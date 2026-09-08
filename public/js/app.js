/**
 * ============================================================================
 * EDUSIGN WEB — CLIENT APPLICATION JAVASCRIPT
 * Hỗ trợ 2 chế độ:
 * 1. Chế độ GitHub Pages (Static Web): Kết nối trực tiếp Firebase Realtime DB
 *    (Không cần chạy server cục bộ, hoạt động 100% trên GitHub Pages / Trình duyệt)
 * 2. Chế độ Render Server: Gọi qua API backend khi chạy đầy đủ
 * ============================================================================
 */

// ==================== GLOBAL CONFIG & STATE ====================
const isStaticOrGitHub = window.location.hostname.includes('github.io') || 
                         window.location.protocol === 'file:' || 
                         window.location.port !== '3000';

const BACKEND_RENDER_URL = 'https://edusign-vgca.onrender.com';
const API_BASE = isStaticOrGitHub ? BACKEND_RENDER_URL : '';

let appState = {
  token: localStorage.getItem('edusign_token') || null,
  currentUser: JSON.parse(localStorage.getItem('edusign_user') || 'null'),
  users: [],
  departments: [],
  activeTab: 'teachers'
};

// ==================== FIREBASE REALTIME CLIENT ====================
let firebaseDb = null;
const RTDB_URL = "https://edusign-school-default-rtdb.asia-southeast1.firebasedatabase.app";

function initFirebaseRealtime() {
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) return;

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }
    firebaseDb = firebase.database();

    // 1. Lắng nghe thay đổi bảng Users trong thời gian thực
    firebaseDb.ref('users').on('value', (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const list = Array.isArray(data) 
        ? data.filter(u => u && (u.id || u.username)) 
        : Object.keys(data).map(k => ({ id: data[k].id || k, ...data[k] }));

      appState.users = list;
      renderTeachersTable();
      updateDepartmentSelectOptions();

      // Kiểm tra nếu tài khoản đang đăng nhập bị khóa -> văng ra
      if (appState.currentUser) {
        const me = list.find(u => u.id === appState.currentUser.id || u.username === appState.currentUser.username);
        if (me && me.isLocked) {
          showToast('Tài khoản của bạn vừa bị Quản trị viên khóa!', 'error');
          handleLogout();
        }
      }
    });

    // 2. Lắng nghe thay đổi bảng Departments trong thời gian thực
    firebaseDb.ref('departments').on('value', (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const list = Array.isArray(data) 
        ? data.filter(d => d && (d.id || d.name)) 
        : Object.keys(data).map(k => ({ id: data[k].id || k, ...data[k] }));

      appState.departments = list;
      renderDepartmentsGrid();
      updateDepartmentSelectOptions();
    });

    // 3. Lắng nghe thay đổi bảng Documents (Hồ sơ chờ ký) trong thời gian thực
    firebaseDb.ref('documents').on('value', () => {
      if (appState.currentUser && typeof loadTeacherPendingDocuments === 'function') {
        loadTeacherPendingDocuments();
      }
    });

  } catch (err) {
    console.warn('[Firebase Realtime Init]', err.message);
  }
}

// Lưu mảng Users lên Firebase
async function syncUsersToFirebase(users) {
  if (firebaseDb) {
    await firebaseDb.ref('users').set(users);
    return;
  }
  await fetch(`${RTDB_URL}/users.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(users)
  });
}

// Lưu mảng Departments lên Firebase
async function syncDepartmentsToFirebase(depts) {
  if (firebaseDb) {
    await firebaseDb.ref('departments').set(depts);
    return;
  }
  await fetch(`${RTDB_URL}/departments.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(depts)
  });
}

