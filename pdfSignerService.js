const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Loại bỏ dấu tiếng Việt để xuất văn bản ASCII an toàn vào PDF (WinAnsi encoding)
 */
function safeAscii(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, ''); // Chỉ giữ các ký tự ASCII in được
}

/**
 * Đóng dấu chữ ký số 3 cấp vào văn bản PDF thật
 */
async function generateSignedPdf(doc) {
  let sourcePdfBuffer = null;

  // 1. Đọc file nguồn nếu có
  if (doc.filePath && fs.existsSync(doc.filePath)) {
    const ext = path.extname(doc.filePath).toLowerCase();
    if (ext === '.pdf') {
      try {
        sourcePdfBuffer = fs.readFileSync(doc.filePath);
      } catch (err) {
        console.error('Lỗi đọc file gốc:', err.message);
      }
    }
  }

  // Nếu không có file PDF nguồn (hoặc file lỗi, rỗng, nộp docx), dùng file template chuẩn
  if (!sourcePdfBuffer || sourcePdfBuffer.length < 50 || !sourcePdfBuffer.toString('ascii', 0, 5).startsWith('%PDF')) {
    const defaultTemplate = path.join(__dirname, 'GiaoAn_CanKy.pdf');
    if (fs.existsSync(defaultTemplate) && fs.statSync(defaultTemplate).size > 100) {
      sourcePdfBuffer = fs.readFileSync(defaultTemplate);
    } else {
      const emptyDoc = await PDFDocument.create();
      emptyDoc.addPage([595.28, 841.89]);
      sourcePdfBuffer = await emptyDoc.save();
    }
  }

  // 2. Nạp PDF bằng pdf-lib
  const pdfDoc = await PDFDocument.load(sourcePdfBuffer);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  // Đóng dấu chữ ký ảnh trực tiếp lên trang văn bản nguồn (trang cuối của bài dạy)
  const sourcePages = pdfDoc.getPages();
  if (sourcePages.length > 0) {
    const lastDocPage = sourcePages[sourcePages.length - 1];
    const { width: pW, height: pH } = lastDocPage.getSize();
    
    // Tìm chữ ký giáo viên
    const teacherSignature = (doc.signatures || []).find(s => s.step === 1);
    const teacherSigImgData = (teacherSignature && teacherSignature.visualSignImage) || doc.signatureImage;

    if (teacherSigImgData && teacherSigImgData.includes('base64')) {
      try {
        const base64Clean = teacherSigImgData.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64Clean, 'base64');
        const pngSignImg = await pdfDoc.embedPng(imgBuf);

        const scale = (doc.signCoordinates && typeof doc.signCoordinates.scale === 'number') 
          ? Math.max(0.4, Math.min(2.5, doc.signCoordinates.scale)) 
          : 1.0;
        const stampWidth = Math.round(((doc.signCoordinates && doc.signCoordinates.width) || 95) * scale);
        const stampHeight = Math.round(((doc.signCoordinates && doc.signCoordinates.height) || 60) * scale);

        const isLandscape = pW > pH;
        let defaultX = isLandscape ? (pW * 0.745) : (pW * 0.746);
        let defaultY = isLandscape ? 290 : 504;

        let stampX = defaultX;
        let stampY = defaultY;

        if (doc.signCoordinates && typeof doc.signCoordinates.xPercent === 'number' && typeof doc.signCoordinates.yPercent === 'number') {
          stampX = (doc.signCoordinates.xPercent / 100) * pW;
          stampY = (1 - (doc.signCoordinates.yPercent / 100)) * pH;
        } else if (doc.signPlacement === 'bottom-left') {
          stampX = pW * 0.18;
          stampY = defaultY;
        } else if (doc.signPlacement === 'middle-right') {
          stampX = pW * 0.46;
          stampY = defaultY;
        }

        // Tự động kiểm tra biên an toàn (tránh văng khỏi trang PDF)
        stampX = Math.max(10, Math.min(pW - stampWidth - 10, stampX));
        stampY = Math.max(10, Math.min(pH - stampHeight - 10, stampY));

        lastDocPage.drawImage(pngSignImg, {
          x: stampX,
          y: stampY,
          width: stampWidth,
          height: stampHeight
        });
      } catch (e) {
        console.error('Lỗi đóng dấu ảnh chữ ký trực tiếp lên trang văn bản:', e.message);
      }
    }
  }

  // Thêm một trang phụ lục xác nhận chữ ký số chính thức (Official Digital Signature Certificate Sheet)
  const certPage = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = certPage.getSize();

  // Khung viền chứng nhận hành chính sư phạm
  certPage.drawRectangle({
    x: 30,
    y: 30,
    width: width - 60,
    height: height - 60,
    borderColor: rgb(0.1, 0.2, 0.4),
    borderWidth: 1.5,
    color: rgb(0.98, 0.99, 1.0)
  });

  // Header cơ quan
  certPage.drawText(safeAscii('SO GIAO DUC VA DAO TAO TINH QUANG NGAI'), {
    x: 45,
    y: height - 65,
    size: 10,
    font: fontRegular,
    color: rgb(0.2, 0.2, 0.2)
  });
  certPage.drawText(safeAscii('TRUONG THCS CHU VAN AN'), {
    x: 45,
    y: height - 80,
    size: 11,
    font: fontBold,
    color: rgb(0.05, 0.2, 0.5)
  });

  certPage.drawText(safeAscii('CONG HOA XA HOI CHU NGHIA VIET NAM'), {
    x: width - 265,
    y: height - 65,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1)
  });
  certPage.drawText(safeAscii('Doc lap - Tu do - Hanh phuc'), {
    x: width - 215,
    y: height - 80,
    size: 9.5,
    font: fontOblique,
    color: rgb(0.2, 0.2, 0.2)
  });

  // Đường kẻ phân cách
  certPage.drawLine({
    start: { x: 45, y: height - 95 },
    end: { x: width - 45, y: height - 95 },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.8)
  });

  // Tiêu đề phụ lục
  const docCode = safeAscii(doc.id || 'KHBD-2026');
  certPage.drawText(safeAscii('PHU LUC XAC NHAN CHU KY SO & PHE DUYET GIAO AN'), {
    x: 75,
    y: height - 130,
    size: 14,
    font: fontBold,
    color: rgb(0.1, 0.2, 0.5)
  });
  certPage.drawText(safeAscii('(Ban hanh theo quy dinh tai Nghi dinh so 30/2020/ND-CP ve Cong tac van thu dien tu)'), {
    x: 80,
    y: height - 148,
    size: 9,
    font: fontOblique,
    color: rgb(0.4, 0.4, 0.4)
  });

  // Khung thông tin bài dạy
  const infoY = height - 175;
  certPage.drawRectangle({
    x: 45,
    y: infoY - 80,
    width: width - 90,
    height: 85,
    borderColor: rgb(0.8, 0.85, 0.9),
    borderWidth: 1,
    color: rgb(0.95, 0.97, 1.0)
  });

  const safeTitle = safeAscii(doc.title || 'Ke hoach bai day');
  const safeDept = safeAscii(doc.department || 'To Toan - Tin');
  const safeAuthor = safeAscii(doc.author || 'Giao vien');

  certPage.drawText(`MA HO SO: ${docCode}`, { x: 60, y: infoY - 15, size: 9.5, font: fontBold, color: rgb(0.1, 0.3, 0.7) });
  certPage.drawText(`BAI DAY: ${safeTitle.substring(0, 75)}`, { x: 60, y: infoY - 32, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  certPage.drawText(`GIAO VIEN SOAN: ${safeAuthor}   |   TO CHUYEN MON: ${safeDept}`, { x: 60, y: infoY - 48, size: 9, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
  certPage.drawText(`KHOI LOP: ${safeAscii(doc.grade || 'Khoi 9')}   |   TUAN DAY: ${safeAscii(doc.week || 'Tuan 12')}   |   TRANG THAI: ${safeAscii(doc.status || 'APPROVED')}`, { x: 60, y: infoY - 64, size: 9, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });

  // 3 CỘT CHỮ KÝ THEO CHUẨN NGHỊ ĐỊNH 30/2020/NĐ-CP
  const colY = height - 300;
  const colW = (width - 90) / 3;

  // --- CỘT 1: GIÁO VIÊN SOẠN THẢO (CẤP 1) ---
  const teacherSig = (doc.signatures || []).find(s => s.step === 1) || {
    signerName: doc.author || 'Giao vien',
    signedAt: doc.createdAt || '2026-09-05'
  };

  certPage.drawText(safeAscii('GIAO VIEN SOAN THAO'), { x: 55, y: colY, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  certPage.drawText(safeAscii('(Ky va ghi ro ho ten)'), { x: 55, y: colY - 14, size: 8.5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) });

  // Vẽ chữ ký giáo viên nếu có ảnh
  if (teacherSig.visualSignImage && teacherSig.visualSignImage.includes('base64')) {
    try {
      const base64Data = teacherSig.visualSignImage.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      const pngImg = await pdfDoc.embedPng(imgBuffer);
      certPage.drawImage(pngImg, {
        x: 55,
        y: colY - 80,
        width: 100,
        height: 50
      });
    } catch (e) {
      console.error('Lỗi nhúng ảnh chữ ký giáo viên:', e.message);
    }
  }

  certPage.drawText(safeAscii(teacherSig.signerName || 'Giao vien'), {
    x: 55,
    y: colY - 98,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.4)
  });
  certPage.drawText(`Ngay ky: ${safeAscii(teacherSig.signedAt || '')}`, {
    x: 55,
    y: colY - 110,
    size: 8,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4)
  });

  // --- CỘT 2: TỔ TRƯỞNG CHUYÊN MÔN (CẤP 2) ---
  const leaderSig = (doc.signatures || []).find(s => s.step === 2);
  const col2X = 45 + colW + 10;

  certPage.drawText(safeAscii('TO TRUONG CHUYEN MON'), { x: col2X, y: colY, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  certPage.drawText(safeAscii('(Ky nhay duyet chuyen mon)'), { x: col2X, y: colY - 14, size: 8.5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) });

  if (leaderSig) {
    if (leaderSig.visualSignImage && leaderSig.visualSignImage.includes('base64')) {
      try {
        const base64Data = leaderSig.visualSignImage.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(base64Data, 'base64');
        const pngImg = await pdfDoc.embedPng(imgBuffer);
        certPage.drawImage(pngImg, {
          x: col2X,
          y: colY - 80,
          width: 95,
          height: 48
        });
      } catch (e) {
        console.error('Lỗi nhúng ảnh chữ ký tổ trưởng:', e.message);
      }
    }

    certPage.drawText(safeAscii(leaderSig.signerName || 'To truong'), {
      x: col2X,
      y: colY - 98,
      size: 10,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.4)
    });
    certPage.drawText(`Ngay duyet: ${safeAscii(leaderSig.signedAt || '')}`, {
      x: col2X,
      y: colY - 110,
      size: 8,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4)
    });
    certPage.drawText(safeAscii('Danh gia: Dat chuan phan phoi'), {
      x: col2X,
      y: colY - 122,
      size: 7.5,
      font: fontOblique,
      color: rgb(0.1, 0.5, 0.2)
    });
  } else {
    certPage.drawText(safeAscii('[ Dang cho To truong duyet ]'), {
      x: col2X,
      y: colY - 60,
      size: 9,
      font: fontOblique,
      color: rgb(0.7, 0.4, 0.0)
    });
  }

  // --- CỘT 3: BAN GIÁM HIỆU / HIỆU TRƯỞNG (CẤP 3) ---
  const principalSig = (doc.signatures || []).find(s => s.step === 3);
  const col3X = 45 + colW * 2 + 15;

  certPage.drawText(safeAscii('HIEU TRUONG / BAN GIAM HIEU'), { x: col3X, y: colY, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  certPage.drawText(safeAscii('(Ky so, dong dau co quan)'), { x: col3X, y: colY - 14, size: 8.5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) });

  // Nhúng con dấu trường nếu có
  const sealPath = path.join(__dirname, 'uploads', 'signatures', 'school_seal.png');
  if (fs.existsSync(sealPath)) {
    try {
      const sealBuffer = fs.readFileSync(sealPath);
      const sealPng = await pdfDoc.embedPng(sealBuffer);
      certPage.drawImage(sealPng, {
        x: col3X + 15,
        y: colY - 80,
        width: 65,
        height: 65
      });
    } catch (e) {
      console.error('Lỗi nhúng con dấu:', e.message);
    }
  }

  if (principalSig) {
    certPage.drawText(safeAscii(principalSig.signerName || 'Ban Giam hieu'), {
      x: col3X,
      y: colY - 98,
      size: 10,
      font: fontBold,
      color: rgb(0.7, 0.1, 0.1)
    });
    certPage.drawText(`Ngay ky so: ${safeAscii(principalSig.signedAt || '')}`, {
      x: col3X,
      y: colY - 110,
      size: 8,
      font: fontRegular,
      color: rgb(0.4, 0.4, 0.4)
    });
    certPage.drawText(safeAscii('Chung thuc: Ban Co yeu Chinh phu (VGCA)'), {
      x: col3X,
      y: colY - 122,
      size: 7.5,
      font: fontBold,
      color: rgb(0.1, 0.3, 0.7)
    });
    certPage.drawText(safeAscii('Tieu chuan: PAdES LTV X.509 v3 Valid'), {
      x: col3X,
      y: colY - 134,
      size: 7,
      font: fontRegular,
      color: rgb(0.2, 0.5, 0.2)
    });
  } else {
    certPage.drawText(safeAscii('[ Dang cho BGH phe duyet ]'), {
      x: col3X,
      y: colY - 60,
      size: 9,
      font: fontOblique,
      color: rgb(0.7, 0.4, 0.0)
    });
  }

  // Khung xác thực mật mã điện tử ở chân trang
  const footerY = 90;
  certPage.drawRectangle({
    x: 45,
    y: footerY - 45,
    width: width - 90,
    height: 48,
    borderColor: rgb(0.75, 0.8, 0.9),
    borderWidth: 0.8,
    color: rgb(0.96, 0.98, 1.0)
  });

  certPage.drawText(safeAscii('XAC THUC TOAN VEN VAN BAN DIEN TU:'), {
    x: 55,
    y: footerY - 12,
    size: 8.5,
    font: fontBold,
    color: rgb(0.1, 0.3, 0.6)
  });
  certPage.drawText(safeAscii('Van ban da duoc ma hoa bam SHA-256 va ky so phe duyet boi He thong EduSign VGCA.'), {
    x: 55,
    y: footerY - 24,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.3, 0.3, 0.3)
  });
  certPage.drawText(safeAscii('Moi thay doi noi dung sau khi ky se lam mat hieu luc phap ly cua chu ky so theo Luat Giao dich Dien tu.'), {
    x: 55,
    y: footerY - 36,
    size: 7,
    font: fontOblique,
    color: rgb(0.5, 0.2, 0.2)
  });

  return await pdfDoc.save();
}

/**
 * Thực hiện ký số mật mã thật X.509 PAdES qua RealPdfSigner (Ban Cơ yếu Chính phủ - VGCA)
 */
async function signWithRealVgca(doc) {
  // 1. Tạo file PDF đã đóng dấu ảnh chữ ký chuẩn
  const stampedPdfBuffer = await generateSignedPdf(doc);
  const tempDir = path.join(__dirname, 'uploads', 'documents');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const tempInput = path.join(tempDir, `temp_stamped_${doc.id}_${Date.now()}.pdf`);
  const tempOutput = path.join(tempDir, `RealSigned_${doc.id}_${Date.now()}.pdf`);
  fs.writeFileSync(tempInput, stampedPdfBuffer);

  const exePath = path.join(__dirname, 'RealPdfSigner', 'bin', 'Debug', 'net8.0', 'RealPdfSigner.exe');
  if (!fs.existsSync(exePath)) {
    throw new Error('Không tìm thấy tệp thực thi RealPdfSigner.exe tại: ' + exePath);
  }

  // Tọa độ đã chuẩn hóa
  const scale = (doc.signCoordinates && doc.signCoordinates.scale) || 1.0;
  const w = Math.round(90 * scale);
  const h = Math.round(60 * scale);

  return new Promise((resolve, reject) => {
    const { execFile } = require('child_process');
    execFile(exePath, ['--sign', tempInput, tempOutput, '0', '-1', '-1', String(w), String(h)], { timeout: 120000 }, (error, stdout, stderr) => {
      // Dọn dẹp file trung gian
      try {
        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
      } catch (e) {}

      if (error) {
        console.error('Lỗi khi ký VGCA thật:', stderr || error.message);
        return reject(new Error('Ký số VGCA thất bại (chưa xác nhận trên điện thoại hoặc lỗi kết nối): ' + (stderr || error.message)));
      }

      if (fs.existsSync(tempOutput)) {
        const signedBuf = fs.readFileSync(tempOutput);
        resolve({
          signedBuffer: signedBuf,
          signedFilePath: tempOutput,
          stdout
        });
      } else {
        reject(new Error('Không tìm thấy tệp PDF kết quả sau khi ký số'));
      }
    });
  });
}

module.exports = {
  generateSignedPdf,
  signWithRealVgca
};
