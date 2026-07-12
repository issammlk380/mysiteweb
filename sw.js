const CACHE_NAME = 'tech-sews-v3'; // Bedel version bach ytbaddel
const urlsToCache = [
    '/technicien.html',
    '/site.webmanifest',
    '/icon-192x192.png',
    '/icon-512x512.png'
];

// ═══════════════════════════════════════════
// INSTALL — Ki ytzad SW lwe7d lkhra
// ═══════════════════════════════════════════
self.addEventListener('install', (event) => {
    self.skipWaiting(); // B7al "seb9ni" bach ykhdem daba
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Cache t7el:', CACHE_NAME);
                
                // Hna: koul fichier b7alo, ila fache w7ed ma yw9efch lba9i
                return Promise.all(
                    urlsToCache.map((url) => 
                        cache.add(url).catch((err) => {
                            console.warn('[SW] Ma tcachech:', url, err);
                        })
                    )
                );
            })
    );
});

// ═══════════════════════════════════════════
// FETCH — HAD L7AJA LMOHIMMA BZZAF
// ═══════════════════════════════════════════
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Ila ma3andoch GET, khelha tb7alha (POST, PUT, etc.)
    if (request.method !== 'GET') {
        return;
    }

    // 2. Ila men domaine khra (Socket.io, API), khelha tb7alha
    if (url.origin !== self.location.origin) {
        return;
    }

    // 3. HNA: Khas NRJE3 response f koul 7al, ma3endich l7a9 nrje3 undefined
    event.respondWith(
        (async () => {
            try {
                const cache = await caches.open(CACHE_NAME);
                
                // Jareb men cache lwl
                const cachedResponse = await cache.match(request);
                
                if (cachedResponse) {
                    // Rje3 men cache, w f background jareb t7edded
                    fetch(request.clone())
                        .then((networkResponse) => {
                            if (networkResponse?.ok) {
                                cache.put(request, networkResponse.clone());
                            }
                        })
                        .catch(() => { /* ma3lich ila fache f background */ });
                    
                    return cachedResponse;
                }

                // Cache miss → jareb men network
                const networkResponse = await fetch(request.clone());
                
                // Ila s7i7, cacheih bach ykhdem offline
                if (networkResponse?.ok) {
                    cache.put(request, networkResponse.clone());
                }
                
                return networkResponse;

            } catch (error) {
                console.error('[SW] Fetch fache:', error);

                // HNA L7AJA LMOHIMMA: Khas nrje3 chi response, walo walo!
                
                // Ila navigate (page kamla), rje3 technicien.html
                if (request.mode === 'navigate') {
                    const fallback = await caches.match('/technicien.html');
                    if (fallback) return fallback;
                }

                // Ila chi haja khra, rje3 response s7i7a b 503
                // Hadi bach Chrome ma ychoufch "failed to fetch"
                return new Response(
                    JSON.stringify({ error: 'Offline', time: Date.now() }),
                    {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-SW-Fallback': 'true'
                        }
                    }
                );
            }
        })()
    );
});

// ═══════════════════════════════════════════
// ACTIVATE — N7ayed lcache l9dim
// ═══════════════════════════════════════════
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Cache 9dim t7ayed:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    
    // Hadi bach ykhdem daba 3la lpage li hna
    event.waitUntil(self.clients.claim());
});