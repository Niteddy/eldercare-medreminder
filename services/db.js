const low = require('lowdb');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB_NAME = process.env.MONGODB_DB_NAME || 'eldercare';
const COLLECTION_NAME = 'appstate';
const DOC_ID = 'main';

// โครงสร้างข้อมูลเริ่มต้น (ตรงกับสคีมาในภาพ "ฐานข้อมูล & การ Repeat")
const defaultData = {
  patients: [
    {
      patientId: 'PATIENT_001',
      name: 'คุณตาบุญมี',
      lineUserId: null,
      caregivers: [
        { caregiverId: 'CG_001', name: 'คุณสมชาย (ลูกชาย)', lineUserId: null }
      ]
    }
  ],
  medications: [
    {
      medId: 'MED_001',
      patientId: 'PATIENT_001',
      medName: 'ยาลดความดัน',
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
  medicationLogs: []
};

let mongoCollection = null;
let realDb = null;

/**
 * Adapter สำหรับ lowdb v1 ที่เก็บข้อมูลไว้ในหน่วยความจำ (อ่าน/เขียนแบบ sync ตามที่ lowdb v1 ต้องการ)
 * แต่ทุกครั้งที่มีการ .write() จะแอบบันทึกสำเนาล่าสุดลง MongoDB แบบ async อยู่เบื้องหลังด้วย (fire-and-forget)
 * วิธีนี้ทำให้โค้ดเดิมที่เรียก db.get(...).write() แบบ synchronous ยังใช้ได้เหมือนเดิมทุกที่ ไม่ต้องแก้โค้ดอื่น
 */
class SyncMemoryAdapter {
  constructor(initialData) {
    this._data = initialData;
  }
  read() {
    return this._data;
  }
  write(data) {
    this._data = data;
    if (mongoCollection) {
      mongoCollection
        .updateOne({ _id: DOC_ID }, { $set: { data, updatedAt: new Date() } }, { upsert: true })
        .catch((err) => console.error('[db] บันทึกลง MongoDB ไม่สำเร็จ:', err.message));
    }
  }
}

/**
 * เชื่อมต่อฐานข้อมูลจริง ต้องเรียกและ await ฟังก์ชันนี้ให้เสร็จก่อน (ตอน server เริ่มทำงาน)
 * ถึงจะเรียกใช้ db.get(...) ที่อื่นได้ปลอดภัย
 */
async function initDb() {
  if (MONGO_URI) {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    mongoCollection = client.db(MONGO_DB_NAME).collection(COLLECTION_NAME);

    const existing = await mongoCollection.findOne({ _id: DOC_ID });
    const initialData = existing && existing.data ? existing.data : defaultData;

    realDb = low(new SyncMemoryAdapter(initialData));
    // เติมค่า default ให้ key ที่อาจยังไม่มี (เช่นตอนอัปเดตโค้ดเพิ่ม field ใหม่ในอนาคต) โดยไม่ทับข้อมูลเดิมที่มีอยู่แล้ว
    realDb.defaults(defaultData).write();

    console.log('[db] ✅ เชื่อมต่อ MongoDB สำเร็จ — ข้อมูลจะไม่หายอีกต่อไปแม้ redeploy ใหม่');
  } else {
    // โหมดสำรอง: ถ้ายังไม่ได้ตั้งค่า MONGODB_URI จะใช้ไฟล์ JSON ในเครื่องแบบเดิม (เหมาะกับทดสอบในเครื่องเท่านั้น)
    const FileSync = require('lowdb/adapters/FileSync');
    const adapter = new FileSync(path.join(__dirname, '..', 'data', 'db.json'));
    realDb = low(adapter);
    realDb.defaults(defaultData).write();
    console.warn('[db] ⚠️ ไม่พบ MONGODB_URI — ใช้ไฟล์ JSON ในเครื่องชั่วคราว (ข้อมูลจะหายเมื่อ redeploy ใหม่บน Render)');
  }
  return realDb;
}

// ส่งออกเป็น Proxy เพื่อให้โค้ดที่อื่น (server.js, scheduler.js) เรียก db.get(...) ได้เหมือนเดิมทุกที่
// โดยไม่ต้องรู้เลยว่าข้างในเปลี่ยนไปใช้ MongoDB แล้ว
const dbProxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'initDb') return initDb;
      if (!realDb) {
        throw new Error('[db] ฐานข้อมูลยังไม่พร้อมใช้งาน ต้องเรียก await db.initDb() ให้เสร็จก่อนเริ่มรับ request');
      }
      const value = realDb[prop];
      return typeof value === 'function' ? value.bind(realDb) : value;
    }
  }
);

module.exports = dbProxy;