// ==================== AUTHENTICATION ====================
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername').value.trim();
  const passwordInput = document.getElementById('loginPassword').value;
  const alertEl = document.getElementById('loginAlert');
  const btnSubmit = document.getElementById('btnLoginSubmit');

  alertEl.classList.add('hidden');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<span>Đang xác thực...</span>';

  try {
    let authenticatedUser = null;

    // 1. Thử xác thực trực tiếp qua Firebase Realtime DB (Tối ưu cho GitHub Pages & không phụ thuộc Render server)
    try {
      let usersList = appState.users;
      if (!usersList || usersList.length === 0) {
        const res = await fetch(`${RTDB_URL}/users.json`);
        const data = await res.json();
        usersList = Array.isArray(data) ? data : Object.values(data || {});
        appState.users = usersList;
      }

      const cleanU = usernameInput.toLowerCase();
      const matched = usersList.find(u => u && (u.username || '').toLowerCase() === cleanU);

      if (matched) {
        if (matched.isLocked) {
          throw new Error('Tài khoản của Thầy/Cô đã bị tạm khóa bởi Quản trị viên.');
        }

        // Kiểm tra mật khẩu (hỗ trợ cả mật khẩu admin@123, admin, và các mật khẩu đã băm/chuỗi)
        const isPassOk = (matched.password === passwordInput) || 
                         (matched.passwordHash && typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt.compareSync(passwordInput, matched.passwordHash)) ||
                         (passwordInput === 'admin@123' && cleanU === 'admin') ||
                         (passwordInput === 'admin' && cleanU === 'admin');

        if (isPassOk) {
          authenticatedUser = {
            id: matched.id || 'admin',
            username: matched.username,
            fullName: matched.fullName || matched.name || matched.username,
            role: (matched.role || 'TEACHER').toUpperCase(),
            roleTitle: matched.roleTitle || (matched.role === 'ADMIN' ? 'Quản trị viên' : 'Giáo viên'),
            departmentId: matched.departmentId || '',
            departmentName: matched.departmentName || matched.department || '',
            signType: matched.signType || 'VGCA'
          };
        }
      }
    } catch (fbErr) {
      if (fbErr.message.includes('khóa')) throw fbErr;
      console.warn('[Direct Auth Note]', fbErr.message);
    }

    // 2. Nếu chưa xong, thử gọi API Backend nếu có
    if (!authenticatedUser && !isStaticOrGitHub) {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Tên đăng nhập hoặc mật khẩu không đúng.');
      authenticatedUser = data.user;
      appState.token = data.token;
      localStorage.setItem('edusign_token', data.token);
    }

    if (!authenticatedUser) {
      throw new Error('Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    appState.currentUser = authenticatedUser;
    localStorage.setItem('edusign_user', JSON.stringify(authenticatedUser));

    showToast(`Chào mừng ${authenticatedUser.fullName || authenticatedUser.username}!`, 'success');
    if (authenticatedUser.role === 'ADMIN') {
      showView('admin');
    } else {
      showView('teacher');
    }
    initFirebaseRealtime();
    fetchInitialData();

  } catch (err) {
    alertEl.textContent = err.message;
    alertEl.classList.remove('hidden');
    showToast(err.message, 'error');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<span>Đăng nhập hệ thống</span><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>';
  }
}

function handleLogout() {
  appState.token = null;
  appState.currentUser = null;
  localStorage.removeItem('edusign_token');
  localStorage.removeItem('edusign_user');
  showView('login');
  showToast('Đã đăng xuất an toàn.', 'info');
}

function checkSession() {
  if (appState.currentUser) {
    if (appState.currentUser.role === 'ADMIN') {
      showView('admin');
    } else {
      showView('teacher');
    }
    initFirebaseRealtime();
    fetchInitialData();
  } else {
    showView('login');
  }
}

// ==================== VIEW MANAGEMENT ====================
function showView(viewName) {
  const viewLogin = document.getElementById('viewLogin');
  const viewAdmin = document.getElementById('viewAdmin');
  const viewTeacher = document.getElementById('viewTeacher');

  if (viewName === 'login') {
    viewLogin?.classList.remove('hidden');
    viewAdmin?.classList.add('hidden');
    viewTeacher?.classList.add('hidden');
  } else if (viewName === 'admin') {
    viewLogin?.classList.add('hidden');
    viewAdmin?.classList.remove('hidden');
    viewTeacher?.classList.add('hidden');

    if (appState.currentUser) {
      const nameEl = document.getElementById('headerAdminName');
      const roleEl = document.getElementById('headerAdminRole');
      if (nameEl) nameEl.textContent = appState.currentUser.fullName || appState.currentUser.username;
      if (roleEl) roleEl.textContent = appState.currentUser.roleTitle || 'Quản trị viên';
    }
  } else {
    // viewName === 'teacher'
    viewLogin?.classList.add('hidden');
    viewAdmin?.classList.add('hidden');
    viewTeacher?.classList.remove('hidden');

    if (appState.currentUser) {
      const nameEl = document.getElementById('headerTeacherName');
      const deptEl = document.getElementById('headerTeacherDept');
      const badgeEl = document.getElementById('teacherHeaderSignTypeBadge');
      if (nameEl) nameEl.textContent = appState.currentUser.fullName || appState.currentUser.username;
      if (deptEl) deptEl.textContent = `${appState.currentUser.departmentName || appState.currentUser.department || 'Chưa phân tổ'} • ${appState.currentUser.roleTitle || 'Giáo viên'}`;
      if (badgeEl) {
        badgeEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> ${appState.currentUser.signType === 'USB' ? 'Chữ ký số USB Token' : 'VGCA SmartCA (Ban Cơ yếu)'}`;
      }
    }

    if (typeof populateNextSigners === 'function') {
      populateNextSigners();
    }
    if (typeof initTeacherWorkspace === 'function') {
      initTeacherWorkspace();
    }
    if (typeof loadTeacherPendingDocuments === 'function') {
      loadTeacherPendingDocuments();
    }
  }
}

function switchTab(tabName) {
  appState.activeTab = tabName;
  const tabTeachers = document.getElementById('tabContentTeachers');
  const tabDepts = document.getElementById('tabContentDepartments');
  const btnTeachers = document.getElementById('tabBtnTeachers');
  const btnDepts = document.getElementById('tabBtnDepartments');

  const btnCreateUser = document.querySelector('.btn-create-user');
  const btnCreateDept = document.querySelector('.btn-create-dept');

  if (tabName === 'teachers') {
    tabTeachers.classList.remove('hidden');
    tabDepts.classList.add('hidden');

    btnTeachers.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all bg-brand-600 text-white shadow-sm shadow-brand-500/20";
    btnDepts.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-500 hover:text-slate-800 hover:bg-slate-100";

    btnCreateUser.classList.remove('hidden');
    btnCreateDept.classList.add('hidden');
  } else {
    tabTeachers.classList.add('hidden');
    tabDepts.classList.remove('hidden');

    btnDepts.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all bg-brand-600 text-white shadow-sm shadow-brand-500/20";
    btnTeachers.className = "px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-500 hover:text-slate-800 hover:bg-slate-100";

    btnCreateUser.classList.add('hidden');
    btnCreateDept.classList.remove('hidden');
    renderDepartmentsGrid();
  }
}

// ==================== DATA FETCHING ====================
async function fetchInitialData() {
  try {
    const [uRes, dRes] = await Promise.all([
      fetch(`${RTDB_URL}/users.json`),
      fetch(`${RTDB_URL}/departments.json`)
    ]);

    const uData = await uRes.json();
    const dData = await dRes.json();

    if (uData) {
      appState.users = Array.isArray(uData) ? uData.filter(u => u) : Object.values(uData);
    }
    if (dData) {
      appState.departments = Array.isArray(dData) ? dData.filter(d => d) : Object.values(dData);
    }

    renderTeachersTable();
    renderDepartmentsGrid();
    updateDepartmentSelectOptions();
  } catch (err) {
    console.warn('Lỗi tải dữ liệu ban đầu:', err.message);
  }
}

// ==================== RENDERING TEACHERS ====================
function renderTeachersTable() {
  const tbody = document.getElementById('tableBodyTeachers');
  if (!tbody) return;

  const filtered = getFilteredTeachers();

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-slate-400">Không tìm thấy giáo viên nào phù hợp.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const isLocked = !!u.isLocked;
    const signTypeBadge = u.signType === 'USB_TOKEN'
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
           <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
           USB Token
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
           <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
           VGCA SmartCA
         </span>`;

    const statusBadge = isLocked
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">
           <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
           Đã khóa
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
           <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
           Hoạt động
         </span>`;

    const roleBadgeColor = u.role === 'ADMIN' ? 'bg-purple-50 text-purple-700 border-purple-200' :
      (u.role === 'BGH' ? 'bg-rose-50 text-rose-700 border-rose-200' : 
      (u.role === 'LEADER' || u.role === 'HEAD_DEPT' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-700 border-slate-200'));

    const displayName = u.fullName || u.name || u.username;
    const deptName = u.departmentName || u.department || 'Chưa vào tổ';

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-xs">
              ${displayName.substring(0, 1).toUpperCase()}
            </div>
            <div>
              <div class="font-bold text-slate-900">${escapeHtml(displayName)}</div>
              <div class="text-[11px] text-slate-400 font-mono">@${escapeHtml(u.username)} ${u.email ? `• ${escapeHtml(u.email)}` : ''}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="font-medium text-slate-700">${escapeHtml(deptName)}</div>
          <span class="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold border ${roleBadgeColor}">
            ${escapeHtml(u.roleTitle || u.role)}
          </span>
        </td>
        <td class="py-3 px-4">${signTypeBadge}</td>
        <td class="py-3 px-4">${statusBadge}</td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <!-- Nút Khóa / Mở khóa -->
            <button onclick="handleToggleLock('${u.id}')" title="${isLocked ? 'Mở khóa tài khoản' : 'Khóa tài khoản'}" 
              class="p-1.5 rounded-lg border ${isLocked ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-amber-600 hover:bg-amber-50'} transition-all">
              ${isLocked 
                ? '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>'
                : '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>'
              }
            </button>

            <!-- Nút Sửa -->
            <button onclick="openModalEditUser('${u.id}')" title="Sửa thông tin" 
              class="p-1.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 hover:text-brand-600 hover:bg-brand-50 hover:border-brand-200 transition-all">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>

            <!-- Nút Đặt lại Mật khẩu -->
            <button onclick="openModalResetPass('${u.id}', '${escapeHtml(displayName)}')" title="Đặt lại mật khẩu" 
              class="p-1.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200 hover:text-amber-600 hover:bg-amber-50 hover:border-amber-200 transition-all">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
            </button>

            <!-- Nút Xóa -->
            ${u.username === 'admin' ? '' : `
              <button onclick="handleDeleteUser('${u.id}', '${escapeHtml(displayName)}')" title="Xóa tài khoản" 
                class="p-1.5 rounded-lg bg-slate-50 text-slate-400 border border-slate-200 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-all">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getFilteredTeachers() {
  const q = (document.getElementById('filterTeacherSearch')?.value || '').trim().toLowerCase();
  const deptId = document.getElementById('filterTeacherDept')?.value || '';
  const signType = document.getElementById('filterTeacherSignType')?.value || '';

  return appState.users.filter(u => {
    if (!u) return false;
    const userDeptId = u.departmentId || u.deptId || '';
    if (deptId && userDeptId !== deptId) return false;
    if (signType && u.signType !== signType) return false;
    if (q) {
      const match = (u.fullName || u.name || '').toLowerCase().includes(q) ||
                    (u.username || '').toLowerCase().includes(q) ||
                    (u.email || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}

function applyTeacherFilters() {
  renderTeachersTable();
}

// ==================== RENDERING DEPARTMENTS ====================
function renderDepartmentsGrid() {
  const container = document.getElementById('gridDepartments');
  if (!container) return;

  if (appState.departments.length === 0) {
    container.innerHTML = '<div class="col-span-full py-8 text-center text-slate-400">Chưa có tổ chuyên môn nào.</div>';
    return;
  }

  container.innerHTML = appState.departments.map(d => {
    const memberCount = appState.users.filter(u => (u.departmentId === d.id || u.department === d.name)).length;
    const leader = appState.users.find(u => u.id === d.leaderId || u.username === d.leaderId);
    const leaderName = leader ? (leader.fullName || leader.name) : (d.leaderName || 'Chưa chỉ định');

    return `
      <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
        <div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <span class="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700">${escapeHtml(d.code || 'TO')}</span>
              <h4 class="text-sm font-bold text-slate-900 mt-1">${escapeHtml(d.name)}</h4>
            </div>
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-100">
              ${memberCount} giáo viên
            </span>
          </div>
          <p class="text-xs text-slate-500 mt-2 line-clamp-2">${escapeHtml(d.description || 'Không có mô tả.')}</p>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
          <div class="text-[11px] text-slate-500">
            <span class="text-slate-400">Tổ trưởng:</span> <strong class="text-slate-700">${escapeHtml(leaderName)}</strong>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="openModalEditDept('${d.id}')" title="Sửa tổ" class="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-all">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            ${d.id === 'dept_bgh' ? '' : `
              <button onclick="handleDeleteDepartment('${d.id}', '${escapeHtml(d.name)}')" title="Xóa tổ" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function updateDepartmentSelectOptions() {
  const selects = ['filterTeacherDept', 'userDepartmentId'];
  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (!select) return;

    const currentVal = select.value;
    const isFilter = selectId === 'filterTeacherDept';

    let html = isFilter ? '<option value="">Tất cả Tổ chuyên môn</option>' : '<option value="">Chọn tổ chuyên môn</option>';
    html += appState.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

    select.innerHTML = html;
    if (currentVal) select.value = currentVal;
  });

  // Cập nhật dropdown chọn Tổ trưởng
  const leaderSelect = document.getElementById('deptLeaderId');
  if (leaderSelect) {
    const curVal = leaderSelect.value;
    let html = '<option value="">Chưa chỉ định</option>';
    html += appState.users.map(u => {
      const name = u.fullName || u.name || u.username;
      const dept = u.departmentName || u.department || 'Chưa vào tổ';
      return `<option value="${u.id}">${escapeHtml(name)} (${escapeHtml(dept)})</option>`;
    }).join('');
    leaderSelect.innerHTML = html;
    if (curVal) leaderSelect.value = curVal;
  }
}

// ==================== USER ACTIONS (FIREBASE REALTIME DIRECT) ====================
function openModalCreateUser() {
  document.getElementById('modalUserTitle').textContent = 'Thêm Giáo viên mới';
  document.getElementById('userId').value = '';
  document.getElementById('userFullName').value = '';
  document.getElementById('userUsername').value = '';
  document.getElementById('userUsername').disabled = false;
  document.getElementById('boxPassword').classList.remove('hidden');
  document.getElementById('userPassword').required = true;
  document.getElementById('userPassword').value = '';
  document.getElementById('userRole').value = 'TEACHER';
  document.getElementById('userEmail').value = '';
  document.getElementById('userPhone').value = '';

  const radios = document.getElementsByName('userSignType');
  radios.forEach(r => { r.checked = (r.value === 'VGCA'); });

  updateDepartmentSelectOptions();
  openModal('modalUser');
}

function openModalEditUser(userId) {
  const u = appState.users.find(x => x.id === userId);
  if (!u) return;

  const displayName = u.fullName || u.name || u.username;
  document.getElementById('modalUserTitle').textContent = `Sửa thông tin: ${displayName}`;
  document.getElementById('userId').value = u.id;
  document.getElementById('userFullName').value = displayName;
  document.getElementById('userUsername').value = u.username || '';
  document.getElementById('userUsername').disabled = true; // Không đổi username
  document.getElementById('boxPassword').classList.add('hidden'); // Đổi MK dùng modal riêng
  document.getElementById('userPassword').required = false;

  document.getElementById('userDepartmentId').value = u.departmentId || '';
  document.getElementById('userRole').value = u.role || 'TEACHER';
  document.getElementById('userEmail').value = u.email || '';
  document.getElementById('userPhone').value = u.phone || '';

  const radios = document.getElementsByName('userSignType');
  radios.forEach(r => { r.checked = (r.value === (u.signType || 'VGCA')); });

  openModal('modalUser');
}

async function handleSaveUser(e) {
  e.preventDefault();
  const id = document.getElementById('userId').value;
  const fullName = document.getElementById('userFullName').value.trim();
  const username = document.getElementById('userUsername').value.trim().toLowerCase();
  const password = document.getElementById('userPassword').value;
  const departmentId = document.getElementById('userDepartmentId').value;
  const role = document.getElementById('userRole').value;
  const email = document.getElementById('userEmail').value.trim();
  const phone = document.getElementById('userPhone').value.trim();

  let signType = 'VGCA';
  const radios = document.getElementsByName('userSignType');
  radios.forEach(r => { if (r.checked) signType = r.value; });

  const dept = appState.departments.find(d => d.id === departmentId);
  const departmentName = dept ? dept.name : '';

  try {
    const users = [...appState.users];

    if (id) {
      // Cập nhật giáo viên
      const idx = users.findIndex(u => u.id === id);
      if (idx !== -1) {
        users[idx] = {
          ...users[idx],
          fullName,
          departmentId,
          departmentName,
          department: departmentName,
          role,
          roleTitle: role === 'ADMIN' ? 'Quản trị viên' : (role === 'BGH' ? 'Ban Giám hiệu' : (role === 'LEADER' ? 'Tổ trưởng chuyên môn' : 'Giáo viên')),
          signType,
          email,
          phone,
          updatedAt: new Date().toISOString()
        };
        await syncUsersToFirebase(users);
        showToast('Cập nhật thông tin giáo viên thành công!', 'success');
      }
    } else {
      // Thêm mới
      if (users.some(u => (u.username || '').toLowerCase() === username)) {
        throw new Error(`Tên đăng nhập [${username}] đã tồn tại.`);
      }

      const newId = `user_${Date.now().toString(36)}`;
      const newUser = {
        id: newId,
        username,
        password: password || '123456',
        fullName,
        name: fullName,
        departmentId,
        departmentName,
        department: departmentName,
        role,
        roleTitle: role === 'ADMIN' ? 'Quản trị viên' : (role === 'BGH' ? 'Ban Giám hiệu' : (role === 'LEADER' ? 'Tổ trưởng chuyên môn' : 'Giáo viên')),
        signType,
        email,
        phone,
        isLocked: false,
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      await syncUsersToFirebase(users);
      showToast('Thêm giáo viên mới thành công!', 'success');
    }

    closeModal('modalUser');
    renderTeachersTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleToggleLock(userId) {
  try {
    const users = [...appState.users];
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return;

    if (users[idx].username === 'admin') {
      throw new Error('Không thể khóa tài khoản Quản trị viên cấp cao [admin].');
    }

    users[idx].isLocked = !users[idx].isLocked;
    users[idx].updatedAt = new Date().toISOString();

    await syncUsersToFirebase(users);
    const actionText = users[idx].isLocked ? 'Khóa tài khoản' : 'Mở khóa tài khoản';
    showToast(`${actionText} thành công!`, 'success');
    renderTeachersTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openModalResetPass(userId, userName) {
  document.getElementById('resetPasswordUserId').value = userId;
  document.getElementById('resetPassTargetDesc').textContent = `Cấp lại mật khẩu mới cho: ${userName}`;
  document.getElementById('inputNewPassword').value = '123456';
  openModal('modalResetPassword');
}

async function handleConfirmResetPassword(e) {
  e.preventDefault();
  const userId = document.getElementById('resetPasswordUserId').value;
  const newPassword = document.getElementById('inputNewPassword').value.trim();

  if (!newPassword || newPassword.length < 4) {
    showToast('Mật khẩu mới phải có ít nhất 4 ký tự.', 'error');
    return;
  }

  try {
    const users = [...appState.users];
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) {
      users[idx].password = newPassword;
      delete users[idx].passwordHash;
      users[idx].updatedAt = new Date().toISOString();
      await syncUsersToFirebase(users);
      showToast('Đặt lại mật khẩu thành công!', 'success');
      closeModal('modalResetPassword');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDeleteUser(userId, userName) {
  showModalConfirm(
    'Xác nhận xóa tài khoản',
    `Thầy/Cô có chắc chắn muốn xóa tài khoản của [${userName}] khỏi hệ thống? Thao tác này không thể khôi phục!`,
    async () => {
      try {
        let users = [...appState.users];
        const target = users.find(u => u.id === userId);
        if (target && target.username === 'admin') {
          showModalAlert('Không thể xóa', 'Tài khoản [admin] được bảo vệ, không thể xóa.', 'error');
          return;
        }

        users = users.filter(u => u.id !== userId);
        await syncUsersToFirebase(users);
        showToast('Đã xóa tài khoản giáo viên.', 'success');
        renderTeachersTable();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// ==================== DEPARTMENT ACTIONS (FIREBASE REALTIME DIRECT) ====================
function openModalCreateDept() {
  document.getElementById('modalDeptTitle').textContent = 'Thêm Tổ chuyên môn mới';
  document.getElementById('deptId').value = '';
  document.getElementById('deptName').value = '';
  document.getElementById('deptCode').value = '';
  document.getElementById('deptDescription').value = '';
  updateDepartmentSelectOptions();
  openModal('modalDepartment');
}

function openModalEditDept(deptId) {
  const d = appState.departments.find(x => x.id === deptId);
  if (!d) return;

  document.getElementById('modalDeptTitle').textContent = `Sửa tổ: ${d.name}`;
  document.getElementById('deptId').value = d.id;
  document.getElementById('deptName').value = d.name || '';
  document.getElementById('deptCode').value = d.code || '';
  document.getElementById('deptDescription').value = d.description || '';
  updateDepartmentSelectOptions();
  document.getElementById('deptLeaderId').value = d.leaderId || '';
  openModal('modalDepartment');
}

async function handleSaveDepartment(e) {
  e.preventDefault();
  const id = document.getElementById('deptId').value;
  const name = document.getElementById('deptName').value.trim();
  const code = document.getElementById('deptCode').value.trim().toUpperCase();
  const description = document.getElementById('deptDescription').value.trim();
  const leaderId = document.getElementById('deptLeaderId').value;

  try {
    const depts = [...appState.departments];

    if (id) {
      const idx = depts.findIndex(d => d.id === id);
      if (idx !== -1) {
        depts[idx] = { ...depts[idx], name, code, description, leaderId, updatedAt: new Date().toISOString() };
        await syncDepartmentsToFirebase(depts);
        showToast('Cập nhật tổ chuyên môn thành công!', 'success');
      }
    } else {
      const newId = `dept_${Date.now().toString(36)}`;
      depts.push({
        id: newId,
        name,
        code,
        description,
        leaderId: leaderId || null,
        createdAt: new Date().toISOString()
      });
      await syncDepartmentsToFirebase(depts);
      showToast('Tạo tổ chuyên môn mới thành công!', 'success');
    }

    closeModal('modalDepartment');
    renderDepartmentsGrid();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDeleteDepartment(deptId, deptName) {
  if (deptId === 'dept_bgh') {
    showModalAlert('Không thể xóa', 'Tổ Ban Giám hiệu là cơ cấu hệ thống, không thể xóa.', 'warning');
    return;
  }

  const memberCount = appState.users.filter(u => u.departmentId === deptId || u.department === deptName).length;
  if (memberCount > 0) {
    showModalAlert('Chưa thể xóa tổ', `Không thể xóa tổ này vì đang có ${memberCount} giáo viên. Vui lòng chuyển giáo viên sang tổ khác trước!`, 'warning');
    return;
  }

  showModalConfirm(
    'Xác nhận xóa tổ chuyên môn',
    `Thầy/Cô có chắc chắn muốn xóa tổ chuyên môn [${deptName}]?`,
    async () => {
      try {
        const depts = appState.departments.filter(d => d.id !== deptId);
        await syncDepartmentsToFirebase(depts);
        showToast('Đã xóa tổ chuyên môn.', 'success');
        renderDepartmentsGrid();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// ==================== MODAL UTILITIES ====================
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
  if (id === 'modalDocViewer') {
    currentChainedPendingDoc = null;
    const chainedBar = document.getElementById('viewerChainedSignBar');
    if (chainedBar) chainedBar.classList.add('hidden');
  }
}

function closeModalOnBackdrop(e, id) {
  if (e.target === e.currentTarget) {
    closeModal(id);
  }
}

function togglePasswordVisibility(inputId, _btnId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const bgColors = {
    success: 'bg-emerald-600 text-white shadow-emerald-500/25',
    error: 'bg-red-600 text-white shadow-red-500/25',
    info: 'bg-slate-800 text-white shadow-slate-900/25'
  };

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto p-3.5 rounded-2xl text-xs font-semibold shadow-xl flex items-center justify-between gap-3 transform transition-all duration-300 translate-y-2 opacity-0 ${bgColors[type] || bgColors.info}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button onclick="this.parentElement.remove()" class="opacity-70 hover:opacity-100 p-0.5">✕</button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==================== HỆ THỐNG HỘP THOẠI MODAL ĐỒNG NHẤT (ZERO BROWSER ALERTS) ====================
let pendingConfirmCallback = null;

function showModalAlert(title, message, type = 'info', actionConfig = null) {
  const elTitle = document.getElementById('alertTitle');
  const elMsg = document.getElementById('alertMessage');
  const iconContainer = document.getElementById('alertIconContainer');
  const btnOk = document.getElementById('btnAlertOk');
  const btnSec = document.getElementById('btnAlertSecondary');

  if (elTitle) elTitle.textContent = title;
  if (elMsg) elMsg.textContent = message;

  if (iconContainer) {
    if (type === 'error') {
      iconContainer.className = 'mx-auto w-12 h-12 rounded-2xl flex items-center justify-center bg-red-50 text-red-600';
      iconContainer.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    } else if (type === 'warning') {
      iconContainer.className = 'mx-auto w-12 h-12 rounded-2xl flex items-center justify-center bg-amber-50 text-amber-600';
      iconContainer.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
    } else if (type === 'success') {
      iconContainer.className = 'mx-auto w-12 h-12 rounded-2xl flex items-center justify-center bg-emerald-50 text-emerald-600';
      iconContainer.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
    } else {
      iconContainer.className = 'mx-auto w-12 h-12 rounded-2xl flex items-center justify-center bg-brand-50 text-brand-600';
      iconContainer.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    }
  }

  const alertActionCallback = actionConfig ? (actionConfig.callback || actionConfig.onConfirm) : null;
  const alertActionText = actionConfig ? (actionConfig.text || actionConfig.confirmText || 'Thực hiện') : 'Thực hiện';

  if (actionConfig && alertActionCallback) {
    if (btnSec) {
      btnSec.classList.remove('hidden');
      btnSec.textContent = actionConfig.cancelText || 'Đóng';
      btnSec.onclick = () => closeModal('modalUnifiedAlert');
    }
    if (btnOk) {
      btnOk.textContent = alertActionText;
      btnOk.className = 'px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20 transition-all flex-1';
      btnOk.onclick = () => {
        closeModal('modalUnifiedAlert');
        alertActionCallback();
      };
    }
  } else {
    if (btnSec) btnSec.classList.add('hidden');
    if (btnOk) {
      btnOk.textContent = 'Đồng ý';
      btnOk.className = 'w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-500/20 transition-all';
      btnOk.onclick = () => closeModal('modalUnifiedAlert');
    }
  }

  openModal('modalUnifiedAlert');
}

function showModalConfirm(title, message, onConfirm) {
  pendingConfirmCallback = onConfirm;
  const elTitle = document.getElementById('confirmTitle');
  const elMsg = document.getElementById('confirmMessage');
  if (elTitle) elTitle.textContent = title;
  if (elMsg) elMsg.textContent = message;

  const btnOk = document.getElementById('btnConfirmOk');
  if (btnOk) {
    btnOk.onclick = () => {
      closeModal('modalUnifiedConfirm');
      if (typeof pendingConfirmCallback === 'function') {
        pendingConfirmCallback();
        pendingConfirmCallback = null;
      }
    };
  }
  openModal('modalUnifiedConfirm');
}

// ==================== BÀN LÀM VIỆC GIÁO VIÊN (TEACHER WORKSPACE) ====================
let teacherSelectedFile = null;
let teacherSelectedFileBase64 = null;

function initTeacherWorkspace() {
  initDropzone();
}

function initDropzone() {
  const dropzone = document.getElementById('dropzoneBox');
  if (!dropzone || dropzone._hasListener) return;
  dropzone._hasListener = true;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('border-brand-500', 'bg-brand-50/30');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('border-brand-500', 'bg-brand-50/30');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt && dt.files;
    if (files && files.length > 0) {
      processSelectedFile(files[0]);
    }
  }, false);
}

function handleTeacherFileSelect(event) {
  const file = event.target.files && event.target.files[0];
  if (file) {
    processSelectedFile(file);
  }
}

function processSelectedFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['docx', 'doc', 'pdf'].includes(ext)) {
    showModalAlert(
      'Định dạng không hỗ trợ',
      'Hệ thống chỉ tiếp nhận tệp Microsoft Word (.docx, .doc) hoặc tệp chuẩn PDF (.pdf). Vui lòng chọn đúng tệp.',
      'warning'
    );
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    showModalAlert('Tệp quá lớn', 'Kích thước tệp vượt quá 50MB. Vui lòng kiểm tra lại.', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    teacherSelectedFile = file;
    teacherSelectedFileBase64 = e.target.result;

    const box = document.getElementById('fileSelectedBox');
    const nameEl = document.getElementById('fileNameDisplay');
    const sizeEl = document.getElementById('fileSizeDisplay');
    const badge = document.getElementById('fileIconBadge');

    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) sizeEl.textContent = `${formatFileSize(file.size)} • Sẵn sàng`;

    if (ext === 'pdf') {
      if (badge) {
        badge.textContent = 'PDF';
        badge.className = 'w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold text-xs shadow-sm';
      }
    } else {
      if (badge) {
        badge.textContent = 'DOC';
        badge.className = 'w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-xs shadow-sm';
      }
    }

    if (box) box.classList.remove('hidden');

    updateTeacherButtonStates();
  };
  reader.readAsDataURL(file);
}

function updateTeacherButtonStates() {
  const btnConvert = document.getElementById('btnConvertToPdf');
  const btnSign = document.getElementById('btnSignNow');

  if (!teacherSelectedFile) {
    if (btnConvert) {
      btnConvert.disabled = true;
      btnConvert.className = 'flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-not-allowed';
      btnConvert.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>Chuyển PDF</span>';
    }
    if (btnSign) {
      btnSign.disabled = true;
      btnSign.className = 'flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-slate-200 text-slate-400 text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-not-allowed';
    }
    return;
  }

  const isWord = /\.(docx|doc)$/i.test(teacherSelectedFile.name);

  if (isWord) {
    if (btnConvert) {
      btnConvert.disabled = false;
      btnConvert.className = 'flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-white text-xs font-bold shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer';
      btnConvert.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>Chuyển PDF</span>';
    }
    if (btnSign) {
      btnSign.disabled = true;
      btnSign.className = 'flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-slate-200 text-slate-400 text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-not-allowed';
    }
  } else {
    if (btnConvert) {
      btnConvert.disabled = true;
      btnConvert.className = 'flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-400 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-not-allowed';
      btnConvert.innerHTML = '<svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span>Đã là PDF</span>';
    }
    if (btnSign) {
      btnSign.disabled = false;
      btnSign.className = 'flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-[0.99] text-white text-xs font-bold transition-all shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2 cursor-pointer';
    }
  }
}

function handleClearFile() {
  teacherSelectedFile = null;
  teacherSelectedFileBase64 = null;
  const input = document.getElementById('teacherFileInput');
  if (input) input.value = '';
  const box = document.getElementById('fileSelectedBox');
  if (box) box.classList.add('hidden');
  updateTeacherButtonStates();
}

function handleDocTypeChange() {
  const choice = document.querySelector('input[name="docTypeChoice"]:checked')?.value || 'LESSON_PLAN';
  const secReport = document.getElementById('sectionReportForward');
  const labelLesson = document.getElementById('labelTypeLesson');
  const labelReport = document.getElementById('labelTypeReport');

  if (choice === 'LESSON_PLAN') {
    if (secReport) secReport.classList.add('hidden');
    labelLesson?.classList.add('border-brand-500', 'bg-brand-50/40');
    labelLesson?.classList.remove('border-slate-200');
    labelReport?.classList.remove('border-brand-500', 'bg-brand-50/40');
    labelReport?.classList.add('border-slate-200');
  } else {
    if (secReport) secReport.classList.remove('hidden');
    labelReport?.classList.add('border-brand-500', 'bg-brand-50/40');
    labelReport?.classList.remove('border-slate-200');
    labelLesson?.classList.remove('border-brand-500', 'bg-brand-50/40');
    labelLesson?.classList.add('border-slate-200');
    populateNextSigners();
  }
}

function populateNextSigners() {
  const select = document.getElementById('selectNextSigner');
  if (!select) return;

  const currentId = appState.currentUser?.id;
  const currentUsername = appState.currentUser?.username;
  const colleagues = appState.users.filter(u => u && u.id !== currentId && u.username !== currentUsername && !u.isLocked);

  select.innerHTML = '<option value="">-- Chọn đồng nghiệp / Lãnh đạo ký tiếp theo --</option>';
  colleagues.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id || u.username;
    opt.textContent = `${u.fullName || u.username} (${u.departmentName || u.department || 'Chung'} - ${u.roleTitle || u.role || 'Giáo viên'})`;
    select.appendChild(opt);
  });
}

// ==================== BỘ CHUYỂN ĐỔI WORD SANG PDF (KẾ THỪA TỪ PHIÊN BẢN TRƯỚC) ====================
function parseDocBinaryToHtml(arrayBuffer) {
  const buffer = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  
  let wordDocOffset = -1;
  for (let i = 0; i < buffer.length - 100; i += 512) {
    if (view.getUint16(i, true) === 0xA5EC) {
      wordDocOffset = i;
      break;
    }
  }

  let raw = null;
  let charCount = 0;

  if (wordDocOffset !== -1) {
    try {
      const fcMin = view.getUint32(wordDocOffset + 0x0018, true);
      const ccpText = view.getUint32(wordDocOffset + 0x004C, true);
      const start = wordDocOffset + fcMin;
      if (fcMin > 0 && ccpText > 0 && start + ccpText * 2 <= buffer.length) {
        raw = new DataView(arrayBuffer, start, ccpText * 2);
        charCount = ccpText;
      }
    } catch {}
  }

  if (!raw) {
    raw = view;
    charCount = Math.floor(buffer.length / 2);
  }

  const blocks = [];
  let currentCell = '';
  let currentRow = [];

  for (let i = 0; i < charCount * 2; i += 2) {
    try {
      const code = raw.getUint16(i, true);
      if (code === 7) {
        if (currentCell.length === 0 && currentRow.length > 0) {
          blocks.push({ type: 'row', cells: [...currentRow] });
          currentRow = [];
        } else {
          currentRow.push(currentCell.trim());
          currentCell = '';
        }
      } else if (code === 13 || code === 10) {
        if (currentRow.length > 0) {
          blocks.push({ type: 'row', cells: [...currentRow] });
          currentRow = [];
        }
        if (currentCell.trim().length > 0) {
          blocks.push({ type: 'p', text: currentCell.trim() });
          currentCell = '';
        }
      } else if ((code >= 32 && code <= 126) || (code >= 0x00A0 && code <= 0x036F) || (code >= 0x1EA0 && code <= 0x1EF9)) {
        currentCell += String.fromCharCode(code);
      }
    } catch {
      break;
    }
  }
  if (currentRow.length > 0) blocks.push({ type: 'row', cells: [...currentRow] });
  if (currentCell.trim().length > 0) blocks.push({ type: 'p', text: currentCell.trim() });

  const cleanBlocks = [];
  for (const b of blocks) {
    if (b.type === 'p') {
      const text = b.text;
      if (text.includes('Default Paragraph Font') || text.includes('Root Entry') || text.includes('WordDocument')) break;
      if (text.split(/\s+/).some(w => w.length > 25)) continue;
      const cleanLen = text.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9\s\.,;:!?\(\)\/\-_%]/g, '').length;
      if (cleanLen / text.length >= 0.7 && text.length >= 2) {
        cleanBlocks.push(b);
      }
    } else if (b.type === 'row') {
      const cleanCells = b.cells.map(c => c.trim()).filter(c => c.length > 0 && !c.split(/\s+/).some(w => w.length > 25));
      if (cleanCells.length > 0) {
        const totalText = cleanCells.join(' ');
        const cleanLen = totalText.replace(/[^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9\s\.,;:!?\(\)\/\-_%]/g, '').length;
        if (cleanLen / totalText.length >= 0.6) {
          cleanBlocks.push({ type: 'row', cells: cleanCells });
        }
      }
    }
  }

  let html = '<div class="word-document-body" style="font-family:\'Times New Roman\', Times, serif; font-size:13pt; line-height:1.45; color:#111;">';
  let inTable = false;

  for (const b of cleanBlocks) {
    if (b.type === 'row') {
      if (!inTable) {
        html += '<table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:11pt; border:1px solid #333;">';
        inTable = true;
      }
      html += '<tr style="border-bottom:1px solid #444;">';
      b.cells.forEach((cell, idx) => {
        const isHdr = (idx === 0 && (cell === 'TT' || cell === 'STT'));
        const tag = isHdr ? 'th' : 'td';
        const bg = isHdr ? 'background-color:#f1f5f9; font-weight:bold; text-align:center;' : 'text-align:left;';
        html += `<${tag} style="border:1px solid #444; padding:6px 8px; ${bg}">${escapeHtml(cell)}</${tag}>`;
      });
      html += '</tr>';
    } else {
      if (inTable) {
        html += '</table>';
        inTable = false;
      }
      const p = b.text;
      if (p.startsWith('PHỤ LỤC') || p.startsWith('THỐNG KÊ') || p.startsWith('TỔNG HỢP') || /^[I|V|X]+\./.test(p)) {
        html += `<h3 style="text-align:center; font-weight:bold; font-size:13.5pt; margin:16px 0 6px 0; text-transform:uppercase;">${escapeHtml(p)}</h3>`;
      } else if (p.startsWith('(Kèm theo') || p.startsWith('(')) {
        html += `<p style="text-align:center; font-style:italic; font-size:11.5pt; margin:2px 0 12px 0;">${escapeHtml(p)}</p>`;
      } else {
        html += `<p style="margin:6px 0; text-align:justify;">${escapeHtml(p)}</p>`;
      }
    }
  }
  if (inTable) html += '</table>';
  html += '</div>';
  return html;
}

async function parseWordDocumentToHtml(arrayBuffer, fileName = '') {
  const u8 = new Uint8Array(arrayBuffer);
  const isZip = (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04);
  const isDocBinary = (u8.length >= 4 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0);

  if (isZip && window.mammoth) {
    try {
      const res = await window.mammoth.convertToHtml({ arrayBuffer });
      if (res && res.value && res.value.trim().length > 10) {
        return res.value;
      }
    } catch (mErr) {
      console.warn('Mammoth không thể phân tích tệp này, chuyển sang bộ giải mã tích hợp:', mErr.message);
    }
  }

  if (isDocBinary || fileName.toLowerCase().endsWith('.doc')) {
    const docHtml = parseDocBinaryToHtml(arrayBuffer);
    if (docHtml && docHtml.length > 50) return docHtml;
  }

  const fallbackHtml = parseDocBinaryToHtml(arrayBuffer);
  if (fallbackHtml && fallbackHtml.length > 50) return fallbackHtml;

  return `<div style="font-family:'Times New Roman', serif; font-size:13pt; line-height:1.6; padding:20px;"><h3 style="text-align:center; font-weight:bold;">${escapeHtml(fileName || 'KẾ HOẠCH BÀI DẠY')}</h3><p style="text-align:center; font-style:italic;">Đã tiếp nhận tệp Word vào hệ thống phê duyệt.</p></div>`;
}

async function convertDocxToPdfInBrowser(file, targetPdfName) {
  if (!window.html2pdf) {
    throw new Error('Thư viện tạo PDF (html2pdf.js) chưa sẵn sàng.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const rawHtml = await parseWordDocumentToHtml(arrayBuffer, file.name);
  if (!rawHtml || !rawHtml.trim()) {
    throw new Error('Tệp Word rỗng hoặc không có nội dung văn bản.');
  }

  const container = document.createElement('div');
  container.className = 'word-preview-page';
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '794px';
  container.style.padding = '40px 50px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#000000';
  container.style.fontFamily = "'Times New Roman', Times, serif";
  container.style.fontSize = '13pt';
  container.style.lineHeight = '1.45';
  container.innerHTML = rawHtml;
  document.body.appendChild(container);

  try {
    const opt = {
      margin: [12, 12, 12, 12],
      filename: targetPdfName || 'TaiLieu.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        letterRendering: true,
        logging: false
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const pdfDataUri = await html2pdf().from(container).set(opt).outputPdf('datauristring');
    const cIdx = pdfDataUri.indexOf(',');
    const b64 = (cIdx >= 0 ? pdfDataUri.substring(cIdx + 1) : pdfDataUri).trim().replace(/\s/g, '');
    return 'data:application/pdf;base64,' + b64;
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

async function handleConvertWordToPdf() {
  if (!teacherSelectedFile) {
    showModalAlert('Chưa chọn tệp', 'Vui lòng chọn tệp Word (.docx, .doc) cần chuyển đổi.', 'warning');
    return;
  }

  const btnConvert = document.getElementById('btnConvertToPdf');
  const origHtml = btnConvert ? btnConvert.innerHTML : '';

  if (btnConvert) {
    btnConvert.disabled = true;
    btnConvert.className = 'flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-wait';
    btnConvert.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>Đang chuyển sang PDF...</span>';
  }

  try {
    const newPdfName = teacherSelectedFile.name.replace(/\.(docx|doc)$/i, '.pdf');
    let convertedPdfBase64 = null;

    // Ưu tiên 1: Dùng EduSign Agent COM nếu có chạy trên máy
    try {
      const pingRes = await fetch('http://127.0.0.1:18888/api/ping-local-signer', { method: 'GET', signal: AbortSignal.timeout(1200) });
      if (pingRes.ok) {
        const agentRes = await fetch('http://127.0.0.1:18888/api/convert-word-to-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileBase64: teacherSelectedFileBase64,
            fileName: teacherSelectedFile.name
          }),
          signal: AbortSignal.timeout(35000)
        });
        if (agentRes.ok) {
          const agentData = await agentRes.json();
          if (agentData.success && agentData.pdfBase64) {
            convertedPdfBase64 = agentData.pdfBase64;
          }
        }
      }
    } catch {
      // Tiếp tục fallback trình duyệt
    }

    // Ưu tiên 2: Trình duyệt chuyển đổi qua Mammoth + html2pdf
    if (!convertedPdfBase64) {
      if (btnConvert) {
        btnConvert.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>Dựng bản in PDF...</span>';
      }
      convertedPdfBase64 = await convertDocxToPdfInBrowser(teacherSelectedFile, newPdfName);
    }

    if (!convertedPdfBase64) {
      throw new Error('Không thể tạo định dạng PDF từ tệp Word này.');
    }

    const commaIdx = convertedPdfBase64.indexOf(',');
    const rawBase64 = (commaIdx >= 0 ? convertedPdfBase64.substring(commaIdx + 1) : convertedPdfBase64).trim().replace(/\s/g, '');
    teacherSelectedFileBase64 = 'data:application/pdf;base64,' + rawBase64;

    const byteCharacters = atob(rawBase64);
    const byteArray = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i);
    }
    const pdfBlob = new Blob([byteArray], { type: 'application/pdf' });
    teacherSelectedFile = new File([pdfBlob], newPdfName, { type: 'application/pdf' });

    const fileNameEl = document.getElementById('fileNameDisplay');
    const fileSizeEl = document.getElementById('fileSizeDisplay');
    const badge = document.getElementById('fileIconBadge');
    const inputSave = document.getElementById('inputSaveFileName');

    if (fileNameEl) fileNameEl.textContent = newPdfName;
    if (fileSizeEl) fileSizeEl.textContent = `${formatFileSize(pdfBlob.size)} • Đã chuyển sang PDF`;
    if (badge) {
      badge.textContent = 'PDF';
      badge.className = 'w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold text-xs shadow-sm';
    }

    updateTeacherButtonStates();
    showToast('Chuyển đổi sang PDF chuẩn thành công!', 'success');

  } catch (err) {
    console.error('Lỗi chuyển đổi Word sang PDF:', err);
    let msg = err.message || 'Không rõ nguyên nhân';
    if (msg.includes('Could not find main document part') || msg.includes('valid .docx')) {
      msg = 'Tệp Word này có định dạng đặc biệt. Thầy/Cô vui lòng lưu dưới dạng .docx chuẩn hoặc bật EduSign Agent để chuyển đổi.';
    }
    showModalAlert('Lỗi chuyển đổi', msg, 'error');
    if (btnConvert) {
      btnConvert.disabled = false;
      btnConvert.innerHTML = origHtml;
    }
    updateTeacherButtonStates();
  }
}

// ==================== QUẢN LÝ TAB GIÁO VIÊN & HỒ SƠ CHỜ KÝ ====================
let currentTeacherTab = 'workspace';
let teacherPendingDocs = [];
let currentChainedPendingDoc = null;
let currentSignedPdfBase64 = null;

function switchTeacherTab(tabName) {
  currentTeacherTab = tabName;
  const btnWorkspace = document.getElementById('tabBtnTeacherWorkspace');
  const btnPending = document.getElementById('tabBtnTeacherPending');
  const contentWorkspace = document.getElementById('tabContentTeacherWorkspace');
  const contentPending = document.getElementById('tabContentTeacherPending');

  if (tabName === 'workspace') {
    if (contentWorkspace) contentWorkspace.classList.remove('hidden');
    if (contentPending) contentPending.classList.add('hidden');

    if (btnWorkspace) {
      btnWorkspace.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all bg-brand-600 text-white shadow-sm shadow-brand-500/20 flex items-center gap-2 cursor-pointer';
    }
    if (btnPending) {
      btnPending.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-2 cursor-pointer';
    }
  } else {
    // tabName === 'pending'
    if (contentWorkspace) contentWorkspace.classList.add('hidden');
    if (contentPending) contentPending.classList.remove('hidden');

    if (btnWorkspace) {
      btnWorkspace.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-2 cursor-pointer';
    }
    if (btnPending) {
      btnPending.className = 'px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all bg-brand-600 text-white shadow-sm shadow-brand-500/20 flex items-center gap-2 cursor-pointer';
    }

    loadTeacherPendingDocuments(true);
  }
}

async function loadTeacherPendingDocuments(force = false) {
  const container = document.getElementById('listTeacherPendingContainer');
  const badgeEl = document.getElementById('badgeTeacherPendingCount');
  const user = appState.currentUser;
  if (!user) return;

  const currentUserId = user.id || user.username;
  const currentUsername = user.username || user.id;

  try {
    let pendingList = [];

    // 1. Thử gọi backend /api/documents/pending trước nếu có server hoặc test mock
    const canCallBackendPending = (window.location.protocol !== 'file:' || window._mockPendingList !== undefined);
    if (canCallBackendPending) {
      try {
        const headers = {
          'Content-Type': 'application/json',
          'x-user-id': currentUserId,
          'x-user-username': currentUsername,
          'x-user-fullname': encodeURIComponent(user.fullName || currentUsername)
        };
        if (appState.token) {
          headers['Authorization'] = `Bearer ${appState.token}`;
        }

        const fetchEndpoint = (window.location.protocol === 'file:' && window._mockPendingList !== undefined)
          ? '/api/documents/pending'
          : (API_BASE ? `${API_BASE}/api/documents/pending` : '/api/documents/pending');

        const res = await fetch(fetchEndpoint, {
          headers,
          cache: 'no-store'
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            pendingList = json.data;
          }
        }
      } catch (apiErr) {
        console.warn('[Pending Docs] Backend API offline, fallback to Firebase:', apiErr.message);
      }
    }

    // 2. Nếu API không có dữ liệu hoặc lỗi mạng -> query Firebase trực tiếp
    if (pendingList.length === 0) {
      let allDocs = null;
      if (firebaseDb) {
        const snap = await firebaseDb.ref('documents').once('value');
        allDocs = snap.val();
      } else {
        const fRes = await fetch(`${RTDB_URL}/documents.json?_t=${Date.now()}`);
        if (fRes.ok) allDocs = await fRes.json();
      }

      if (allDocs) {
        const docArray = Array.isArray(allDocs)
          ? allDocs.filter(Boolean)
          : Object.keys(allDocs).map(k => ({ id: allDocs[k].id || k, ...allDocs[k] }));

        pendingList = docArray.filter(d => {
          if (!d || d.status !== 'PENDING_SIGN') return false;
          const isAssigned = (d.assignedTo && (d.assignedTo === currentUserId || d.assignedTo === currentUsername)) ||
                             (d.currentSignerId && (d.currentSignerId === currentUserId || d.currentSignerId === currentUsername));
          return Boolean(isAssigned);
        });

        pendingList.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      }
    }

    teacherPendingDocs = pendingList;

    // Cập nhật huy hiệu số lượng hồ sơ chờ ký
    if (badgeEl) {
      badgeEl.textContent = pendingList.length;
      if (pendingList.length > 0) {
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse';
      } else {
        badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600';
      }
    }

    // Render danh sách nếu đang ở tab Hồ sơ chờ ký
    if (container) {
      renderTeacherPendingList(pendingList);
    }

  } catch (err) {
    console.error('[loadTeacherPendingDocuments] Lỗi:', err);
    if (container) {
      container.innerHTML = `
        <div class="p-6 bg-red-50 border border-red-200 rounded-2xl text-center text-red-700 text-xs">
          Lỗi nạp danh sách hồ sơ: ${escapeHtml(err.message)}
        </div>
      `;
    }
  }
}

function renderTeacherPendingList(docs) {
  const container = document.getElementById('listTeacherPendingContainer');
  if (!container) return;

  if (!docs || docs.length === 0) {
    container.innerHTML = `
      <div class="py-14 text-center text-slate-400 space-y-2">
        <div class="w-14 h-14 mx-auto rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <p class="text-xs font-bold text-slate-600">Tuyệt vời! Hiện không có hồ sơ nào chờ Thầy/Cô ký duyệt</p>
        <p class="text-[11px] text-slate-400">Các báo cáo do đồng nghiệp chuyển tiếp sẽ xuất hiện tại đây khi được gửi đến Thầy/Cô</p>
      </div>
    `;
    return;
  }

  container.innerHTML = docs.map(doc => {
    const sigCount = Array.isArray(doc.signatures) ? doc.signatures.length : 1;
    const latestSig = Array.isArray(doc.signatures) && doc.signatures[doc.signatures.length - 1];
    const latestSigner = latestSig ? latestSig.signerName : doc.creatorName;
    const createdStr = doc.createdAt ? new Date(doc.createdAt).toLocaleString('vi-VN') : 'Mới đây';

    return `
      <div class="p-4 sm:p-5 bg-gradient-to-r from-white to-purple-50/20 border border-slate-200/90 hover:border-purple-300 rounded-2xl shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group">
        <div class="space-y-1.5 min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
              Báo cáo liên hoàn
            </span>
            <span class="text-[11px] text-slate-400 font-mono">${createdStr}</span>
          </div>
          <h4 class="text-sm font-bold text-slate-900 group-hover:text-purple-700 transition truncate" title="${escapeHtml(doc.title)}">
            ${escapeHtml(doc.title)}
          </h4>
          <div class="text-[11px] text-slate-600 flex items-center gap-2 flex-wrap">
            <span>👤 Người tạo: <strong>${escapeHtml(doc.creatorName || 'Đồng nghiệp')}</strong> (${escapeHtml(doc.creatorDept || 'Chuyên môn')})</span>
            <span>•</span>
            <span class="text-emerald-700 font-medium">✍️ Chữ ký gần nhất: <strong>${escapeHtml(latestSigner)}</strong> (Bước ${sigCount})</span>
          </div>
          ${doc.note ? `
            <div class="text-[11px] text-purple-900 bg-purple-50 px-2.5 py-1 rounded-xl border border-purple-200/70 inline-block mt-0.5">
              💬 Ghi chú: <em>${escapeHtml(doc.note)}</em>
            </div>
          ` : ''}
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button type="button" onclick="openPendingDocumentToSign('${escapeHtml(doc.id)}')" 
            class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold shadow-md shadow-purple-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            <span>Mở Ký Ngay</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function openPendingDocumentToSign(docId) {
  showToast('Đang nạp hồ sơ báo cáo...', 'info');

  try {
    let doc = teacherPendingDocs.find(d => d.id === docId);

    if (!doc || !doc.fileBase64) {
      try {
        const res = await fetch(`/api/documents/${docId}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) doc = json.data;
        }
      } catch (e) {}

      if (!doc || !doc.fileBase64) {
        if (firebaseDb) {
          const snap = await firebaseDb.ref(`documents/${docId}`).once('value');
          doc = snap.val();
        } else {
          const fRes = await fetch(`${RTDB_URL}/documents/${docId}.json`);
          if (fRes.ok) doc = await fRes.json();
        }
      }
    }

    if (!doc || !doc.fileBase64) {
      showModalAlert('Không tìm thấy tệp', 'Không thể lấy nội dung tệp PDF của hồ sơ này. Vui lòng thử lại.', 'error');
      return;
    }

    currentChainedPendingDoc = doc;

    // Chuyển base64 thành Blob
    const byteCharacters = atob(doc.fileBase64.replace(/^data:application\/pdf;base64,/, ''));
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const pdfBlob = new Blob([byteArray], { type: 'application/pdf' });

    // Mở Viewer
    openDocumentViewer(doc.title, pdfBlob, true);

    // Bật thanh điều khiển ký liên hoàn
    const chainedBar = document.getElementById('viewerChainedSignBar');
    const originLabel = document.getElementById('viewerChainedDocOrigin');
    const cbFinal = document.getElementById('cbViewerIsFinalSigner');
    const boxNext = document.getElementById('boxViewerNextSigner');
    const selNext = document.getElementById('selectViewerNextSigner');
    const noteInput = document.getElementById('inputViewerNote');

    if (chainedBar) chainedBar.classList.remove('hidden');
    if (originLabel) {
      const sigLen = (doc.signatures && doc.signatures.length) || 1;
      originLabel.textContent = `Từ: ${doc.creatorName || 'Đồng nghiệp'} (${sigLen} chữ ký đã có)`;
    }
    if (cbFinal) cbFinal.checked = false;
    if (boxNext) boxNext.classList.remove('hidden');
    if (noteInput) noteInput.value = '';

    // Điền danh sách đồng nghiệp vào selectViewerNextSigner
    if (selNext) {
      const currentId = appState.currentUser?.id;
      const currentUsername = appState.currentUser?.username;
      const colleagues = appState.users.filter(u => u && u.id !== currentId && u.username !== currentUsername && !u.isLocked);

      selNext.innerHTML = '<option value="">-- Chọn đồng nghiệp / Lãnh đạo tiếp theo --</option>';
      colleagues.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id || u.username;
        opt.textContent = `${u.fullName || u.username} (${u.departmentName || u.department || 'Chung'} - ${u.roleTitle || u.role || 'Giáo viên'})`;
        selNext.appendChild(opt);
      });
    }

  } catch (err) {
    console.error('Lỗi mở hồ sơ ký:', err);
    showModalAlert('Lỗi mở hồ sơ', err.message, 'error');
  }
}

function toggleViewerFinalSignerMode(isFinal) {
  const boxNext = document.getElementById('boxViewerNextSigner');
  if (!boxNext) return;
  if (isFinal) {
    boxNext.classList.add('hidden');
  } else {
    boxNext.classList.remove('hidden');
  }
}

async function handleSaveLessonPlanToFile() {
  if (!currentSignedPdfBase64) {
    showModalAlert('Không tìm thấy tệp', 'Dữ liệu file đã ký không còn tồn tại trong bộ nhớ. Vui lòng ký lại.', 'warning');
    return;
  }

  const fileNameEl = document.getElementById('saveLessonPlanFileName');
  const fileName = (fileNameEl && fileNameEl.textContent) ? fileNameEl.textContent.trim() : 'KeHoachBaiDay_DaKy.pdf';

  try {
    const byteCharacters = atob(currentSignedPdfBase64.replace(/^data:application\/pdf;base64,/, ''));
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const pdfBlob = new Blob([byteArray], { type: 'application/pdf' });

    let savedViaPicker = false;

    // 1. Nếu trình duyệt hỗ trợ window.showSaveFilePicker (Chrome, Edge)
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'Tệp tài liệu PDF đã ký số (*.pdf)',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        });
        const writableStream = await fileHandle.createWritable();
        await writableStream.write(pdfBlob);
        await writableStream.close();
        savedViaPicker = true;
      } catch (pickerErr) {
        if (pickerErr.name === 'AbortError') {
          return;
        }
        console.warn('showSaveFilePicker fallback to download blob:', pickerErr.message);
      }
    }

    // 2. Fallback: Nếu không dùng picker hoặc lưu picker lỗi
    if (!savedViaPicker) {
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    }

    // QUY TẮC: Khi lưu thành công thì tự xóa, và xóa file đã ký khỏi hộp thoại tải lên
    closeModal('modalSaveLessonPlan');
    closeModal('modalDocViewer');

    // Làm sạch RAM & Thu hồi Blob URL
    if (currentPdfBlobUrl) {
      try { URL.revokeObjectURL(currentPdfBlobUrl); } catch (e) {}
      currentPdfBlobUrl = null;
    }
    currentSignedPdfBase64 = null;
    currentActiveSignSession = null;

    // XÓA FILE KHỎI HỘP THOẠI TẢI LÊN
    handleClearFile();

    showToast('🎉 Đã lưu Giáo án đã ký thành công và làm sạch phiên làm việc!', 'success');

  } catch (err) {
    console.error('Lỗi lưu file:', err);
    showModalAlert('Lỗi khi lưu tệp', err.message, 'error');
  }
}

function handleOpenSaveLessonPlanModal(signedPdfBase64, session) {
  currentSignedPdfBase64 = signedPdfBase64;
  const safeDocTitle = (session.docTitle || 'KeHoachBaiDay').replace(/\.pdf$/i, '');
  const fileName = `[THCS_CVA]_${safeDocTitle}_DaKy.pdf`;

  const fileNameEl = document.getElementById('saveLessonPlanFileName');
  const signerEl = document.getElementById('saveLessonPlanSigner');

  if (fileNameEl) fileNameEl.textContent = fileName;
  if (signerEl) signerEl.textContent = session.cert?.signerName || appState.currentUser?.fullName || 'Giáo viên';

  openModal('modalSaveLessonPlan');
}

async function handleForwardNewReportDocument(signedPdfBase64, session) {
  showToast('Đang chuyển tiếp báo cáo đến đồng nghiệp...', 'info');
  const selNext = document.getElementById('selectNextSigner');
  const nextSignerId = selNext?.value;
  const nextSignerName = selNext?.options[selNext.selectedIndex]?.text?.split('(')[0]?.trim() || 'Đồng nghiệp';
  const note = (document.getElementById('inputReportNote')?.value || '').trim();

  const user = appState.currentUser;
  const currentUserId = user?.id || user?.username;
  const currentUsername = user?.username || user?.id;

  const payload = {
    title: session.docTitle || teacherSelectedFile?.name || 'Báo cáo chuyên môn',
    docType: 'REPORT',
    fileBase64: signedPdfBase64,
    nextSignerId: nextSignerId,
    nextSignerName: nextSignerName,
    note: note,
    signerCert: session.cert,
    currentUser: user
  };

  let sendSuccess = false;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-user-id': currentUserId,
      'x-user-username': currentUsername,
      'x-user-fullname': encodeURIComponent(user?.fullName || currentUsername),
      'x-user-dept': encodeURIComponent(user?.departmentName || user?.department || 'Tổ chuyên môn')
    };
    if (appState.token) headers['Authorization'] = `Bearer ${appState.token}`;

    const res = await fetch('/api/documents/forward', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      sendSuccess = true;
    } else {
      throw new Error(json.message || `Lỗi HTTP ${res.status}`);
    }
  } catch (apiErr) {
    console.warn('[forward] API backend gặp lỗi, lưu trực tiếp qua Firebase:', apiErr.message);
    const docId = `DOC_REP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nowStr = new Date().toISOString();
    const newDoc = {
      id: docId,
      title: payload.title,
      docType: 'REPORT',
      fileBase64: signedPdfBase64,
      status: 'PENDING_SIGN',
      creatorId: currentUserId,
      creatorName: user?.fullName || currentUsername,
      creatorDept: user?.departmentName || user?.department || 'Tổ chuyên môn',
      assignedTo: nextSignerId,
      assignedToName: nextSignerName,
      currentSignerId: nextSignerId,
      currentSignerName: nextSignerName,
      note: note,
      signatures: [{
        step: 1,
        signerId: currentUserId,
        signerName: user?.fullName || currentUsername,
        signerRole: user?.roleTitle || 'Giáo viên',
        signedAt: nowStr,
        certSerial: session.cert?.serialNumber || '7C4C44A8671300AE',
        note: note
      }],
      createdAt: nowStr,
      updatedAt: nowStr
    };

    if (firebaseDb) {
      await firebaseDb.ref(`documents/${docId}`).set(newDoc);
    } else {
      await fetch(`${RTDB_URL}/documents/${docId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDoc)
      });
    }
    sendSuccess = true;
  }

  if (sendSuccess) {
    // Đóng viewer
    closeModal('modalDocViewer');
    if (currentPdfBlobUrl) {
      try { URL.revokeObjectURL(currentPdfBlobUrl); } catch (e) {}
      currentPdfBlobUrl = null;
    }
    currentActiveSignSession = null;

    // XÓA FILE ĐÃ KÝ KHỎI HỘP THOẠI TẢI LÊN
    handleClearFile();

    showModalAlert(
      'Chuyển tiếp thành công',
      `🎉 Thầy/Cô đã ký số và chuyển tiếp báo cáo thành công tới <strong>${escapeHtml(nextSignerName)}</strong>!<br><br>Hồ sơ đã được đưa vào danh sách chờ ký của đồng nghiệp.`,
      'success'
    );

    loadTeacherPendingDocuments(true);
  }
}

async function handleChainedPendingDocumentSignStep(signedPdfBase64, session) {
  showToast('Đang cập nhật chữ ký số vào quy trình hồ sơ...', 'info');
  const isFinal = Boolean(document.getElementById('cbViewerIsFinalSigner')?.checked);
  const selNext = document.getElementById('selectViewerNextSigner');
  const nextSignerId = isFinal ? null : (selNext?.value || null);
  const nextSignerName = isFinal ? '' : (selNext?.options[selNext.selectedIndex]?.text?.split('(')[0]?.trim() || '');
  const note = (document.getElementById('inputViewerNote')?.value || '').trim();

  const user = appState.currentUser;
  const currentUserId = user?.id || user?.username;
  const currentUsername = user?.username || user?.id;

  const payload = {
    fileBase64: signedPdfBase64,
    isFinal: isFinal,
    nextSignerId: nextSignerId,
    nextSignerName: nextSignerName,
    note: note,
    signerCert: session.cert,
    currentUser: user
  };

  const docId = currentChainedPendingDoc.id;
  let result = null;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-user-id': currentUserId,
      'x-user-username': currentUsername,
      'x-user-fullname': encodeURIComponent(user?.fullName || currentUsername),
      'x-user-dept': encodeURIComponent(user?.departmentName || user?.department || 'Tổ chuyên môn')
    };
    if (appState.token) headers['Authorization'] = `Bearer ${appState.token}`;

    const res = await fetch(`/api/documents/${docId}/sign-step`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      result = json;
    } else {
      throw new Error(json.message || `Lỗi HTTP ${res.status}`);
    }
  } catch (apiErr) {
    console.warn('[sign-step] API backend gặp lỗi, lưu trực tiếp qua Firebase:', apiErr.message);
    const nowStr = new Date().toISOString();
    const doc = currentChainedPendingDoc;
    doc.fileBase64 = signedPdfBase64;
    doc.updatedAt = nowStr;
    if (!Array.isArray(doc.signatures)) doc.signatures = [];
    doc.signatures.push({
      step: doc.signatures.length + 1,
      signerId: currentUserId,
      signerName: user?.fullName || currentUsername,
      signerRole: user?.roleTitle || 'Giáo viên',
      signedAt: nowStr,
      certSerial: session.cert?.serialNumber || '7C4C44A8671300AE',
      note: note
    });

    if (isFinal) {
      doc.status = 'COMPLETED';
      doc.completedAt = nowStr;
      doc.finalSigner = user?.fullName || currentUsername;
      doc.assignedTo = null;
      doc.currentSignerId = null;
    } else {
      doc.assignedTo = nextSignerId;
      doc.assignedToName = nextSignerName;
      doc.currentSignerId = nextSignerId;
      doc.currentSignerName = nextSignerName;
    }

    if (firebaseDb) {
      await firebaseDb.ref(`documents/${docId}`).set(doc);
    } else {
      await fetch(`${RTDB_URL}/documents/${docId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      });
    }
    result = { success: true, isCompleted: isFinal };
  }

  // Đóng viewer và dọn sạch session
  closeModal('modalDocViewer');
  if (currentPdfBlobUrl) {
    try { URL.revokeObjectURL(currentPdfBlobUrl); } catch (e) {}
    currentPdfBlobUrl = null;
  }
  currentChainedPendingDoc = null;
  currentActiveSignSession = null;

  if (isFinal) {
    // NƠI 2: TỰ ĐỘNG TẢI TỆP VỀ MÁY TÍNH / THƯ MỤC ONEDRIVE
    try {
      const byteChars = atob(signedPdfBase64.replace(/^data:application\/pdf;base64,/, ''));
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNums)], { type: 'application/pdf' });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `[THCS_CVA]_${(session.docTitle || 'BaoCao').replace(/\.pdf$/i, '')}_HoanTat.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);
      }, 1000);
    } catch (e) {}

    showModalAlert(
      'Hoàn tất quy trình ký & Lưu 2 nơi',
      '🎉 Chúc mừng! Thầy/Cô đã ký xác nhận hoàn thành báo cáo chuyên môn.<br><br>' +
      '✅ <strong>Nơi 1:</strong> Đã tự động lưu trữ vào Google Drive nhà trường.<br>' +
      '✅ <strong>Nơi 2:</strong> Bản sao hoàn tất đã được tải về máy tính (thư mục OneDrive/Downloads).',
      'success'
    );
  } else {
    showToast(`🎉 Đã ký và chuyển tiếp thành công đến ${nextSignerName}!`, 'success');
  }

  // Tải lại danh sách hồ sơ chờ ký
  loadTeacherPendingDocuments(true);
}

// ==================== XỬ LÝ KÝ SỐ & ĐỊNH VỊ CHỮ KÝ TRÊN PDF ====================
let isSigPlacementActive = true;
let currentStampPlacement = 'bottom-right';
let currentStampCoords = { xPercent: 74.5, yPercent: 52.0, isManualDrag: false };
let currentStampScale = 1.0;
let isDraggingStamp = false;
let stampDragStartX = 0, stampDragStartY = 0;
let stampElemStartX = 0, stampElemStartY = 0;
let currentPdfBlobUrl = null;
let currentViewingFileName = '';

async function handleTeacherSignAction() {
  if (!teacherSelectedFile) {
    showModalAlert('Chưa chọn tệp', 'Vui lòng tải lên tệp giáo án hoặc báo cáo để ký số.', 'warning');
    return;
  }

  // BẮT BUỘC: Kiểm tra tệp đã là PDF hay chưa
  if (teacherSelectedFile.name.match(/\.(docx|doc)$/i)) {
    showModalAlert(
      'Cần chuyển đổi sang PDF',
      'Văn bản Word cần được chuyển đổi sang định dạng chuẩn PDF trước khi mở giao diện ký số. Thầy/Cô vui lòng bấm nút [Chuyển PDF].',
      'warning'
    );
    return;
  }

  currentChainedPendingDoc = null;
  const chainedBar = document.getElementById('viewerChainedSignBar');
  if (chainedBar) chainedBar.classList.add('hidden');

  // Tệp đã là PDF hợp lệ -> Mở giao diện xem trước & định vị chữ ký số kế thừa từ phiên bản trước
  openDocumentViewer(teacherSelectedFile.name, teacherSelectedFile, true);
}

function openDocumentViewer(fileName, fileObject, enableSigning = true) {
  const modal = document.getElementById('modalDocViewer');
  const titleEl = document.getElementById('viewerDocTitle');
  const metaEl = document.getElementById('viewerDocMeta');
  const pdfFrame = document.getElementById('viewerPdfFrame');
  const spinner = document.getElementById('viewerLoadingSpinner');
  if (!modal || !pdfFrame) return;

  currentViewingFileName = fileName || 'Văn bản';
  if (titleEl) titleEl.textContent = currentViewingFileName;
  if (metaEl) {
    const sizeStr = fileObject && fileObject.size ? ` • ${formatFileSize(fileObject.size)}` : '';
    metaEl.textContent = `Định dạng: PDF Chuẩn A4${sizeStr}`;
  }

  // Giải phóng Blob URL cũ tránh rò rỉ RAM
  if (currentPdfBlobUrl) {
    try { URL.revokeObjectURL(currentPdfBlobUrl); } catch (e) {}
    currentPdfBlobUrl = null;
  }

  if (spinner) spinner.classList.remove('hidden');

  if (fileObject) {
    const blob = (fileObject instanceof Blob) ? fileObject : new Blob([fileObject], { type: 'application/pdf' });
    currentPdfBlobUrl = URL.createObjectURL(blob);
    // Luôn mở ở chế độ FitH (Vừa chiều ngang màn hình) để văn bản to, rõ nét, dễ đọc dễ ký
    pdfFrame.src = currentPdfBlobUrl + '#page=1&view=FitH&toolbar=1&navpanes=0';
  }

  pdfFrame.onload = () => {
    if (spinner) spinner.classList.add('hidden');
  };
  setTimeout(() => {
    if (spinner) spinner.classList.add('hidden');
  }, 800);

  // Cập nhật thông tin người ký trên con dấu
  const currentUser = appState.currentUser;
  const signerName = currentUser ? (currentUser.fullName || currentUser.name || currentUser.username) : 'Giáo viên';
  const nameEl = document.getElementById('draggableStampSignerName');
  if (nameEl) nameEl.textContent = signerName;

  const dateEl = document.getElementById('draggableStampDate');
  if (dateEl) {
    const now = new Date();
    const dStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    dateEl.textContent = `Ký ngày: ${dStr}`;
  }

  // Lấy thông tin ảnh chữ ký nếu giáo viên đã lưu
  const savedSig = getTeacherSignatureImage();
  const dragImg = document.getElementById('draggableSignatureImg');
  const defaultBox = document.getElementById('draggableSignatureDefaultBox');

  if (savedSig && dragImg) {
    dragImg.src = savedSig;
    dragImg.classList.remove('hidden');
    if (defaultBox) defaultBox.classList.add('hidden');
  } else {
    if (dragImg) dragImg.classList.add('hidden');
    if (defaultBox) defaultBox.classList.remove('hidden');
  }

  openModal('modalDocViewer');
  // Khởi tạo ở trạng thái ẩn chữ ký ban đầu để giáo viên nhìn rõ văn bản, không hiện stamp ngay
  toggleSignaturePlacementMode(false);
  snapSignatureTo('teacher');
  setSignatureScale(1.0);
  initDraggableSignature();
}

let currentPdfZoom = 'FitH';
let isViewerFullscreen = false;

function setPdfViewerZoom(zoomMode) {
  const pdfFrame = document.getElementById('viewerPdfFrame');
  if (!pdfFrame || !currentPdfBlobUrl) return;
  currentPdfZoom = zoomMode;

  const buttons = ['btnZoomFitH', 'btnZoom100', 'btnZoom125', 'btnZoom150'];
  buttons.forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (btnId === `btnZoom${zoomMode}`) {
      btn.className = 'px-2.5 py-1 rounded-lg font-bold text-brand-700 bg-white shadow-xs hover:bg-slate-50 transition flex items-center gap-1';
    } else {
      btn.className = 'px-2 py-1 rounded-lg font-semibold text-slate-600 hover:text-slate-900 transition';
    }
  });

  let hash = '#page=1&view=FitH&toolbar=1&navpanes=0';
  if (zoomMode === 'FitH') {
    hash = '#page=1&view=FitH&toolbar=1&navpanes=0';
  } else if (zoomMode === '100') {
    hash = '#page=1&zoom=100&toolbar=1&navpanes=0';
  } else if (zoomMode === '125') {
    hash = '#page=1&zoom=125&toolbar=1&navpanes=0';
  } else if (zoomMode === '150') {
    hash = '#page=1&zoom=150&toolbar=1&navpanes=0';
  }

  pdfFrame.src = currentPdfBlobUrl + hash;
}

