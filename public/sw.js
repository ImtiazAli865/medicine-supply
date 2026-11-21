/* Medicine Supply service worker (Module 009).
 *
 * It does two jobs only and holds no business logic:
 *  1. keeps the app files (everything under /_next/static/) and the offline shell page (/offline) on the device, so the app
 *     can open without the internet;
 *  2. when a PAGE request fails or takes longer than 4 seconds, answers with a redirect to /offline?go=<the path>.
 *
 * It never handles /api/ requests, never caches an API answer, and never caches any page other than /offline (pages are
 * per user and must always come from the server). The list of files comes from /sw-assets.json, written after every build. */

const SHELL_PATH = "/offline";
const CACHE_PREFIX = "medsupply-shell-";
const META_CACHE = "medsupply-meta";
const CURRENT_KEY = "/__current-build";
const NAVIGATION_TIMEOUT_MS = 4000;

let currentCacheName = null;

async function readCurrentCacheName() {
  if (currentCacheName) return currentCacheName;
  const meta = await caches.open(META_CACHE);
  const stored = await meta.match(CURRENT_KEY);
  currentCacheName = stored ? await stored.text() : null;
  return currentCacheName;
}

async function install() {
  const response = await fetch("/sw-assets.json", { cache: "no-store" });
  if (!response.ok) throw new Error("The list of app files is not available.");
  const manifest = await response.json();
  if (!manifest || typeof manifest.buildId !== "string" || !Array.isArray(manifest.files)) {
    throw new Error("The list of app files is not valid.");
  }
  const name = CACHE_PREFIX + manifest.buildId;
  const cache = await caches.open(name);
  // Every file must be kept, or the install fails and the previous worker stays in charge.
  await Promise.all(
    manifest.files.map(async (file) => {
      const fetched = await fetch(file, { cache: "no-store" });
      if (!fetched.ok) throw new Error("Could not keep " + file);
      await cache.put(file, fetched);
    }),
  );
  const meta = await caches.open(META_CACHE);
  await meta.put(CURRENT_KEY, new Response(name));
  currentCacheName = name;
}

async function removeOldCaches() {
  const keep = await readCurrentCacheName();
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== keep).map((n) => caches.delete(n)));
}

async function fromCache(request, ignoreSearch) {
  const name = await readCurrentCacheName();
  if (!name) return undefined;
  const cache = await caches.open(name);
  return cache.match(request, { ignoreSearch: ignoreSearch === true });
}

async function staticFile(request) {
  const hit = await fromCache(request, false);
  if (hit) return hit;
  // Not one of the listed files (for example a file of a newer build): ask the network, keep nothing.
  return fetch(request);
}

async function shellPage(request) {
  const hit = await fromCache(request, true);
  if (hit) return hit;
  return fetch(request);
}

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function navigation(request, url) {
  try {
    return await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
  } catch {
    const go = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(self.location.origin + SHELL_PATH + "?go=" + go, 302);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(install());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(removeOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never touched by the worker
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(request));
    return;
  }
  if (url.pathname === SHELL_PATH) {
    event.respondWith(shellPage(request));
    return;
  }
  if (request.mode === "navigate") event.respondWith(navigation(request, url));
});
