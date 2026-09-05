# EduSign VGCA - Hệ thống Quản lý và Trình ký Hồ sơ Giáo dục Điện tử

> **Giải pháp thay thế triệt để quy trình gửi giáo án thủ công qua Zalo bằng Chữ ký số Chuyên dùng Ban Cơ yếu Chính phủ (VGCA) – Chuẩn PAdES Incremental Update.**

---

## 🌟 1. Giới thiệu Bài toán & Mục tiêu

Hiện nay tại nhiều trường học, quy trình ký duyệt Kế hoạch bài dạy (Giáo án) và hồ sơ chuyên môn thường diễn ra thủ công:
* Giáo viên ký xong gửi qua Zalo cho Tổ trưởng.
* Tổ trưởng tải về, mở phần mềm ký, rồi lại gửi tiếp qua Zalo cho Ban Giám hiệu (BGH).
* BGH tải về ký duyệt và lưu trữ rải rác trên máy tính hoặc Google Drive.

### Nhược điểm lớn của quy trình Zalo cũ:
1. **Lỗi hỏng chữ ký số (Broken Signature Chain):** Gửi qua lại Zalo, tải về và lưu lại bằng các phần mềm không chuẩn sẽ làm thay đổi chuỗi băm (Hash) $\rightarrow$ Chữ ký của giáo viên trước đó bị báo lỗi *"Signature is Invalid / Document Altered"* trên Adobe Acrobat.
2. **Thất lạc file:** Zalo tự động dọn dẹp bộ nhớ đệm (xóa file) sau một thời gian, trôi tin nhắn nhóm.
3. **Mất thời gian & Không có báo cáo:** Tổ trưởng và BGH phải đếm thủ công từng file bằng mắt thường.

---

## 🚀 2. Kiến trúc & Tính năng Nổi bật của EduSign VGCA

1. **Luồng duyệt 3 cấp khép kín trên Web:**
   * **Cấp 1 (Giáo viên):** Nộp bài giảng $\rightarrow$ Đưa ảnh chữ ký tay lên $\rightarrow$ Ký số cấp 1 với Chứng thư VGCA.
   * **Cấp 2 (Tổ trưởng):** Nhận thông báo tự động $\rightarrow$ Đọc bài trực tiếp trên web $\rightarrow$ Ký nháy duyệt chuyên môn.
   * **Cấp 3 (Hiệu trưởng):** Xem tổng hợp các tổ $\rightarrow$ Phê duyệt chính thức và đóng dấu đỏ điện tử của nhà trường $\rightarrow$ File tự động lưu vào Kho hồ sơ số vĩnh viễn.
2. **Tự động nhận diện Chứng thư số Ban Cơ yếu (VGCA):**
   * Quét và kết nối trực tiếp với chứng thư số chuyên dùng công vụ X.509 v3 trong Windows Certificate Store (thông qua `VGCA Virtual CSP`).
3. **Quản lý Mẫu Chữ Ký Tay (Visual Signature Representation):**
   * Cho phép giáo viên **tải ảnh chữ ký scan tay (PNG nền trong suốt)** hoặc **vẽ chữ ký trực tiếp trên màn hình**.
   * Đóng dấu trực quan chuẩn quy định của Bộ GD&ĐT và Nghị định 30/2020/NĐ-CP.
4. **Bảo toàn Chữ ký số Chuẩn PAdES (Incremental Update):**
   * Mỗi cấp ký sau sẽ được ghi nối tiếp vào phần phụ lục của file PDF, đảm bảo khi mở bằng Adobe Acrobat Reader, cả 3 chữ ký đều hiển thị màu xanh lá hợp lệ 100%.

---

## 🛠️ 3. Yêu cầu Hệ thống

* **Hệ điều hành:** Windows 10 / 11 hoặc Windows Server.
* **Môi trường chạy:** Node.js v18 trở lên (hoặc .NET 8 SDK).
* **Phần mềm Cơ yếu:** Máy tính đã cài đặt và đăng nhập **`VGCA Virtual CSP`** (do Ban Cơ yếu Chính phủ cấp).

---

## 💻 4. Hướng dẫn Cài đặt & Khởi chạy

### Bước 1: Tải mã nguồn về máy
```bash
git clone https://github.com/MrKhang-Khoi/chukyso.git
cd chukyso
```

### Bước 2: Cài đặt thư viện phụ thuộc
```bash
npm install
```

### Bước 3: Biên dịch module Ký số C# (Tùy chọn, hệ thống tự động nhận)
```bash
npm run build:signer
```

### Bước 4: Kiểm thử toàn diện hệ thống (Automated Verification)
Để chứng minh hệ thống hoạt động chính xác 100% (từ API web, kết nối Google Drive đến xác thực chứng thư mật mã VGCA):
```bash
npm test
```

### Bước 5: Khởi chạy ứng dụng
```bash
npm start
```
Hệ thống sẽ chạy tại địa chỉ: **`http://localhost:3000`**

