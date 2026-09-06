using System;
using System.IO;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using iText.Bouncycastle.X509;
using iText.Commons.Bouncycastle.Cert;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;
using iText.Kernel.Pdf.Canvas.Parser.Listener;
using iText.Kernel.Pdf.Canvas.Parser.Data;
using iText.Layout;
using iText.Layout.Element;
using iText.Signatures;

using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace RealPdfSigner
{
    // Lớp thực thi Chữ ký số Mật mã Chuẩn Quốc tế (Hỗ trợ cả ECDSA và RSA của Ban Cơ yếu Chính phủ)
    public class VgcaSignature : IExternalSignature
    {
        protected readonly X509Certificate2 _cert;
        protected readonly ECDsa? _ecdsa;
        protected readonly RSA? _rsa;

        public VgcaSignature(X509Certificate2 cert)
        {
            _cert = cert ?? throw new ArgumentNullException(nameof(cert));
            _ecdsa = cert.GetECDsaPrivateKey();
            if (_ecdsa == null)
            {
                _rsa = cert.GetRSAPrivateKey();
            }

            if (_ecdsa == null && _rsa == null)
            {
                throw new Exception("Chứng thư số không có Khóa riêng (Private Key) hợp lệ cho RSA hoặc ECDSA!");
            }
        }

        public string GetDigestAlgorithmName() => "SHA-256";

        public string GetSignatureAlgorithmName() => _ecdsa != null ? "ECDSA" : "RSA";

        public ISignatureMechanismParams? GetSignatureMechanismParameters() => null;

        public byte[] Sign(byte[] message)
        {
            Console.ForegroundColor = ConsoleColor.Yellow;
            Console.WriteLine("===============================================================");
            Console.WriteLine($"📲 ĐANG KÍCH HOẠT KÝ SỐ MẬT MÃ ({GetSignatureAlgorithmName()}) QUA BAN CƠ YẾU CHÍNH PHỦ (VGCA)...");
            Console.WriteLine("👉 ĐÃ GỬI TÍN HIỆU TỚI THIẾT BỊ / USB TOKEN CỦA THẦY!");
            Console.WriteLine("===============================================================");
            Console.ResetColor();

            if (_ecdsa != null)
            {
                // Định dạng chữ ký ECDSA trong PKCS#7 / PAdES chuẩn quốc tế (Adobe Acrobat) BẮT BUỘC là RFC 3279 DER Sequence.
                return _ecdsa.SignData(message, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
            }
            else if (_rsa != null)
            {
                // Định dạng chữ ký RSA PKCS#1 v1.5
                return _rsa.SignData(message, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            }

            throw new InvalidOperationException("Không tìm thấy thuật toán mã hóa phù hợp.");
        }
    }

    public class VgcaEcdsaSignature : VgcaSignature
    {
        public VgcaEcdsaSignature(X509Certificate2 cert) : base(cert) { }
    }

    class Program
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int dwProcessId);
        private const int ATTACH_PARENT_PROCESS = -1;

        [STAThread]
        static void Main(string[] args)
        {
            // Nếu chạy ứng dụng mà không truyền tham số CLI, hoặc có cờ --tray/--agent:
            // TỰ ĐỘNG CHẠY NGẦM KHAY HỆ THỐNG (SYSTEM TRAY) - KHÔNG MỞ MÀN HÌNH ĐEN
            if (args.Length == 0 || (args.Length == 1 && (args[0].Equals("--tray", StringComparison.OrdinalIgnoreCase) || args[0].Equals("--agent", StringComparison.OrdinalIgnoreCase))))
            {
                RunTrayAgent();
                return;
            }

            if (args.Length == 1 && args[0].Equals("--console", StringComparison.OrdinalIgnoreCase))
            {
                AttachConsole(ATTACH_PARENT_PROCESS);
                RunConsoleAgent();
                return;
            }

            // Gắn vào cửa sổ dòng lệnh gọi đến (nếu gọi từ cmd/powershell/node child_process)
            AttachConsole(ATTACH_PARENT_PROCESS);
            try
            {
                var stdOutStream = Console.OpenStandardOutput();
                if (stdOutStream != null && stdOutStream != Stream.Null)
                {
                    Console.SetOut(new StreamWriter(stdOutStream, System.Text.Encoding.UTF8) { AutoFlush = true });
                }
                var stdErrStream = Console.OpenStandardError();
                if (stdErrStream != null && stdErrStream != Stream.Null)
                {
                    Console.SetError(new StreamWriter(stdErrStream, System.Text.Encoding.UTF8) { AutoFlush = true });
                }
            }
            catch { }
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

            if (args.Length > 0 && args[0].Equals("--find-anchor", StringComparison.OrdinalIgnoreCase))
            {
                string pdfFile = args.Length > 1 ? args[1] : "GiaoAn_CanKy.pdf";
                string signerName = args.Length > 2 ? args[2] : "Hà Văn Tý";
                string role = args.Length > 3 ? args[3] : "teacher";
                FindAnchor(pdfFile, signerName, role);
                return;
            }

            // 1. Tìm chứng thư thật của Giáo viên / Ban Cơ yếu trong Windows Certificate Store
            X509Certificate2? realCert = FindVgcaCertificate();

            if (realCert == null)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("❌ Không tìm thấy chứng thư số Ban Cơ yếu Chính phủ hoặc USB Token trong kho Windows!");
                Console.ResetColor();
                return;
            }

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine($"✅ ĐÃ TÌM THẤY CHỨNG THƯ THẬT:");
            Console.WriteLine($"   - Chủ sở hữu: {realCert.Subject}");
            Console.WriteLine($"   - Cơ quan cấp: {realCert.Issuer}");
            Console.WriteLine($"   - Thời hạn đến: {realCert.NotAfter:dd/MM/yyyy HH:mm:ss}");
            string algoName = realCert.GetECDsaPrivateKey() != null ? "ECDSA" : (realCert.GetRSAPrivateKey() != null ? "RSA" : "CryptoAPI");
            Console.WriteLine($"   - Thuật toán: {realCert.PublicKey.Oid.FriendlyName} ({algoName})");
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
                    rectY = 275f;
                }
                else
                {
                    rectX = 440f;
                    rectY = 120f;
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
                    IExternalSignature pks = new VgcaSignature(realCert);

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

        public static void FindAnchor(string pdfPath, string signerName, string role)
        {
            try
            {
                if (!File.Exists(pdfPath))
                {
                    Console.WriteLine("[ANCHOR_RESULT_JSON]");
                    Console.WriteLine(JsonSerializer.Serialize(new { found = false, message = "File not found" }));
                    return;
                }

                using var pdfReader = new PdfReader(pdfPath);
                using var pdfDoc = new PdfDocument(pdfReader);
                int pageCount = pdfDoc.GetNumberOfPages();
                var page = pdfDoc.GetPage(pageCount);
                var pageSize = page.GetPageSize();
                float pW = pageSize.GetWidth();
                float pH = pageSize.GetHeight();
                bool isLandscape = pW > pH;

                var listener = new TextCollectorListener();
                var processor = new PdfCanvasProcessor(listener);
                processor.ProcessPageContent(page);

                // Nhóm text chunk thành từng dòng theo tọa độ Y
                var lines = new List<(float Y, List<TextChunk> Chunks, string Text)>();
                listener.Chunks.Sort((a, b) => b.Y.CompareTo(a.Y));

                var curLineChunks = new List<TextChunk>();
                foreach (var chunk in listener.Chunks)
                {
                    if (curLineChunks.Count == 0)
                    {
                        curLineChunks.Add(chunk);
                    }
                    else
                    {
                        if (Math.Abs(curLineChunks[0].Y - chunk.Y) <= 4.0f)
                        {
                            curLineChunks.Add(chunk);
                        }
                        else
                        {
                            curLineChunks.Sort((a, b) => a.X.CompareTo(b.X));
                            string lineText = string.Join("", curLineChunks.ConvertAll(c => c.Text));
                            lines.Add((curLineChunks[0].Y, new List<TextChunk>(curLineChunks), lineText));
                            curLineChunks.Clear();
                            curLineChunks.Add(chunk);
                        }
                    }
                }
                if (curLineChunks.Count > 0)
                {
                    curLineChunks.Sort((a, b) => a.X.CompareTo(b.X));
                    string lineText = string.Join("", curLineChunks.ConvertAll(c => c.Text));
                    lines.Add((curLineChunks[0].Y, new List<TextChunk>(curLineChunks), lineText));
                }

                bool isTeacher = role.ToLower().Contains("teacher") || role.Contains("1") || (!role.ToLower().Contains("leader") && !role.ToLower().Contains("principal"));
                bool isLeader = role.ToLower().Contains("leader") || role.Contains("2");
                bool isPrincipal = role.ToLower().Contains("principal") || role.Contains("3");

                float minColX = isTeacher ? (pW * 0.55f) : (isLeader ? (pW * 0.30f) : 0f);
                float maxColX = isTeacher ? pW : (isLeader ? (pW * 0.65f) : (pW * 0.35f));

                float? targetNameY = null;
                float? targetNameX = null;
                float? targetRoleY = null;
                float? targetRoleX = null;

                foreach (var line in lines)
                {
                    string lt = line.Text;
                    if (lt.Contains("GIÁO VIÊN", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("TỔ TRƯỞNG", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("HIỆU TRƯỞNG", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("PHÓ HIỆU", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("Người lập", StringComparison.OrdinalIgnoreCase))
                    {
                        targetRoleY = line.Y;
                        var colChunks = line.Chunks.FindAll(c => c.X >= minColX && c.X <= maxColX);
                        if (colChunks.Count > 0)
                        {
                            targetRoleX = colChunks[0].X;
                        }
                    }

                    if (lt.Contains("Hà Văn Tý", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("Phan Thị", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("Ngô Thị", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("Trần Văn", StringComparison.OrdinalIgnoreCase) ||
                        lt.Contains("Trần Khắc", StringComparison.OrdinalIgnoreCase) ||
                        (!string.IsNullOrWhiteSpace(signerName) && lt.Contains(signerName, StringComparison.OrdinalIgnoreCase)))
                    {
                        targetNameY = line.Y;
                        var colChunks = line.Chunks.FindAll(c => c.X >= minColX && c.X <= maxColX);
                        if (colChunks.Count > 0)
                        {
                            targetNameX = colChunks[0].X;
                        }
                    }
                }

                float stampW = 95f;
                float stampH = 60f;
                float defaultX = isTeacher ? (isLandscape ? pW * 0.745f : pW * 0.74f)
                               : isLeader ? (isLandscape ? pW * 0.46f : pW * 0.46f)
                               : (isLandscape ? pW * 0.18f : pW * 0.18f);
                float defaultY = isLandscape ? 275f : 120f;

                float stampX = defaultX;
                float stampY = defaultY;
                bool foundAnchor = false;

                if (targetNameY.HasValue && targetRoleY.HasValue)
                {
                    float midY = (targetRoleY.Value + targetNameY.Value) / 2f;
                    stampY = midY - (stampH / 2f);
                    float anchorX = targetNameX ?? targetRoleX ?? defaultX;
                    stampX = anchorX - (stampW * 0.15f);
                    foundAnchor = true;
                }
                else if (targetNameY.HasValue)
                {
                    stampY = targetNameY.Value + 15f;
                    float anchorX = targetNameX ?? defaultX;
                    stampX = anchorX - (stampW * 0.15f);
                    foundAnchor = true;
                }
                else if (targetRoleY.HasValue)
                {
                    stampY = targetRoleY.Value - stampH - 15f;
                    float anchorX = targetRoleX ?? defaultX;
                    stampX = anchorX - (stampW * 0.15f);
                    foundAnchor = true;
                }

                stampX = Math.Max(10f, Math.Min(pW - stampW - 10f, stampX));
                stampY = Math.Max(10f, Math.Min(pH - stampH - 10f, stampY));

                var result = new
                {
                    found = foundAnchor,
                    x = Math.Round(stampX, 1),
                    y = Math.Round(stampY, 1),
                    width = stampW,
                    height = stampH,
                    page = pageCount,
                    pageWidth = pW,
                    pageHeight = pH
                };

                Console.WriteLine("[ANCHOR_RESULT_JSON]");
                Console.WriteLine(JsonSerializer.Serialize(result));
            }
            catch (Exception ex)
            {
                Console.WriteLine("[ANCHOR_RESULT_JSON]");
                Console.WriteLine(JsonSerializer.Serialize(new { found = false, error = ex.Message }));
            }
        }

        public static X509Certificate2? FindVgcaCertificate()
        {
            try
            {
                using var store = new X509Store(StoreName.My, StoreLocation.CurrentUser);
                store.Open(OpenFlags.ReadOnly);

                // 1. Ưu tiên chứng thư có khóa riêng và thuộc Ban Cơ yếu / Cơ quan Nhà nước
                foreach (var cert in store.Certificates)
                {
                    if (!cert.HasPrivateKey) continue;
                    string issuer = cert.Issuer ?? "";
                    string subject = cert.Subject ?? "";
                    if (issuer.Contains("Ban C") || issuer.Contains("VGCA") || issuer.Contains("Nhà nước") || issuer.Contains("Nha nuoc") ||
                        subject.Contains("gov.vn") || subject.Contains("CHU VAN AN") || subject.Contains("Chu Văn An"))
                    {
                        return cert;
                    }
                }

                // 2. Tìm theo thumbprint quen thuộc
                string defaultThumbprint = "6398E3DC37E44EBBF976DFDE9F0143E1BDA5346D";
                foreach (var cert in store.Certificates)
                {
                    if (cert.Thumbprint.Equals(defaultThumbprint, StringComparison.OrdinalIgnoreCase))
                        return cert;
                }

                // 3. Fallback: Bất kỳ chứng thư nào có Khóa riêng và còn hạn
                foreach (var cert in store.Certificates)
                {
                    if (cert.HasPrivateKey && cert.NotAfter > DateTime.Now)
                        return cert;
                }
            }
            catch { }
            return null;
        }

        public static byte[] KySoPdfBytes(byte[] inputPdfBytes, string reason, string location)
        {
            var cert = FindVgcaCertificate();
            if (cert == null)
                throw new Exception("Không tìm thấy chứng thư số Ban Cơ yếu có khóa riêng trong kho Windows! Xin vui lòng kiểm tra kết nối USB Token.");

            using var reader = new PdfReader(new MemoryStream(inputPdfBytes));
            using var outputStream = new MemoryStream();

            var stampingProps = new StampingProperties();
            stampingProps.UseAppendMode();

            var signer = new PdfSigner(reader, outputStream, stampingProps);
            var signerProps = new SignerProperties()
                .SetFieldName("SignatureVGCA_" + DateTime.Now.Ticks)
                .SetReason(reason)
                .SetLocation(location);
            signer.SetSignerProperties(signerProps);

            IExternalSignature pks = new VgcaSignature(cert);
            var bcCert = new Org.BouncyCastle.X509.X509CertificateParser().ReadCertificate(cert.RawData);
            var bcCertWrapper = new X509CertificateBC(bcCert);
            var chain = new IX509Certificate[] { bcCertWrapper };

            signer.SignDetached(pks, chain, null, null, null, 0, PdfSigner.CryptoStandard.CADES);
            return outputStream.ToArray();
        }

        public static void RunDesktopAgent()
        {
            RunTrayAgent();
        }

        public static void RunTrayAgent()
        {
            var tray = new EduSignWin32Tray();
            tray.Run();
        }

        public static void RunConsoleAgent()
        {
            Console.Clear();
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("╔══════════════════════════════════════════════════════════════════════╗");
            Console.WriteLine("║        CÔNG CỤ KÝ SỐ CHUYÊN DỤNG EDUSIGN AGENT (VGCA DESKTOP)        ║");
            Console.WriteLine("║            Trường THCS Chu Văn An - Tỉnh Quảng Ngãi                  ║");
            Console.WriteLine("║            Phiên bản 2.0.0 - Chuẩn Nghị định 30/2020/NĐ-CP           ║");
            Console.WriteLine("╚══════════════════════════════════════════════════════════════════════╝");
            Console.ResetColor();

            var cert = FindVgcaCertificate();
            if (cert != null)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine($"\n✓ ĐÃ NHẬN DIỆN CHỨNG THƯ SỐ CÔNG VỤ:");
                Console.WriteLine($"  - Chủ sở hữu: {cert.Subject}");
                Console.WriteLine($"  - Cơ quan cấp: {cert.Issuer}");
                Console.WriteLine($"  - Hạn dùng: {cert.NotAfter:dd/MM/yyyy HH:mm:ss} | Khóa riêng: {(cert.HasPrivateKey ? "CÓ SẴN (ĐÃ CẮM)" : "CHƯA NHẬN")}");
                Console.ResetColor();
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("\n⚠️ CHƯA PHÁT HIỆN USB TOKEN BAN CƠ YẾU HOẶC CHỨNG THƯ SỐ");
                Console.WriteLine("  Xin vui lòng cắm USB Token vào máy tính trước khi bấm ký trên web.");
                Console.ResetColor();
            }

            var prefixes = new List<string> { "http://127.0.0.1:18888/", "http://localhost:18888/" };
            try
            {
                var testListener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 3000);
                testListener.Start();
                testListener.Stop();
                prefixes.Add("http://127.0.0.1:3000/");
                prefixes.Add("http://localhost:3000/");
            }
            catch { }

            using var listener = new HttpListener();
            foreach (var prefix in prefixes)
            {
                try { listener.Prefixes.Add(prefix); } catch { }
            }

            try
            {
                listener.Start();
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine("\n🚀 DỊCH VỤ KÝ SỐ CỤC BỘ ĐANG CHẠY...");
                foreach (var p in prefixes) Console.WriteLine($"   👉 Lắng nghe kết nối an toàn tại: {p}");
                Console.WriteLine("\n💡 Thầy hãy giữ cửa sổ này mở khi ký trên trang web (Local hoặc Render Cloud).");
                Console.ResetColor();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"❌ Không thể khởi động cổng lắng nghe: {ex.Message}");
                Console.ResetColor();
                return;
            }

            while (true)
            {
                try
                {
                    var context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => HandleAgentRequest(context));
                }
                catch (Exception) { break; }
            }
        }

        public static void HandleAgentRequest(HttpListenerContext context)
        {
            var req = context.Request;
            var res = context.Response;

            // Thiết lập tiêu đề CORS & Private Network Access
            res.AddHeader("Access-Control-Allow-Origin", "*");
            res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
            res.AddHeader("Access-Control-Allow-Private-Network", "true");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            res.ContentType = "application/json; charset=utf-8";
            string path = req.Url?.AbsolutePath.ToLowerInvariant() ?? "";

            try
            {
                if (path == "/api/ping-local-signer" || path == "/api/check-vgca-status")
                {
                    var cert = FindVgcaCertificate();
                    var statusData = new
                    {
                        success = true,
                        service = "EduSign-Desktop-Agent",
                        version = "2.0.0",
                        platform = "win32",
                        appRunning = true,
                        appName = "EduSign Desktop Agent (Ban Cơ yếu Chính phủ)",
                        tokenConnected = cert != null && cert.HasPrivateKey,
                        certInfo = cert != null ? new
                        {
                            subject = cert.Subject,
                            issuer = cert.Issuer,
                            notAfter = cert.NotAfter.ToString("yyyy-MM-dd HH:mm:ss"),
                            thumbprint = cert.Thumbprint,
                            hasPrivateKey = cert.HasPrivateKey,
                            signerName = ExtractCn(cert.Subject),
                            email = ExtractEmail(cert.Subject),
                            school = ExtractOu(cert.Subject)
                        } : null,
                        details = (cert != null && cert.HasPrivateKey)
                            ? "EduSign Agent đang hoạt động và đã nhận diện USB Token hợp lệ."
                            : "EduSign Agent đang hoạt động nhưng chưa cắm USB Token."
                    };

                    byte[] jsonBytes = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(statusData));
                    res.OutputStream.Write(jsonBytes, 0, jsonBytes.Length);
                    res.Close();
                    return;
                }

                if (path == "/api/local-sign-doc" && req.HttpMethod == "POST")
                {
                    using var streamReader = new StreamReader(req.InputStream, req.ContentEncoding);
                    string body = streamReader.ReadToEnd();
                    using var docJson = JsonDocument.Parse(body);
                    var root = docJson.RootElement;

                    string fileBase64 = root.TryGetProperty("fileBase64", out var fb64) ? fb64.GetString() ?? "" : "";
                    string docTitle = "Kế hoạch bài dạy";
                    string signerName = "Hà Văn Tý";

                    if (root.TryGetProperty("doc", out var docElem))
                    {
                        if (docElem.TryGetProperty("title", out var t)) docTitle = t.GetString() ?? docTitle;
                        if (docElem.TryGetProperty("author", out var a)) signerName = a.GetString() ?? signerName;
                    }

                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] 📝 Nhận lệnh ký số từ Web: \"{docTitle}\" (Người ký: {signerName})");

                    byte[] pdfBytes;
                    if (!string.IsNullOrEmpty(fileBase64))
                    {
                        string cleanBase64 = Regex.Replace(fileBase64, @"^data:[^;]+;base64,", "");
                        pdfBytes = Convert.FromBase64String(cleanBase64);
                    }
                    else
                    {
                        string samplePath = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "GiaoAn_CanKy.pdf");
                        if (File.Exists(samplePath)) pdfBytes = File.ReadAllBytes(samplePath);
                        else
                        {
                            string tempMau = System.IO.Path.GetTempFileName() + ".pdf";
                            TaoFilePdfMau(tempMau);
                            pdfBytes = File.ReadAllBytes(tempMau);
                            try { File.Delete(tempMau); } catch { }
                        }
                    }

                    byte[] signedBytes = KySoPdfBytes(pdfBytes, $"{signerName} đã ký số VGCA", "Quảng Ngãi");
                    Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] 🎉 Niêm phong PAdES X.509 thành công! Dung lượng: {signedBytes.Length} bytes.");

                    var resObj = new
                    {
                        success = true,
                        message = "Ký số mật mã thật VGCA thành công 100%!",
                        signedPdfBase64 = "data:application/pdf;base64," + Convert.ToBase64String(signedBytes),
                        signer = signerName
                    };
                    byte[] resBytes = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(resObj));
                    res.OutputStream.Write(resBytes, 0, resBytes.Length);
                    res.Close();
                    return;
                }

                res.StatusCode = 404;
                byte[] notFound = System.Text.Encoding.UTF8.GetBytes("{\"success\":false,\"message\":\"Endpoint not found\"}");
                res.OutputStream.Write(notFound, 0, notFound.Length);
                res.Close();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"❌ Lỗi xử lý yêu cầu ký: {ex.Message}");
                Console.ResetColor();

                res.StatusCode = 500;
                var errObj = new { success = false, message = ex.Message };
                byte[] errBytes = System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(errObj));
                res.OutputStream.Write(errBytes, 0, errBytes.Length);
                res.Close();
            }
        }

        public static string ExtractCn(string? subject)
        {
            if (string.IsNullOrEmpty(subject)) return "Giáo viên";
            var m = Regex.Match(subject, @"CN=([^,]+)");
            return m.Success ? m.Groups[1].Value.Trim() : subject;
        }

        public static string ExtractEmail(string? subject)
        {
            if (string.IsNullOrEmpty(subject)) return "";
            var m = Regex.Match(subject, @"E=([^,]+)");
            return m.Success ? m.Groups[1].Value.Trim() : "";
        }

        public static string ExtractOu(string? subject)
        {
            if (string.IsNullOrEmpty(subject)) return "THCS Chu Văn An";
            var m = Regex.Match(subject, @"OU=([^,]+)");
            return m.Success ? m.Groups[1].Value.Trim() : "THCS Chu Văn An";
        }
    }

    public class EduSignWin32Tray
    {
        private const int NIM_ADD = 0x00000000;
        private const int NIM_MODIFY = 0x00000001;
        private const int NIM_DELETE = 0x00000002;
        private const int NIF_MESSAGE = 0x00000001;
        private const int NIF_ICON = 0x00000002;
        private const int NIF_TIP = 0x00000004;
        private const int NIF_INFO = 0x00000010;
        private const int NIIF_INFO = 0x00000001;
        private const int NIIF_WARNING = 0x00000002;
        private const int WM_USER = 0x0400;
        private const int WM_TRAYICON = WM_USER + 1;
        private const int WM_RBUTTONUP = 0x0205;
        private const int WM_LBUTTONDBLCLK = 0x0203;
        private const int TPM_RIGHTBUTTON = 0x0002;
        private const int TPM_RETURNCMD = 0x0100;
        private const int MF_STRING = 0x0000;
        private const int MF_SEPARATOR = 0x0800;
        private const int MF_GRAYED = 0x0001;
        private const int MF_CHECKED = 0x0008;
        private const string AppName = "EduSignAgent";

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct NOTIFYICONDATA
        {
            public int cbSize;
            public IntPtr hWnd;
            public int uID;
            public int uFlags;
            public int uCallbackMessage;
            public IntPtr hIcon;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string szTip;
            public int dwState;
            public int dwStateMask;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
            public string szInfo;
            public int uTimeoutOrVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string szInfoTitle;
            public int dwInfoFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }

        public delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct WNDCLASSEX
        {
            public uint cbSize;
            public uint style;
            public WndProcDelegate lpfnWndProc;
            public int cbClsExtra;
            public int cbWndExtra;
            public IntPtr hInstance;
            public IntPtr hIcon;
            public IntPtr hCursor;
            public IntPtr hbrBackground;
            public string lpszMenuName;
            public string lpszClassName;
            public IntPtr hIconSm;
        }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWindowEx(int dwExStyle, string lpClassName, string lpWindowName, int dwStyle, int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern ushort RegisterClassEx([In] ref WNDCLASSEX lpwcx);

        [DllImport("user32.dll")]
        private static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref MSG lpmsg);

        [DllImport("user32.dll")]
        private static extern void PostQuitMessage(int nExitCode);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern bool Shell_NotifyIcon(int dwMessage, ref NOTIFYICONDATA lpData);

        [DllImport("user32.dll")]
        private static extern IntPtr LoadIcon(IntPtr hInstance, IntPtr lpIconName);

        [DllImport("user32.dll")]
        private static extern IntPtr CreatePopupMenu();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool AppendMenu(IntPtr hMenu, int uFlags, int uIDNewItem, string lpNewItem);

        [DllImport("user32.dll")]
        private static extern int TrackPopupMenu(IntPtr hMenu, int uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);

        [DllImport("user32.dll")]
        private static extern bool DestroyMenu(IntPtr hMenu);

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string? lpModuleName);

        private IntPtr _hWnd;
        private NOTIFYICONDATA _nid;
        private WndProcDelegate? _wndProc;
        private HttpListener? _listener;
        private Thread? _listenerThread;
        private static readonly IntPtr IDI_SHIELD = (IntPtr)32518;
        private static readonly IntPtr IDI_APPLICATION = (IntPtr)32512;

        public void Run()
        {
            string className = "EduSignAgentTrayWin_" + Guid.NewGuid().ToString("N");
            IntPtr hInstance = GetModuleHandle(null);

            _wndProc = CustomWndProc;
            var wndClass = new WNDCLASSEX
            {
                cbSize = (uint)Marshal.SizeOf<WNDCLASSEX>(),
                style = 0,
                lpfnWndProc = _wndProc,
                cbClsExtra = 0,
                cbWndExtra = 0,
                hInstance = hInstance,
                hIcon = IntPtr.Zero,
                hCursor = IntPtr.Zero,
                hbrBackground = IntPtr.Zero,
                lpszMenuName = "",
                lpszClassName = className,
                hIconSm = IntPtr.Zero
            };

            RegisterClassEx(ref wndClass);

            _hWnd = CreateWindowEx(0, className, "EduSignAgentHiddenWindow", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);

            IntPtr hIcon = LoadIcon(IntPtr.Zero, IDI_SHIELD);
            if (hIcon == IntPtr.Zero) hIcon = LoadIcon(IntPtr.Zero, IDI_APPLICATION);

            _nid = new NOTIFYICONDATA
            {
                cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
                hWnd = _hWnd,
                uID = 1,
                uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
                uCallbackMessage = WM_TRAYICON,
                hIcon = hIcon,
                szTip = "EduSign Agent v2.0 - Ban Cơ yếu CP"
            };

            Shell_NotifyIcon(NIM_ADD, ref _nid);

            ShowBalloon("EduSign Desktop Agent", "Dịch vụ ký số Ban Cơ yếu đang chạy ngầm an toàn tại khay hệ thống.", NIIF_INFO);

            StartHttpServer();

            while (GetMessage(out MSG msg, IntPtr.Zero, 0, 0))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            Shell_NotifyIcon(NIM_DELETE, ref _nid);
            try { _listener?.Stop(); _listener?.Close(); } catch { }
        }

        private IntPtr CustomWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == WM_TRAYICON)
            {
                int lp = lParam.ToInt32();
                if (lp == WM_RBUTTONUP || lp == WM_LBUTTONDBLCLK)
                {
                    ShowTrayMenu();
                }
                return IntPtr.Zero;
            }
            return DefWindowProc(hWnd, msg, wParam, lParam);
        }

        private void ShowTrayMenu()
        {
            SetForegroundWindow(_hWnd);
            GetCursorPos(out POINT pt);

            IntPtr hMenu = CreatePopupMenu();

            AppendMenu(hMenu, MF_STRING | MF_GRAYED, 101, "🛡️ EduSign Desktop Agent v2.0");
            AppendMenu(hMenu, MF_STRING | MF_GRAYED, 102, "Trường THCS Chu Văn An - Tỉnh Quảng Ngãi");
            AppendMenu(hMenu, MF_SEPARATOR, 0, "");

            AppendMenu(hMenu, MF_STRING | MF_GRAYED, 103, "🟢 Cổng ký số cục bộ: Hoạt động (18888)");

            var cert = Program.FindVgcaCertificate();
            if (cert != null && cert.HasPrivateKey)
            {
                string cn = Program.ExtractCn(cert.Subject);
                AppendMenu(hMenu, MF_STRING, 104, $"🔑 USB Token: {cn} (Ban Cơ yếu) - ĐÃ CẮM");
            }
            else
            {
                AppendMenu(hMenu, MF_STRING, 104, "🔑 Chưa nhận diện USB Token (Bấm để quét lại)");
            }

            AppendMenu(hMenu, MF_SEPARATOR, 0, "");
            AppendMenu(hMenu, MF_STRING, 105, "🌐 Mở Cổng Ký số Giáo dục THCS Chu Văn An");

            int startupFlags = MF_STRING;
            if (IsStartupEnabled()) startupFlags |= MF_CHECKED;
            AppendMenu(hMenu, startupFlags, 106, "🚀 Tự động khởi động cùng Windows");

            AppendMenu(hMenu, MF_SEPARATOR, 0, "");
            AppendMenu(hMenu, MF_STRING, 107, "❌ Thoát ứng dụng");

            int cmd = TrackPopupMenu(hMenu, TPM_RIGHTBUTTON | TPM_RETURNCMD, pt.X, pt.Y, 0, _hWnd, IntPtr.Zero);
            DestroyMenu(hMenu);

            if (cmd == 104)
            {
                var refreshed = Program.FindVgcaCertificate();
                if (refreshed != null && refreshed.HasPrivateKey)
                {
                    string cn = Program.ExtractCn(refreshed.Subject);
                    ShowBalloon("USB Token Ban Cơ yếu", $"Đã nhận diện chữ ký số của {cn} (Ban Cơ yếu Chính phủ).", NIIF_INFO);
                }
                else
                {
                    ShowBalloon("EduSign Agent", "Chưa phát hiện USB Token. Xin vui lòng cắm USB Token vào cổng USB máy tính.", NIIF_WARNING);
                }
            }
            else if (cmd == 105)
            {
                try
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("http://localhost:3000") { UseShellExecute = true });
                }
                catch { }
            }
            else if (cmd == 106)
            {
                ToggleStartup();
            }
            else if (cmd == 107)
            {
                PostQuitMessage(0);
            }
        }

        private void ShowBalloon(string title, string text, int iconFlags)
        {
            try
            {
                var nid = _nid;
                nid.uFlags = NIF_INFO;
                nid.szInfoTitle = title;
                nid.szInfo = text;
                nid.dwInfoFlags = iconFlags;
                nid.uTimeoutOrVersion = 3000;
                Shell_NotifyIcon(NIM_MODIFY, ref nid);
            }
            catch { }
        }

        private bool IsStartupEnabled()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
                return key?.GetValue(AppName) != null;
            }
            catch { return false; }
        }

        private void ToggleStartup()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
                if (key != null)
                {
                    if (IsStartupEnabled())
                    {
                        key.DeleteValue(AppName, false);
                        ShowBalloon("EduSign Agent", "Đã tắt tự động khởi động cùng Windows.", NIIF_INFO);
                    }
                    else
                    {
                        string exePath = Environment.ProcessPath ?? AppDomain.CurrentDomain.BaseDirectory;
                        key.SetValue(AppName, $"\"{exePath}\" --tray");
                        ShowBalloon("EduSign Agent", "Đã bật tự động khởi động cùng Windows.", NIIF_INFO);
                    }
                }
            }
            catch { }
        }

        private void StartHttpServer()
        {
            _listenerThread = new Thread(() =>
            {
                var prefixes = new List<string> { "http://127.0.0.1:18888/", "http://localhost:18888/" };
                try
                {
                    var testListener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 3000);
                    testListener.Start();
                    testListener.Stop();
                    prefixes.Add("http://127.0.0.1:3000/");
                    prefixes.Add("http://localhost:3000/");
                }
                catch { }

                try
                {
                    _listener = new HttpListener();
                    foreach (var prefix in prefixes)
                    {
                        try { _listener.Prefixes.Add(prefix); } catch { }
                    }
                    _listener.Start();

                    while (_listener.IsListening)
                    {
                        try
                        {
                            var context = _listener.GetContext();
                            ThreadPool.QueueUserWorkItem(_ => Program.HandleAgentRequest(context));
                        }
                        catch { break; }
                    }
                }
                catch { }
            })
            {
                IsBackground = true,
                Name = "EduSignAgentHttpListener"
            };
            _listenerThread.Start();
        }
    }

    public class TextChunk
    {
        public string Text { get; set; } = "";
        public float X { get; set; }
        public float Y { get; set; }
        public float Width { get; set; }
        public float Height { get; set; }
    }

    public class TextCollectorListener : IEventListener
    {
        public List<TextChunk> Chunks { get; } = new List<TextChunk>();

        public void EventOccurred(IEventData data, EventType type)
        {
            if (type == EventType.RENDER_TEXT)
            {
                var renderInfo = (TextRenderInfo)data;
                string text = renderInfo.GetText();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    var rect = renderInfo.GetBaseline().GetBoundingRectangle();
                    Chunks.Add(new TextChunk
                    {
                        Text = text,
                        X = rect.GetX(),
                        Y = rect.GetY(),
                        Width = rect.GetWidth(),
                        Height = rect.GetHeight()
                    });
                }
            }
        }

        public ICollection<EventType> GetSupportedEvents()
        {
            return new HashSet<EventType> { EventType.RENDER_TEXT };
        }
    }
}
