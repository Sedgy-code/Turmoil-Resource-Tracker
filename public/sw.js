/*
 * Turmoil Clan Hub offline support. With no connection, the Hub still opens and shows the last
 * war plan, rankings and numbers this phone saw; nothing is ever sent from here. Pages and data
 * always come from the network first, so an online phone never sees old numbers.
 */
const VERSION = "2026-10-18";
const STATIC_CACHE = `turmoil-static-${VERSION}`;
const PAGE_CACHE = "turmoil-pages";
const DATA_CACHE = "turmoil-data";

/** Read-only data kept for offline use: the member's own view of the clan. */
const DATA_PATHS = new Set([
  "/api/session", "/api/bank", "/api/settings", "/api/dew", "/api/ascensions", "/api/recognition",
  "/api/snipes", "/api/clan-tech", "/api/war-results", "/api/war-days", "/api/war-days/votes", "/api/war-days/report",
  // Leaders' Home card and status board.
  "/api/leader", "/api/status",
]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Old copies of the app's code go when a new version arrives; pages and data are kept.
    await Promise.all(keys.filter((key) => key.startsWith("turmoil-static-") && key !== STATIC_CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

/** Signing out clears everything this phone kept. */
self.addEventListener("message", (event) => {
  if (event.data === "turmoil-sign-out") {
    event.waitUntil(Promise.all([caches.delete(PAGE_CACHE), caches.delete(DATA_CACHE)]));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Signing in and the bots never go through here.
  if (url.pathname.startsWith("/api/auth") || url.pathname.startsWith("/api/cron") || url.pathname.startsWith("/api/discord")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(pageNetworkFirst(request));
  } else if (DATA_PATHS.has(url.pathname)) {
    event.respondWith(dataNetworkFirst(request));
  }
});

/** The app's code never changes under the same name, so a kept copy is always right. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
    // Each new version of the Hub adds new files: keep the newest few hundred, not every old one.
    const keys = await cache.keys();
    if (keys.length > 300) await Promise.all(keys.slice(0, keys.length - 300).map((key) => cache.delete(key)));
  }
  return response;
}

/** Pages: the network first; offline, the last copy of this page, or Home if this phone never opened it. */
async function pageNetworkFirst(request) {
  const cache = await caches.open(PAGE_CACHE);
  const key = new URL(request.url).pathname;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    // Go to Home properly (not Home's page under another address), so the tabs match what's shown.
    if (key !== "/" && (await cache.match("/"))) return Response.redirect(new URL("/", self.location.origin).href, 302);
    throw error;
  }
}

/** Data: the network first; offline, the last answer this phone got, marked as kept. */
async function dataNetworkFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      const headers = new Headers(copy.headers);
      headers.set("x-turmoil-saved-at", new Date().toISOString());
      cache.put(request, new Response(await copy.blob(), { status: copy.status, statusText: copy.statusText, headers }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-turmoil-offline", "1");
      return new Response(await cached.blob(), { status: cached.status, statusText: cached.statusText, headers });
    }
    return new Response(JSON.stringify({ error: "You’re offline. Connect to the internet and try again.", code: "OFFLINE" }), {
      status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
