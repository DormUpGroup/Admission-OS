import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function cookieStartsWith(req: NextRequest, prefix: string) {
  return req.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith(prefix));
}

async function getSessionToken(req: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const forwarded = req.headers.get("x-forwarded-proto") ?? "";
  const requestIsHttps =
    req.nextUrl.protocol === "https:" ||
    forwarded.split(",")[0]?.trim() === "https";

  const hasSecureCookie = cookieStartsWith(
    req,
    "__Secure-authjs.session-token",
  );
  const hasPlainCookie = cookieStartsWith(req, "authjs.session-token");
  const secureCookie =
    hasSecureCookie || (!hasPlainCookie && requestIsHttps);

  const token = await getToken({ req, secret, secureCookie });
  if (token) return token;

  // HTTPS proxies and local HTTP use different cookie names; try the other.
  return getToken({ req, secret, secureCookie: !secureCookie });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getSessionToken(req);

  const isLoggedIn = !!token;
  const role = token?.role as string | undefined;

  if (pathname.startsWith("/login")) {
    if (isLoggedIn) {
      const dest = role === "STUDENT" ? "/portal" : "/admin";
      return NextResponse.redirect(new URL(dest, req.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (role === "STUDENT") {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
  }

  if (pathname.startsWith("/portal")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (role !== "STUDENT") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/portal/:path*", "/login"],
};
