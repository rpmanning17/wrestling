/** Emits bounded administrator SQL for the private person-rating candidate. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { guardedBatchSql, sqlLiteral } from "../../src/lib/rating/recovery";

const [directory, phase, modelId, rawIndex] = process.argv.slice(2);
if (!directory || !["model", "ratings", "history"].includes(phase))
  throw new Error("Use private directory and model|ratings|history [model UUID] [batch index]");
const candidate = JSON.parse(readFileSync(path.join(directory, "identity-417-rating-candidate.json"), "utf8")) as {
  model: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
};
const model = candidate.model;
if (model.status !== "building" || model.identity_scheme !== "person_uuid")
  throw new Error("Expected an unactivated person candidate");
if (phase === "model") {
  const columns = Object.keys(model);
  const sql = `insert into public.rating_models (${columns.join(",")})
    select ${columns.map(k => `m.${k}`).join(",")} from
    jsonb_populate_record(null::public.rating_models,${sqlLiteral(JSON.stringify(model))}::jsonb) m
    returning id;`;
  process.stdout.write(sql);
} else {
  if (!modelId || !/^[0-9a-f-]{36}$/i.test(modelId)) throw new Error("Model UUID required");
  const index = Number(rawIndex ?? 0);
  if (!Number.isInteger(index) || index < 0) throw new Error("Nonnegative batch index required");
  const rows = phase === "ratings" ? candidate.rows : candidate.history;
  const batch = rows.slice(index * 250, (index + 1) * 250)
    .map(row => ({ ...row, model_id: modelId }));
  if (!batch.length) throw new Error(`No ${phase} batch ${index}`);
  process.stdout.write(guardedBatchSql({ ...model, id: modelId },
    phase === "ratings" ? "wrestler_model_ratings" : "wrestler_rating_history", batch));
}
