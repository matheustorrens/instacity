import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { checkAchievements } from "@/lib/achievements";
import { ITEM_NAMES } from "@/lib/zones";
import { touchLastActive } from "@/lib/notification-helpers";
import { sendStreakMilestoneNotification } from "@/lib/notification-senders/streak";
import { sendStreakBrokenNotification } from "@/lib/notification-senders/streak-broken";
import { trackDailyMission } from "@/lib/dailies";
import type { SupabaseClient } from "@supabase/supabase-js";

// A12: Streak reward milestones — {milestone: days, pool: item_ids to pick from}
const STREAK_MILESTONES = [
  { milestone: 3,  pool: ["flag"] },
  { milestone: 7,  pool: ["satellite_dish", "antenna_array", "rooftop_garden", "neon_trim"] },
  { milestone: 14, pool: ["neon_outline", "rooftop_fire", "hologram_ring"] },
  { milestone: 30, pool: ["lightning_aura", "pool_party", "crown_item"] },
];

async function grantStreakReward(
  sb: SupabaseClient,
  instagrammerId: number,
  streak: number,
): Promise<{ milestone: number; item_id: string; item_name: string } | null> {
  // Find highest unclaimed milestone the user qualifies for
  for (const tier of [...STREAK_MILESTONES].reverse()) {
    if (streak < tier.milestone) continue;

    // Check if already claimed
    const { data: existing } = await sb
      .from("streak_rewards")
      .select("id")
      .eq("instagrammer_id", instagrammerId)
      .eq("milestone", tier.milestone)
      .maybeSingle();
    if (existing) continue;

    // Pick a random item from pool that user doesn't own yet
    const { data: ownedRows } = await sb
      .from("purchases")
      .select("item_id")
      .eq("instagrammer_id", instagrammerId)
      .eq("status", "completed");
    const ownedSet = new Set((ownedRows ?? []).map((r: { item_id: string }) => r.item_id));

    const unowned = tier.pool.filter((id) => !ownedSet.has(id));
    const itemId = unowned.length > 0
      ? unowned[Math.floor(Math.random() * unowned.length)]
      : tier.pool[Math.floor(Math.random() * tier.pool.length)]; // fallback: grant anyway

    // Grant the item
    await sb.from("purchases").insert({
      instagrammer_id: instagrammerId,
      item_id: itemId,
      provider: "free",
      provider_tx_id: `streak_reward_${tier.milestone}_${instagrammerId}`,
      amount_cents: 0,
      currency: "usd",
      status: "completed",
    });

    // Record the reward
    await sb.from("streak_rewards").insert({
      instagrammer_id: instagrammerId,
      milestone: tier.milestone,
      item_id: itemId,
    });

    return {
      milestone: tier.milestone,
      item_id: itemId,
      item_name: ITEM_NAMES[itemId] ?? itemId,
    };
  }

  return null;
}

