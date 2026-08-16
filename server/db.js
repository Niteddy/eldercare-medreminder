const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, '..', 'data', 'db.json'));
const db = low(adapter);

// โครงสร้างข้อมูลเริ่มต้น (ตรงกับสคีมาในภาพ "ฐานข้อมูล & การ Repeat")
db.defaults({
  // ผู้สูงอายุ 1 คน ผูกกับผู้ดูแลได้หลายคน
  patients: [
    {
      patientId: 'PATIENT_001',
      name: 'คุณตาบุญมี',
      lineUserId: null, // จะถูกเติมอัตโนมัติเมื่อผู้สูงอายุเพิ่มเพื่อน/แอด LINE OA และผูกบัญชี
      caregivers: [
        { caregiverId: 'CG_001', name: 'คุณสมชาย (ลูกชาย)', lineUserId: null }
      ]
    }
  ],
  // รายการยา พร้อมกฎการ Repeat (ตรงตาม schema ในมockup)
  medications: [
    {
      medId: 'MED_001',
      patientId: 'PATIENT_001',
      medName: 'ยาลดความดัน',
      dosage: '1 เม็ด',
      instruction: 'หลังอาหารเช้า',
      mealTag: 'มื้อเช้า',
      time: '08:00',
      repeatType: 'DAILY', // DAILY | WEEKLY_CUSTOM | INTERVAL
      repeatDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      intervalDays: 1,
      startDate: '2026-08-01',
      endDate: null,
      isActive: true
    },
    {
      medId: 'MED_002',
      patientId: 'PATIENT_001',
      medName: 'วิตามินบำรุงประสาท',
      dosage: '1 เม็ด',
      instruction: 'หลังอาหารเช้า',
      mealTag: 'มื้อเช้า',
      time: '08:00',
      repeatType: 'DAILY',
      repeatDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      intervalDays: 1,
      startDate: '2026-08-01',
      endDate: null,
      isActive: true
    }
  ],
  // Log การทานยารายวัน สร้างอัตโนมัติทุกเที่ยงคืนโดย Cron ตามเงื่อนไข Repeat
  medicationLogs: [
    // { logId, medId, patientId, date: 'YYYY-MM-DD', scheduledTime, status: 'PENDING'|'TAKEN'|'MISSED',
    //   remindedAt, snoozedAt, escalatedAt, takenAt }
  ]
}).write();

module.exports = db;