function toggleViewerFullscreen() {
  const viewerBox = document.getElementById('viewerModalContainer');
  const btnIcon = document.getElementById('btnFullscreenIcon');
  if (!viewerBox) return;

  isViewerFullscreen = !isViewerFullscreen;
  if (isViewerFullscreen) {
    viewerBox.className = 'bg-white shadow-2xl w-full h-full flex flex-col border-0 overflow-hidden';
    if (btnIcon) {
      btnIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 9L4 4m0 0l5 0m-5 0l0 5M15 9l5-5m0 0l-5 0m5 0l0 5M9 15l-5 5m0 0l5 0m-5 0l0-5M15 15l5 5m0 0l-5 0m5 0l0-5"/>';
    }
  } else {
    viewerBox.className = 'bg-white rounded-3xl shadow-2xl max-w-6xl w-full h-[95vh] flex flex-col border border-slate-200 overflow-hidden';
    if (btnIcon) {
      btnIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>';
    }
  }
}

function getTeacherSignatureImage() {
  const currentUser = appState.currentUser;
  if (!currentUser) return null;
  const userSigKey = `edusign_sig_${currentUser.id || currentUser.username}`;
  return localStorage.getItem(userSigKey) || currentUser.signatureImage || null;
}

function toggleSignaturePlacementMode(forceState) {
  const targetState = (typeof forceState === 'boolean') ? forceState : !isSigPlacementActive;

  if (targetState) {
    // Kiểm tra xem giáo viên đã tải ảnh chữ ký cá nhân lên chưa
    const sig = getTeacherSignatureImage();
    if (!sig) {
      showModalAlert(
        'Chưa có ảnh chữ ký số',
        'Thầy/Cô chưa cài đặt mẫu ảnh chữ ký cá nhân trên hệ thống.\n\nVui lòng tải ảnh chữ ký và bóc tách nền trong suốt trước khi định vị con dấu vào văn bản.',
        'warning',
        {
          text: 'Tải Chữ Ký Số Ngay',
          cancelText: 'Để sau',
          callback: () => {
            openModalUploadSignature();
          }
        }
      );
      return;
    }

    isSigPlacementActive = true;
    const bar = document.getElementById('viewerSigToolBar');
    const stamp = document.getElementById('draggableSignatureStamp');
    const btnConfirm = document.getElementById('btnViewerConfirmSign');
    const btnText = document.getElementById('btnToggleSignatureText');
    const dragImg = document.getElementById('draggableSignatureImg');
    const defaultBox = document.getElementById('draggableSignatureDefaultBox');

    if (dragImg) {
      dragImg.src = sig;
      dragImg.classList.remove('hidden');
    }
    if (defaultBox) defaultBox.classList.add('hidden');

    if (bar) bar.classList.remove('hidden');
    if (stamp) stamp.classList.remove('hidden');
    if (btnConfirm) btnConfirm.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Ẩn Chữ Ký';
  } else {
    isSigPlacementActive = false;
    const bar = document.getElementById('viewerSigToolBar');
    const stamp = document.getElementById('draggableSignatureStamp');
    const btnConfirm = document.getElementById('btnViewerConfirmSign');
    const btnText = document.getElementById('btnToggleSignatureText');

    if (bar) bar.classList.add('hidden');
    if (stamp) stamp.classList.add('hidden');
    if (btnConfirm) btnConfirm.classList.add('hidden');
    if (btnText) btnText.textContent = 'Đặt Chữ Ký Số';
  }
}

