import { stableStringify, type RatingConfig } from "./config";

/** A recovery version identifies provenance; all mathematical and policy settings must agree. */
export function assertSameFormula(production: RatingConfig, recovery: RatingConfig) {
  const { modelVersion: originalVersion, ...original } = production;
  const { modelVersion: recoveryVersion, ...replacement } = recovery;
  if (originalVersion === recoveryVersion || stableStringify(original) !== stableStringify(replacement)) {
    throw new Error("Recovery must have a distinct version and exactly the production formula/policies");
  }
}

export type PersistedRow = Record<string, unknown>;
export const sqlLiteral = (value: string) => "'" + value.replaceAll("'", "''") + "'";

/** Administrator-connector transport. No schema/grant changes, overwrites or deletes.
 * Lock the parent and verify its complete expected metadata before every batch.
 * A retried committed batch is a no-op only if every existing field matches exactly.
 */
export function guardedBatchSql(
  model: PersistedRow,
  table: "wrestler_model_ratings" | "wrestler_rating_history",
  rows: PersistedRow[],
) {
  if (model.status !== "building" || typeof model.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(model.id) || !rows.length) throw new Error("Explicit building model and nonempty batch required");
  const keys = table === "wrestler_model_ratings"
    ? ["model_id", "athlete_key"] : ["model_id", "athlete_key", "period_end"];
  const columns = Object.keys(rows[0]);
  if (columns.some(k => !/^[a-z_]+$/.test(k)) || rows.some(r => r.model_id !== model.id ||
      keys.some(k => typeof r[k] !== "string") ||
      Object.keys(r).sort().join() !== [...columns].sort().join())) throw new Error("Invalid batch identity or columns");
  const identities = rows.map(r => JSON.stringify(keys.map(k => r[k])));
  if (new Set(identities).size !== rows.length) throw new Error("Duplicate batch identity");
  const relation = `public.${table}`;
  const payload = `jsonb_populate_recordset(null::${relation}, payload)`;
  const join = keys.map(k => `s.${k} = e.${k}`).join(" and ");
  const body = `declare payload jsonb := ${sqlLiteral(JSON.stringify(rows))}::jsonb;
begin
  perform 1 from public.rating_models m where m.id = ${sqlLiteral(model.id)}::uuid
    and to_jsonb(m) @> ${sqlLiteral(JSON.stringify(model))}::jsonb for update;
  if not found then raise exception 'Recovery model status or provenance mismatch'; end if;
  if exists (select 1 from ${payload} e join ${relation} s on ${join}
      where to_jsonb(s) is distinct from to_jsonb(e)) then
    raise exception 'Recovery existing-row mismatch';
  end if;
  insert into ${relation} (${columns.join(",")})
    select ${columns.map(k => `e.${k}`).join(",")} from ${payload} e
    where not exists (select 1 from ${relation} s where ${join});
end`;
  // Quote the entire DO body too: names may contain quotes or dollar-quote delimiters.
  return `do ${sqlLiteral(body)};`;
}
