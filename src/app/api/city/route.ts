import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = Math.max(0, parseInt(searchParams.get("from") ?? "0", 10));
  const to = Math.min(
    from + 1000,
    parseInt(searchParams.get("to") ?? "500", 10)
  );

  const sb = getSupabaseAdmin();

  // Round 1: instagrammers + stats in parallel
  const [instagrammersResult, statsResult] = await Promise.all([
    sb
      .from("instagrammers")
      .select(
        "id, instagram_handle, name, avatar_url, posts_count, followers_count, following_count, district, rank, claimed, kudos_count, visit_count, app_streak, rabbit_completed, district_chosen, xp_total, xp_level, raid_xp, current_week_posts, current_week_kudos_given, current_week_kudos_received"
      )
      .order("rank", { ascending: true })
      .range(from, to - 1),
    sb.from("city_stats").select("*").eq("id", 1).single(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instagrammers = (instagrammersResult.data ?? []) as Record<string, any>[];
  const instagrammerIds = instagrammers.map((d: Record<string, any>) => d.id);

  if (instagrammerIds.length === 0) {
    return NextResponse.json(
      {
        instagrammers: [],
        stats: statsResult.data ?? { total_instagrammers: 0, total_posts: 0 },
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  }

  // Round 2: purchases + customizations + achievements + raid tags in parallel
  const [purchasesResult, giftPurchasesResult, customizationsResult, achievementsResult, raidTagsResult] = await Promise.all([
    sb
      .from("purchases")
      .select("instagrammer_id, item_id")
      .in("instagrammer_id", instagrammerIds)
      .is("gifted_to", null)
      .eq("status", "completed"),
    sb
      .from("purchases")
      .select("gifted_to, item_id")
      .in("gifted_to", instagrammerIds)
      .eq("status", "completed"),
    sb
      .from("instagrammer_customizations")
      .select("instagrammer_id, item_id, config")
      .in("instagrammer_id", instagrammerIds)
      .in("item_id", ["custom_color", "billboard", "loadout"]),
    sb
      .from("instagrammer_achievements")
      .select("instagrammer_id, achievement_id")
      .in("instagrammer_id", instagrammerIds),
    sb
      .from("raid_tags")
      .select("building_id, attacker_login, tag_style, expires_at")
      .in("building_id", instagrammerIds)
      .eq("active", true),
  ]);

  // Build owned items map (direct purchases + received gifts)
  const ownedItemsMap: Record<number, string[]> = {};
  for (const row of purchasesResult.data ?? []) {
    if (!ownedItemsMap[row.instagrammer_id]) ownedItemsMap[row.instagrammer_id] = [];
    ownedItemsMap[row.instagrammer_id].push(row.item_id);
  }
  for (const row of giftPurchasesResult.data ?? []) {
    const instId = row.gifted_to as number;
    if (!ownedItemsMap[instId]) ownedItemsMap[instId] = [];
    ownedItemsMap[instId].push(row.item_id);
  }

  // Build customization maps
  const customColorMap: Record<number, string> = {};
  const billboardImagesMap: Record<number, string[]> = {};
  const loadoutMap: Record<number, { crown: string | null; roof: string | null; aura: string | null }> = {};
  for (const row of customizationsResult.data ?? []) {
    const config = row.config as Record<string, unknown>;
    if (row.item_id === "custom_color" && typeof config?.color === "string") {
      customColorMap[row.instagrammer_id] = config.color;
    }
    if (row.item_id === "billboard") {
      if (Array.isArray(config?.images)) {
        billboardImagesMap[row.instagrammer_id] = config.images as string[];
      } else if (typeof config?.image_url === "string") {
        billboardImagesMap[row.instagrammer_id] = [config.image_url];
      }
    }
    if (row.item_id === "loadout") {
      loadoutMap[row.instagrammer_id] = {
        crown: (config?.crown as string) ?? null,
        roof: (config?.roof as string) ?? null,
        aura: (config?.aura as string) ?? null,
      };
    }
  }

  // Build achievements map
  const achievementsMap: Record<number, string[]> = {};
  for (const row of achievementsResult.data ?? []) {
    if (!achievementsMap[row.instagrammer_id]) achievementsMap[row.instagrammer_id] = [];
    achievementsMap[row.instagrammer_id].push(row.achievement_id);
  }

  // Build raid tags map (1 active tag per building)
  const raidTagMap: Record<number, { attacker_login: string; tag_style: string; expires_at: string }> = {};
  for (const row of raidTagsResult.data ?? []) {
    raidTagMap[row.building_id] = {
      attacker_login: row.attacker_login,
      tag_style: row.tag_style,
      expires_at: row.expires_at,
    };
  }

  // Merge everything
  const instagrammersWithItems = instagrammers.map((inst) => ({
    ...inst,
    kudos_count: inst.kudos_count ?? 0,
    visit_count: inst.visit_count ?? 0,
    owned_items: ownedItemsMap[inst.id] ?? [],
    custom_color: customColorMap[inst.id] ?? null,
    billboard_images: billboardImagesMap[inst.id] ?? [],
    achievements: achievementsMap[inst.id] ?? [],
    loadout: loadoutMap[inst.id] ?? null,
    app_streak: inst.app_streak ?? 0,
    raid_xp: inst.raid_xp ?? 0,
    current_week_posts: inst.current_week_posts ?? 0,
    current_week_kudos_given: inst.current_week_kudos_given ?? 0,
    current_week_kudos_received: inst.current_week_kudos_received ?? 0,
    active_raid_tag: raidTagMap[inst.id] ?? null,
    rabbit_completed: inst.rabbit_completed ?? false,
    xp_total: inst.xp_total ?? 0,
    xp_level: inst.xp_level ?? 1,
  }));

  return NextResponse.json(
    {
      instagrammers: instagrammersWithItems,
      stats: statsResult.data ?? {
        total_instagrammers: 0,
        total_posts: 0,
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
