import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";

// ─── Instagram OAuth Configuration ───────────────────────────
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID!;
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET!;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/instagram/callback`;

// ─── Types ───────────────────────────────────────────────────

interface InstagramTokenResponse {
  access_token: string;
  user_id: string;
}

interface InstagramLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface InstagramUserResponse {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  website?: string;
}

// ─── Helper Functions ────────────────────────────────────────

/**
 * Exchange authorization code for short-lived access token
 */
async function exchangeCodeForToken(code: string): Promise<InstagramTokenResponse> {
  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: INSTAGRAM_APP_ID,
      client_secret: INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  return response.json();
}

/**
 * Exchange short-lived token for long-lived token (60 days)
 */
async function getLongLivedToken(shortToken: string): Promise<InstagramLongLivedTokenResponse> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", INSTAGRAM_APP_SECRET);
  url.searchParams.set("access_token", shortToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get long-lived token: ${error}`);
  }

  return response.json();
}

/**
 * Fetch Instagram user profile data
 */
async function fetchInstagramProfile(accessToken: string, userId: string): Promise<InstagramUserResponse> {
  const fields = [
    "id",
    "username",
    "name",
    "biography",
    "profile_picture_url",
    "followers_count",
    "follows_count",
    "media_count",
    "website",
  ].join(",");

  const url = new URL(`https://graph.instagram.com/v21.0/${userId}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch profile: ${error}`);
  }

  return response.json();
}

