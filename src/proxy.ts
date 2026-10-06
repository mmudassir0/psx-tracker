import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Early redirect for personal pages when there is no session cookie at all.
 * This only checks that a cookie exists: every personal page, query and
 * action validates the session itself (src/lib/auth.ts), so a forged cookie
 * gets past here and is then refused.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return new NextResponse("Log in first.", { status: 401 });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/portfolio/:path*",
    "/risk/:path*",
    "/cgt/:path*",
    "/zakat/:path*",
    "/watchlist/:path*",
    "/alerts/:path*",
    "/account/:path*",
    "/admin/:path*",
    "/screens/new",
    "/screens/:id/edit",
    "/api/cgt.csv",
    "/api/export",
  ],
};
