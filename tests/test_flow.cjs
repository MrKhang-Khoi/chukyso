const testFlow = async () => {
  try {
    // 1. Login as cva.ty
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cva.ty', password: '123456' })
    });
    const loginData = await loginRes.json();
    console.log('1. Login cva.ty:', loginData.success);
    const token = loginData.token;

    // 2. Create a test report (Tab 2)
    const createRes = await fetch('http://localhost:3000/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        title: 'Báo cáo Kiểm tra chuyên môn tháng 9',
        category: 'REPORT',
        grade: 'Khối 9',
        week: 'Tuần 1',
        nextSignerId: 'user_7f37ffc5',
        fileBase64: 'JVBERi0xLjQKJcTl8uXrCg==',
        fileName: 'BaoCao_Thang9.pdf'
      })
    });
    const createData = await createRes.json();
    const docId = createData.data && createData.data.id;
    console.log('2. Create report:', createData.success, 'docId:', docId);

    // 3. Test Recall by author
    const recallRes = await fetch('http://localhost:3000/api/documents/' + docId + '/recall', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const recallData = await recallRes.json();
    console.log('3. Recall report:', recallData.success, 'status:', recallData.data && recallData.data.status);

    // 4. Test re-forwarding
    const fwdRes = await fetch('http://localhost:3000/api/documents/' + docId + '/forward-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        comment: 'Đã chỉnh sửa nội dung sau thu hồi',
        nextSignerId: 'user_7f37ffc5'
      })
    });
    const fwdData = await fwdRes.json();
    console.log('4. Re-forward to leader:', fwdData.success);

    // 5. Login as Tran Van Nam
    const namLogin = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tvnam', password: '123' })
    });
    const namData = await namLogin.json();
    console.log('5. Login tvnam:', namData.success);
    const namToken = namData.token;

    // 6. Test Reject by Tran Van Nam
    const rejectRes = await fetch('http://localhost:3000/api/documents/' + docId + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + namToken },
      body: JSON.stringify({ reason: 'Số liệu chưa khớp với biên bản' })
    });
    const rejectData = await rejectRes.json();
    console.log('6. Reject report:', rejectData.success, 'status:', rejectData.data && rejectData.data.status);

    // 7. Author forwards again, Tran Van Nam signs and finishes
    await fetch('http://localhost:3000/api/documents/' + docId + '/forward-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ comment: 'Đã hoàn thiện số liệu', nextSignerId: 'user_7f37ffc5' })
    });

    const finalSignRes = await fetch('http://localhost:3000/api/documents/' + docId + '/forward-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + namToken },
      body: JSON.stringify({ comment: 'Đã chốt duyệt', isFinish: true })
    });
    const finalSignData = await finalSignRes.json();
    console.log('7. Final sign & finish:', finalSignData.success, 'status:', finalSignData.data && finalSignData.data.status);

    // 8. Last signer (Tran Van Nam) clicks confirm-complete
    const completeRes = await fetch('http://localhost:3000/api/documents/' + docId + '/confirm-complete', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + namToken }
    });
    const completeData = await completeRes.json();
    console.log('8. Confirm complete by last signer:', completeData.success, 'isArchived:', completeData.data && completeData.data.isArchived);

  } catch (e) {
    console.error('Error:', e.message);
  }
};
testFlow();
