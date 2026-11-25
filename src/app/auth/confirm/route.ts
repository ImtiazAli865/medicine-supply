import { NextResponse, type NextRequest } from "next/server";
import { confirmRedirect } from "@/lib/auth/reset";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Opens the link of the password reset email (Module 011). The emailed link carries a one-time token hash (our own template) or a one-time code (the service's default template, same browser only); it is verified here on
 * the server, which starts the recovery session, and the browser is sent to the page for choosing a new password. Every failure
 * goes to the forgot-password page with the same plain error, and nothing of the request is ever repeated back: the only two
 * places this route sends the browser to are fixed in `confirmRedirect`. A `next` parameter is ignored.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = await confirmRedirect(
    { tokenHash: params.get("token_hash"), type: params.get("type"), code: params.get("code") },
    async (tokenHash) => {
      const supabase = await createClient();
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      return !error;
    },
    async (code) => {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return !error;
    },
  );
  const response = NextResponse.redirect(new URL(target, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
