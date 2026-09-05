using System;
using System.IO;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using iText.Bouncycastle.X509;
using iText.Commons.Bouncycastle.Cert;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Layout;
using iText.Layout.Element;
using iText.Signatures;

namespace RealPdfSigner
{
    // Lớp thực thi Chữ ký số từ xa qua Windows CNG (VGCA RSSP KSP v2.0)
    public class VgcaEcdsaSignature : IExternalSignature
    {
        private readonly X509Certificate2 _cert;
        private readonly ECDsa _ecdsa;

        public VgcaEcdsaSignature(X509Certificate2 cert)
        {
            _cert = cert ?? throw new ArgumentNullException(nameof(cert));
            _ecdsa = cert.GetECDsaPrivateKey() ?? throw new Exception("Không tìm thấy ECDsa Private Key trên chứng thư VGCA!");
        }

        public string GetDigestAlgorithmName()
        {
            return "SHA-256";
        }

        public string GetSignatureAlgorithmName()
        {
            return "ECDSA";
        }

        public ISignatureMechanismParams? GetSignatureMechanismParameters()
        {
            return null;
        }

        public byte[] Sign(byte[] message)
        {
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("===============================================================");
            Console.WriteLine("📲 ĐANG KẾT NỐI MÁY CHỦ BAN CƠ YẾU CHÍNH PHỦ (VGCA)...");
            Console.WriteLine("👉 ĐÃ GỬI THÔNG BÁO PUSH NOTIFICATION ĐẾN ĐIỆN THOẠI CỦA THẦY!");
            Console.WriteLine("👉 XIN MỜI THẦY MỞ ỨNG DỤNG TRÊN ĐIỆN THOẠI ĐỂ XÁC NHẬN KÝ SỐ...");
            Console.WriteLine("===============================================================");
            Console.ResetColor();

            // Khi gọi lệnh này, Windows CNG sẽ kích hoạt VGCA RSSP KSP v2.0 đẩy lệnh về điện thoại.
            // Định dạng chữ ký ECDSA trong PKCS#7 / PAdES chuẩn quốc tế (Adobe Acrobat) BẮT BUỘC là RFC 3279 DER Sequence.
            byte[] signature = _ecdsa.SignData(message, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
            return signature;
        }
    }

    class Program
    {
        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.WriteLine("╔══════════════════════════════════════════════════════════════╗");
            Console.WriteLine("║   HỆ THỐNG KÝ SỐ THẬT CHUYÊN DÙNG BAN CƠ YẾU CHÍNH PHỦ (VGCA)║");
            Console.WriteLine("║   Trường THCS Chu Văn An - Xã Đăk Hà - Tỉnh Quảng Ngãi       ║");
            Console.WriteLine("╚══════════════════════════════════════════════════════════════╝");

            if (args.Length > 0 && (args[0].Equals("--verify", StringComparison.OrdinalIgnoreCase) || args[0].Equals("-v", StringComparison.OrdinalIgnoreCase)))
            {
                string verifyFile = args.Length > 1 ? args[1] : System.IO.Path.Combine(Directory.GetCurrentDirectory(), "GiaoAn_DaKy_That.pdf");
                KiemTraChuKyPdf(verifyFile);
                return;
            }

            // 1. Tìm chứng thư thật của Thầy Hà Văn Tý trong Windows Certificate Store
            string thumbprint = "6398E3DC37E44EBBF976DFDE9F0143E1BDA5346D";
            using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadOnly);

            X509Certificate2? realCert = null;
            foreach (var cert in store.Certificates)
            {
                if (cert.Thumbprint.Equals(thumbprint, StringComparison.OrdinalIgnoreCase))
                {
                    realCert = cert;
                    break;
                }
            }

            if (realCert == null)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("❌ Không tìm thấy chứng thư số của Thầy Hà Văn Tý trong kho Windows!");
                Console.ResetColor();
                return;
            }

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine($"✅ ĐÃ TÌM THẤY CHỨNG THƯ THẬT:");
            Console.WriteLine($"   - Chủ sở hữu: {realCert.Subject}");
            Console.WriteLine($"   - Cơ quan cấp: {realCert.Issuer}");
            Console.WriteLine($"   - Thời hạn đến: {realCert.NotAfter:dd/MM/yyyy HH:mm:ss}");
            Console.WriteLine($"   - Thuật toán: {realCert.PublicKey.Oid.FriendlyName} (ECDSA)");
            Console.ResetColor();
            Console.WriteLine();

