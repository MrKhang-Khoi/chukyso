// Service Worker for Hệ thống Ký số THCS Chu Văn An
// Hỗ trợ Web Push Notification trên điện thoại di động & máy tính (PWA)

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Xử lý sự kiện Push Notification từ máy chủ
self.addEventListener('push', (event) => {
  let data = {
    title: 'Hệ thống Ký số THCS Chu Văn An',
    body: 'Bạn có thông báo mới từ hệ thống ký số.',
    url: '/'
  };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = Object.assign(data, payload);
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'open', title: 'Xem chi tiết' },
      { action: 'close', title: 'Đóng' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Nhấp vào thông báo sẽ mở / chuyển đến trang tài liệu
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if ('focus' in client) {
          if (client.url.includes(self.location.origin)) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
