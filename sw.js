/* GereBoleto — Service Worker v1
   Estratégia: Network First
   - Sempre tenta buscar versão nova do servidor
   - Cai no cache só se estiver offline
   - Ao detectar nova versão, avisa o app para mostrar botão de refresh
*/

const CACHE_NAME = 'gereboleto-v1';
const FILES_TO_CACHE = ['/index.html', '/'];

/* ── Instalação: pré-cacheia o index ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  /* NÃO chama skipWaiting() aqui.
     O app (index.html) controla quando o novo SW assume,
     via postMessage({type:'SKIP_WAITING'}) após o usuário
     confirmar o update. Sem isso o SW ativaria sozinho,
     quebrando o fluxo de "Nova versão disponível". */
});

/* ── Mensagens do app: recebe SKIP_WAITING do index.html ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ── Ativação: remove caches antigos ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: Network First ── */
self.addEventListener('fetch', event => {
  /* Só intercepta GETs de mesma origem */
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      /* Compara ETag/Last-Modified para detectar mudança */
      const cached = await cache.match(request);
      const newEtag = networkResponse.headers.get('etag');
      const oldEtag = cached ? cached.headers.get('etag') : null;
      const newDate = networkResponse.headers.get('last-modified');
      const oldDate = cached ? cached.headers.get('last-modified') : null;

      const changed =
        (newEtag && oldEtag && newEtag !== oldEtag) ||
        (newDate && oldDate && newDate !== oldDate) ||
        (!cached); /* primeira vez */

      /* Grava versão nova no cache */
      cache.put(request, networkResponse.clone());

      /* Avisa todas as abas que há versão nova */
      if (changed && cached) {
        notifyClients('UPDATE_AVAILABLE');
      }
    }

    return networkResponse;
  } catch {
    /* Offline: serve do cache */
    const cached = await cache.match(request);
    return cached || new Response('Offline — sem cache disponível', { status: 503 });
  }
}

function notifyClients(type) {
  self.clients.matchAll({ type: 'window' }).then(clients =>
    clients.forEach(c => c.postMessage({ type }))
  );
}
