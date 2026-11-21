import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeAssets } from "../../scripts/make-sw-assets.mjs";

const made: string[] = [];

function fakeBuild(files: string[], buildId = "abc123") {
  const root = mkdtempSync(path.join(os.tmpdir(), "swassets-"));
  made.push(root);
  const staticDir = path.join(root, "static");
  for (const f of files) {
    const full = path.join(staticDir, f);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, "x");
  }
  mkdirSync(staticDir, { recursive: true });
  const buildIdFile = path.join(root, "BUILD_ID");
  writeFileSync(buildIdFile, `${buildId}\n`);
  return { staticDir, buildIdFile };
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("make-sw-assets", () => {
  it("lists every static file with its public path, the shell page last, and the build id", () => {
    const build = fakeBuild(["chunks/a.js", "chunks/b.js", "css/site.css", "abc123/_buildManifest.js", "chunks/a.js.map"]);
    const manifest = makeAssets(build) as { buildId: string; files: string[] };
    expect(manifest.buildId).toBe("abc123");
    expect(manifest.files).toEqual([
      "/_next/static/abc123/_buildManifest.js",
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.js",
      "/_next/static/css/site.css",
      "/offline",
    ]);
  });

  it("fails loudly when the build output or the build id is missing or empty", () => {
    expect(() => makeAssets({ staticDir: path.join(os.tmpdir(), "no-such-dir-xyz"), buildIdFile: "x" })).toThrow(/Run next build/);
    const build = fakeBuild([]);
    expect(() => makeAssets(build)).toThrow(/No files/);
    const noId = fakeBuild(["a.js"]);
    writeFileSync(noId.buildIdFile, "  \n");
    expect(() => makeAssets(noId)).toThrow(/empty/);
  });
});