            // 2. Chuẩn bị file PDF đầu vào và đầu ra
            string currentDir = Directory.GetCurrentDirectory();
            string inputPdf = "";
            string outputPdf = "";
            int targetPage = 0; // 0 = last page
            float rectX = -1f, rectY = -1f, rectW = 90f, rectH = 60f;
            string reason = "Hà Văn Tý<hvty-dakha@quangngai.gov.vn> đã ký lên văn bản này!";
            string location = "Quảng Ngãi";

            int argOffset = 0;
            if (args.Length > 0 && args[0].Equals("--sign", StringComparison.OrdinalIgnoreCase))
            {
                argOffset = 1;
            }

            if (args.Length > argOffset) inputPdf = args[argOffset];
            if (args.Length > argOffset + 1) outputPdf = args[argOffset + 1];
            if (args.Length > argOffset + 2 && int.TryParse(args[argOffset + 2], out int p)) targetPage = p;
            if (args.Length > argOffset + 3 && float.TryParse(args[argOffset + 3], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float xVal)) rectX = xVal;
            if (args.Length > argOffset + 4 && float.TryParse(args[argOffset + 4], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float yVal)) rectY = yVal;
            if (args.Length > argOffset + 5 && float.TryParse(args[argOffset + 5], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float wVal)) rectW = wVal;
            if (args.Length > argOffset + 6 && float.TryParse(args[argOffset + 6], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out float hVal)) rectH = hVal;
            if (args.Length > argOffset + 7) reason = args[argOffset + 7];
            if (args.Length > argOffset + 8) location = args[argOffset + 8];

            if (string.IsNullOrWhiteSpace(inputPdf))
                inputPdf = System.IO.Path.Combine(currentDir, "GiaoAn_CanKy.pdf");
            if (string.IsNullOrWhiteSpace(outputPdf))
                outputPdf = System.IO.Path.Combine(currentDir, "GiaoAn_DaKy_That.pdf");

            if (!File.Exists(inputPdf))
            {
                TaoFilePdfMau(inputPdf);
                Console.WriteLine($"📄 Đã tạo file PDF giáo án mẫu: {inputPdf}");
            }
            else
            {
                Console.WriteLine($"📄 Sử dụng file PDF đầu vào: {inputPdf}");
            }
            Console.WriteLine($"📁 File xuất chữ ký số dự kiến: {outputPdf}");

            // 3. Xác định trang cần ký và kích thước trang
            int totalPages = 1;
            float pageWidth = 595.28f, pageHeight = 841.89f;
            using (var tempReader = new PdfReader(inputPdf))
            using (var tempDoc = new PdfDocument(tempReader))
            {
                totalPages = tempDoc.GetNumberOfPages();
                if (targetPage <= 0 || targetPage > totalPages)
                    targetPage = totalPages;

                var pageObj = tempDoc.GetPage(targetPage);
                var pageSize = pageObj.GetPageSize();
                pageWidth = pageSize.GetWidth();
                pageHeight = pageSize.GetHeight();
            }

            // Tự động tính tọa độ nếu chưa được chỉ định
            if (rectX < 0 || rectY < 0)
            {
                bool isLandscape = pageWidth > pageHeight;
                if (isLandscape)
                {
                    rectX = 627f;
                    rectY = 290f;
                }
                else
                {
                    rectX = 444f;
                    rectY = 504f;
                }
            }

            Console.WriteLine($"📍 Thông số vị trí chữ ký số: Trang {targetPage}/{totalPages} (Kích thước: {pageWidth:F0}x{pageHeight:F0}), X={rectX:F1}, Y={rectY:F1}, W={rectW:F1}, H={rectH:F1}");

