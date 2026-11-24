/*
 * The app's notifications (v0.74), a part of its service worker (vite.config.ts → workbox.importScripts): what the
 * garage's server pushes is shown — its title, its lines, the count on the app's icon — and a tap opens the app at the
 * job (or «Сегодня») it is about.
 *
 * The message is JSON: { title, body, tag, url, badge }. The same `tag` again replaces the notification before it (a
 * price not told is one notification however many times it was said). An iPhone asks for one thing: every push shows a
 * notification — so one is always shown, whatever came.
 */

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    try {
      d = { body: event.data ? event.data.text() : '' };
    } catch {
      d = {};
    }
  }
  const title = typeof d.title === 'string' && d.title ? d.title : 'MyGarage';
  const options = {
    body: typeof d.body === 'string' ? d.body : '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: typeof d.url === 'string' ? d.url : '' },
  };
  if (typeof d.tag === 'string' && d.tag) {
    options.tag = d.tag;
    // Said again: it sounds again (the same tag silently replaces otherwise).
    options.renotify = true;
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      try {
        if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
          if (d.badge > 0) await self.navigator.setAppBadge(d.badge);
          else await self.navigator.clearAppBadge();
        }
      } catch {
        // no badge on this system
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '';
  // Only the app's own places (#/orders/…), never an address from outside.
  const hash = typeof url === 'string' && url.indexOf('#/') === 0 ? url : '#/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
        } catch {
          // not focusable from here: it is told where to go all the same
        }
        client.postMessage({ type: 'mg-open', url: hash });
        return;
      }
      await self.clients.openWindow(new URL('./' + hash, self.registration.scope).href);
    })(),
  );
});