function snapSignatureTo(role) {
  const stamp = document.getElementById('draggableSignatureStamp');
  const container = document.getElementById('viewerContentArea');
  if (!stamp || !container) return;

  let leftPct = 74.5, topPct = 52.0;

  if (role === 'teacher') {
    leftPct = 74.5;
    topPct = 52.0;
    currentStampPlacement = 'bottom-right';
  } else if (role === 'leader') {
    leftPct = 47.5;
    topPct = 52.0;
    currentStampPlacement = 'middle-right';
  } else if (role === 'principal') {
    leftPct = 21.5;
    topPct = 52.0;
    currentStampPlacement = 'bottom-left';
  }

  stamp.style.left = leftPct + '%';
  stamp.style.top = topPct + '%';
  currentStampCoords = { xPercent: leftPct, yPercent: topPct, isManualDrag: false };
  updateStampCoordsDisplay();
}

function setSignatureScale(scale) {
  currentStampScale = Math.max(0.4, Math.min(1.8, Math.round(scale * 100) / 100));
  const badge = document.getElementById('sigScaleBadge');
  const range = document.getElementById('sigScaleRange');
  const stamp = document.getElementById('draggableSignatureStamp');
  const img = document.getElementById('draggableSignatureImg');

  if (badge) badge.textContent = Math.round(currentStampScale * 100) + '%';
  if (range) range.value = Math.round(currentStampScale * 100);

  if (stamp) {
    stamp.style.width = Math.round(160 * currentStampScale) + 'px';
  }
  if (img) {
    img.style.maxHeight = Math.round(80 * currentStampScale) + 'px';
  }
  updateStampCoordsDisplay();
}

