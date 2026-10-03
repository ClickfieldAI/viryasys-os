import { NextRequest, NextResponse } from "next/server";

// Cheap gate: no session cookie → /login. Real verification + RBAC happen server-side (guard/authorize).
// Webhooks authenticate with their own shared-secret headers, not cookies.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname.startsWith("/_next") || pathname.startsWith("/api/webhooks") || pathname.startsWith("/brand") || pathname === "/favicon.ico" || pathname === "/login";
  const has = req.cookies.has("vos_session");
  if (!open && !has) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
