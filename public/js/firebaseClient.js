/**
 * EduSign Firebase Client Adapter (Hybrid Mode)
 * Hỗ trợ đồng bộ dữ liệu thời gian thực (Realtime Sync) qua Google Cloud Firestore
 * Tự động chuyển đổi mượt mà giữa Chế độ Cloud Firestore và Chế độ Local REST API
 */

(function() {
  let db = null;
  let unsubscribeDocs = null;
  let isInitialized = false;

  function initFirebase() {
    if (isInitialized) return db;

    const config = window.FIREBASE_CONFIG;
    if (config && config.enabled && config.apiKey && !config.apiKey.includes('YOUR_API_KEY') && typeof firebase !== 'undefined') {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(config);
        }
        db = firebase.firestore();
        isInitialized = true;
        console.log('⚡ [Firebase] Kết nối Cloud Firestore THÀNH CÔNG! Chế độ Realtime Sync đã kích hoạt.');
        updateFirebaseStatusUI(true);
        return db;
      } catch (err) {
        console.warn('⚠️ [Firebase] Lỗi khởi tạo:', err.message);
      }
    }
    
    updateFirebaseStatusUI(false);
    return null;
  }

  function updateFirebaseStatusUI(isActive) {
    const badge = document.getElementById('firebaseStatusBadge');
    if (badge) {
      if (isActive) {
        badge.innerHTML = '<i class="fa-solid fa-bolt text-amber-300"></i> Cloud Realtime: Đang bật';
        badge.className = 'px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 cursor-pointer';
        badge.title = 'Đang đồng bộ dữ liệu thời gian thực qua Google Cloud Firestore. Không cần bấm F5 khi duyệt bài.';
      } else {
        badge.innerHTML = '<i class="fa-solid fa-server text-slate-400"></i> Local Server Mode';
        badge.className = 'px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600 flex items-center gap-1.5 cursor-pointer';
        badge.title = 'Hệ thống đang chạy qua máy chủ REST API. Nhấp vào đây để xem hướng dẫn bật Firebase Cloud Realtime.';
      }
    }
  }

  // Lắng nghe hồ sơ thay đổi thời gian thực
  function subscribeDocuments(onDataChanged) {
    const firestore = initFirebase();
    if (!firestore) return false;

    if (unsubscribeDocs) {
      unsubscribeDocs();
    }

    try {
      unsubscribeDocs = firestore.collection('documents')
        .orderBy('createdAt', 'desc')
        .onSnapshot((snapshot) => {
          const docs = [];
          snapshot.forEach(docSnap => {
            docs.push({ id: docSnap.id, ...docSnap.data() });
          });
          console.log(`⚡ [Firebase Realtime] Nhận cập nhật: ${docs.length} hồ sơ`);
          if (typeof onDataChanged === 'function') {
            onDataChanged(docs);
          }
        }, (error) => {
          console.warn('⚠️ [Firebase Realtime] Lỗi lắng nghe:', error.message);
        });
      return true;
    } catch (err) {
      console.warn('⚠️ [Firebase Realtime] Không thể kết nối listener:', err.message);
      return false;
    }
  }

  // Cung cấp API ra ngoài
  window.EduSignFirebase = {
    init: initFirebase,
    isAvailable: function() {
      return !!initFirebase();
    },
    subscribeDocuments: subscribeDocuments,
    updateStatusUI: updateFirebaseStatusUI
  };

  // Tự động kiểm tra khi tải trang xong
  window.addEventListener('DOMContentLoaded', () => {
    initFirebase();
  });
})();