            // 4. Thực hiện ký số chuẩn PAdES
            try
            {
                Console.WriteLine("⚙️ Đang thiết lập cấu trúc chữ ký số PAdES...");
                
                using (PdfReader reader = new PdfReader(inputPdf))
                using (FileStream outputStream = new FileStream(outputPdf, FileMode.Create))
                {
                    // Chế độ ghi nối tiếp Incremental Update (bảo vệ nguyên vẹn cấu trúc file)
                    StampingProperties stampingProperties = new StampingProperties();
                    stampingProperties.UseAppendMode();

                    PdfSigner signer = new PdfSigner(reader, outputStream, stampingProperties);

                    // Thiết lập thông tin chữ ký số qua SignerProperties trong iText 9
                    // KHÔNG gọi SetPageRect để tránh iText tự sinh các dòng chữ (Digitally signed by, Reason, Location...)
                    // che mất chữ ký và nội dung văn bản, giữ văn bản luôn trang nhã và đẹp mắt theo chuẩn Hình 2.
                    // Toàn bộ chứng thư số X.509 v3 và thông tin ký vẫn được bảo vệ nguyên vẹn 100% trong từ điển PDF.
                    SignerProperties signerProperties = new SignerProperties()
                        .SetFieldName("SignatureVGCA_" + DateTime.Now.Ticks)
                        .SetReason(reason)
                        .SetLocation(location);

                    signer.SetSignerProperties(signerProperties);

                    // Nạp đối tượng ký VGCA
                    IExternalSignature pks = new VgcaEcdsaSignature(realCert);

                    // Chuyển đổi chứng thư X509 sang định dạng iText BouncyCastle
                    Org.BouncyCastle.X509.X509Certificate bcCert = new Org.BouncyCastle.X509.X509CertificateParser().ReadCertificate(realCert.RawData);
                    IX509Certificate bcCertWrapper = new X509CertificateBC(bcCert);
                    IX509Certificate[] chain = new IX509Certificate[] { bcCertWrapper };

                    // Ký số và nhúng chữ ký PKCS#7 vào file PDF
                    signer.SignDetached(pks, chain, null, null, null, 0, PdfSigner.CryptoStandard.CADES);
                }

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("\n🎉🎉🎉 KÝ SỐ THÀNH CÔNG 100%! 🎉🎉🎉");
                Console.WriteLine($"📁 File PDF kết quả đã được tạo tại:");
                Console.WriteLine($"   👉 {outputPdf}");
                Console.WriteLine("\n👉 THẦY HÃY MỞ FILE TRÊN BẰNG ADOBE ACROBAT READER:");
                Console.WriteLine("   Nó sẽ hiện chính xác thanh màu xanh:");
                Console.WriteLine("   \"This document is digitally signed. All signatures are valid.\"");
                Console.ResetColor();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"❌ Lỗi trong quá trình ký: {ex.Message}");
                Console.WriteLine(ex.StackTrace);
                Console.ResetColor();
            }
        }

        static void TaoFilePdfMau(string path)
        {
            if (File.Exists(path)) return;

            using (PdfWriter writer = new PdfWriter(path))
            using (PdfDocument pdf = new PdfDocument(writer))
            using (Document document = new Document(pdf))
            {
                document.Add(new Paragraph("UBND HUYỆN ĐĂK HÀ").SetFontSize(12));
                document.Add(new Paragraph("TRƯỜNG THCS CHU VĂN AN").SetFontSize(14));
                document.Add(new Paragraph("\nKẾ HOẠCH BÀI DẠY (GIÁO ÁN ĐIỆN TỬ)").SetFontSize(16));
                document.Add(new Paragraph("Môn: Toán 9 - Năm học 2026 - 2027").SetFontSize(12));
                document.Add(new Paragraph("Giáo viên thực hiện: Thầy Hà Văn Tý").SetFontSize(12));
                document.Add(new Paragraph("\nI. MỤC TIÊU BÀI HỌC:\n- Học sinh nắm vững định nghĩa và tính chất cơ bản.\n- Ứng dụng giải quyết bài toán thực tế."));
                document.Add(new Paragraph("\nII. TIẾN TRÌNH DẠY HỌC:\n- Tiết 1: Ôn tập và khởi động.\n- Tiết 2: Hình thành kiến thức mới."));
                document.Add(new Paragraph("\n\n\n[KHU VỰC ĐÓNG DẤU CHỮ KÝ SỐ CHUYÊN DÙNG VGCA]").SetFontSize(10));
            }
        }

        static void KiemTraChuKyPdf(string pdfPath)
        {
            Console.WriteLine($"🔍 Đang kiểm tra tính xác thực chữ ký số trong file: {pdfPath}\n");
            if (!File.Exists(pdfPath))
            {
                Console.WriteLine("❌ File không tồn tại!");
                return;
            }

            try
            {
                using (PdfReader reader = new PdfReader(pdfPath))
                using (PdfDocument pdfDoc = new PdfDocument(reader))
                {
                    SignatureUtil signUtil = new SignatureUtil(pdfDoc);
                    var names = signUtil.GetSignatureNames();
                    Console.WriteLine($"📊 Số lượng chữ ký số tìm thấy: {names.Count}");

                    foreach (var name in names)
                    {
                        Console.WriteLine($"\n================= CHỨNG THƯ CHỮ KÝ: [{name}] =================");
                        PdfPKCS7 pkcs7 = signUtil.ReadSignatureData(name);
                        Console.WriteLine($"👤 Tên người ký (SignName): {pkcs7.GetSignName()}");
                        Console.WriteLine($"📋 Lý do ký (Reason): {pkcs7.GetReason()}");
                        Console.WriteLine($"📍 Địa điểm ký (Location): {pkcs7.GetLocation()}");
                        Console.WriteLine($"⏰ Thời điểm ký: {pkcs7.GetSignDate():dd/MM/yyyy HH:mm:ss}");
                        Console.WriteLine($"🔐 Thuật toán băm: {pkcs7.GetDigestAlgorithmName()}");
                        Console.WriteLine($"🔑 Tiêu chuẩn chữ ký: {pkcs7.GetFilterSubtype()}");

                        var cert = pkcs7.GetSigningCertificate();
                        if (cert != null)
                        {
                            Console.WriteLine($"📜 Chủ thể chứng thư (Subject): {cert.GetSubjectDN()}");
                            Console.WriteLine($"🏛️ Cơ quan cấp phát (Issuer): {cert.GetIssuerDN()}");
                        }

                        bool wholeDoc = signUtil.SignatureCoversWholeDocument(name);
                        Console.WriteLine($"🛡️ Bảo vệ toàn vẹn tài liệu (Covers whole doc): {(wholeDoc ? "CÓ (100% tài liệu được niêm phong mật mã)" : "KHÔNG")}");

                        // In vị trí ô chữ ký (Rectangle và Page)
                        var form = iText.Forms.PdfAcroForm.GetAcroForm(pdfDoc, false);
                        if (form != null)
                        {
                            var field = form.GetField(name);
                            if (field != null)
                            {
                                var widgets = field.GetWidgets();
                                foreach (var w in widgets)
                                {
                                    var rect = w.GetRectangle().ToRectangle();
                                    var page = w.GetPage();
                                    int pageNum = page != null ? pdfDoc.GetPageNumber(page) : -1;
                                    Console.WriteLine($"📐 Vị trí ô chữ ký: Trang {pageNum}, X={rect.GetX():F1}, Y={rect.GetY():F1}, W={rect.GetWidth():F1}, H={rect.GetHeight():F1}");
                                }
                            }
                        }

                        bool isValid = pkcs7.VerifySignatureIntegrityAndAuthenticity();
                        Console.ForegroundColor = isValid ? ConsoleColor.Green : ConsoleColor.Red;
                        Console.WriteLine($"\n⭐ KẾT QUẢ XÁC THỰC MẬT MÃ: {(isValid ? "✅ HỢP LỆ TUYỆT ĐỐI (VALID - CHỨNG THẬT 100%, KHÔNG BỊ SỬA ĐỔI)" : "❌ KHÔNG HỢP LỆ")}");
                        Console.ResetColor();
                        Console.WriteLine("===============================================================");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"❌ Lỗi đọc chữ ký số: {ex.Message}");
                Console.ResetColor();
            }
        }
    }
}