export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Per-user rate limit: 1 req/5s
  const { ok } = rateLimit(`checkin:${user.id}`, 1, 5000);
  if (!ok) {
    return NextResponse.json({ error: "Too fast" }, { status: 429 });
  }

  const instagramHandle = (
    user.user_metadata?.user_name ??
    user.user_metadata?.preferred_username ??
    user.user_metadata?.name ??
    ""
  ).toLowerCase().replace(/\s+/g, "");

  if (!instagramHandle) {
    return NextResponse.json({ error: "No Instagram handle" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Fetch instagrammer (must be claimed)
  const { data: instagrammer } = await sb
    .from("instagrammers")
    .select("id, claimed, posts_count, followers_count, following_count, kudos_count, app_streak, streak_freeze_30d_claimed, last_checkin_date")
    .eq("instagram_handle", instagramHandle)
    .single();

  if (!instagrammer || !instagrammer.claimed) {
    return NextResponse.json({ error: "Must claim building first" }, { status: 403 });
  }

  // Perform check-in via RPC
  const { data: result, error: rpcError } = await sb.rpc("perform_checkin", {
    p_instagrammer_id: instagrammer.id,
  });

  if (rpcError) {
    console.error("perform_checkin RPC error:", rpcError);
    return NextResponse.json({ error: "Check-in failed" }, { status: 500 });
  }

  const checkinResult = result as {
    checked_in: boolean;
    already_today?: boolean;
    streak: number;
    longest: number;
    was_frozen?: boolean;
    error?: string;
  };

  if (checkinResult.error) {
    return NextResponse.json({ error: checkinResult.error }, { status: 400 });
  }

  // Track activity
  touchLastActive(instagrammer.id);
  trackDailyMission(instagrammer.id, "checkin");

  // Detect streak broken: previous streak was >= 7, now reset to 1, and freeze didn't save them
  const previousStreak = instagrammer.app_streak ?? 0;
  if (
    checkinResult.checked_in &&
    checkinResult.streak === 1 &&
    previousStreak >= 7 &&
    !checkinResult.was_frozen
  ) {
    const today = new Date().toISOString().split("T")[0];
    sendStreakBrokenNotification(instagrammer.id, instagramHandle, previousStreak, today);
  }

  let newAchievements: string[] = [];
  let streakReward: { milestone: number; item_id: string; item_name: string } | null = null;
  let xpResult: { granted: number; new_total: number; new_level: number } | null = null;

  // Grant XP for check-in
  if (checkinResult.checked_in) {
    const { data: xpData } = await sb.rpc("grant_xp", { p_instagrammer_id: instagrammer.id, p_source: "checkin", p_amount: 10 });
    if (xpData) xpResult = xpData as { granted: number; new_total: number; new_level: number };
  }

  if (checkinResult.checked_in) {
    // Check achievements with updated streak
    const referralCount = 0; // Not fetched here, achievements will check existing unlocks
    const giftsSent = 0;
    const giftsReceived = 0;

    newAchievements = await checkAchievements(instagrammer.id, {
      posts_count: instagrammer.posts_count,
      followers_count: instagrammer.followers_count,
      following_count: instagrammer.following_count,
      referral_count: referralCount,
      kudos_count: instagrammer.kudos_count ?? 0,
      gifts_sent: giftsSent,
      gifts_received: giftsReceived,
      app_streak: checkinResult.streak,
    }, instagramHandle);

    // Grant 1 free freeze at 30-day streak milestone
    if (checkinResult.streak >= 30 && !instagrammer.streak_freeze_30d_claimed) {
      await sb.rpc("grant_streak_freeze", { p_instagrammer_id: instagrammer.id });
      await sb
        .from("instagrammers")
        .update({ streak_freeze_30d_claimed: true })
        .eq("id", instagrammer.id);
      await sb.from("streak_freeze_log").insert({
        instagrammer_id: instagrammer.id,
        action: "granted_milestone",
      });
    }

    // A12: Streak rewards - grant free items at milestones
    streakReward = await grantStreakReward(sb, instagrammer.id, checkinResult.streak);

    // Streak milestone notifications (7, 30, 100, 365)
    if ([7, 30, 100, 365].includes(checkinResult.streak)) {
      sendStreakMilestoneNotification(
        instagrammer.id,
        instagramHandle,
        checkinResult.streak,
        checkinResult.longest,
        streakReward?.item_name,
      );
    }

    // Insert feed event
    await sb.from("activity_feed").insert({
      event_type: "streak_checkin",
      actor_id: instagrammer.id,
      metadata: {
        handle: instagramHandle,
        streak: checkinResult.streak,
        was_frozen: checkinResult.was_frozen ?? false,
        reward: streakReward?.item_id ?? null,
      },
    });
  }

  // Count unseen achievements
  const { count: unseenCount } = await sb
    .from("instagrammer_achievements")
    .select("achievement_id", { count: "exact", head: true })
    .eq("instagrammer_id", instagrammer.id)
    .eq("seen", false);

  // Fetch kudos received since last check-in
  const { data: recentKudos } = await sb
    .from("instagrammer_kudos")
    .select("giver_id, given_date")
    .eq("receiver_id", instagrammer.id)
    .order("given_date", { ascending: false })
    .limit(10);

  // Fetch raids targeting this instagrammer since last checkin (raids table may not exist yet)
  let raidsSinceLast: { attacker_handle: string; success: boolean; created_at: string }[] = [];
  try {
    const lastCheckin = instagrammer.last_checkin_date as string | null;
    const { data: recentRaids } = await sb
      .from("raids")
      .select("attacker_id, success, created_at, attacker:instagrammers!raids_attacker_id_fkey(instagram_handle)")
      .eq("defender_id", instagrammer.id)
      .gt("created_at", lastCheckin ?? "1970-01-01")
      .order("created_at", { ascending: false })
      .limit(5);

    raidsSinceLast = (recentRaids ?? []).map((r) => ({
      attacker_handle: (r.attacker as unknown as { instagram_handle: string })?.instagram_handle ?? "unknown",
      success: r.success,
      created_at: r.created_at,
    }));
  } catch {
    // raids table may not exist yet
  }

  return NextResponse.json({
    checked_in: checkinResult.checked_in,
    already_today: checkinResult.already_today ?? false,
    streak: checkinResult.streak,
    longest: checkinResult.longest,
    was_frozen: checkinResult.was_frozen ?? false,
    new_achievements: newAchievements,
    unseen_count: unseenCount ?? 0,
    kudos_since_last: recentKudos?.length ?? 0,
    raids_since_last: raidsSinceLast,
    streak_reward: streakReward,
    xp: xpResult,
  });
}
