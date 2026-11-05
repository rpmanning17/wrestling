import "server-only";
import { supabase } from "@/lib/supabase";

/** Use person reads only after a validated person-keyed model is activated. */
export async function personModelActive() {
  const { data, error } = await supabase().from("rating_models")
    .select("identity_scheme").eq("status", "active").maybeSingle();
  if (error) return false; // Before the additive identity migration, the name-key model remains active.
  return data?.identity_scheme === "person_uuid";
}
