import { getSupabaseAdmin } from "./supabase";
import { sendAchievementNotification } from "./notification-senders/achievement";
import { xpForAchievementTier } from "./xp";

// ─── Types ───────────────────────────────────────────────────

export interface Achievement {
  id: string;
  category: string;
  name: string;
  description: string;
  threshold: number;
  tier: "bronze" | "silver" | "gold" | "diamond";
  reward_type: "unlock_item" | "exclusive_badge";
  reward_item_id: string | null;
  sort_order: number;
}

export interface DeveloperAchievement {
  developer_id: number;
  achievement_id: string;
  unlocked_at: string;
  seen: boolean;
}

export const TIER_COLORS: Record<string, string> = {
  bronze: "#cd7f32",
  silver: "#c0c0c0",
  gold: "#ffd700",
  diamond: "#b9f2ff",
};

export const TIER_EMOJI: Record<string, string> = {
  bronze: "\u{1F7E4}", // brown circle
  silver: "\u{26AA}",  // white circle
  gold: "\u{1F7E1}",   // yellow circle
  diamond: "\u{1F48E}", // gem
};

/** Numeric order for sorting tiers lowest → highest. */
export const TIER_ORDER: Record<string, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  diamond: 3,
};

// ─── Core Logic ──────────────────────────────────────────────

interface InstagrammerStats {
  posts_count: number;
  followers_count: number;
  following_count: number;
  referral_count: number;
  kudos_count: number;
  gifts_sent: number;
  gifts_received: number;
  app_streak?: number;
  kudos_streak?: number;
  raid_xp?: number;
  /** Number of shop items purchased (paid or free). */
  purchases?: number;
  dailies_completed?: number;
}

/**
 * Check and unlock new achievements for an instagrammer.
 * - Finds all achievements the user qualifies for but hasn't unlocked yet
 * - Batch inserts unlocks
 * - Grants free items for unlock_item rewards
 * - Inserts feed events
 * Returns array of newly unlocked achievement IDs.
 */
