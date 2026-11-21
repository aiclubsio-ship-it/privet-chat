/* App shell + runtime caching. Never caches Supabase, Cloudinary uploads/API, or video streams. */
const VERSION = "pc-v3";
const SHELL_CACHE = `${VERSION}-shell`, LIB_CACHE = `${VERSION}-lib`, IMG_CACHE = `${VERSION}-img`;
const SHELL = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const IMG_LIMIT = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function staleWhileRevalidate(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) { network.catch(() => {}); return cached; }
  return (await network) || (fallbackKey ? cache.match(fallbackKey) : null) || Response.error();
}

async function navigate(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("index.html", response.clone());
    return response;
  } catch {
    return (await cache.match("index.html")) || new Response("<!doctype html><meta name=viewport content='width=device-width'><body style='background:#000;color:#aaa;font:16px sans-serif;display:grid;place-items:center;height:100vh;margin:0'>No connection. Pull down or reload.</body>", { headers: { "Content-Type": "text/html" } });
  }
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200) {
    cache.put(request, response.clone());
    cache.keys().then((keys) => { if (keys.length > IMG_LIMIT) cache.delete(keys[0]); });
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    if (request.mode === "navigate") return event.respondWith(navigate(request));
    return event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
  if (url.hostname === "esm.sh") return event.respondWith(staleWhileRevalidate(request, LIB_CACHE));
  if (url.hostname === "res.cloudinary.com" && request.destination === "image") return event.respondWith(cacheFirstImage(request));
  // Everything else (Supabase REST/auth/realtime/functions, Cloudinary API, video) goes straight to the network.
});
