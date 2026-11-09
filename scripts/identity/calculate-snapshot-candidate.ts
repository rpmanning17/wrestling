/** Offline-only exporter; never connects to a database or overwrites an earlier payload. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "../../src/lib/rating/config";
import { readVerifiedSnapshot } from "../ratings/snapshot";
import { calculateSnapshotCandidate } from "./snapshot-candidate";

const [directory,asOfDate] = process.argv.slice(2);
if (!directory || !asOfDate) throw new Error("Use verified private snapshot directory and ISO as-of date");
const dirty = execFileSync("git",["status","--porcelain","--","src/lib/rating","src/lib/identity",
  "scripts/identity","scripts/ratings","config/ratings.production.json"],{encoding:"utf8"});
if (dirty.trim()) throw new Error("Commit all calculation and verification sources before exporting");
const commit = execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const config = resolveConfig(JSON.parse(readFileSync("config/ratings.production.json","utf8")));
const candidate = calculateSnapshotCandidate(readVerifiedSnapshot(directory),config,asOfDate,
  commit+"/verified-person-snapshot-v2");
const output = path.join(directory,"person-rating-candidate.json");
writeFileSync(output,JSON.stringify(candidate)+"\n",{mode:0o600,flag:"wx"});
console.log(JSON.stringify({output,...candidate.verification}));
