import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AliasRow, RawMatch } from "../../src/lib/rating/prepare";
import { resolveConfig, stableStringify, type RatingConfig, type RatingConfigOverrides } from "../../src/lib/rating/config";

export type Args = { flags: Set<string>; values: Map<string, string> };

export function parseArgs(argv: string[]): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [name, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) values.set(name, inline);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) { values.set(name, argv[i + 1]); i += 1; }
    else flags.add(name);
  }
  return { flags, values };
}

export function loadConfig(args: Args): RatingConfig {
  const file = args.values.get("config");
  const overrides = file ? (JSON.parse(readFileSync(file, "utf8")) as RatingConfigOverrides) : {};
  return resolveConfig(overrides);
}

export type Inputs = { matches: RawMatch[]; aliases: AliasRow[]; source: string };

const PAGE = 1000;

/** Reads with the same personal-app credentials the website uses; no service key is needed to read. */
export function readClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example), or pass --input <file.json>.");
  const headers: Record<string, string> = {};
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!process.env.SUPABASE_PERSONAL_APP_KEY) throw new Error("SUPABASE_PERSONAL_APP_KEY is required for reads.");
    headers["x-personal-app-key"] = process.env.SUPABASE_PERSONAL_APP_KEY;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers } });
}

export function writeClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Writing needs SUPABASE_SERVICE_ROLE_KEY in your LOCAL environment (never commit it). Use --dry-run to calculate without writing.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function loadInputs(args: Args): Promise<Inputs> {
  const file = args.values.get("input");
  if (file) {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { matches: RawMatch[]; aliases?: AliasRow[] };
    return { matches: parsed.matches, aliases: parsed.aliases ?? [], source: `file:${file}` };
  }
  const db = readClient();
  const matches: RawMatch[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("matches")
      .select("id,event_date,event_name,city,weight_class,round,winner_name,winner_team,loser_name,loser_team,result,win_type")
      .order("event_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading matches failed: ${error.message}`);
    matches.push(...((data ?? []) as RawMatch[]));
    if (!data || data.length < PAGE) break;
  }
  const { data: aliasData, error: aliasError } = await db.from("wrestler_aliases").select("alias_key,canonical_key,canonical_name");
  if (aliasError) throw new Error(`Reading aliases failed: ${aliasError.message}`);
  return { matches, aliases: (aliasData ?? []) as AliasRow[], source: "supabase" };
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Identifies the exact inputs: every match id with its outcome-defining fields, plus the alias table. */
export function inputFingerprint(inputs: Inputs): string {
  const lines = inputs.matches
    .map((m) => [m.id, m.event_date, m.winner_name, m.loser_name, m.win_type, m.result ?? "", m.weight_class].join("\u001f"))
    .sort();
  const aliases = [...inputs.aliases].map((a) => `${a.alias_key}>${a.canonical_key}`).sort();
  return sha256(`${lines.join("\n")}\n--aliases--\n${aliases.join("\n")}`);
}

export const configHash = (config: RatingConfig) => sha256(stableStringify(config));

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
