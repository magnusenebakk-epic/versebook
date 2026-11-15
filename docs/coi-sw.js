// Makes the book's pages cross-origin isolated on a host that doesn't send the two headers for it, by adding them to this
// site's responses. The examples' Run buttons need it: the Verse runtime runs threads, which browsers allow only on
// isolated pages. js/VerseRun.js registers this worker on a reader's first Run, and only when the page isn't isolated
// already; a reader who never runs an example never gets it.
//
// The embedder policy is `credentialless`: the page's cross-origin resources (the highlighter's modules, fonts) load as
// before, without cookies. Responses from other sites, and redirects, pass through untouched.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    // The runtime's WebAssembly and data files go straight to the network: they're fetched by this site's own pages,
    // which these headers don't change, and relaying their megabytes through the worker adds a step that can fail.
    if (/\/runtime\/[^/]+\.(wasm|data)$/.test(url.pathname)) return;
    event.respondWith(
        fetch(request).then((response) => {
            if (response.status === 0 || response.type === "opaqueredirect" || response.type === "opaque") return response;
            const headers = new Headers(response.headers);
            headers.set("Cross-Origin-Opener-Policy", "same-origin");
            headers.set("Cross-Origin-Embedder-Policy", "credentialless");
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }),
    );
});
