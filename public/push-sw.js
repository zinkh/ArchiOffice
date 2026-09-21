// Gestionnaires Web Push du service worker.
//
// Workbox génère sw.js entièrement (mode generateSW) : on ne peut pas y écrire
// directement sans repasser en injectManifest, ce qui reviendrait à reprendre
// à la main la précache et le cycle de mise à jour dont dépend déjà
// src/components/UpdateBanner.tsx. Ce fichier est donc importé en tête du
// service worker généré (workbox.importScripts dans vite.config.ts) : les
// deux écouteurs ci-dessous s'ajoutent, rien d'existant n'est remplacé.
//
// Il est volontairement en JavaScript brut et non transpilé : il est servi tel
// quel depuis public/, hors du bundle.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Une charge utile illisible ne doit pas faire disparaître la
    // notification : le service de push l'a livrée, on affiche au moins que
    // quelque chose est arrivé.
    payload = { title: 'ArchiOffice', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'ArchiOffice';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Le tag remplace une notification de même sujet au lieu d'empiler des
    // doublons (une alerte relancée à chaque cycle, par exemple).
    tag: payload.tag || undefined,
    // Rejouer la vibration/le son quand le contenu a changé sous un même tag.
    renotify: Boolean(payload.tag),
    timestamp: Date.now(),
    data: {
      // Résolue contre l'origine du service worker au clic : jamais une URL
      // absolue reçue telle quelle, pour qu'une charge utile forgée ne puisse
      // pas transformer la notification en redirection vers un site tiers.
      url: typeof payload.url === 'string' ? payload.url : '/notifications',
      id: payload.id || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const raw = (event.notification.data && event.notification.data.url) || '/notifications';
  let target;
  try {
    const resolved = new URL(raw, self.location.origin);
    // Un chemin hors de notre propre origine est ignoré au profit de la page
    // des notifications.
    target = resolved.origin === self.location.origin ? resolved.href : new URL('/notifications', self.location.origin).href;
  } catch {
    target = new URL('/notifications', self.location.origin).href;
  }

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Réutiliser un onglet ArchiOffice déjà ouvert plutôt qu'en ajouter un :
    // une notification cliquée depuis l'écran d'accueil sur mobile ouvrirait
    // sinon une seconde instance de l'application installée.
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(target);
          } catch {
            /* onglet non contrôlé par ce SW : le focus seul suffit */
          }
        }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});


// Réception native Android via Web Share Target API.
//
// Android POSTe les fichiers vers /share-target. Comme une navigation ne peut
// pas transporter le corps multipart jusqu'à React, le service worker
// intercepte cette requête, sérialise le partage dans IndexedDB, puis redirige
// vers la page protégée /share-target?shareId=... qui effectue le classement
// et le dépôt réel dans /api/documents.
const SHARE_DB_NAME = 'archioffice-share-target';
const SHARE_DB_VERSION = 1;
const SHARE_STORE = 'shares';

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Share DB unavailable'));
  });
}

async function saveIncomingShare(record) {
  const db = await openShareDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Share write failed'));
      tx.onabort = () => reject(tx.error || new Error('Share write aborted'));
    });
  } finally {
    db.close();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'POST') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin || url.pathname !== '/share-target') return;

  event.respondWith((async () => {
    try {
      const form = await request.formData();
      const files = [];
      for (const value of form.getAll('files')) {
        if (!(value instanceof File)) continue;
        files.push({
          name: value.name,
          type: value.type,
          lastModified: value.lastModified,
          blob: value,
        });
      }

      const id = (self.crypto && self.crypto.randomUUID)
        ? self.crypto.randomUUID()
        : `share-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      await saveIncomingShare({
        id,
        createdAt: Date.now(),
        title: String(form.get('title') || ''),
        text: String(form.get('text') || ''),
        url: String(form.get('url') || ''),
        files,
      });

      return Response.redirect(new URL(`/share-target?shareId=${encodeURIComponent(id)}`, self.location.origin).href, 303);
    } catch (error) {
      console.error('[ArchiOffice] Android share target failed', error);
      return Response.redirect(new URL('/share-target?shareError=1', self.location.origin).href, 303);
    }
  })());
});
