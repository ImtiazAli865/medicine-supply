// Writes public/sw-assets.json after `next build` (Module 009): the build id and every file under .next/static plus the
// offline shell page. The service worker keeps exactly these files on the device. The file is generated and git-ignored.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHELL_PATH = "/offline";

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** The manifest for a build: { buildId, files }. Fails loudly when the build output is missing. */
export function makeAssets({ staticDir, buildIdFile }) {
  if (!existsSync(staticDir)) throw new Error(`Build output not found: ${staticDir}. Run next build first.`);
  if (!existsSync(buildIdFile)) throw new Error(`Build id not found: ${buildIdFile}. Run next build first.`);
  const buildId = readFileSync(buildIdFile, "utf8").trim();
  if (buildId === "") throw new Error("The build id is empty.");
  const files = listFiles(staticDir)
    .filter((f) => !f.endsWith(".map"))
    .map((f) => `/_next/static/${f}`);
  if (files.length === 0) throw new Error("No files found under .next/static.");
  return { buildId, files: [...files, SHELL_PATH] };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = makeAssets({ staticDir: path.join(root, ".next", "static"), buildIdFile: path.join(root, ".next", "BUILD_ID") });
  const outDir = path.join(root, "public");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "sw-assets.json"), JSON.stringify(manifest));
  console.log(`sw-assets.json written: ${manifest.files.length} files, build ${manifest.buildId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
