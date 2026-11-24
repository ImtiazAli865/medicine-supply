import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets, image optimization and the connectivity check (`/api/ping` needs no session), and the service worker files; everything else is checked.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ping$|sw\\.js$|sw-assets\\.json$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
