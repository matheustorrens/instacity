import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { getSupabaseAdmin } from "@/lib/supabase";
import LeaderboardTracker from "@/components/LeaderboardTracker";
import LeaderboardYouBadge, { LeaderboardAuthProvider } from "@/components/LeaderboardYouBadge";
import LeaderboardUserPosition from "@/components/LeaderboardUserPosition";
import LeaderboardYouVsNext from "@/components/LeaderboardYouVsNext";
import FlyLeaderboard from "@/components/FlyLeaderboard";
import DailiesLeaderboard from "@/components/DailiesLeaderboard";
import { rankFromLevel, tierFromLevel } from "@/lib/xp";

export const revalidate = 300; // ISR: regenerate every 5 min

export const metadata: Metadata = {
  title: "Leaderboard - InstaCity",
  description:
    "Top Instagram creators ranked by posts, followers, following, achievements, and referrals in InstaCity.",
};

interface Instagrammer {
  instagram_handle: string;
  name: string | null;
  avatar_url: string | null;
  posts_count: number;
  followers_count: number;
  following_count: number;
  niche: string | null;
  rank: number | null;
  referral_count: number;
  kudos_count: number;
  created_at?: string;
  xp_total?: number;
  xp_level?: number;
}

type TabId = "posters" | "followers" | "following" | "achievers" | "recruiters" | "xp";

const TABS: { id: TabId; label: string; metric: string }[] = [
  { id: "posters", label: "Posts", metric: "posts_count" },
  { id: "followers", label: "Followers", metric: "followers_count" },
  { id: "following", label: "Following", metric: "following_count" },
  { id: "achievers", label: "Achievers", metric: "achievements" },
  { id: "recruiters", label: "Recruiters", metric: "referral_count" },
  { id: "xp", label: "XP", metric: "xp_total" },
];

const ACCENT = "#c8e64a";

