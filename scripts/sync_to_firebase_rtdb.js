/**
 * Đồng bộ toàn bộ dữ liệu người dùng và hồ sơ từ local lên Firebase Realtime Database (Singapore)
 */

const fs = require('fs');
const path = require('path');

const rtdbUrl = 'https://edusign-school-default-rtdb.asia-southeast1.firebasedatabase.app';
const docsFile = path.join(__dirname, '..', 'data', 'documents.json');
const usersFile = path.join(__dirname, '..', 'data', 'users.json');
const bghConfigFile = path.join(__dirname, '..', 'data', 'bgh_signing_config.json');

async function syncAll() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 ĐỒNG BỘ DỮ LIỆU LÊN GOOGLE FIREBASE REALTIME DATABASE');
  console.log('URL:', rtdbUrl);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Đồng bộ người dùng
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    console.log(`📤 Đang tải lên ${users.length} tài khoản người dùng...`);
    const res = await fetch(`${rtdbUrl}/users.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(users)
    });
    if (res.ok) {
      console.log(`✅ Đã đồng bộ ${users.length} tài khoản người dùng lên Firebase!`);
    } else {
      console.warn(`Lỗi đồng bộ users: HTTP ${res.status}`);
    }
  }

  // 2. Đồng bộ hồ sơ (đã làm sạch Base64)
  if (fs.existsSync(docsFile)) {
    const docs = JSON.parse(fs.readFileSync(docsFile, 'utf8'));
    console.log(`📤 Đang tải lên ${docs.length} hồ sơ giáo án...`);
    const cleanDocs = docs.map(d => {
      const c = { ...d };
      delete c.fileBase64;
      delete c.signedPdfBase64;
      return c;
    });

    const res = await fetch(`${rtdbUrl}/documents.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanDocs)
    });
    if (res.ok) {
      console.log(`✅ Đã đồng bộ ${cleanDocs.length} hồ sơ giáo án lên Firebase!`);
    } else {
      console.warn(`Lỗi đồng bộ documents: HTTP ${res.status}`);
    }
  }

  // 3. Đồng bộ cấu hình USB Token BGH
  if (fs.existsSync(bghConfigFile)) {
    const bghCfg = JSON.parse(fs.readFileSync(bghConfigFile, 'utf8'));
    console.log(`📤 Đang tải lên cấu hình USB Token Ban Giám hiệu...`);
    const res = await fetch(`${rtdbUrl}/configs/bgh_signing_config.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bghCfg)
    });
    if (res.ok) {
      console.log(`✅ Đã đồng bộ cấu hình BGH lên Firebase!`);
    }
  }

  console.log('\n🎉 HOÀN TẤT ĐỒNG BỘ 100% LÊN GOOGLE FIREBASE REALTIME DATABASE!');
}

syncAll().catch(console.error);
