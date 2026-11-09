/** Offline only. Output stays in the supplied ignored/private export directory. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { readVerifiedSnapshot } from "./snapshot";

const directory = process.argv[2];
if (!directory) throw new Error("Supply the private connector export directory");
const { baseline, rows } = readVerifiedSnapshot(directory);
const report = { verified: true, encoding: "sha256-of-ordered-full-row-md5-hex-v1", baseline,
  counts: Object.fromEntries(Object.entries(rows).map(([kind, value]) => [kind, value.length])),
  activationAuthorized: false };
writeFileSync(path.join(directory, "snapshot-integrity.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report));
