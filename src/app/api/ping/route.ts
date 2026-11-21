// Is the server reachable? Used only to tell online from offline (Module 009). No sign-in and no database access, so it
// answers fast, works with an expired session, and returns nothing about any business or user.

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
