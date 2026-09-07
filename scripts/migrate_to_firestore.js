/**
 * Script di chuyển (Migrate) dữ liệu từ data/*.json lên Google Cloud Firestore
 * Cách dùng:
 * 1. Tải file Service Account Key từ Firebase Console (Project Settings -> Service Accounts -> Generate new private key)
 * 2. Lưu thành file: serviceAccountKey.json tại thư mục gốc dự án
 * 3. Chạy lệnh: node scripts/migrate_to_firestore.js
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const serviceAccountPath = path.join(rootDir, 'serviceAccountKey.json');
const usersFile = path.join(rootDir, 'data', 'users.json');
const docsFile = path.join(rootDir, 'data', 'documents.json');
const bghConfigFile = path.join(rootDir, 'data', 'bgh_signing_config.json');

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🚀 CÔNG CỤ DI CHUYỂN DỮ LIỆU LÊN GOOGLE CLOUD FIRESTORE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!fs.existsSync(serviceAccountPath)) {
    console.log('⚠️  CHƯA TÌM THẤY TỆP: serviceAccountKey.json');
    console.log('👉 Hướng dẫn:');
    console.log('   1. Truy cập https://console.firebase.google.com');
    console.log('   2. Vào Project Settings -> Service accounts -> Bấm [Generate new private key]');
    console.log('   3. Đổi tên file tải về thành: serviceAccountKey.json và đặt vào thư mục gốc dự án:');
    console.log(`      ${rootDir}\\serviceAccountKey.json`);
    console.log('   4. Chạy lại lệnh này.\n');
    return;
  }

  let admin;
  try {
    admin = require('firebase-admin');
  } catch (e) {
    console.log('📦 Đang cài đặt thư viện firebase-admin...');
    const { execSync } = require('child_process');
    execSync('npm install firebase-admin --save-dev', { cwd: rootDir, stdio: 'inherit' });
    admin = require('firebase-admin');
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  const db = admin.firestore();
  console.log(`✅ Đã kết nối thành công đến Firebase Project: ${serviceAccount.project_id}\n`);

  // 1. Đồng bộ người dùng (users)
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    console.log(`📤 Đang tải lên ${users.length} tài khoản người dùng...`);
    const batch = db.batch();
    for (const u of users) {
      const ref = db.collection('users').doc(u.id);
      batch.set(ref, u, { merge: true });
    }
    await batch.commit();
    console.log(`✅ Đã đồng bộ ${users.length} người dùng vào collection "users"!`);
  }

  // 2. Đồng bộ hồ sơ (documents) - Đã làm sạch Base64
  if (fs.existsSync(docsFile)) {
    const docs = JSON.parse(fs.readFileSync(docsFile, 'utf8'));
    console.log(`📤 Đang tải lên ${docs.length} hồ sơ giáo án...`);
    
    // Firestore giới hạn batch 500 records
    const chunkSize = 400;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const d of chunk) {
        const cleanDoc = { ...d };
        delete cleanDoc.fileBase64;
        delete cleanDoc.signedPdfBase64;
        const ref = db.collection('documents').doc(d.id);
        batch.set(ref, cleanDoc, { merge: true });
      }
      await batch.commit();
      console.log(`   -> Đã tải lên ${Math.min(i + chunkSize, docs.length)}/${docs.length} hồ sơ...`);
    }
    console.log(`✅ Đã đồng bộ ${docs.length} hồ sơ vào collection "documents"!`);
  }

  // 3. Đồng bộ cấu hình BGH USB Token
  if (fs.existsSync(bghConfigFile)) {
    const bghConfig = JSON.parse(fs.readFileSync(bghConfigFile, 'utf8'));
    console.log(`📤 Đang tải lên cấu hình Chữ ký số BGH...`);
    await db.collection('configs').doc('bgh_signing_config').set(bghConfig, { merge: true });
    console.log(`✅ Đã đồng bộ cấu hình BGH vào collection "configs"!`);
  }

  console.log('\n🎉 DI CHUYỂN DỮ LIỆU LÊN CLOUD FIRESTORE HOÀN TẤT 100%!');
}

main().catch(err => {
  console.error('❌ Lỗi di chuyển dữ liệu:', err);
});
