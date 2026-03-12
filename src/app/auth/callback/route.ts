import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { checkAchievements } from "@/lib/achievements";
import { cacheEmailFromAuth, touchLastActive, ensurePreferences } from "@/lib/notification-helpers";
import { sendWelcomeNotification } from "@/lib/notification-senders/welcome";
import { sendReferralJoinedNotification } from "@/lib/notification-senders/referral";
import { calculateInstagramXp } from "@/lib/xp";

// Extend timeout for Instagram API calls during login
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/?error=auth_failed`);
  }

  // Instagram user metadata from OAuth
  const instagramHandle = (
    data.user.user_metadata.user_name ??
    data.user.user_metadata.preferred_username ??
    data.user.user_metadata.name ??
    ""
  ).toLowerCase().replace(/\s+/g, "");

  const admin = getSupabaseAdmin();

  if (instagramHandle) {
    // Check if instagrammer already exists in the database
    const { data: existing } = await admin
      .from("instagrammers")
      .select("id, claimed")
      .eq("instagram_handle", instagramHandle)
      .maybeSingle();

    if (!existing) {
      // ─── New instagrammer: create building from Instagram data on login ───
      try {
        const igData = {
          instagram_handle: instagramHandle,
          display_name: data.user.user_metadata.full_name ?? data.user.user_metadata.name ?? instagramHandle,
          avatar_url: data.user.user_metadata.avatar_url ?? data.user.user_metadata.picture ?? null,
          bio: data.user.user_metadata.bio ?? null,
          posts_count: 0,
          followers_count: 0,
          following_count: 0,
          district: "lifestyle",
        };

        const { data: created, error: createErr } = await admin
          .from("instagrammers")
          .upsert({
            ...igData,
            fetched_at: new Date().toISOString(),
            claimed: true,
            claimed_by: data.user.id,
            claimed_at: new Date().toISOString(),
            fetch_priority: 1,
          }, { onConflict: "instagram_handle" })
          .select("id")
          .single();

        if (created && !createErr) {
          // Instagram XP
          const xp = calculateInstagramXp(igData.posts_count, igData.followers_count, igData.following_count);
          if (xp > 0) {
            await admin.rpc("grant_xp", { p_instagrammer_id: created.id, p_source: "instagram", p_amount: xp });
            await admin.from("instagrammers").update({ xp_instagram: xp }).eq("id", created.id);
          }

          // Rank
          await admin.rpc("assign_new_instagrammer_rank", { instagrammer_id: created.id });
          admin.rpc("recalculate_ranks").then(
            () => console.log("Ranks recalculated for new instagrammer:", instagramHandle),
            (err: unknown) => console.error("Rank recalculation failed:", err),
          );

          // Feed event
          await admin.from("activity_feed").insert({
            event_type: "instagrammer_joined",
            actor_id: created.id,
            metadata: { handle: instagramHandle },
          });

          // Notifications
          cacheEmailFromAuth(created.id, data.user.id).catch(() => {});
          ensurePreferences(created.id).catch(() => {});
          sendWelcomeNotification(created.id, instagramHandle);
        }
      } catch (err) {
        console.error("Failed to create instagrammer on login:", err);
      }
    } else if (!existing.claimed) {
      // ─── Legacy instagrammer: claim existing unclaimed building ───
      await admin
        .from("instagrammers")
        .update({
          claimed: true,
          claimed_by: data.user.id,
          claimed_at: new Date().toISOString(),
          fetch_priority: 1,
        })
        .eq("id", existing.id)
        .eq("claimed", false);

      await admin.from("activity_feed").insert({
        event_type: "instagrammer_joined",
        actor_id: existing.id,
        metadata: { handle: instagramHandle },
      });

      cacheEmailFromAuth(existing.id, data.user.id).catch(() => {});
      ensurePreferences(existing.id).catch(() => {});
      sendWelcomeNotification(existing.id, instagramHandle);
    }

    // Fetch instagrammer record for achievement check + referral processing
    try {
      const { data: instagrammer } = await admin
        .from("instagrammers")
        .select("id, posts_count, followers_count, following_count, kudos_count, referral_count, referred_by")
        .eq("instagram_handle", instagramHandle)
        .single();

      if (instagrammer) {
        // Cache email + update last_active_at on every login
        cacheEmailFromAuth(instagrammer.id, data.user.id).catch(() => {});
        touchLastActive(instagrammer.id);

        // Process referral (from ?ref= param forwarded by client)
        const ref = searchParams.get("ref");
        if (ref && ref !== instagramHandle && !instagrammer.referred_by) {
          const { data: referrer } = await admin
            .from("instagrammers")
            .select("id, instagram_handle")
            .eq("instagram_handle", ref.toLowerCase())
            .single();

          if (referrer) {
            await admin
              .from("instagrammers")
              .update({ referred_by: referrer.instagram_handle })
              .eq("id", instagrammer.id);

            await admin.rpc("increment_referral_count", { referrer_instagrammer_id: referrer.id });

            await admin.from("activity_feed").insert({
              event_type: "referral",
              actor_id: referrer.id,
              target_id: instagrammer.id,
              metadata: { referrer_handle: referrer.instagram_handle, referred_handle: instagramHandle },
            });

            // Notify referrer that their referral joined
            sendReferralJoinedNotification(referrer.id, referrer.instagram_handle, instagramHandle, instagrammer.id);

            // Check referral achievements for the referrer
            const { data: referrerFull } = await admin
              .from("instagrammers")
              .select("referral_count, kudos_count, posts_count, followers_count, following_count")
              .eq("id", referrer.id)
              .single();

            if (referrerFull) {
              const giftsSent = await countGifts(admin, referrer.id, "sent");
              const giftsReceived = await countGifts(admin, referrer.id, "received");
              await checkAchievements(referrer.id, {
                posts_count: referrerFull.posts_count,
                followers_count: referrerFull.followers_count,
                following_count: referrerFull.following_count,
                referral_count: referrerFull.referral_count,
                kudos_count: referrerFull.kudos_count,
                gifts_sent: giftsSent,
                gifts_received: giftsReceived,
              }, referrer.instagram_handle);
            }
          }
        }

        // Run achievement check for this instagrammer
        const giftsSent = await countGifts(admin, instagrammer.id, "sent");
        const giftsReceived = await countGifts(admin, instagrammer.id, "received");
        await checkAchievements(instagrammer.id, {
          posts_count: instagrammer.posts_count,
          followers_count: instagrammer.followers_count,
          following_count: instagrammer.following_count,
          referral_count: instagrammer.referral_count ?? 0,
          kudos_count: instagrammer.kudos_count ?? 0,
          gifts_sent: giftsSent,
          gifts_received: giftsReceived,
        }, instagramHandle);
      }
    } catch {
      // Silently skip v2 features if tables/columns don't exist yet
      console.warn("Auth callback: skipping v2 achievement/referral check (migration may not have run)");
    }
  }

  // Support ?next= param for post-login redirect (e.g. /shop)
  const next = searchParams.get("next");
  if (next === "/shop" && instagramHandle) {
    const { data: ig } = await admin
      .from("instagrammers")
      .select("instagram_handle")
      .eq("instagram_handle", instagramHandle)
      .single();

    if (!ig) {
      return NextResponse.redirect(`${origin}/?user=${instagramHandle}`);
    }

    return NextResponse.redirect(`${origin}/shop/${instagramHandle}`);
  }

  return NextResponse.redirect(`${origin}/?user=${instagramHandle}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countGifts(admin: any, instagrammerId: number, direction: "sent" | "received"): Promise<number> {
  const column = direction === "sent" ? "instagrammer_id" : "gifted_to";
  const { count } = await admin
    .from("purchases")
    .select("id", { count: "exact", head: true })
    .eq(column, instagrammerId)
    .eq("status", "completed")
    .not("gifted_to", "is", null);
  return count ?? 0;
}
