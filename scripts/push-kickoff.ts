/**
 * One-shot: push generated-code to the repo in .blueprint/kickoff-repo.json
 * Usage: npx tsx scripts/push-kickoff.ts [codeOutputDir]
 * Loads PROJECT_KICKOFF_GITHUB_TOKEN / GITHUB_TOKEN from .env.local
 */
import { readFileSync, existsSync } from "fs";
import { pushGeneratedCodeToKickoffRepo } from "../src/lib/pipeline/push-kickoff-repo";

function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf-8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(".env.local");
loadDotEnv(".env");

const token =
  process.env.PROJECT_KICKOFF_GITHUB_TOKEN?.trim() ||
  process.env.GITHUB_TOKEN?.trim() ||
  "";

const codeOutputDir = process.argv[2] || "generated-code";

pushGeneratedCodeToKickoffRepo({
  projectRoot: process.cwd(),
  codeOutputDir,
  token,
}).then((r) => {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
});
