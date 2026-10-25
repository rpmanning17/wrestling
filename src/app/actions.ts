"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";

export async function addMatch(form: FormData) {
 if (!configured()) redirect("/?error=setup");

 const field = (key: string, max: number, required = true) => {
  const value = String(form.get(key) ?? "").trim();
  if ((required && !value) || value.length > max) throw new Error("Invalid field");
  return value;
 };

 let row;
 try {
  const event_date = field("event_date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date) || Number.isNaN(Date.parse(event_date))) {
   throw new Error("Invalid date");
  }

  row = {
   event_date,
   season: field("season", 20),
   event_name: field("event_name", 160),
   city: field("city", 100, false),
   state: field("state", 10, false).toUpperCase(),
   weight_class: field("weight_class", 40),
   round: field("round", 80, false),
   winner_name: field("winner_name", 100),
   winner_team: field("winner_team", 160, false),
   loser_name: field("loser_name", 100),
   loser_team: field("loser_team", 160, false),
   result: field("result", 80, false),
   win_type: field("win_type", 20).toUpperCase(),
   source_file: null,
   source_row: null,
  };
 } catch {
  redirect("/?error=validation");
 }

 const { error } = await supabase().from("matches").insert(row);
 if (error) redirect("/?error=save");

 revalidatePath("/");
 redirect("/");
}

export async function deleteMatch(form: FormData) {
 if (!configured()) redirect("/?error=setup");

 const id = String(form.get("id") ?? "");
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
  redirect("/?error=delete");
 }

 const { error } = await supabase().from("matches").delete().eq("id", id);
 if (error) redirect("/?error=delete");

 revalidatePath("/");
}