/**
 * GET /api/auth/instagram/callback
 * 
 * Handles Instagram OAuth callback.
 * - Exchanges code for access token
 * - Fetches user profile data
 * - Creates/updates instagrammer in database
 * - Links to logged-in Supabase user
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // user_id from authorize
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

  // Handle OAuth errors
  if (error) {
    console.error("Instagram OAuth error:", error, errorReason);
    const redirectUrl = new URL("/", baseUrl);
    redirectUrl.searchParams.set("error", "instagram_denied");
    redirectUrl.searchParams.set("error_description", errorReason || error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    const redirectUrl = new URL("/", baseUrl);
    redirectUrl.searchParams.set("error", "no_code");
    return NextResponse.redirect(redirectUrl);
  }

  // Verify user is logged in
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.id !== state) {
    const redirectUrl = new URL("/", baseUrl);
    redirectUrl.searchParams.set("error", "auth_mismatch");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    // 1. Exchange code for short-lived token
    const tokenResponse = await exchangeCodeForToken(code);
    
    // 2. Exchange for long-lived token (60 days)
    const longLivedToken = await getLongLivedToken(tokenResponse.access_token);
    
    // 3. Fetch Instagram profile data
    const profile = await fetchInstagramProfile(
      longLivedToken.access_token,
      tokenResponse.user_id
    );

    // 4. Calculate token expiration (60 days from now)
    const tokenExpiresAt = new Date(
      Date.now() + longLivedToken.expires_in * 1000
    ).toISOString();

    const admin = getSupabaseAdmin();

    // 5. Check if user already has a claimed building
    const { data: existingClaim } = await admin
      .from("instagrammers")
      .select("instagram_handle")
      .eq("claimed_by", user.id)
      .maybeSingle();

    if (existingClaim) {
      // User already claimed a building - update it instead
      const { error: updateError } = await admin
        .from("instagrammers")
        .update({
          instagram_id: profile.id,
          name: profile.name || null,
          avatar_url: profile.profile_picture_url || null,
          bio: profile.biography || null,
          website: profile.website || null,
          posts_count: profile.media_count || 0,
          followers_count: profile.followers_count || 0,
          following_count: profile.follows_count || 0,
          instagram_access_token: longLivedToken.access_token,
          instagram_token_expires_at: tokenExpiresAt,
          fetched_at: new Date().toISOString(),
        })
        .eq("claimed_by", user.id);

      if (updateError) {
        throw new Error(`Failed to update profile: ${updateError.message}`);
      }

      // Recalculate ranks
      await admin.rpc("recalculate_ranks");

      const redirectUrl = new URL(`/dev/${existingClaim.instagram_handle}`, baseUrl);
      redirectUrl.searchParams.set("success", "profile_updated");
      return NextResponse.redirect(redirectUrl);
    }

    // 6. Check if this Instagram handle already exists
    const { data: existingHandle } = await admin
      .from("instagrammers")
      .select("id, claimed, claimed_by")
      .eq("instagram_handle", profile.username.toLowerCase())
      .maybeSingle();

    if (existingHandle) {
      if (existingHandle.claimed && existingHandle.claimed_by !== user.id) {
        // Already claimed by someone else
        const redirectUrl = new URL("/", baseUrl);
        redirectUrl.searchParams.set("error", "already_claimed");
        return NextResponse.redirect(redirectUrl);
      }

      // Update existing unclaimed record and claim it
      const { error: updateError } = await admin
        .from("instagrammers")
        .update({
          instagram_id: profile.id,
          name: profile.name || null,
          avatar_url: profile.profile_picture_url || null,
          bio: profile.biography || null,
          website: profile.website || null,
          posts_count: profile.media_count || 0,
          followers_count: profile.followers_count || 0,
          following_count: profile.follows_count || 0,
          instagram_access_token: longLivedToken.access_token,
          instagram_token_expires_at: tokenExpiresAt,
          claimed: true,
          claimed_by: user.id,
          claimed_at: new Date().toISOString(),
          fetched_at: new Date().toISOString(),
          fetch_priority: 1,
        })
        .eq("id", existingHandle.id);

      if (updateError) {
        throw new Error(`Failed to claim profile: ${updateError.message}`);
      }

      // Insert feed event
      await admin.from("activity_feed").insert({
        event_type: "building_claimed",
        actor_id: existingHandle.id,
        metadata: { login: profile.username },
      });

      // Recalculate ranks
      await admin.rpc("recalculate_ranks");

      const redirectUrl = new URL(`/dev/${profile.username.toLowerCase()}`, baseUrl);
      redirectUrl.searchParams.set("success", "claimed");
      return NextResponse.redirect(redirectUrl);
    }

    // 7. Create new instagrammer record
    const { data: newInstagrammer, error: insertError } = await admin
      .from("instagrammers")
      .insert({
        instagram_handle: profile.username.toLowerCase(),
        instagram_id: profile.id,
        name: profile.name || null,
        avatar_url: profile.profile_picture_url || null,
        bio: profile.biography || null,
        website: profile.website || null,
        posts_count: profile.media_count || 0,
        followers_count: profile.followers_count || 0,
        following_count: profile.follows_count || 0,
        instagram_access_token: longLivedToken.access_token,
        instagram_token_expires_at: tokenExpiresAt,
        claimed: true,
        claimed_by: user.id,
        claimed_at: new Date().toISOString(),
        fetch_priority: 1,
      })
      .select("id, instagram_handle")
      .single();

    if (insertError) {
      throw new Error(`Failed to create profile: ${insertError.message}`);
    }

    // Insert feed event
    await admin.from("activity_feed").insert({
      event_type: "building_claimed",
      actor_id: newInstagrammer.id,
      metadata: { login: profile.username },
    });

    // Recalculate ranks
    await admin.rpc("recalculate_ranks");

    // Redirect to profile page
    const redirectUrl = new URL(`/dev/${newInstagrammer.instagram_handle}`, baseUrl);
    redirectUrl.searchParams.set("success", "created");
    return NextResponse.redirect(redirectUrl);

  } catch (err) {
    console.error("Instagram callback error:", err);
    const redirectUrl = new URL("/", baseUrl);
    redirectUrl.searchParams.set("error", "callback_failed");
    redirectUrl.searchParams.set(
      "error_description",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.redirect(redirectUrl);
  }
}
