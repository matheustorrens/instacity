import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/rate-limit";
import { getDailyMissions, getTodayStr } from "@/lib/dailies";
import { checkAchievements } from "@/lib/achievements";

export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { ok } = rateLimit(`dailies-claim:${user.id}`, 2, 10_000);
  if (!ok) {
    return NextResponse.json({ error: "Too fast" }, { status: 429 });
  }

  const instagramHandle = (
    user.user_metadata?.user_name ??
    user.user_metadata?.preferred_username ??
    user.user_metadata?.name ??
    ""
  ).toLowerCase().replace(/\s+/g, "");

  const admin = getSupabaseAdmin();

  const { data: instagrammer } = await admin
    .from("instagrammers")
    .select("id, claimed, posts_count, followers_count, following_count, kudos_count, dailies_completed, dailies_streak, last_dailies_date")
    .eq("instagram_handle", instagramHandle)
    .single();

  if (!instagrammer || !instagrammer.claimed) {
    return NextResponse.json({ error: "Must claim building first" }, { status: 403 });
  }

  const today = getTodayStr();

  // Already claimed today
  if (instagrammer.last_dailies_date === today) {
    return NextResponse.json({ error: "Already claimed today" }, { status: 400 });
  }

  // Verify all 3 missions are completed
  const missions = getDailyMissions(instagrammer.id, today);
  const { data: progressRows } = await admin
    .from("daily_mission_progress")
    .select("mission_id, completed")
    .eq("instagrammer_id", instagrammer.id)
    .eq("mission_date", today);

  const completedSet = new Set(
    (progressRows ?? []).filter((r) => r.completed).map((r) => r.mission_id),
  );

  const allDone = missions.every((m) => completedSet.has(m.id));
  if (!allDone) {
    return NextResponse.json({ error: "Not all missions completed" }, { status: 400 });
  }

  // Complete dailies via RPC (handles streak + total atomically)
  const { data: result, error: rpcError } = await admin.rpc("complete_all_dailies", {
    p_instagrammer_id: instagrammer.id,
  });

  if (rpcError) {
    console.error("[dailies] claim RPC error:", rpcError);
    return NextResponse.json({ error: "Failed to claim" }, { status: 500 });
  }

  const claimResult = result as {
    already_completed: boolean;
    streak: number;
    total: number;
  };

  if (claimResult.already_completed) {
    return NextResponse.json({ error: "Already claimed today" }, { status: 400 });
  }

  // Grant XP for completing all dailies
  admin.rpc("grant_xp", { p_instagrammer_id: instagrammer.id, p_source: "dailies", p_amount: 25 }).then();

  // Grant streak freeze every 7 completions (cap at 2)
  let freezeGranted = false;
  if (claimResult.total % 7 === 0) {
    const { data: igFreeze } = await admin
      .from("instagrammers")
      .select("streak_freeze_count")
      .eq("id", instagrammer.id)
      .single();

    if ((igFreeze?.streak_freeze_count ?? 0) < 2) {
      await admin.rpc("grant_streak_freeze", { p_instagrammer_id: instagrammer.id });
      await admin.from("streak_freeze_log").insert({
        instagrammer_id: instagrammer.id,
        action: "granted_dailies",
      });
      freezeGranted = true;
    }
  }

  // Insert activity feed event
  await admin.from("activity_feed").insert({
    event_type: "dailies_completed",
    actor_id: instagrammer.id,
    metadata: {
      handle: instagramHandle,
      streak: claimResult.streak,
      total: claimResult.total,
    },
  });

  // Check dailies achievements
  await checkAchievements(
    instagrammer.id,
    {
      posts_count: instagrammer.posts_count ?? 0,
      followers_count: instagrammer.followers_count ?? 0,
      following_count: instagrammer.following_count ?? 0,
      referral_count: 0,
      kudos_count: instagrammer.kudos_count ?? 0,
      gifts_sent: 0,
      gifts_received: 0,
      dailies_completed: claimResult.total,
    },
    instagramHandle,
  );

  return NextResponse.json({
    ok: true,
    streak: claimResult.streak,
    total: claimResult.total,
    freeze_granted: freezeGranted,
  });
}
