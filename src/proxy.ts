import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
export async function proxy(request: NextRequest) {
 let response = NextResponse.next({request});
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(url && key) {
  const db = createServerClient(url,key,{cookies:{getAll:()=>request.cookies.getAll(),setAll:items=>{items.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});items.forEach(({name,value,options})=>response.cookies.set(name,value,options));}}});
  await db.auth.getUser();
 }
 response.headers.set("Cache-Control","private, no-store");
 response.headers.set("X-Robots-Tag","noindex, nofollow, noarchive");
 response.headers.set("Referrer-Policy","no-referrer");
 response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("X-Frame-Options","DENY");
 return response;
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};

