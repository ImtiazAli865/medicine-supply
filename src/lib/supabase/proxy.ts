import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig, isSupabaseConfigured } from "./env";

const PUBLIC_PATHS = ["/sign-in"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the auth session cookies and redirects signed-out visitors to /sign-in.
 * Redirects are a convenience only: every page and API route verifies the user again on the server.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // API routes answer 401 JSON themselves; the proxy only refreshes cookies for them.
  const isApi = pathname.startsWith("/api/");

  if (!isSupabaseConfigured()) {
    // Without configuration nothing can be authenticated: send pages to sign-in, which shows the problem.
    if (isApi || isPublic(pathname)) return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isApi && !isPublic(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/sign-in";
    redirect.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === "/sign-in") {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return response;
}
