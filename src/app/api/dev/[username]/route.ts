import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

// This route now redirects to the Instagram API
// Keeping for backward compatibility with existing links

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  
  // Redirect to Instagram API
  const url = new URL(request.url);
  const newUrl = new URL(`/api/instagram/${username}`, url.origin);
  
  return NextResponse.redirect(newUrl.toString(), 307);
}