---

## ☁️ Triển khai Đám Mây 24/7 Miễn Phí (Deploy to Render)

Nhấn nút bên dưới để đưa toàn bộ hệ thống lên Cloud Render chạy độc lập 24/7 không cần mở máy tính:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/MrKhang-Khoi/chukyso)


---

## 🧪 5. Bằng chứng Hệ thống Hoạt động Chính xác (Verification Proof)

### 5.1. Kết quả Kiểm thử Xác thực Chữ ký số Mật mã VGCA (`npm test`)
File mẫu đã ký số thực tế bằng Chứng thư chuyên dùng Ban Cơ yếu Chính phủ: `GiaoAn_DaKy_That.pdf`.
Khi chạy lệnh kiểm tra tính toàn vẹn và hợp lệ:
```bash
dotnet run --project RealPdfSigner -- --verify GiaoAn_DaKy_That.pdf
```
Kết quả kiểm định mật mã thực tế:
```
================= CHỨNG THƯ CHỮ KÝ: [SignatureVGCA] =================
👤 Tên người ký (SignName): Thầy Hà Văn Tý
📋 Lý do ký (Reason): Phê duyệt Kế hoạch bài dạy Tuần 12
📍 Địa điểm ký (Location): Trường THCS Chu Văn An - Xã Đăk Hà
⏰ Thời điểm ký: 05/09/2026 10:38:09
🔐 Thuật toán băm: SHA256
🔑 Tiêu chuẩn chữ ký: /ETSI.CAdES.detached
📜 Chủ thể chứng thư (Subject): C=VN,L=Quảng Ngãi,O=ỦY BAN NHÂN DÂN TỈNH QUẢNG NGÃI,OU=ỦY BAN NHÂN DÂN XÃ ĐĂK HÀ,OU=TRƯỜNG TRUNG HỌC CƠ SỞ CHU VĂN AN,CN=Hà Văn Tý,E=hvty-dakha@quangngai.gov.vn
🏛️ Cơ quan cấp phát (Issuer): C=VN,O=Ban Cơ yếu Chính phủ,CN=CA phục vụ các cơ quan Nhà nước G2
🛡️ Bảo vệ toàn vẹn tài liệu (Covers whole doc): CÓ (100% tài liệu được niêm phong mật mã)
⭐ KẾT QUẢ XÁC THỰC MẬT MÃ: ✅ HỢP LỆ TUYỆT ĐỐI (VALID - CHỨNG THẬT 100%, KHÔNG BỊ SỬA ĐỔI)
```

### 5.2. Kết quả Đồng bộ & Phân loại Hồ sơ Tự động lên Google Drive Kho Trường
* Tự động sinh cấu trúc thư mục sư phạm: `Năm học 2026 - 2027 / Học kỳ I / Tổ Toán - Tin / Tuần 12`.
* Tự động lưu trữ bản sao chuẩn hóa: `[Tổ Toán - Tin]_Kế hoạch bài dạy Tuần 12_DaKy.pdf`.
* Tích hợp Google Apps Script Webhook đẩy trực tiếp vào Google Drive tổ chức của nhà trường.

---

## 📱 6. Hướng dẫn Đưa Mẫu Chữ Ký Tay lên Hệ thống

1. Truy cập vào địa chỉ **`http://localhost:3000`**.
2. Bấm nút **"Mẫu chữ ký & Con dấu"** ở thanh điều hướng trên cùng.
3. Chọn một trong hai cách:
   * **Cách 1:** Tải file ảnh chụp chữ ký tay mực xanh (nền trong suốt PNG).
   * **Cách 2:** Dùng chuột hoặc bút cảm ứng vẽ trực tiếp chữ ký vào khung canvas.
4. Bấm **"Lưu mẫu chữ ký vào hồ sơ"**. Mẫu này sẽ tự động gắn kèm với chứng thư số của bạn mỗi khi ký văn bản.

---

## 🌐 7. Kho Lưu Trữ GitHub Chính Thức

* Repository: [https://github.com/MrKhang-Khoi/chukyso](https://github.com/MrKhang-Khoi/chukyso)
* Nhánh chính: `main`

---

## 📜 8. Căn cứ Pháp lý & Tiêu chuẩn Kỹ thuật

* **Nghị định số 30/2020/NĐ-CP:** Về công tác văn thư và quy định chữ ký số cơ quan, tổ chức.
* **Thông tư số 22/2021/TT-BGDĐT:** Quy định về quản lý và lưu trữ hồ sơ giáo dục điện tử.
* **Quy chuẩn kỹ thuật VGCA:** Tiêu chuẩn mật mã khóa công khai X.509 v3, thuật toán ECDSA SHA-256 (RFC 3279 DER Sequence), chuẩn chữ ký tài liệu PAdES (ETSI TS 102 778 / ISO 32000).

---
*Phát triển phục vụ mục tiêu Chuyển đổi số Ngành Giáo dục.*