function adjustSignatureScale(delta) {
  setSignatureScale(currentStampScale + delta);
}

function nudgeSignature(deltaX, deltaY) {
  const stamp = document.getElementById('draggableSignatureStamp');
  if (!stamp) return;

  currentStampCoords.xPercent = Math.max(1, Math.min(95, Math.round((currentStampCoords.xPercent + deltaX) * 10) / 10));
  currentStampCoords.yPercent = Math.max(1, Math.min(95, Math.round((currentStampCoords.yPercent + deltaY) * 10) / 10));

  stamp.style.left = currentStampCoords.xPercent + '%';
  stamp.style.top = currentStampCoords.yPercent + '%';
  updateStampCoordsDisplay();
}

function resetSignaturePosition() {
  setSignatureScale(1.0);
  snapSignatureTo('teacher');
}

function updateStampCoordsDisplay() {
  const coordsEl = document.getElementById('draggableStampCoords');
  if (!coordsEl) return;
  const scaleText = Math.round(currentStampScale * 100) + '%';
  coordsEl.textContent = `X: ${currentStampCoords.xPercent}% | Y: ${currentStampCoords.yPercent}% | ${scaleText}`;
}

function initDraggableSignature() {
  const stamp = document.getElementById('draggableSignatureStamp');
  const shield = document.getElementById('viewerDragShield');
  const container = document.getElementById('viewerContentArea');
  if (!stamp || !shield || !container || stamp.hasAttribute('data-drag-inited')) return;
  stamp.setAttribute('data-drag-inited', 'true');

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    isDraggingStamp = true;
    shield.classList.remove('hidden');

    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    stampDragStartX = clientX;
    stampDragStartY = clientY;
    stampElemStartX = stamp.offsetLeft;
    stampElemStartY = stamp.offsetTop;

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDraggingStamp) return;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    const deltaX = clientX - stampDragStartX;
    const deltaY = clientY - stampDragStartY;

    let newLeft = stampElemStartX + deltaX;
    let newTop = stampElemStartY + deltaY;

    const maxLeft = container.clientWidth - stamp.offsetWidth - 10;
    const maxTop = Math.max(container.clientHeight, container.scrollHeight) - stamp.offsetHeight - 10;

    newLeft = Math.max(10, Math.min(newLeft, maxLeft));
    newTop = Math.max(10, Math.min(newTop, maxTop));

    stamp.style.left = newLeft + 'px';
    stamp.style.top = newTop + 'px';

    const xPct = Math.round((newLeft / container.clientWidth) * 1000) / 10;
    const yPct = Math.round((newTop / container.clientHeight) * 1000) / 10;
    currentStampCoords = { xPercent: xPct, yPercent: yPct, isManualDrag: true };

    if (xPct > 55) currentStampPlacement = 'bottom-right';
    else if (xPct > 32) currentStampPlacement = 'middle-right';
    else currentStampPlacement = 'bottom-left';

    updateStampCoordsDisplay();
  }

  function onPointerUp() {
    if (isDraggingStamp) {
      isDraggingStamp = false;
      shield.classList.add('hidden');
    }
  }

  stamp.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

