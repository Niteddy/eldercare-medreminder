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

      // ดึงชื่อจริงจากโปรไฟล์ LINE ของผู้ที่กำลังผูกบัญชี แทนการ hardcode ชื่อ
      let displayName = 'ผู้ดูแล';
      try {
        const profile = await client.getProfile(userId);
        if (profile && profile.displayName) displayName = profile.displayName;
      } catch (e) {
        console.warn('[webhook] ดึงโปรไฟล์ LINE ไม่สำเร็จ ใช้ชื่อ default แทน:', e.message);
      }

      const existing = (patient.caregivers || []).find((c) => c.lineUserId === userId);
      if (!existing) {
        db.get('patients')
          .find({ patientId: patient.patientId })
          .get('caregivers')
          .push({ caregiverId: uuidv4(), name: displayName, lineUserId: userId })
          .write();
      } else if (existing.name !== displayName) {
        // เคยผูกไว้แล้วแต่ชื่อยังไม่ตรง (เช่นเคยเป็นชื่อ default) -> อัปเดตให้ตรงชื่อ LINE ปัจจุบัน
        db.get('patients')
          .find({ patientId: patient.patientId })
          .get('caregivers')
          .find({ lineUserId: userId })
          .assign({ name: displayName })
          .write();
      }

      await client.pushMessage(userId, {
        type: 'text',
        text: `ผูกบัญชีผู้ดูแลของคุณ${patient.name} เรียบร้อยแล้วค่ะ คุณ${displayName} ✅\nเปิดแดชบอร์ดได้จากเมนูด้านล่างเลยค่ะ`
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
    startDate: req.body.startDate || scheduler.getBangkokNow().date,
    endDate: req.body.endDate || null,
    isActive: true
  };
  db.get('medications').push(med).write();

  // สร้างคิวแจ้งเตือนของ "วันนี้" ให้ทันที ถ้ายาตัวนี้ต้องกินวันนี้พอดี
  // (ไม่ต้องรอ cron เที่ยงคืน หรือรอเซิร์ฟเวอร์ restart)
  const today = scheduler.getBangkokNow().date;
  if (scheduler.isDueOnDate(med, today)) {
    const exists = db.get('medicationLogs').find({ medId: med.medId, date: today }).value();
    if (!exists) {
      db.get('medicationLogs')
        .push({
          logId: uuidv4(),
          medId: med.medId,
          patientId: med.patientId,
          date: today,
          scheduledTime: med.time,
          status: 'PENDING',
          remindedAt: null,
          snoozedAt: null,
          escalatedAt: null,
          takenAt: null
        })
        .write();
    }
  }

  res.status(201).json(med);
});

// แก้ไขยา / เปิด-ปิดใช้งาน
app.put('/api/medications/:medId', (req, res) => {
  db.get('medications').find({ medId: req.params.medId }).assign(req.body).write();
  const med = db.get('medications').find({ medId: req.params.medId }).value();

  // ซิงก์คิวของ "วันนี้" ให้ตรงกับข้อมูลล่าสุดทันที (ถ้ายังไม่เคยแจ้งเตือนไปแล้ว)
  const today = scheduler.getBangkokNow().date;
  const todayLog = db.get('medicationLogs').find({ medId: med.medId, date: today }).value();
  const dueToday = scheduler.isDueOnDate(med, today);

  if (todayLog && !todayLog.remindedAt) {
    if (dueToday) {
      db.get('medicationLogs').find({ logId: todayLog.logId }).assign({ scheduledTime: med.time }).write();
    } else {
      db.get('medicationLogs').remove({ logId: todayLog.logId }).write();
    }
  } else if (!todayLog && dueToday) {
    db.get('medicationLogs')
      .push({
        logId: uuidv4(),
        medId: med.medId,
        patientId: med.patientId,
        date: today,
        scheduledTime: med.time,
        status: 'PENDING',
        remindedAt: null,
        snoozedAt: null,
        escalatedAt: null,
        takenAt: null
      })
      .write();
  }

  res.json(med);
});

// ลบยา
app.delete('/api/medications/:medId', (req, res) => {
  db.get('medications').remove({ medId: req.params.medId }).write();
  res.status(204).end();
});

// ผูกบัญชี LINE (จาก LIFF login) เป็น "ผู้ป่วย" ของ patient รายนี้โดยตรงจากหน้าเว็บ
app.post('/api/patients/:patientId/link-patient', (req, res) => {
  const { patientId } = req.params;
  const { lineUserId, name } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'missing lineUserId' });

  db.get('patients')
    .find({ patientId })
    .assign({ lineUserId, name: name || db.get('patients').find({ patientId }).value().name })
    .write();

  res.json(db.get('patients').find({ patientId }).value());
});

// ผูกบัญชี LINE (จาก LIFF login) เป็น "ผู้ดูแล" ของ patient รายนี้โดยตรงจากหน้าเว็บ
app.post('/api/patients/:patientId/link-caregiver', (req, res) => {
  const { patientId } = req.params;
  const { lineUserId, name } = req.body;
  if (!lineUserId) return res.status(400).json({ error: 'missing lineUserId' });

  const patient = db.get('patients').find({ patientId }).value();
  const existing = (patient.caregivers || []).find((c) => c.lineUserId === lineUserId);

  if (existing) {
    db.get('patients')
      .find({ patientId })
      .get('caregivers')
      .find({ lineUserId })
      .assign({ name: name || existing.name })
      .write();
  } else {
    db.get('patients')
      .find({ patientId })
      .get('caregivers')
      .push({ caregiverId: uuidv4(), name: name || 'ผู้ดูแล', lineUserId })
      .write();
  }

  res.json(db.get('patients').find({ patientId }).value());
});

// เลิกผูกบัญชี (กรณีผูกผิดคน อยากรีเซ็ต)
app.post('/api/patients/:patientId/unlink-patient', (req, res) => {
  db.get('patients').find({ patientId: req.params.patientId }).assign({ lineUserId: null }).write();
  res.json(db.get('patients').find({ patientId: req.params.patientId }).value());
});

app.post('/api/patients/:patientId/caregivers/:caregiverId/unlink', (req, res) => {
  const { patientId, caregiverId } = req.params;
  db.get('patients').find({ patientId }).get('caregivers').remove({ caregiverId }).write();
  res.json(db.get('patients').find({ patientId }).value());
});

// แก้ชื่อผู้ดูแล (เผื่อทดสอบคนเดียวโดยไม่ต้องมีบัญชี LINE อีกเครื่อง)
app.put('/api/patients/:patientId/caregivers/:caregiverId', (req, res) => {
  const { patientId, caregiverId } = req.params;
  db.get('patients')
    .find({ patientId })
    .get('caregivers')
    .find({ caregiverId })
    .assign({ name: req.body.name })
    .write();
  res.json(db.get('patients').find({ patientId }).value());
});

// สรุปสถานะวันนี้ (สำหรับการ์ดแดชบอร์ด: อัตราทานตรงเวลา / จำนวน repeat / ผู้ดูแล)
app.get('/api/patients/:patientId/dashboard', (req, res) => {
  const { patientId } = req.params;
  const date = scheduler.getBangkokNow().date;
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
