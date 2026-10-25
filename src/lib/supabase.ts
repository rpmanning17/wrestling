import "server-only";
import { createClient } from "@supabase/supabase-js";

export const configured = () =>
 Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
   process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
   process.env.SUPABASE_PERSONAL_APP_KEY,
 );

export function supabase() {
 if (!configured()) {
  throw new Error("Supabase server configuration is incomplete.");
 }

 return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
   auth: { persistSession: false, autoRefreshToken: false },
   global: {
    headers: {
     "x-personal-app-key": process.env.SUPABASE_PERSONAL_APP_KEY!,
    },
   },
  },
 );
}
