import { NextResponse } from "next/server";

export function proxy() {
 const response = NextResponse.next();
 response.headers.set("Cache-Control", "private, no-store");
 response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
 response.headers.set("Referrer-Policy", "no-referrer");
 response.headers.set("X-Content-Type-Options", "nosniff");
 response.headers.set("X-Frame-Options", "DENY");
 return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
