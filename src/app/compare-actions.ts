"use server";

import { revalidatePath } from "next/cache";
import { buildProfiles, findWrestlers } from "@/lib/scouting";
import type { WrestlerRef } from "@/lib/scouting-types";
import { wrestlerKey } from "@/lib/scouting-types";
import { supabase } from "@/lib/supabase";

export async function searchWrestlers(query: string) {
  return findWrestlers(String(query ?? "").slice(0, 100));
}

export async function loadProfiles(refs: WrestlerRef[]) {
  if (!Array.isArray(refs)) return [];
  return buildProfiles(refs.slice(0, 8));
}

export async function saveWrestlerNote(input: { wrestlerName: string; body: string; clientId: string }) {
  const wrestlerName = String(input?.wrestlerName ?? "").trim().slice(0, 100);
  const body = String(input?.body ?? "").trim().slice(0, 4000);
  const clientId = String(input?.clientId ?? "").trim().slice(0, 100);
  if (!wrestlerName || !body || !/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) throw new Error("Invalid note");

  const { data, error } = await supabase()
    .from("wrestler_notes")
    .upsert({ wrestler_key: wrestlerKey(wrestlerName), wrestler_name: wrestlerName, body, client_id: clientId }, { onConflict: "client_id" })
    .select("id,wrestler_key,body,client_id,created_at")
    .single();
  if (error) throw new Error("Unable to save note");
  revalidatePath("/");
  return { id: data.id, wrestlerKey: data.wrestler_key, body: data.body, clientId: data.client_id, createdAt: data.created_at };
}

export async function deleteWrestlerNote(id: number) {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid note");
  const { error } = await supabase().from("wrestler_notes").delete().eq("id", id);
  if (error) throw new Error("Unable to delete note");
  revalidatePath("/");
}