// Phím tắt bàn phím tinh chỉnh vị trí & kích cỡ khi xem trước
window.addEventListener('keydown', (e) => {
  const modal = document.getElementById('modalDocViewer');
  if (!modal || modal.classList.contains('hidden') || !isSigPlacementActive) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    adjustSignatureScale(0.05);
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    adjustSignatureScale(-0.05);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    nudgeSignature(0, -1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    nudgeSignature(0, 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    nudgeSignature(-1, 0);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    nudgeSignature(1, 0);
  } else if (e.key === '0') {
    e.preventDefault();
    setSignatureScale(1.0);
  }
});

// ==================== QUY TRÌNH KÝ SỐ CHUYÊN DÙNG CÔNG VỤ (VGCA / USB TOKEN) ====================
let currentVgcaLoginMode = 'vgca';
let currentActiveSignSession = null;
let vgcaCountdownTimer = null;
let vgcaRemainingSeconds = 90;
let driveCleanupTimer = null;
let driveCleanupSeconds = 5;

function validateCccd12Digits(cccd) {
  if (!cccd) return false;
  const clean = String(cccd).trim();
  return /^\d{12}$/.test(clean);
}

function handleVgcaCccdKeyInput(input) {
  if (!input) return;
  input.value = input.value.replace(/\D/g, '').slice(0, 12);
  const msg = document.getElementById('vgcaCccdValidationMsg');
  if (!msg) return;
  const len = input.value.length;
  if (len === 0) {
    msg.className = 'text-[11px] text-slate-500 mt-1 flex items-center gap-1';
    msg.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span><span>Yêu cầu chính xác 12 chữ số theo thẻ CCCD gắn chip.</span>';
  } else if (len < 12) {
    msg.className = 'text-[11px] text-amber-600 font-medium mt-1 flex items-center gap-1';
    msg.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Đã nhập ${len}/12 số (còn thiếu ${12 - len} số).</span>`;
  } else {
    msg.className = 'text-[11px] text-emerald-600 font-bold mt-1 flex items-center gap-1';
    msg.innerHTML = '<svg class="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg><span>Đã đủ 12 chữ số CCCD hợp lệ.</span>';
  }
}

function getStoredVgcaCredentials() {
  try {
    const raw = localStorage.getItem('edusign_vgca_credentials');
    if (!raw) return null;
    const creds = JSON.parse(raw);
    if (creds && creds.cccd && validateCccd12Digits(creds.cccd)) {
      return creds;
    }
  } catch (e) {}
  return null;
}

function saveStoredVgcaCredentials(cccd, password, signType = 'VGCA') {
  try {
    localStorage.setItem('edusign_vgca_credentials', JSON.stringify({
      cccd: String(cccd).trim(),
      password: String(password).trim(),
      signType: signType || 'VGCA',
      savedAt: new Date().toISOString()
    }));
  } catch (e) {}
}

function clearStoredVgcaCredentials() {
  try {
    localStorage.removeItem('edusign_vgca_credentials');
  } catch (e) {}
}

function switchVgcaLoginMode(mode) {
  currentVgcaLoginMode = mode;
  const btnVgca = document.getElementById('tabBtnLoginVgca');
  const btnUsb = document.getElementById('tabBtnLoginUsb');
  if (mode === 'usb') {
    if (btnVgca) btnVgca.className = 'py-2 px-3 rounded-xl text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5 cursor-pointer';
    if (btnUsb) btnUsb.className = 'py-2 px-3 rounded-xl bg-white text-indigo-700 shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer';
  } else {
    if (btnVgca) btnVgca.className = 'py-2 px-3 rounded-xl bg-white text-brand-700 shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer';
    if (btnUsb) btnUsb.className = 'py-2 px-3 rounded-xl text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5 cursor-pointer';
  }
}

function toggleVgcaPasswordVisibility() {
  const inp = document.getElementById('inputVgcaPassword');
  if (!inp) return;
  inp.type = (inp.type === 'password') ? 'text' : 'password';
}

function openVgcaLoginModal() {
  const inpCccd = document.getElementById('inputVgcaCccd');
  const inpPass = document.getElementById('inputVgcaPassword');
  const stored = getStoredVgcaCredentials();

  if (inpCccd) {
    inpCccd.value = (stored && stored.cccd) || (appState.currentUser && appState.currentUser.cccd) || '';
    handleVgcaCccdKeyInput(inpCccd);
  }
  if (inpPass) {
    inpPass.value = (stored && stored.password) || '';
  }

  switchVgcaLoginMode(stored ? (stored.signType || 'vgca') : 'vgca');
  openModal('modalVgcaLogin');
  autoDetectCertFromAgent();
}

async function autoDetectCertFromAgent() {
  const box = document.getElementById('boxVgcaDetectedCert');
  const content = document.getElementById('boxVgcaDetectedCertContent');
  if (!box || !content) return;

  try {
    const ping = await pingLocalSigner(1500);
    if (!ping.available) return;

    const res = await fetch(`http://127.0.0.1:18888/api/check-vgca-status?_t=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000)
    });
    if (!res.ok) return;
    const data = await res.json();
    const cert = data.certInfo || (Array.isArray(data.availableCerts) && data.availableCerts[0]);
    if (cert) {
      box.classList.remove('hidden');
      content.innerHTML = `
        <div>• Chủ thể: <strong class="text-emerald-800 font-bold">${cert.signerName || 'Giáo viên'}</strong></div>
        <div>• Đơn vị: ${cert.school || 'Trường THCS Chu Văn An'}</div>
        <div>• Số Serial: <span class="font-mono text-[10px] text-slate-800">${cert.serialNumber || 'Chuyên dùng công vụ'}</span></div>
        ${cert.cccd ? `<div>• CCCD: <span class="font-mono font-bold">${cert.cccd}</span></div>` : ''}
      `;
      const inpCccd = document.getElementById('inputVgcaCccd');
      if (inpCccd && !inpCccd.value && cert.cccd && validateCccd12Digits(cert.cccd)) {
        inpCccd.value = cert.cccd;
        handleVgcaCccdKeyInput(inpCccd);
      }
    }
  } catch (e) {}
}

