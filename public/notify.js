// Web Notification API による通知ヘルパー
(() => {
  const isSupported = () => {
    return 'Notification' in window;
  };

  const isEnabled = () => {
    if (!isSupported()) return false;
    try {
      const settings = JSON.parse(localStorage.getItem('shopping-settings-v1') || '{}');
      return Boolean(settings.notifications) && Notification.permission === 'granted';
    } catch (e) {
      return false;
    }
  };

  window.AppNotify = {
    isSupported,

    requestPermission: async () => {
      if (!isSupported()) {
        alert('お使いのブラウザはWeb通知に対応していません。');
        return false;
      }

      try {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
      } catch (e) {
        console.warn('通知許可リクエストエラー:', e);
        return false;
      }
    },

    send: (title, body = '', options = {}) => {
      if (!isEnabled()) return;

      try {
        const defaultOptions = {
          body,
          icon: '/icons/icon.svg',
          badge: '/icons/icon.svg',
          vibrate: [100, 50, 100],
          ...options
        };

        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then((registration) => {
            registration.showNotification(title, defaultOptions);
          }).catch(() => {
            new Notification(title, defaultOptions);
          });
        } else {
          new Notification(title, defaultOptions);
        }
      } catch (e) {
        console.warn('通知送信エラー:', e);
      }
    }
  };
})();