function rankColor(rank: number): string {
  if (rank === 1) return "#ffd700";
  if (rank === 2) return "#c0c0c0";
  if (rank === 3) return "#cd7f32";
  return ACCENT;
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const mode = params.mode ?? "developers";
  const activeTab = (params.tab ?? "posters") as TabId;

  const supabase = getSupabaseAdmin();

  // Fetch instagrammers sorted by the active metric
  // Posters uses rank (based on posts_count) for consistency
  const orderColumn = activeTab === "posters" ? "rank"
    : activeTab === "followers" ? "followers_count"
    : activeTab === "following" ? "following_count"
    : activeTab === "recruiters" ? "referral_count"
    : activeTab === "xp" ? "xp_total"
    : "posts_count"; // achievers handled separately
  const orderAscending = activeTab === "posters"; // rank is ascending (1 = best)

  let instagrammers: Instagrammer[] = [];
  let achieverCounts: Record<string, number> = {};

  if (activeTab === "achievers") {
    // DB-side aggregation: get top 50 instagrammers by achievement count
    const { data: topAchievers } = await supabase
      .rpc("top_achievers", { lim: 50 });

    const achieverIds = (topAchievers ?? []).map((a: { instagrammer_id: number }) => a.instagrammer_id);
    const achCountMap: Record<number, number> = {};
    for (const a of topAchievers ?? []) {
      achCountMap[a.instagrammer_id] = a.ach_count;
    }

    // Fetch instagrammer details only for the top achievers
    const { data: achieverInsts } = achieverIds.length > 0
      ? await supabase
        .from("instagrammers")
        .select("id, instagram_handle, name, avatar_url, posts_count, followers_count, following_count, district, rank, referral_count, kudos_count, created_at, xp_total, xp_level")
        .in("id", achieverIds)
      : { data: [] };

    // Sort by achievement count (preserving DB order)
    const sorted = (achieverInsts ?? [])
      .map((d) => ({ ...d, ach_count: achCountMap[d.id] ?? 0 }))
      .sort((a, b) => b.ach_count - a.ach_count || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    instagrammers = sorted.map(d => ({ ...d, instagram_handle: d.instagram_handle, niche: d.district })) as unknown as Instagrammer[];
    for (const d of sorted) {
      achieverCounts[d.instagram_handle] = d.ach_count;
    }
  } else {
    const { data } = await supabase
      .from("instagrammers")
      .select("instagram_handle, name, avatar_url, posts_count, followers_count, following_count, district, rank, referral_count, kudos_count, created_at, xp_total, xp_level")
      .order(orderColumn, { ascending: orderAscending, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(50);
    instagrammers = (data ?? []).map(d => ({ ...d, niche: d.district })) as Instagrammer[];
  }

  // Check if recruiters tab should be hidden (no referral data)
  const hasRecruiters = activeTab === "recruiters"
    ? instagrammers.some((d) => (d.referral_count ?? 0) > 0)
    : true;

  const topLogins = instagrammers.map((d) => d.instagram_handle.toLowerCase());

  function getMetricValue(inst: Instagrammer): string {
    switch (activeTab) {
      case "posters": return inst.posts_count.toLocaleString();
      case "followers": return inst.followers_count.toLocaleString();
      case "following": return inst.following_count.toLocaleString();
      case "achievers": return String(achieverCounts[inst.instagram_handle] ?? 0);
      case "recruiters": return (inst.referral_count ?? 0).toLocaleString();
      case "xp": return (inst.xp_total ?? 0).toLocaleString();
      default: return "";
    }
  }

  function getXpBadge(inst: Instagrammer): { title: string; color: string } | null {
    if (activeTab !== "xp" || !inst.xp_level) return null;
    const rank = rankFromLevel(inst.xp_level);
    const tier = tierFromLevel(inst.xp_level);
    return { title: `Lv${inst.xp_level} ${rank.title}`, color: tier.color };
  }

  const metricLabel = activeTab === "posters" ? "Posts"
    : activeTab === "followers" ? "Followers"
    : activeTab === "following" ? "Following"
    : activeTab === "achievers" ? "Achievements"
    : activeTab === "xp" ? "XP"
    : "Referrals";

  // A4: Raw metric values for "You vs. Next" component
  function getMetricValueRaw(inst: Instagrammer): number {
    switch (activeTab) {
      case "posters": return inst.posts_count;
      case "followers": return inst.followers_count;
      case "following": return inst.following_count;
      case "achievers": return achieverCounts[inst.instagram_handle] ?? 0;
      case "recruiters": return inst.referral_count ?? 0;
      case "xp": return inst.xp_total ?? 0;
      default: return 0;
    }
  }

  const devMetrics = instagrammers.map((d) => ({
    login: d.instagram_handle.toLowerCase(),
    value: getMetricValueRaw(d),
  }));

  // A6: "NEW" detection — instagrammers created in last 7 days
  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const newLogins = new Set(
    instagrammers
      .filter((d) => d.created_at && new Date(d.created_at).getTime() > sevenDaysAgo)
      .map((d) => d.instagram_handle.toLowerCase())
  );

  return (
    <LeaderboardAuthProvider>
    <main className="min-h-screen bg-bg font-pixel uppercase text-warm">
      <LeaderboardTracker tab={activeTab} />
      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs text-muted transition-colors hover:text-cream"
          >
            &larr; Back to City
          </Link>
        </div>

        <div className="mt-6 text-center">
          <h1 className="text-3xl text-cream md:text-4xl">
            Leader<span style={{ color: ACCENT }}>board</span>
          </h1>
          <p className="mt-3 text-xs text-muted normal-case">
            Top creators ranked in InstaCity
          </p>
        </div>

        {/* Mode toggle: Creators | Game */}
        <div className="mt-6 flex justify-center">
          <div className="flex border-2 border-border">
            <Link
              href="/leaderboard?mode=developers"
              className="px-5 py-2 text-[11px] transition-colors"
              style={{
                color: mode === "developers" ? ACCENT : "var(--color-muted)",
                backgroundColor: mode === "developers" ? "rgba(200, 230, 74, 0.1)" : "transparent",
              }}
            >
              Creators
            </Link>
            <Link
              href="/leaderboard?mode=game"
              className="relative border-l-2 border-border px-5 py-2 text-[11px] transition-colors"
              style={{
                color: mode === "game" ? ACCENT : "var(--color-muted)",
                backgroundColor: mode === "game" ? "rgba(200, 230, 74, 0.1)" : "transparent",
              }}
            >
              Game
            </Link>
            <Link
              href="/leaderboard?mode=dailies"
              className="relative border-l-2 border-border px-5 py-2 text-[11px] transition-colors"
              style={{
                color: mode === "dailies" ? ACCENT : "var(--color-muted)",
                backgroundColor: mode === "dailies" ? "rgba(200, 230, 74, 0.1)" : "transparent",
              }}
            >
              Dailies
            </Link>
          </div>
        </div>

        {mode === "dailies" ? (
          <Suspense
            fallback={
              <div className="mt-10 text-center text-xs text-muted normal-case">
                Loading dailies leaderboard...
              </div>
            }
          >
            <DailiesLeaderboard />
          </Suspense>
        ) : mode === "developers" ? (
          <>
            {/* Tabs */}
            <div className="mt-6 flex flex-wrap justify-center gap-1">
              {TABS.filter((t) => t.id !== "recruiters" || hasRecruiters).map((tab) => (
                <Link
                  key={tab.id}
                  href={`/leaderboard?tab=${tab.id}`}
                  className="px-3 py-1.5 text-[10px] transition-colors border-2"
                  style={{
                    borderColor: activeTab === tab.id ? ACCENT : "var(--color-border)",
                    color: activeTab === tab.id ? ACCENT : "var(--color-muted)",
                    backgroundColor: activeTab === tab.id ? "rgba(200, 230, 74, 0.1)" : "transparent",
                  }}
                >
                  {tab.label}
                </Link>
              ))}
            </div>

            {/* A4: "You vs. Next" banner */}
            <LeaderboardYouVsNext metrics={devMetrics} metricLabel={metricLabel} />

            {/* Table */}
            <div className="mt-6 border-[3px] border-border">
              <div className="flex items-center gap-4 border-b-[3px] border-border bg-bg-card px-5 py-3 text-xs text-muted">
                <span className="w-10 text-center">#</span>
                <span className="flex-1">Creator</span>
                <span className="hidden w-24 text-right sm:block">{activeTab === "xp" ? "Rank" : "Niche"}</span>
                <span className="w-28 text-right">{metricLabel}</span>
              </div>

              {/* Rows */}
              {instagrammers.map((inst, i) => {
                const pos = i + 1;
                return (
                  <Link
                    key={inst.instagram_handle}
                    href={`/dev/${inst.instagram_handle}`}
                    className="flex items-center gap-4 border-b border-border/50 px-5 py-3.5 transition-colors hover:bg-bg-card"
                  >
                    <span className="w-10 text-center">
                      <span
                        className="text-sm font-bold"
                        style={{ color: rankColor(pos) }}
                      >
                        {pos}
                      </span>
                      {newLogins.has(inst.instagram_handle.toLowerCase()) && (
                        <span className="block text-[7px] font-bold" style={{ color: "#ffd700" }}>
                          NEW
                        </span>
                      )}
                    </span>

                    <div className="flex flex-1 items-center gap-3 overflow-hidden">
                      {inst.avatar_url && (
                        <Image
                          src={inst.avatar_url}
                          alt={inst.instagram_handle}
                          width={36}
                          height={36}
                          className="border-2 border-border"
                          style={{ imageRendering: "pixelated" }}
                        />
                      )}
                      <div className="overflow-hidden">
                        <p className="truncate text-sm text-cream">
                          {inst.name ?? inst.instagram_handle}
                          <LeaderboardYouBadge login={inst.instagram_handle} />
                        </p>
                        {inst.name && (
                          <p className="truncate text-[10px] text-muted">
                            @{inst.instagram_handle}
                          </p>
                        )}
                      </div>
                    </div>

                    <span className="hidden w-24 text-right text-xs text-muted sm:block">
                      {activeTab === "xp"
                        ? (() => {
                            const badge = getXpBadge(inst);
                            return badge ? (
                              <span style={{ color: badge.color }}>{badge.title}</span>
                            ) : "\u2014";
                          })()
                        : (inst.niche ?? "\u2014")}
                    </span>

                    <span className="w-28 text-right text-sm" style={{ color: activeTab === "xp" ? tierFromLevel(inst.xp_level ?? 1).color : ACCENT }}>
                      {getMetricValue(inst)}
                    </span>
                  </Link>
                );
              })}

              {/* "YOU" row if not in top 50 — handled client-side */}
              <LeaderboardUserPosition tab={activeTab} topLogins={topLogins} />

              {instagrammers.length === 0 && (
                <div className="px-5 py-8 text-center text-xs text-muted normal-case">
                  No data for this category yet.
                </div>
              )}
            </div>
          </>
        ) : (
          <Suspense
            fallback={
              <div className="mt-10 text-center text-xs text-muted normal-case">
                Loading daily scores...
              </div>
            }
          >
            <FlyLeaderboard />
          </Suspense>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <Link
            href="/"
            className="btn-press inline-block px-7 py-3.5 text-sm text-bg"
            style={{
              backgroundColor: ACCENT,
              boxShadow: "4px 4px 0 0 #5a7a00",
            }}
          >
            Enter the City
          </Link>

          <p className="mt-6 text-[9px] text-muted normal-case">
            built by{" "}
            <a
              href="https://x.com/samuelrizzondev"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-cream"
              style={{ color: ACCENT }}
            >
              @samuelrizzondev
            </a>
          </p>
        </div>
      </div>
    </main>
    </LeaderboardAuthProvider>
  );
}