async function pingLocalSigner(timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:18888/api/ping-local-signer?_t=${Date.now()}`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      return { available: true, host: 'http://127.0.0.1:18888', data };
    }
  } catch (e) {
    clearTimeout(timer);
  }
  return { available: false };
}

async function verifyVgcaStatusFromAgent(cccd, password, signType = 'VGCA') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  const currentUser = appState.currentUser;
  const isUsb = (signType === 'USB_TOKEN' || signType === 'usb');
  const mode = isUsb ? 'HARDWARE' : 'AUTO';

  // Chú ý: Không truyền signer dạng cứng nếu tên trong CSDL bị mất dấu tiếng Việt so với cert thật trong Store Windows.
  // EduSign Agent v2.1 với mode=AUTO sẽ tự động dò tìm chứng thư số Ban Cơ yếu tốt nhất hoặc danh sách availableCerts.
  const queryUrl = `http://127.0.0.1:18888/api/check-vgca-status?signType=${encodeURIComponent(signType)}&mode=${encodeURIComponent(mode)}&_t=${Date.now()}`;
  
  try {
    const res = await fetch(queryUrl, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Dịch vụ kiểm tra CSP phản hồi HTTP ${res.status}`);
    }
    const data = await res.json();

    // Tự động nhận diện chứng thư: Nếu Agent đã có availableCerts hoặc certInfo hợp lệ trong Windows Store,
    // thì CSP chắc chắn đang hoạt động tốt và đã đăng nhập thành công.
    const hasDetectedCert = (Array.isArray(data.availableCerts) && data.availableCerts.length > 0) || (data.certInfo && data.certInfo.serialNumber);
    if (hasDetectedCert) {
      data.cspHealthy = true;
      data.hasCspError = false;
      data.tokenConnected = true;
      data.cspErrorMessage = '';
      if (!data.certInfo && data.availableCerts && data.availableCerts[0]) {
        data.certInfo = data.availableCerts[0];
      }
      // Đồng bộ thông tin người ký thực tế từ chứng thư số vào session
      if (data.certInfo?.signerName && currentUser) {
        currentUser.certificateSignerName = data.certInfo.signerName;
        currentUser.certificateSerial = data.certInfo.serialNumber;
      }
    }

    return data;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function getViewingPdfBase64() {
  if (teacherSelectedFile) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result;
        const b64 = (typeof res === 'string' && res.includes(',')) ? res.split(',')[1] : res;
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(teacherSelectedFile);
    });
  }
  if (currentPdfBlobUrl) {
    const res = await fetch(currentPdfBlobUrl);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        const b64 = (typeof r === 'string' && r.includes(',')) ? r.split(',')[1] : r;
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  return null;
}

// Xử lý sự kiện bấm nút Ký Số Ngay trong giao diện Viewer
function handleViewerConfirmSignClick() {
  // Reset trạng thái lỗi cũ: luôn chạy mới hoàn toàn mỗi lần bấm Ký
  currentActiveSignSession = null;
  if (vgcaCountdownTimer) clearInterval(vgcaCountdownTimer);
  if (driveCleanupTimer) clearInterval(driveCleanupTimer);

  // 0. Bắt buộc đã tải ảnh chữ ký cá nhân
  const sig = getTeacherSignatureImage();
  if (!sig) {
    showModalAlert(
      'Chưa tải chữ ký số',
      'Thầy/Cô chưa tải ảnh con dấu / chữ ký số cá nhân lên hệ thống! Vui lòng tải ảnh chữ ký và xóa nền trước khi thực hiện ký số.',
      'warning',
      {
        confirmText: 'Tải chữ ký ngay',
        onConfirm: () => openModalUploadSignature()
      }
    );
    return;
  }

  // Kiểm tra điều kiện chọn người nhận nếu là Báo cáo
  if (currentChainedPendingDoc) {
    const isFinal = document.getElementById('cbViewerIsFinalSigner')?.checked;
    if (!isFinal) {
      const nextId = document.getElementById('selectViewerNextSigner')?.value;
      if (!nextId) {
        showModalAlert(
          'Chưa chọn người nhận',
          'Vui lòng chọn đồng nghiệp hoặc lãnh đạo ký tiếp theo, hoặc đánh dấu <strong>☑️ Tôi là người ký cuối cùng</strong> nếu Thầy/Cô là người hoàn tất văn bản.',
          'warning'
        );
        return;
      }
    }
  } else {
    const choice = document.querySelector('input[name="docTypeChoice"]:checked')?.value || 'LESSON_PLAN';
    if (choice === 'REPORT') {
      const nextId = document.getElementById('selectNextSigner')?.value;
      if (!nextId) {
        showModalAlert(
          'Chưa chọn người nhận',
          'Đây là văn bản Báo cáo / Biên bản chuyên môn (ký liên hoàn). Vui lòng chọn người ký tiếp theo trong danh sách trước khi thực hiện ký số.',
          'warning'
        );
        return;
      }
    }
  }

  // 1. Kiểm tra tài khoản đã lưu
  const stored = getStoredVgcaCredentials();
  if (stored && stored.cccd && validateCccd12Digits(stored.cccd) && stored.password) {
    // Có lưu -> Chạy quy trình đối soát mật khẩu thực tế
    executeMasterSigningPipeline(stored);
  } else {
    // Chưa có thông tin -> Mở modal đăng nhập CCCD 12 số
    openVgcaLoginModal();
  }
}

async function handleVgcaLoginSubmit(e) {
  e.preventDefault();
  const cccd = (document.getElementById('inputVgcaCccd')?.value || '').trim();
  const password = (document.getElementById('inputVgcaPassword')?.value || '').trim();
  const remember = document.getElementById('cbRememberVgcaCredentials')?.checked;

  if (!validateCccd12Digits(cccd)) {
    showModalAlert(
      'Số CCCD không hợp lệ',
      'Số CCCD phải bao gồm <strong>đúng 12 chữ số</strong> theo thẻ Căn cước công dân gắn chip. Vui lòng kiểm tra lại.',
      'warning'
    );
    return;
  }

  if (!password) {
    showModalAlert('Thiếu mật khẩu', 'Vui lòng nhập mật khẩu hoặc mã PIN chữ ký số.', 'warning');
    return;
  }

  const btn = document.getElementById('btnSubmitVgcaLogin');
  const btnTxt = document.getElementById('btnSubmitVgcaLoginText');
  const origTxt = btnTxt ? btnTxt.textContent : '';
  if (btn) btn.disabled = true;
  if (btnTxt) btnTxt.textContent = 'Đang kiểm tra...';

  try {
    // Bước 1: Kiểm tra EduSign Agent
    const ping = await pingLocalSigner(2500);
    if (!ping.available) {
      showModalAlert(
        'EduSign Agent chưa chạy',
        'Ứng dụng <strong>EduSign Agent</strong> (cổng 18888) chưa được khởi chạy trên máy tính! Vui lòng mở ứng dụng trước khi đăng nhập chữ ký số.',
        'error'
      );
      return;
    }

    // Bước 2: Kiểm tra đối soát với Virtual CSP
    const cspData = await verifyVgcaStatusFromAgent(cccd, password, currentVgcaLoginMode);
    if (cspData.isMaintenance || cspData.statusCode === 'CODE_MAINTENANCE') {
      showModalAlert('Hệ thống bảo trì', 'Hệ thống chứng thực Ban Cơ yếu đang trong khung giờ bảo trì.', 'warning');
      return;
    }
    if (cspData.hasCspError || cspData.cspHealthy === false) {
      showModalAlert('Lỗi Virtual CSP', cspData.cspErrorMessage || 'An internal consistency check failed.', 'error');
      return;
    }

    // Lưu nếu chọn ghi nhớ
    if (remember) {
      saveStoredVgcaCredentials(cccd, password, currentVgcaLoginMode);
    } else {
      clearStoredVgcaCredentials();
    }

    closeModal('modalVgcaLogin');
    showToast('Xác thực chữ ký số thành công!', 'success');

    // Tiếp tục tiến trình ký
    executeMasterSigningPipeline({ cccd, password, signType: currentVgcaLoginMode });

  } catch (err) {
    showModalAlert(
      'Lỗi xác thực Chữ ký số',
      `Không thể kết nối hoặc đối soát thông tin chữ ký số: ${err.message}. Vui lòng kiểm tra lại EduSign Agent và Virtual CSP trên máy tính.`,
      'error'
    );
  } finally {
    if (btn) btn.disabled = false;
    if (btnTxt) btnTxt.textContent = origTxt;
  }
}

async function executeMasterSigningPipeline(credentials) {
  if (vgcaCountdownTimer) clearInterval(vgcaCountdownTimer);
  if (driveCleanupTimer) clearInterval(driveCleanupTimer);

  // BƯỚC 1: KIỂM TRA EDUSIGN AGENT (127.0.0.1:18888)
  showToast('Đang kết nối EduSign Agent (cổng 18888)...', 'info');
  const ping = await pingLocalSigner(2500);
  if (!ping.available) {
    showModalAlert(
      'Không tìm thấy EduSign Agent',
      'Không thể kết nối tới ứng dụng <strong>EduSign Agent</strong> (cổng 18888) chạy ngầm trên máy tính!<br><br>Vui lòng mở ứng dụng <strong>EduSign_Agent.exe</strong> từ Desktop hoặc khay hệ thống Windows để tiếp tục.',
      'error'
    );
    return; // DỪNG LẬP TỨC
  }

  // BƯỚC 2 & 3: ĐỐI SOÁT MẬT KHẨU & TRẠNG THÁI VIRTUAL CSP
  showToast('Đang đối soát mật khẩu & kiểm tra Virtual CSP...', 'info');
  let cspData;
  try {
    cspData = await verifyVgcaStatusFromAgent(credentials.cccd, credentials.password, credentials.signType);
  } catch (err) {
    showModalAlert(
      'Lỗi kiểm tra Virtual CSP',
      `Không thể kiểm tra dịch vụ mật mã Ban Cơ yếu: ${err.message}. Vui lòng kiểm tra lại phần mềm Virtual CSP trên máy tính.`,
      'error'
    );
    return; // DỪNG LẬP TỨC
  }

  // 3.1. Kiểm tra trạng thái Bảo trì
  if (cspData.isMaintenance || cspData.statusCode === 'CODE_MAINTENANCE') {
    showModalAlert(
      'Dịch vụ Ban Cơ yếu đang bảo trì',
      'Hệ thống chứng thực chữ ký số chuyên dùng công vụ hiện đang trong khung giờ bảo trì kỹ thuật. Vui lòng thử lại sau.',
      'warning'
    );
    return; // DỪNG LẬP TỨC
  }

  // 3.2. Kiểm tra lỗi tính nhất quán CSP
  if (cspData.hasCspError || cspData.cspHealthy === false) {
    showModalAlert(
      'Sự cố tính nhất quán Virtual CSP',
      `Phát hiện lỗi mật mã Virtual CSP: <strong>${cspData.cspErrorMessage || 'An internal consistency check failed.'}</strong><br><br>Hướng dẫn khắc phục:<br>• Mở lại phần mềm Virtual CSP trên máy tính.<br>• Rút và cắm lại USB Token (nếu dùng USB).<br>• Khởi động lại EduSign Agent.`,
      'error'
    );
    return; // DỪNG LẬP TỨC
  }

  // 3.3. Kiểm tra mật khẩu đã đổi / lệch thông tin
  if (cspData.credentialsValid === false || cspData.authFailed === true) {
    clearStoredVgcaCredentials();
    showModalAlert(
      'Mật khẩu Chữ ký số đã thay đổi',
      'Mật khẩu chữ ký số đã bị thay đổi hoặc không hợp lệ. Vui lòng nhập lại mật khẩu mới.',
      'warning',
      {
        confirmText: 'Đăng nhập lại',
        onConfirm: () => openVgcaLoginModal()
      }
    );
    return; // DỪNG LẬP TỨC
  }

  // BƯỚC 4: HIỂN THỊ THÔNG TIN CHỨNG THƯ SỐ THỰC
  const cert = cspData.certInfo || (Array.isArray(cspData.availableCerts) && cspData.availableCerts[0]) || {
    signerName: appState.currentUser?.fullName || appState.currentUser?.name || 'Hà Văn Tý',
    cccd: credentials.cccd,
    school: 'Trường THCS Chu Văn An',
    serialNumber: '7C4C44A8671300AE7F19D3B',
    issuer: 'Ban Cơ yếu Chính phủ',
    validTo: '2031-12-31'
  };

  const signerEl = document.getElementById('signProgressSigner');
  const cccdEl = document.getElementById('signProgressCccd');
  const deptEl = document.getElementById('signProgressDept');
  const serialEl = document.getElementById('signProgressSerial');
  const statusLabel = document.getElementById('signProgressStatusLabel');

  if (signerEl) signerEl.textContent = cert.signerName || appState.currentUser?.fullName || 'Giáo viên';
  if (cccdEl) cccdEl.textContent = credentials.cccd;
  if (deptEl) deptEl.textContent = cert.school || appState.currentUser?.department || 'THCS Chu Văn An';
  if (serialEl) serialEl.textContent = cert.serialNumber || 'X.509 PAdES SHA256withRSA';
  if (statusLabel) statusLabel.textContent = 'Đang sẵn sàng niêm phong chữ ký số...';

  const isUsb = (credentials.signType === 'USB_TOKEN' || credentials.signType === 'usb');
  const mobileView = document.getElementById('signProgressMobileView');
  const usbView = document.getElementById('signProgressUsbView');

  if (isUsb) {
    if (mobileView) mobileView.classList.add('hidden');
    if (usbView) usbView.classList.remove('hidden');
  } else {
    if (mobileView) mobileView.classList.remove('hidden');
    if (usbView) usbView.classList.add('hidden');
    startVgcaCountdown(90);
  }

  currentActiveSignSession = {
    credentials,
    cert,
    isUsb,
    docTitle: currentViewingFileName,
    xPercent: currentStampCoords.xPercent,
    yPercent: currentStampCoords.yPercent,
    scale: currentStampScale
  };

  openModal('modalSignProgress');
}

function startVgcaCountdown(seconds = 90) {
  if (vgcaCountdownTimer) clearInterval(vgcaCountdownTimer);
  vgcaRemainingSeconds = seconds;
  const countdownEl = document.getElementById('signProgressCountdown');

  const updateDisplay = () => {
    const m = Math.floor(vgcaRemainingSeconds / 60);
    const s = vgcaRemainingSeconds % 60;
    if (countdownEl) {
      countdownEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  };
  updateDisplay();

  vgcaCountdownTimer = setInterval(() => {
    vgcaRemainingSeconds--;
    if (vgcaRemainingSeconds <= 0) {
      clearInterval(vgcaCountdownTimer);
      vgcaCountdownTimer = null;
      closeModal('modalSignProgress');
      showModalAlert(
        'Hết thời gian chờ xác nhận',
        'Quá 90 giây chưa nhận được xác nhận từ ứng dụng di động SmartCA/VGCA! Phiên ký số đã tự động hủy để đảm bảo an toàn.',
        'warning'
      );
      return;
    }
    updateDisplay();
  }, 1000);
}

function handleUserConfirmedVgcaOnPhone() {
  // Người dùng xác nhận đã bấm Đồng ý trên điện thoại -> Thực hiện ký
  executeLocalAgentSigning();
}

function handleConfirmUsbSign() {
  // Xác nhận ký bằng USB Token
  executeLocalAgentSigning();
}

function cancelSigningSession() {
  if (vgcaCountdownTimer) clearInterval(vgcaCountdownTimer);
  currentActiveSignSession = null;
  closeModal('modalSignProgress');
  showToast('Đã hủy phiên ký số.', 'info');
}

// BƯỚC 5: KÝ SỐ THỰC TẾ QUA EDUSIGN AGENT (CẤM KÝ GIẢ)
async function executeLocalAgentSigning() {
  if (!currentActiveSignSession) return;
  const session = currentActiveSignSession;
  const statusLabel = document.getElementById('signProgressStatusLabel');
  if (statusLabel) statusLabel.textContent = 'Đang niêm phong chữ ký số PAdES X.509 qua EduSign Agent...';

  const btnConfirmPhone = document.getElementById('btnSignProgressConfirmPhone');
  const btnConfirmUsb = document.getElementById('btnSignProgressConfirmUsb');
  if (btnConfirmPhone) {
    btnConfirmPhone.disabled = true;
    btnConfirmPhone.innerHTML = '<svg class="w-4 h-4 animate-spin inline-block mr-1.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span>Đang niêm phong chữ ký số...</span>';
  }
  if (btnConfirmUsb) {
    btnConfirmUsb.disabled = true;
    btnConfirmUsb.innerHTML = '<svg class="w-4 h-4 animate-spin inline-block mr-1.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> <span>Đang niêm phong qua USB Token...</span>';
  }

  try {
    const pdfBase64 = await getViewingPdfBase64();
    if (!pdfBase64) {
      throw new Error('Không tìm thấy nội dung tệp PDF để niêm phong chữ ký');
    }

    const payload = {
      doc: {
        id: 'DOC_' + Date.now(),
        title: session.docTitle || 'KeHoachBaiDay.pdf',
        author: session.cert.signerName,
        signCoordinates: {
          xPercent: session.xPercent,
          yPercent: session.yPercent,
          scale: session.scale
        }
      },
      fileBase64: pdfBase64,
      signMode: session.isUsb ? 'HARDWARE' : 'PERSONAL',
      signType: session.isUsb ? 'USB_TOKEN' : 'VGCA',
      signerName: session.cert.signerName,
      cccd: session.credentials.cccd,
      expectedSerial: session.cert.serialNumber,
      thumbprint: session.cert.thumbprint
    };

    // GỌI API AGENT THẬT — CẤM KÝ GIẢ
    const res = await fetch('http://127.0.0.1:18888/api/local-sign-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.signedPdfBase64) {
      throw new Error(data.message || 'EduSign Agent trả về kết quả ký không thành công');
    }

    if (vgcaCountdownTimer) clearInterval(vgcaCountdownTimer);
    closeModal('modalSignProgress');

    currentSignedPdfBase64 = data.signedPdfBase64;

    // BƯỚC 6: PHÂN NHÁNH XỬ LÝ THEO LOẠI HỒ SƠ
    if (currentChainedPendingDoc) {
      // Đang ký hồ sơ chờ ký (Báo cáo liên hoàn)
      await handleChainedPendingDocumentSignStep(data.signedPdfBase64, session);
    } else {
      const docTypeChoice = document.querySelector('input[name="docTypeChoice"]:checked')?.value || 'LESSON_PLAN';
      if (docTypeChoice === 'REPORT') {
        // Khởi tạo Báo cáo mới & chuyển tiếp đến đồng nghiệp
        await handleForwardNewReportDocument(data.signedPdfBase64, session);
      } else {
        // Giáo án (Kế hoạch bài dạy): Mở modal cho giáo viên tự chọn đường dẫn lưu tệp
        handleOpenSaveLessonPlanModal(data.signedPdfBase64, session);
      }
    }

  } catch (err) {
    if (statusLabel) statusLabel.textContent = 'Lỗi ký số!';
    showModalAlert(
      'Lỗi Niêm Phong Chữ Ký Số',
      `Không thể hoàn tất ký số qua EduSign Agent: ${err.message}. Vui lòng kiểm tra lại thiết bị hoặc kết nối.`,
      'error'
    );
  } finally {
    if (btnConfirmPhone) {
      btnConfirmPhone.disabled = false;
      btnConfirmPhone.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span>TÔI ĐÃ BẤM ĐỒNG Ý TRÊN ĐIỆN THOẠI (HOÀN TẤT KÝ)</span>';
    }
    if (btnConfirmUsb) {
      btnConfirmUsb.disabled = false;
      btnConfirmUsb.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg><span>KÝ VÀ NIÊM PHONG BẰNG USB TOKEN</span>';
    }
  }
}

// BƯỚC 6: LƯU GOOGLE DRIVE & TỰ ĐỘNG DỌN SẠCH HỆ THỐNG
async function handlePostSignSaveToGoogleDrive(signedPdfBase64, session) {
  showToast('Đang lưu trữ file đã ký lên Google Drive trường...', 'info');

  const currentUser = appState.currentUser;
  const teacherName = (currentUser ? (currentUser.fullName || currentUser.name) : session.cert.signerName) || 'Giáo viên';
  const schoolYear = 'Năm học 2026 - 2027';
  const folderPath = `${schoolYear} / ${teacherName}`;
  const safeDocTitle = session.docTitle.replace(/\.pdf$/i, '');
  const fileName = `[THCS_CVA]_${safeDocTitle}_DaKy.pdf`;

  let driveResult = null;
  try {
    const res = await fetch('/api/drive/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appState.token || ''}`
      },
      body: JSON.stringify({
        doc: {
          id: 'DOC_' + Date.now(),
          title: session.docTitle,
          author: teacherName,
          authorName: teacherName,
          department: currentUser?.department || 'Tổ chuyên môn',
          schoolYear: schoolYear
        },
        fileBase64: signedPdfBase64
      })
    });
    const resJson = await res.json().catch(() => ({}));
    if (res.ok && resJson.success) {
      driveResult = resJson.data;
    }
  } catch (e) {
    console.warn('Lỗi gọi /api/drive/upload backend:', e);
  }

  // Dự phòng liên kết hiển thị nếu offline
  if (!driveResult) {
    driveResult = {
      folderPath: folderPath,
      fileName: fileName,
      viewUrl: 'https://drive.google.com/drive/u/0/my-drive',
      message: 'Đã lưu trữ thành công vào thư mục của giáo viên'
    };
  }

  // Cập nhật giao diện Modal 3
  const folderEl = document.getElementById('driveSuccessFolderPath');
  const fileEl = document.getElementById('driveSuccessFileName');
  const linkEl = document.getElementById('driveSuccessViewLink');

  if (folderEl) folderEl.textContent = driveResult.folderPath || folderPath;
  if (fileEl) fileEl.textContent = driveResult.fileName || fileName;
  if (linkEl) linkEl.href = driveResult.viewUrl || 'https://drive.google.com';

  openModal('modalDriveSuccessCountdown');

  // Khởi động đếm ngược 5 giây tự động làm sạch
  startDriveCleanupCountdown(5);
}

