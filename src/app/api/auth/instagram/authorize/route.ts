import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

// ─── Instagram OAuth Configuration ───────────────────────────
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID!;
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/instagram/callback`;

// Scopes we request from Instagram
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
].join(",");

/**
 * GET /api/auth/instagram/authorize
 * 
 * Initiates Instagram OAuth flow.
 * User must be logged in first (via Supabase email auth).
 * Redirects to Instagram authorization page.
 */
export async function GET() {
  // Check if user is logged in
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Redirect to login page if not authenticated
    const loginUrl = new URL("/", process.env.NEXT_PUBLIC_BASE_URL!);
    loginUrl.searchParams.set("error", "login_required");
    return NextResponse.redirect(loginUrl);
  }

  // Build Instagram OAuth URL
  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", INSTAGRAM_APP_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("response_type", "code");
  // Pass user_id in state to link Instagram account to logged-in user
  authUrl.searchParams.set("state", user.id);

  return NextResponse.redirect(authUrl.toString());
}
