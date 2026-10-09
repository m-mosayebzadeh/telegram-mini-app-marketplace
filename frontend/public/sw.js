/*
 * Cosmos's service worker: only notifications (TECHNICAL_REQUIREMENTS.md
 * section 38). It caches nothing and answers no requests — the app works
 * exactly as before; this only lets a closed app be told something.
 *
 * The server sends {title, body, url, tag}. A notification with the same
 * tag replaces the last one (one per conversation, not one per message).
 * Tapping it brings an open Cosmos window to that place, or opens one.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let note = {}
  try {
    note = event.data ? event.data.json() : {}
  } catch {
    note = {}
  }
  event.waitUntil(
    self.registration.showNotification(note.title || 'Cosmos', {
      body: note.body || '',
      tag: note.tag,
      renotify: Boolean(note.tag),
      data: { url: note.url || '/' },
      // PNG, not SVG: Android and several browsers draw no SVG here. The
      // badge is the mark in white alone, which Android shows in the
      // status bar by its shape (section 43).
      icon: '/icon-192.png',
      badge: '/badge-96.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
  // Marked, so the app can count a tapped notification and then drop the mark
  // (src/lib/analytics.ts).
  target.searchParams.set('from', 'push')
  const url = target.href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        open.focus()
        return open.navigate(url)
      }
      return self.clients.openWindow(url)
    }),
  )
})