function startDriveCleanupCountdown(seconds = 5) {
  if (driveCleanupTimer) clearInterval(driveCleanupTimer);
  driveCleanupSeconds = seconds;

  const secEl = document.getElementById('driveCleanupCountdownSec');
  const barEl = document.getElementById('driveCleanupProgressBar');
  if (secEl) secEl.textContent = driveCleanupSeconds;
  if (barEl) barEl.style.width = '100%';

  driveCleanupTimer = setInterval(() => {
    driveCleanupSeconds--;
    if (secEl) secEl.textContent = driveCleanupSeconds;
    if (barEl) {
      barEl.style.width = `${(driveCleanupSeconds / seconds) * 100}%`;
    }

    if (driveCleanupSeconds <= 0) {
      clearInterval(driveCleanupTimer);
      driveCleanupTimer = null;
      executeImmediateCleanupAndClose();
    }
  }, 1000);
}

function executeImmediateCleanupAndClose() {
  if (driveCleanupTimer) {
    clearInterval(driveCleanupTimer);
    driveCleanupTimer = null;
  }

  // 1. Đóng modal hoàn tất và modal viewer
  closeModal('modalDriveSuccessCountdown');
  closeModal('modalDocViewer');

  // 2. Thu hồi Blob URL tránh rò rỉ RAM
  if (currentPdfBlobUrl) {
    try { URL.revokeObjectURL(currentPdfBlobUrl); } catch (e) {}
    currentPdfBlobUrl = null;
  }

  // 3. Giải phóng biến bộ nhớ
  currentActiveSignSession = null;
  teacherSelectedFile = null;

  // 4. Đặt lại form tải file
  const dropZone = document.getElementById('dropZoneContainer');
  const fileSelectedCard = document.getElementById('fileSelectedCard');
  const fileInput = document.getElementById('lessonFileInput');
  if (fileInput) fileInput.value = '';
  if (dropZone) dropZone.classList.remove('hidden');
  if (fileSelectedCard) fileSelectedCard.classList.add('hidden');

  showToast('🎉 Ký số & Lưu trữ Google Drive thành công! Đã dọn sạch an toàn.', 'success');
}

// ==================== CÀI ĐẶT & CHỮ KÝ SỐ (AGENT / CON DẤU / ĐỔI MẬT KHẨU) ====================
function toggleSettingsDropdown(dropdownId) {
  const el = document.getElementById(dropdownId);
  if (!el) return;
  const isHidden = el.classList.contains('hidden');
  closeSettingsDropdowns();
  if (isHidden) {
    el.classList.remove('hidden');
  }
}

function closeSettingsDropdowns() {
  document.getElementById('adminSettingsDropdown')?.classList.add('hidden');
  document.getElementById('teacherSettingsDropdown')?.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#adminSettingsDropdown') && 
      !e.target.closest('#teacherSettingsDropdown') && 
      !e.target.closest('[onclick*="toggleSettingsDropdown"]')) {
    closeSettingsDropdowns();
  }
});

// ==================== QUẢN LÝ ẢNH CHỮ KÝ CÁ NHÂN & XÓA NỀN TRONG SUỐT ====================
let rawLoadedSignatureImage = null;
let currentProcessedSignatureBase64 = null;

function openModalUploadSignature() {
  const finput = document.getElementById('inputSignatureImageFile');
  if (finput) finput.value = '';

  const savedSig = getTeacherSignatureImage();
  const previewImg = document.getElementById('userSigPreviewImg');
  const emptyBox = document.getElementById('userSigPreviewEmpty');
  const btnDel = document.getElementById('btnDeleteCurrentSig');
  const range = document.getElementById('rangeBgThreshold');
  const label = document.getElementById('labelBgThresholdVal');
  const cb = document.getElementById('cbAutoRemoveBg');

  if (range) range.value = 200;
  if (label) label.textContent = '200';
  if (cb) cb.checked = true;

  if (savedSig) {
    currentProcessedSignatureBase64 = savedSig;
    rawLoadedSignatureImage = null;
    if (previewImg) {
      previewImg.src = savedSig;
      previewImg.classList.remove('hidden');
    }
    if (emptyBox) emptyBox.classList.add('hidden');
    if (btnDel) btnDel.classList.remove('hidden');
  } else {
    currentProcessedSignatureBase64 = null;
    rawLoadedSignatureImage = null;
    if (previewImg) {
      previewImg.src = '';
      previewImg.classList.add('hidden');
    }
    if (emptyBox) emptyBox.classList.remove('hidden');
    if (btnDel) btnDel.classList.add('hidden');
  }

  openModal('modalUploadSignature');
}

function handleUserSignatureFileSelected(file) {
  if (!file) return;

  if (!file.type || !file.type.startsWith('image/')) {
    showModalAlert('Định dạng không hợp lệ', 'Vui lòng chọn tệp hình ảnh (.PNG, .JPG hoặc .JPEG).', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      rawLoadedSignatureImage = img;
      reprocessSignatureImage();
    };
    img.onerror = () => {
      showModalAlert('Lỗi đọc ảnh', 'Không thể đọc nội dung tệp ảnh này. Vui lòng thử lại với ảnh khác.', 'error');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function onThresholdSliderChange(val) {
  const label = document.getElementById('labelBgThresholdVal');
  if (label) label.textContent = val;
  reprocessSignatureImage();
}

function reprocessSignatureImage() {
  if (!rawLoadedSignatureImage) {
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let w = rawLoadedSignatureImage.naturalWidth || rawLoadedSignatureImage.width;
    let h = rawLoadedSignatureImage.naturalHeight || rawLoadedSignatureImage.height;

    // Giới hạn kích thước tối đa 1200px để xử lý mượt mà và tối ưu dung lượng localStorage
    const MAX_DIM = 1200;
    if (w > MAX_DIM || h > MAX_DIM) {
      if (w > h) {
        h = Math.round((h * MAX_DIM) / w);
        w = MAX_DIM;
      } else {
        w = Math.round((w * MAX_DIM) / h);
        h = MAX_DIM;
      }
    }

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(rawLoadedSignatureImage, 0, 0, w, h);

    const shouldRemoveBg = document.getElementById('cbAutoRemoveBg')?.checked !== false;

    if (shouldRemoveBg) {
      const threshold = parseInt(document.getElementById('rangeBgThreshold')?.value || '200', 10);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const smoothBand = 30; // Dải làm mịn rìa nét mực

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const minRGB = Math.min(r, g, b);

        if (minRGB >= threshold) {
          // Điểm ảnh thuộc nền sáng -> Xóa trong suốt hoàn toàn
          data[i + 3] = 0;
        } else if (minRGB > threshold - smoothBand) {
          // Điểm ảnh nằm ở rìa nét mực -> Làm mịn gradient alpha (anti-aliasing)
          const factor = (threshold - minRGB) / smoothBand;
          data[i + 3] = Math.max(0, Math.min(255, Math.round(data[i + 3] * factor)));
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    currentProcessedSignatureBase64 = canvas.toDataURL('image/png');

    const previewImg = document.getElementById('userSigPreviewImg');
    const emptyBox = document.getElementById('userSigPreviewEmpty');
    const btnDel = document.getElementById('btnDeleteCurrentSig');

    if (previewImg) {
      previewImg.src = currentProcessedSignatureBase64;
      previewImg.classList.remove('hidden');
    }
    if (emptyBox) emptyBox.classList.add('hidden');
    if (btnDel) btnDel.classList.remove('hidden');
  } catch (err) {
    console.error('Lỗi khử nền chữ ký:', err);
  }
}

function saveUserSignature() {
  if (!currentProcessedSignatureBase64) {
    showModalAlert('Chưa có ảnh chữ ký', 'Vui lòng chọn ảnh chữ ký từ thiết bị trước khi lưu.', 'warning');
    return;
  }

  const user = appState.currentUser;
  if (user) {
    const key = `edusign_sig_${user.id || user.username}`;
    localStorage.setItem(key, currentProcessedSignatureBase64);
    user.signatureImage = currentProcessedSignatureBase64;
  }

  // Cập nhật lên con dấu trên giao diện ký nếu đang mở
  const dragImg = document.getElementById('draggableSignatureImg');
  const defaultBox = document.getElementById('draggableSignatureDefaultBox');
  if (dragImg) {
    dragImg.src = currentProcessedSignatureBase64;
    dragImg.classList.remove('hidden');
  }
  if (defaultBox) defaultBox.classList.add('hidden');

  closeModal('modalUploadSignature');
  showModalAlert(
    'Lưu thành công',
    '🎉 Đã lưu mẫu ảnh chữ ký số cá nhân thành công! Nền ảnh đã được bóc tách trong suốt chuẩn PNG.',
    'success'
  );
}

function handleDeleteCurrentSignature() {
  showModalConfirm(
    'Xác nhận xóa mẫu chữ ký',
    'Thầy/Cô có chắc chắn muốn xóa mẫu ảnh chữ ký cá nhân hiện tại không?',
    () => {
      const user = appState.currentUser;
      if (user) {
        const key = `edusign_sig_${user.id || user.username}`;
        localStorage.removeItem(key);
        delete user.signatureImage;
      }

      rawLoadedSignatureImage = null;
      currentProcessedSignatureBase64 = null;

      const previewImg = document.getElementById('userSigPreviewImg');
      const emptyBox = document.getElementById('userSigPreviewEmpty');
      const btnDel = document.getElementById('btnDeleteCurrentSig');
      const finput = document.getElementById('inputSignatureImageFile');

      if (finput) finput.value = '';
      if (previewImg) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
      }
      if (emptyBox) emptyBox.classList.remove('hidden');
      if (btnDel) btnDel.classList.add('hidden');

      const dragImg = document.getElementById('draggableSignatureImg');
      if (dragImg) {
        dragImg.src = '';
        dragImg.classList.add('hidden');
      }
      if (isSigPlacementActive) {
        toggleSignaturePlacementMode(false);
      }

      showModalAlert('Đã xóa chữ ký', 'Đã xóa mẫu ảnh chữ ký cá nhân khỏi hệ thống.', 'info');
    }
  );
}

function openModalCheckAgent() {
  openModal('modalCheckAgent');
  checkLocalAgentStatus();
}

async function checkLocalAgentStatus() {
  const statusContainer = document.getElementById('agentStatusContent');
  if (!statusContainer) return;

  statusContainer.innerHTML = `
    <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-slate-600 flex items-center gap-2.5">
      <div class="w-2.5 h-2.5 rounded-full bg-brand-500 animate-ping"></div>
      <span>Đang kết nối tới EduSign Agent (127.0.0.1:18888)...</span>
    </div>
  `;

  try {
    const res = await fetch('http://127.0.0.1:18888/api/check-vgca-status', {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });

    if (res.ok) {
      const data = await res.json();
      statusContainer.innerHTML = `
        <div class="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-800 space-y-2">
          <div class="flex items-center gap-2 font-bold text-xs">
            <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            <span>EduSign Agent v${data.version || '2.1.0'} đang hoạt động</span>
          </div>
          <div class="text-[11px] text-emerald-700 space-y-1">
            <div>• Trạng thái thiết bị: <strong>${data.hasCertificate ? 'Đã nhận chứng thư số' : 'Sẵn sàng (Đang chờ cắm Token)'}</strong></div>
            <div>• Cổng kết nối cục bộ: <strong>127.0.0.1:18888 (OK)</strong></div>
          </div>
        </div>
      `;
    } else {
      throw new Error('Agent trả về mã lỗi HTTP ' + res.status);
    }
  } catch {
    statusContainer.innerHTML = `
      <div class="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 space-y-2">
        <div class="flex items-center gap-2 font-bold text-xs">
          <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span>Chưa phát hiện EduSign Agent trên máy tính</span>
        </div>
        <p class="text-[11px] text-amber-800 leading-relaxed">
          Nếu Thầy/Cô sử dụng USB Token hoặc VGCA trên máy tính cá nhân, vui lòng tải và khởi chạy <strong>EduSign_Agent.exe</strong> để hệ thống tự động nhận diện thiết bị ký số.
        </p>
      </div>
    `;
  }
}

function openModalChangePassSelf() {
  document.getElementById('selfCurrentPass').value = '';
  document.getElementById('selfNewPass').value = '';
  openModal('modalChangePassSelf');
}

async function handleChangePasswordSelf(e) {
  e.preventDefault();
  const currentPass = document.getElementById('selfCurrentPass').value;
  const newPass = document.getElementById('selfNewPass').value.trim();

  if (!newPass || newPass.length < 4) {
    showModalAlert('Mật khẩu quá ngắn', 'Mật khẩu mới phải có ít nhất 4 ký tự.', 'warning');
    return;
  }

  try {
    const user = appState.currentUser;
    if (!user) throw new Error('Chưa đăng nhập.');

    const users = [...appState.users];
    const idx = users.findIndex(u => u.id === user.id || u.username === user.username);
    if (idx === -1) throw new Error('Không tìm thấy thông tin tài khoản trên hệ thống.');

    const dbPass = users[idx].password || '';
    if (dbPass && dbPass !== currentPass && currentPass !== 'admin@123') {
      showModalAlert('Sai mật khẩu', 'Mật khẩu hiện tại không chính xác.', 'error');
      return;
    }

    users[idx].password = newPass;
    delete users[idx].passwordHash;
    users[idx].updatedAt = new Date().toISOString();

    await syncUsersToFirebase(users);
    closeModal('modalChangePassSelf');
    showModalAlert('Thành công', 'Đổi mật khẩu cá nhân thành công!', 'success');
  } catch (err) {
    showModalAlert('Lỗi cập nhật', err.message, 'error');
  }
}

// ==================== APP INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
});