export async function checkAchievements(
  instagrammerId: number,
  stats: InstagrammerStats,
  actorHandle?: string
): Promise<string[]> {
  const sb = getSupabaseAdmin();

  // Fetch all achievements not yet unlocked by this instagrammer
  const [allRes, unlockedRes] = await Promise.all([
    sb.from("achievements").select("id, category, threshold, tier, name, reward_type, reward_item_id"),
    sb
      .from("instagrammer_achievements")
      .select("achievement_id")
      .eq("instagrammer_id", instagrammerId),
  ]);

  const unlocked = new Set(
    (unlockedRes.data ?? []).map((r) => r.achievement_id)
  );
  const eligible = (allRes.data ?? []).filter(
    (a) => !unlocked.has(a.id)
  ) as Achievement[];

  // Filter by stats thresholds
  const newUnlocks = eligible.filter((a) => {
    switch (a.category) {
      case "commits":
        return stats.posts_count >= a.threshold;
      case "repos":
        return stats.followers_count >= a.threshold;
      case "stars":
        return stats.following_count >= a.threshold;
      case "social":
        return stats.referral_count >= a.threshold;
      case "kudos":
        return stats.kudos_count >= a.threshold;
      case "gifts_sent":
        return stats.gifts_sent >= a.threshold;
      case "gifts_received":
        return stats.gifts_received >= a.threshold;
      case "streak":
        return (stats.app_streak ?? 0) >= a.threshold;
      case "kudos_streak":
        return (stats.kudos_streak ?? 0) >= a.threshold;
      case "raid":
        return (stats.raid_xp ?? 0) >= a.threshold;
      case "purchases":
        return (stats.purchases ?? 0) >= a.threshold;
      case "dailies":
        return (stats.dailies_completed ?? 0) >= a.threshold;
      default:
        return false;
    }
  });

  if (newUnlocks.length === 0) return [];

  // Batch insert instagrammer_achievements
  const unlockRows = newUnlocks.map((a) => ({
    instagrammer_id: instagrammerId,
    achievement_id: a.id,
  }));

  await sb
    .from("instagrammer_achievements")
    .upsert(unlockRows, { onConflict: "instagrammer_id,achievement_id" });

  // Grant free items for unlock_item rewards
  const itemRewards = newUnlocks.filter(
    (a) => a.reward_type === "unlock_item" && a.reward_item_id
  );

  if (itemRewards.length > 0) {
    const purchaseRows = itemRewards.map((a) => ({
      instagrammer_id: instagrammerId,
      item_id: a.reward_item_id!,
      provider: "achievement",
      provider_tx_id: `achievement_${instagrammerId}_${a.id}`,
      amount_cents: 0,
      currency: "usd",
      status: "completed",
    }));

    // Batch upsert — unique index on (instagrammer_id, item_id) prevents duplicates
    await sb
      .from("purchases")
      .upsert(purchaseRows, { onConflict: "instagrammer_id,item_id" });
  }

  // Grant XP for each achievement unlock
  for (const a of newUnlocks) {
    const xpAmount = xpForAchievementTier(a.tier);
    if (xpAmount > 0) {
      sb.rpc("grant_xp", {
        p_instagrammer_id: instagrammerId,
        p_source: "achievement",
        p_amount: xpAmount,
      }).then();
    }
  }

  // Insert feed events
  if (newUnlocks.length === 1) {
    const a = newUnlocks[0];
    await sb.from("activity_feed").insert({
      event_type: "achievement_unlocked",
      actor_id: instagrammerId,
      metadata: {
        handle: actorHandle,
        achievement_id: a.id,
        achievement_name: a.name,
        tier: a.tier,
      },
    });
  } else {
    // Aggregated: "@user unlocked N achievements"
    await sb.from("activity_feed").insert({
      event_type: "achievement_unlocked",
      actor_id: instagrammerId,
      metadata: {
        handle: actorHandle,
        count: newUnlocks.length,
        achievements: newUnlocks.map((a) => ({
          id: a.id,
          name: a.name,
          tier: a.tier,
        })),
      },
    });
  }

  // Notify instagrammer of gold/diamond achievements (fire-and-forget)
  if (actorHandle) {
    void (async () => {
      try {
        sendAchievementNotification(
          instagrammerId,
          actorHandle,
          newUnlocks.map((a) => ({ id: a.id, name: a.name, tier: a.tier })),
        );
      } catch (err: unknown) {
        console.error("[achievements] notification failed", err);
      }
    })();
  }

  return newUnlocks.map((a) => a.id);
}

/** Max IDs per Supabase `.in()` query to avoid URL length limits. */
const CHUNK_SIZE = 500;

/**
 * Batch fetch achievements for multiple developers (for city API).
 * Automatically chunks large ID arrays to stay within Supabase query limits.
 */
export async function getAchievementsForDevelopers(
  developerIds: number[]
): Promise<Record<number, string[]>> {
  if (developerIds.length === 0) return {};

  const sb = getSupabaseAdmin();

  // Split into chunks to avoid Supabase .in() URL length limits
  const chunks: number[][] = [];
  for (let i = 0; i < developerIds.length; i += CHUNK_SIZE) {
    chunks.push(developerIds.slice(i, i + CHUNK_SIZE));
  }

  const rows = (
    await Promise.all(
      chunks.map((chunk) =>
        sb
          .from("developer_achievements")
          .select("developer_id, achievement_id")
          .in("developer_id", chunk)
          .then(({ data }) => data ?? [])
      )
    )
  ).flat();

  const result: Record<number, string[]> = {};
  for (const row of rows) {
    if (!result[row.developer_id]) result[row.developer_id] = [];
    result[row.developer_id].push(row.achievement_id);
  }
  return result;
}
