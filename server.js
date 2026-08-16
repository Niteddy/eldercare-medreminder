require('dotenv').config();
const express = require('express');
const cors = require('cors');
const line = require('@line/bot-sdk');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const db = require('./services/db');
const { client, config, buildEscalationFlex, pushMessage } = require('./services/lineClient');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 1) LINE Webhook (ต้องอ่าน raw body ก่อน express.json ของ route อื่น) ----------
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    await Promise.all((req.body.events || []).map(handleLineEvent));
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] error:', err);
    res.sendStatus(500);
  }
});

async function handleLineEvent(event) {
  const userId = event.source && event.source.userId;

  // เพิ่มเพื่อน/ปลดบล็อก -> ผูกบัญชีเบื้องต้น (ถ้ายังไม่มีผู้สูงอายุผูก lineUserId ให้ผูกเป็นผู้สูงอายุก่อน)
  if (event.type === 'follow' && userId) {
    const patients = db.get('patients').value();
    const unlinkedPatient = patients.find((p) => !p.lineUserId);
    if (unlinkedPatient) {
      db.get('patients').find({ patientId: unlinkedPatient.patientId }).assign({ lineUserId: userId }).write();
      await client.pushMessage(userId, {
        type: 'text',
        text: `สวัสดีค่ะคุณ${unlinkedPatient.name} 👴 ระบบผูกบัญชีเรียบร้อยแล้ว จะคอยแจ้งเตือนเวลาทานยาให้นะคะ`
      });
    } else {
      await client.pushMessage(userId, {
        type: 'text',
        text: 'สวัสดีค่ะ ยินดีต้อนรับสู่ ElderCare MedReminder 💊\nพิมพ์ "ผูกบัญชีผู้ดูแล" เพื่อลงทะเบียนเป็นผู้ดูแลนะคะ'
      });
    }
    return;
  }

  // ข้อความ "ผูกบัญชีผู้ดูแล" -> เพิ่มเป็นผู้ดูแลของผู้ป่วยคนแรก (ตัวอย่างแบบง่าย)
  if (event.type === 'message' && event.message.type === 'text' && userId) {
    if (event.message.text.trim() === 'ผูกบัญชีผู้ดูแล') {
      const patient = db.get('patients').first().value();
      const already = (patient.caregivers || []).some((c) => c.lineUserId === userId);
      if (!already) {
        db.get('patients')
          .find({ patientId: patient.patientId })
          .get('caregivers')
          .push({ caregiverId: uuidv4(), name: 'ผู้ดูแล', lineUserId: userId })
          .write();
      }
      await client.pushMessage(userId, {
        type: 'text',
        text: `ผูกบัญชีผู้ดูแลของคุณ${patient.name} เรียบร้อยแล้วค่ะ ✅\nเปิดแดชบอร์ดได้จากเมนูด้านล่างเลยค่ะ`
      });
    }
    return;
  }

  // กดปุ่ม "ทานยาแล้ว" (postback)
  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback.data);
    const action = data.get('action');
    const logIds = (data.get('logId') || '').split(',').filter(Boolean);

    if (action === 'TAKEN') {
      const now = new Date().toISOString();
      logIds.forEach((logId) => {
        db.get('medicationLogs').find({ logId }).assign({ status: 'TAKEN', takenAt: now }).write();
      });
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '✅ บันทึกแล้วค่ะ เก่งมากค่ะวันนี้ทานยาตรงเวลา!'
      });
    }
    return;
  }
}

// ---------- 2) Middleware สำหรับ REST API (LIFF เรียกใช้) ----------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ liffId: process.env.LIFF_ID || '' });
});

// รายชื่อผู้ป่วย (ใช้ในหน้าแดชบอร์ด)
app.get('/api/patients', (req, res) => {
  res.json(db.get('patients').value());
});

// รายการยาทั้งหมดของผู้ป่วยคนหนึ่ง
app.get('/api/patients/:patientId/medications', (req, res) => {
  res.json(db.get('medications').filter({ patientId: req.params.patientId }).value());
});

// เพิ่มยาใหม่ พร้อมกฎ Repeat
app.post('/api/patients/:patientId/medications', (req, res) => {
  const med = {
    medId: uuidv4(),
    patientId: req.params.patientId,
    medName: req.body.medName,
    dosage: req.body.dosage,
    instruction: req.body.instruction,
    mealTag: req.body.mealTag,
    time: req.body.time,
    repeatType: req.body.repeatType || 'DAILY',
    repeatDays: req.body.repeatDays || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    intervalDays: req.body.intervalDays || 1,
    startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
    endDate: req.body.endDate || null,
    isActive: true
  };
  db.get('medications').push(med).write();
  res.status(201).json(med);
});

// แก้ไขยา / เปิด-ปิดใช้งาน
app.put('/api/medications/:medId', (req, res) => {
  db.get('medications').find({ medId: req.params.medId }).assign(req.body).write();
  res.json(db.get('medications').find({ medId: req.params.medId }).value());
});

// ลบยา
app.delete('/api/medications/:medId', (req, res) => {
  db.get('medications').remove({ medId: req.params.medId }).write();
  res.status(204).end();
});

// สรุปสถานะวันนี้ (สำหรับการ์ดแดชบอร์ด: อัตราทานตรงเวลา / จำนวน repeat / ผู้ดูแล)
app.get('/api/patients/:patientId/dashboard', (req, res) => {
  const { patientId } = req.params;
  const date = new Date().toISOString().slice(0, 10);
  const meds = db.get('medications').filter({ patientId }).value();
  const logsToday = db.get('medicationLogs').filter({ patientId, date }).value();
  const patient = db.get('patients').find({ patientId }).value();

  const taken = logsToday.filter((l) => l.status === 'TAKEN').length;
  const total = logsToday.length || 1;
  const onTimeRate = Math.round((taken / total) * 100);

  res.json({
    patient,
    onTimeRate,
    repeatMedCount: meds.filter((m) => m.isActive).length,
    logsToday,
    meds
  });
});

// จำลองการแจ้งเตือน/escalation จากหน้าเว็บ (ปุ่ม "จำลอง LINE Bot" ในมockup)
app.post('/api/simulate/:type', async (req, res) => {
  const { type } = req.params; // 'reminder' | 'escalation'
  await (type === 'reminder' ? scheduler.sendDueReminders() : scheduler.checkSnoozeAndEscalation());
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ ElderCare MedReminder server running on port ${PORT}`);
  scheduler.start();
});
