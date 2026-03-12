import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase";
import { createServerSupabase } from "@/lib/supabase-server";
import { calculateInstagramXp } from "@/lib/xp";

// Allow up to 60s on Vercel (Pro plan)
export const maxDuration = 60;

// ─── Rate Limiting ───────────────────────────────────────────
async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function isRateLimited(key: string): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const ipHash = await hashKey(key);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await sb
    .from("add_requests")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", oneHourAgo);

  return (count ?? 0) >= 10;
}

async function recordRateLimitRequest(key: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const ipHash = await hashKey(key);
  await sb.from("add_requests").insert({ ip_hash: ipHash });
}

async function resolveRateLimitKey(request: Request): Promise<string> {
  try {
    const authClient = await createServerSupabase();
    const { data: { user } } = await authClient.auth.getUser();
    if (user) return `user:${user.id}`;
  } catch {}
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

// ─── Instagram Graph API Fetch ───────────────────────────────
async function fetchInstagramProfile(accessToken: string): Promise<{
  id: string;
  username: string;
  name: string | null;
  biography: string | null;
  profile_picture_url: string | null;
  followers_count: number;
  follows_count: number;
  media_count: number;
} | null> {
  const fields = "id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count";
  const url = `https://graph.instagram.com/v21.0/me?fields=${fields}&access_token=${accessToken}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error("Instagram API error:", await res.text());
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("Instagram fetch error:", err);
    return null;
  }
}

// ─── Route Handler ───────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  const sb = getSupabaseAdmin();

  // Try to get from cache first
  const { data: cached } = await sb
    .from("instagrammers")
    .select("*")
    .eq("instagram_handle", handle.toLowerCase())
    .single();

  // If we have cached data, return it
  if (cached) {
    // Check if data is stale (older than 24 hours)
    const fetchedAt = new Date(cached.fetched_at).getTime();
    const isStale = Date.now() - fetchedAt > 24 * 60 * 60 * 1000;

    // If stale and has access token, try to refresh
    if (isStale && cached.instagram_access_token) {
      const profile = await fetchInstagramProfile(cached.instagram_access_token);
      if (profile) {
        // Update with fresh data
        const { data: updated } = await sb
          .from("instagrammers")
          .update({
            posts_count: profile.media_count,
            followers_count: profile.followers_count,
            following_count: profile.follows_count,
            name: profile.name,
            avatar_url: profile.profile_picture_url,
            bio: profile.biography,
            fetched_at: new Date().toISOString(),
          })
          .eq("id", cached.id)
          .select()
          .single();

        if (updated) {
          // Recalculate ranks
          await sb.rpc("recalculate_ranks");
          revalidatePath("/", "layout");
          
          return NextResponse.json({
            ...updated,
            fresh: true,
          });
        }
      }
    }

    return NextResponse.json({
      ...cached,
      fresh: false,
    });
  }

  // ─── New instagrammer ──────────────────────────────────────
  // Instagram requires OAuth to get profile data
  // User needs to connect their Instagram account first

  // Check if authenticated user is looking up their own profile
  let authUserId: string | null = null;
  let userAccessToken: string | null = null;

  try {
    const authClient = await createServerSupabase();
    const { data: { user } } = await authClient.auth.getUser();
    if (user) {
      authUserId = user.id;
      
      // Check if user has connected this Instagram handle
      const { data: linkedAccount } = await sb
        .from("instagrammers")
        .select("instagram_access_token")
        .eq("claimed_by", user.id)
        .single();
      
      if (linkedAccount?.instagram_access_token) {
        userAccessToken = linkedAccount.instagram_access_token;
      }
    }
  } catch {}

  // Rate limit check
  if (!authUserId && process.env.NODE_ENV !== "development") {
    const key = await resolveRateLimitKey(request);
    const limited = await isRateLimited(key);
    if (limited) {
      return NextResponse.json(
        { error: "Rate limited. Please try again later." },
        { status: 429 }
      );
    }
    await recordRateLimitRequest(key);
  }

  // If no access token available, user needs to connect Instagram first
  if (!userAccessToken) {
    return NextResponse.json(
      { 
        error: "Instagram profile not found in InstaCity. Connect your Instagram account to add your building.",
        code: "not-found",
        requiresAuth: true,
      },
      { status: 404 }
    );
  }

  // Fetch from Instagram API
  const profile = await fetchInstagramProfile(userAccessToken);
  if (!profile) {
    return NextResponse.json(
      { error: "Failed to fetch Instagram profile", code: "api-error" },
      { status: 500 }
    );
  }

  // Verify the handle matches
  if (profile.username.toLowerCase() !== handle.toLowerCase()) {
    return NextResponse.json(
      { 
        error: "This Instagram account is not linked to your profile",
        code: "mismatch",
      },
      { status: 403 }
    );
  }

  // Create new instagrammer record
  const xpInstagram = calculateInstagramXp(profile.media_count, profile.followers_count);

  const { data: newInstagrammer, error: insertError } = await sb
    .from("instagrammers")
    .insert({
      instagram_handle: profile.username.toLowerCase(),
      instagram_id: profile.id,
      name: profile.name,
      avatar_url: profile.profile_picture_url,
      bio: profile.biography,
      posts_count: profile.media_count,
      followers_count: profile.followers_count,
      following_count: profile.follows_count,
      instagram_access_token: userAccessToken,
      claimed: true,
      claimed_by: authUserId,
      claimed_at: new Date().toISOString(),
      xp_instagram: xpInstagram,
      xp_total: xpInstagram,
    })
    .select()
    .single();

  if (insertError || !newInstagrammer) {
    console.error("Insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to create instagrammer record", code: "db-error" },
      { status: 500 }
    );
  }

  // Recalculate ranks
  await sb.rpc("recalculate_ranks");
  revalidatePath("/", "layout");

  return NextResponse.json({
    ...newInstagrammer,
    fresh: true,
    isNew: true,
  });
}
