import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export const configured = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export async function supabase() {
 const jar = await cookies();
 return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{cookies:{getAll:()=>jar.getAll(),setAll:items=>{try{items.forEach(({name,value,options})=>jar.set(name,value,options));}catch{/* Proxy refreshes cookies for Server Components. */}}}});
}

