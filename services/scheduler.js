const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const {
  buildMedReminderFlex,
  buildSnoozeFlex,
  buildEscalationFlex,
  pushMessage
} = require('./lineClient');

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SNOOZE_AFTER_MIN = 15; // สะกิดซ้ำหลัง 15 นาที
const ESCALATE_AFTER_MIN = 30; // แจ้งผู้ดูแลหลัง 30 นาที

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** ตรวจว่ายาตัวนี้ต้องกินในวันที่ dateStr หรือไม่ ตาม repeatType */
function isDueOnDate(med, dateStr) {
  if (!med.isActive) return false;
  if (med.startDate && dateStr < med.startDate) return false;
  if (med.endDate && dateStr > med.endDate) return false;

  const date = new Date(dateStr + 'T00:00:00');

  if (med.repeatType === 'DAILY') return true;

  if (med.repeatType === 'WEEKLY_CUSTOM') {
    const dayKey = DAY_KEYS[date.getDay()];
    return (med.repeatDays || []).includes(dayKey);
  }

  if (med.repeatType === 'INTERVAL') {
    const start = new Date(med.startDate + 'T00:00:00');
    const diffDays = Math.round((date - start) / 86400000);
    if (diffDays < 0) return false;
    return diffDays % (med.intervalDays || 1) === 0;
  }

  return false;
}

/** [เที่ยงคืนทุกวัน] สร้าง MedicationLog ของวันนี้ ตามเงื่อนไข Repeat ของยาทุกตัว */
function generateTodayLogs() {
  const date = todayStr();
  const meds = db.get('medications').value();

  meds.forEach((med) => {
    if (!isDueOnDate(med, date)) return;

    const exists = db
      .get('medicationLogs')
      .find({ medId: med.medId, date })
      .value();
    if (exists) return;

    db.get('medicationLogs')
      .push({
        logId: uuidv4(),
        medId: med.medId,
        patientId: med.patientId,
        date,
        scheduledTime: med.time,
        status: 'PENDING',
        remindedAt: null,
        snoozedAt: null,
        escalatedAt: null,
        takenAt: null
      })
      .write();
  });

  console.log(`[scheduler] สร้าง log ประจำวันที่ ${date} เรียบร้อย`);
}

/** [ทุกนาที] ส่งแจ้งเตือนหลักเมื่อถึงเวลานัดหมายพอดี (group ตามผู้ป่วย+เวลา เพื่อรวมยาในมื้อเดียวกัน) */
async function sendDueReminders() {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5); // HH:MM
  const date = todayStr(now);

  const allTodayLogs = db.get('medicationLogs').filter({ date }).value();
  const pendingAll = allTodayLogs.filter((l) => l.status === 'PENDING');
  // Heartbeat log: พิมพ์ทุกนาทีเสมอ เพื่อยืนยันว่า cron ยังทำงานอยู่จริง และให้เห็นเวลาที่ระบบเห็น ณ ขณะนั้น
  console.log(
    `[cron-tick] เวลาเซิร์ฟเวอร์ตอนนี้ = ${hhmm} (${date}) | ยาที่ยังรอทานวันนี้ทั้งหมด = ${pendingAll.length} | เวลานัดที่รอ = [${pendingAll.map((l) => l.scheduledTime).join(', ')}]`
  );

  const pending = pendingAll.filter((l) => l.scheduledTime === hhmm && !l.remindedAt);

  const byPatientTime = {};
  pending.forEach((log) => {
    const key = `${log.patientId}|${log.scheduledTime}`;
    byPatientTime[key] = byPatientTime[key] || [];
    byPatientTime[key].push(log);
  });

  for (const key of Object.keys(byPatientTime)) {
    const logs = byPatientTime[key];
    const patient = db.get('patients').find({ patientId: logs[0].patientId }).value();
    if (!patient) continue;

    const meds = logs.map((l) => db.get('medications').find({ medId: l.medId }).value());
    const mealTag = meds[0]?.mealTag || 'มื้อยา';
    const flex = buildMedReminderFlex({
      patientName: patient.name,
      mealTag,
      time: logs[0].scheduledTime,
      meds,
      logId: logs.map((l) => l.logId).join(',') // ยืนยันหลายรายการพร้อมกันได้
    });

    await pushMessage(patient.lineUserId, flex);

    logs.forEach((l) => {
      db.get('medicationLogs').find({ logId: l.logId }).assign({ remindedAt: now.toISOString() }).write();
    });

    console.log(`[scheduler] ส่งแจ้งเตือน ${mealTag} ให้ ${patient.name} แล้ว`);
  }
}

/** [ทุกนาที] ตรวจ log ที่ยัง PENDING เกิน 15 นาที -> สะกิดซ้ำ / เกิน 30 นาที -> แจ้งผู้ดูแล */
async function checkSnoozeAndEscalation() {
  const now = new Date();
  const date = todayStr(now);
  const pending = db.get('medicationLogs').filter({ date, status: 'PENDING' }).value().filter((l) => l.remindedAt);

  for (const log of pending) {
    const remindedAt = new Date(log.remindedAt);
    const minutesPassed = (now - remindedAt) / 60000;
    const patient = db.get('patients').find({ patientId: log.patientId }).value();
    const med = db.get('medications').find({ medId: log.medId }).value();
    if (!patient || !med) continue;

    if (minutesPassed >= SNOOZE_AFTER_MIN && !log.snoozedAt) {
      const flex = buildSnoozeFlex({ patientName: patient.name, mealTag: med.mealTag, logId: log.logId });
      await pushMessage(patient.lineUserId, flex);
      db.get('medicationLogs').find({ logId: log.logId }).assign({ snoozedAt: now.toISOString() }).write();
      console.log(`[scheduler] สะกิดซ้ำ ${med.medName} ให้ ${patient.name}`);
    }

    if (minutesPassed >= ESCALATE_AFTER_MIN && !log.escalatedAt) {
      const flex = buildEscalationFlex({ patientName: patient.name, mealTag: med.mealTag, time: log.scheduledTime });
      for (const cg of patient.caregivers || []) {
        await pushMessage(cg.lineUserId, flex);
      }
      db.get('medicationLogs').find({ logId: log.logId }).assign({ escalatedAt: now.toISOString(), status: 'MISSED' }).write();
      console.log(`[scheduler] แจ้งผู้ดูแลเรื่อง ${med.medName} ของ ${patient.name} แล้ว (เกิน 30 นาที)`);
    }
  }
}

function start() {
  // เที่ยงคืนทุกวัน (เวลาไทย) -> สร้าง log ของวันใหม่
  cron.schedule('0 0 * * *', generateTodayLogs, { timezone: 'Asia/Bangkok' });
  // ทุกนาที -> เช็กว่าถึงเวลาแจ้งเตือนหรือยัง
  cron.schedule('* * * * *', sendDueReminders, { timezone: 'Asia/Bangkok' });
  // ทุกนาที -> เช็ก snooze / escalation
  cron.schedule('* * * * *', checkSnoozeAndEscalation, { timezone: 'Asia/Bangkok' });

  // สร้าง log ของวันนี้ทันทีตอนสตาร์ทเซิร์ฟเวอร์ (เผื่อ deploy ระหว่างวัน)
  generateTodayLogs();
  console.log('[scheduler] cron jobs เริ่มทำงานแล้ว (timezone Asia/Bangkok)');
}

module.exports = { start, generateTodayLogs, sendDueReminders, checkSnoozeAndEscalation, isDueOnDate };
