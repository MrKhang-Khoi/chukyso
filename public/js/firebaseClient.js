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
        console.log('⚡ [Firebase] Đã khởi tạo Firebase App cho dự án:', config.projectId);
        updateFirebaseStatusUI('CONNECTING');
        return db;
      } catch (err) {
        console.warn('⚠️ [Firebase] Lỗi khởi tạo:', err.message);
      }
    }
    
    updateFirebaseStatusUI('LOCAL');
    return null;
  }

  function updateFirebaseStatusUI(status) {
    const badge = document.getElementById('firebaseStatusBadge');
    const modalBox = document.getElementById('firebaseConnectionState');
    const modalDesc = document.getElementById('firebaseStatusDesc');

    if (badge) {
      badge.classList.remove('hidden');
      if (status === 'ACTIVE') {
        badge.innerHTML = '<i class="fa-solid fa-bolt text-amber-300 animate-pulse"></i> Cloud Realtime: Đang bật';
        badge.className = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-pointer transition shadow-sm';
        badge.title = 'Đang đồng bộ dữ liệu thời gian thực qua Google Cloud Firestore. Không cần bấm F5 khi duyệt bài.';
        if (modalBox) {
          modalBox.innerText = 'Cloud Realtime: Đang hoạt động';
          modalBox.className = 'px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold';
        }
        if (modalDesc) {
          modalDesc.innerHTML = 'Dự án <strong>edusign-school</strong> đã kết nối thành công với Google Cloud Firestore! Khi BGH ký số duyệt bài, giao diện toàn trường sẽ cập nhật ngay lập tức không cần tải lại trang.';
        }
      } else if (status === 'NEED_DB') {
        badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-amber-400"></i> Firebase: Cần tạo Database';
        badge.className = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 cursor-pointer animate-pulse transition shadow-sm';
        badge.title = 'Dự án đã kết nối nhưng chưa bấm "Tạo Database" trên Firebase Console. Bấm vào đây để xem hướng dẫn.';
        if (modalBox) {
          modalBox.innerText = 'Chưa tạo Firestore Database';
          modalBox.className = 'px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold';
        }
        if (modalDesc) {
          modalDesc.innerHTML = '<div class="space-y-2"><div class="text-amber-800 font-bold">👉 Chỉ còn 1 bước cuối cùng:</div><div>Dự án <code>edusign-school</code> đã được kết nối vào code, nhưng Thầy/Cô chưa bấm nút <strong>[Create database]</strong> trong mục <em>Firestore Database</em> trên Google Console.</div><div class="pt-1"><a href="https://console.firebase.google.com/project/edusign-school/firestore" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition"><i class="fa-solid fa-arrow-up-right-from-square text-xs"></i> Mở trang Tạo Database ngay (Chọn Singapore & Test Mode)</a></div></div>';
        }
      } else {
        badge.innerHTML = '<i class="fa-solid fa-server text-slate-400"></i> Local Server Mode';
        badge.className = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 cursor-pointer transition shadow-sm';
        badge.title = 'Hệ thống đang chạy qua máy chủ REST API. Nhấp vào đây để xem hướng dẫn.';
        if (modalBox) {
          modalBox.innerText = 'Local Server Mode';
          modalBox.className = 'px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 font-semibold';
        }
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
          updateFirebaseStatusUI('ACTIVE');
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
          if (error.message && (error.message.includes('does not exist') || error.message.includes('NOT_FOUND') || error.code === 'not-found')) {
            updateFirebaseStatusUI('NEED_DB');
          } else {
            updateFirebaseStatusUI('LOCAL');
          }
        });
      return true;
    } catch (err) {
      console.warn('⚠️ [Firebase Realtime] Không thể kết nối listener:', err.message);
      updateFirebaseStatusUI('LOCAL');
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
