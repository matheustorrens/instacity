import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase";

const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET!;

/**
 * POST /api/auth/instagram/refresh
 * 
 * Refreshes the Instagram access token for the logged-in user.
 * Tokens can be refreshed when they have more than 24 hours of validity.
 * Returns a new token valid for 60 days.
 */
export async function POST(request: NextRequest) {
  // Verify user is logged in
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const admin = getSupabaseAdmin();

  // Get user's Instagram data
  const { data: instagrammer } = await admin
    .from("instagrammers")
    .select("id, instagram_access_token, instagram_token_expires_at")
    .eq("claimed_by", user.id)
    .single();

  if (!instagrammer || !instagrammer.instagram_access_token) {
    return NextResponse.json(
      { error: "No Instagram account linked" },
      { status: 404 }
    );
  }

  // Check if token needs refresh (at least 24h remaining required)
  const expiresAt = new Date(instagrammer.instagram_token_expires_at);
  const now = new Date();
  const hoursRemaining = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursRemaining < 24) {
    return NextResponse.json(
      { error: "Token expired or expiring too soon. Please reconnect Instagram." },
      { status: 400 }
    );
  }

  try {
    // Refresh the token
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", instagrammer.instagram_access_token);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh token: ${error}`);
    }

    const data = await response.json();

    // Calculate new expiration (60 days from now)
    const newExpiresAt = new Date(
      Date.now() + data.expires_in * 1000
    ).toISOString();

    // Update token in database
    await admin
      .from("instagrammers")
      .update({
        instagram_access_token: data.access_token,
        instagram_token_expires_at: newExpiresAt,
      })
      .eq("id", instagrammer.id);

    return NextResponse.json({
      success: true,
      expires_at: newExpiresAt,
    });

  } catch (err) {
    console.error("Token refresh error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
