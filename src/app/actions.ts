"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { configured, supabase } from "@/lib/supabase";

export async function addResult(form: FormData) {
 if (!configured()) redirect("/?error=setup");

 const field = (key: string, max: number, required = true) => {
  const value = String(form.get(key) ?? "").trim();
  if ((required && !value) || value.length > max) {
   throw new Error("Invalid field");
  }
  return value;
 };

 let row;
 try {
  const event_date = field("event_date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date) || Number.isNaN(Date.parse(event_date))) {
   throw new Error("Invalid date");
  }

  const outcome = field("outcome", 4);
  if (!["Win", "Loss", "Draw"].includes(outcome)) {
   throw new Error("Invalid outcome");
  }

  const source_url = field("source_url", 2048, false);
  if (source_url && new URL(source_url).protocol !== "https:") {
   throw new Error("Invalid URL");
  }

  row = {
   athlete: field("athlete", 100),
   opponent: field("opponent", 100),
   event_name: field("event_name", 160),
   division: field("division", 80),
   season: field("season", 20),
   event_date,
   outcome,
   method: field("method", 80, false),
   source_url: source_url || null,
  };
 } catch {
  redirect("/?error=validation");
 }

 const { error } = await supabase().from("results").insert(row);
 if (error) redirect("/?error=save");

 revalidatePath("/");
 redirect("/");
}

export async function deleteResult(form: FormData) {
 if (!configured()) redirect("/?error=setup");

 const id = String(form.get("id") ?? "");
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
  redirect("/?error=delete");
 }

 const { error } = await supabase().from("results").delete().eq("id", id);
 if (error) redirect("/?error=delete");

 revalidatePath("/");
}
