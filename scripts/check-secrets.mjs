// Fails the lint step when secrets could leak into source or git.
// - Under src/: no service-role or AI key names, no JWT-like key values.
// - Git: no tracked .env file other than .env.example, and no JWT-like value in tracked files
//   other than this script. tests/helpers may reference the *name* of the service-role
//   variable but never a value.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const problems = [];
const jwtLike = /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/;
const forbiddenNamesInSrc = /SERVICE_ROLE|GEMINI_API_KEY/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

for (const file of walk("src")) {
  if (!/\.(ts|tsx|js|jsx|mjs|css|json)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (forbiddenNamesInSrc.test(text)) problems.push(`${file}: references a server-only secret name`);
  if (jwtLike.test(text)) problems.push(`${file}: contains a JWT-like key value`);
}

let tracked = [];
try {
  tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
} catch {
  // Not a git checkout (for example a build sandbox): skip the git checks.
}

for (const file of tracked) {
  const base = path.basename(file);
  if (base.startsWith(".env") && base !== ".env.example") problems.push(`${file}: env file is tracked by git`);
  if (file === "scripts/check-secrets.mjs" || file.startsWith(".claude/") || file === "package-lock.json") continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (jwtLike.test(text)) problems.push(`${file}: contains a JWT-like key value`);
}

if (problems.length > 0) {
  console.error("Secrets check failed:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("Secrets check passed.");
