# 💊 ElderCare MedReminder

ระบบแจ้งเตือนทานยาผู้สูงอายุผ่าน LINE Bot + LIFF App
รองรับ **ฟังก์ชันทานยาซ้ำ (Repeat)** แบบทุกวัน / เลือกวันในสัปดาห์ / เว้นวัน
พร้อมระบบ **สะกิดซ้ำ (Snooze)** และ **แจ้งเตือนผู้ดูแลทันที (Escalation Alert)**

โครงสร้างนี้ทำงานได้จริง (ไม่ใช่ดีไซน์เปล่า) ประกอบด้วย:

- **Express server** (`server.js`) — รับ Webhook จาก LINE, เปิด REST API ให้ LIFF เรียก
- **Cron Scheduler** (`services/scheduler.js`) — สร้างตารางยาประจำวันตอนเที่ยงคืน, ส่ง Flex Message ตรงเวลา, สะกิดซ้ำหลัง 15 นาที, แจ้งผู้ดูแลหลัง 30 นาที
- **LIFF Web App** (`public/liff`) — แดชบอร์ดผู้ดูแล เพิ่ม/แก้ไข/ลบยา และตั้งค่า Repeat
- **LowDB (ไฟล์ JSON)** (`data/db.json`) — เก็บข้อมูลผู้ป่วย ยา และ log การทานยา (จะแทนที่ด้วย MongoDB/Postgres ทีหลังได้)

---

## 1. เตรียมของก่อนเริ่ม

| สิ่งที่ต้องมี | หามาจากไหน |
|---|---|
| บัญชี LINE Developers | https://developers.line.biz/console/ (ล็อกอินด้วย LINE ปกติ) |
| เซิร์ฟเวอร์ที่มี HTTPS public URL | เช่น [Render](https://render.com), [Railway](https://railway.app), Vercel (serverless ต้องปรับ cron), หรือ VPS ของคุณเอง |
| Node.js 18 ขึ้นไป | https://nodejs.org |

---

## 2. สร้าง LINE Provider + Messaging API Channel

1. เข้า https://developers.line.biz/console/ → กด **Create a new provider** ตั้งชื่อ เช่น `ElderCare`
2. ในหน้า provider กด **Create a Messaging API channel**
   - Channel name: `ElderCare MedReminder`
   - Category / Subcategory: เลือกที่ใกล้เคียงที่สุด เช่น สุขภาพ
3. เข้าไปที่ช่องทางที่สร้าง → แท็บ **Messaging API**
   - เลื่อนลงไปกด **Issue** ที่ช่อง **Channel access token (long-lived)** → คัดลอกเก็บไว้ → นี่คือ `LINE_CHANNEL_ACCESS_TOKEN`
   - แท็บ **Basic settings** → คัดลอก **Channel secret** → นี่คือ `LINE_CHANNEL_SECRET`
4. ยังอยู่แท็บ Messaging API:
   - ปิด **Auto-reply messages** และ **Greeting messages** (เพื่อไม่ให้ชนกับบอทของเรา) — เปิดเฉพาะ **Webhook**
   - ช่อง **Webhook URL** ใส่ `https://โดเมนของคุณ/webhook` (ใส่ทีหลังหลัง deploy เสร็จ) แล้วกด **Verify**
   - เปิดสวิตช์ **Use webhook** เป็น ON

---

## 3. สร้าง LIFF App

1. ในช่องทางเดียวกัน ไปแท็บ **LIFF** → กด **Add**
2. ตั้งค่า:
   - LIFF app name: `แดชบอร์ดผู้ดูแล`
   - Size: `Full`
   - Endpoint URL: `https://โดเมนของคุณ/liff/index.html` (ใส่ทีหลังหลัง deploy)
   - Scope: ติ๊ก `profile`, `openid`
   - Bot link feature: `On (Aggressive)` (บังคับให้เพิ่มเพื่อนบอทก่อนใช้ LIFF)
3. กด Add แล้วคัดลอก **LIFF ID** (รูปแบบ `1234567890-abcdEFGH`) → นี่คือ `LIFF_ID`

---

## 4. ตั้งค่าไฟล์ .env

คัดลอกไฟล์ `.env.example` เป็น `.env` แล้วกรอกค่าที่ได้จากขั้นตอน 2-3:

```
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
LIFF_ID=...
BASE_URL=https://your-app.onrender.com
PORT=3000
CAREGIVER_PASSCODE=1234
```

---

## 5. รันในเครื่อง (ทดสอบก่อน deploy)

```bash
npm install
npm run dev        # ใช้ nodemon, รีสตาร์ทอัตโนมัติเมื่อแก้โค้ด
# หรือ
npm start
```

เปิดเบราว์เซอร์ที่ `http://localhost:3000/liff/index.html` จะเห็นแดชบอร์ดผู้ดูแล (นอกแอป LINE จะข้าม LIFF login อัตโนมัติ ถ้ายังไม่ตั้งค่า LIFF_ID)

ทดสอบ Webhook ในเครื่องได้ด้วย [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

แล้วเอา URL ที่ได้ (เช่น `https://xxxx.ngrok-free.app`) ไปตั้งเป็น Webhook URL และ LIFF Endpoint URL ชั่วคราวระหว่างทดสอบ

---

## 6. Deploy ขึ้นเซิร์ฟเวอร์จริง (ตัวอย่างด้วย Render.com — ฟรี)

1. Push โค้ดทั้งโฟลเดอร์นี้ขึ้น GitHub repository
2. เข้า https://render.com → **New +** → **Web Service** → เชื่อม GitHub repo
3. ตั้งค่า:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: เพิ่มตัวแปรทั้งหมดจากไฟล์ `.env` (Environment → Add Environment Variable)
4. Deploy เสร็จจะได้ URL เช่น `https://eldercare-medreminder.onrender.com`
5. กลับไปที่ LINE Developers Console:
   - Messaging API → Webhook URL → ใส่ `https://eldercare-medreminder.onrender.com/webhook` → Verify
   - LIFF → แก้ Endpoint URL เป็น `https://eldercare-medreminder.onrender.com/liff/index.html`
6. อัปเดต `BASE_URL` ใน Environment Variables ให้ตรงกับโดเมนจริง แล้ว redeploy

> ⚠️ Render แผนฟรีจะ sleep เมื่อไม่มีคนเรียกนานๆ ทำให้ cron อาจไม่ทำงานตรงเวลา ถ้าจะใช้งานจริงกับผู้สูงอายุ แนะนำใช้แผนเสียเงินขั้นต่ำ หรือ VPS ที่รันตลอดเวลา

---

## 7. วิธีใช้งานแอป (ขั้นตอนสำหรับผู้ใช้จริง)

### ฝั่งผู้สูงอายุ (Patient)
1. สแกน QR Code ของ Official Account (ดูได้ในแท็บ Messaging API → QR code) เพื่อเพิ่มเพื่อน
2. เมื่อเพิ่มเพื่อนครั้งแรก ระบบจะผูกบัญชี LINE ของผู้สูงอายุเข้ากับข้อมูลผู้ป่วยอัตโนมัติ (คนแรกที่แอดบอทจะถูกผูกเป็นผู้ป่วย)
3. เมื่อถึงเวลาแจ้งเตือน (เช่น 08:00 มื้อเช้า) จะได้รับข้อความ Flex Message แสดงรายการยาในมื้อนั้น พร้อมปุ่ม **✅ ทานยาแล้ว**
4. กดปุ่มเพื่อยืนยัน — ถ้าไม่กดภายใน 15 นาที บอทจะส่งข้อความเตือนซ้ำ, ถ้ายังไม่กดอีกภายใน 30 นาที ระบบจะแจ้งผู้ดูแลทันที

### ฝั่งผู้ดูแล (Caregiver)
1. เพิ่มเพื่อน Official Account ตัวเดียวกัน
2. พิมพ์ข้อความ **"ผูกบัญชีผู้ดูแล"** ในแชท เพื่อลงทะเบียนรับการแจ้งเตือนกรณีผู้สูงอายุลืมทานยา
3. เปิดแดชบอร์ดโดยพิมพ์ลิงก์ `https://liff.line.me/<LIFF_ID>` ในแชท หรือปักไว้ที่ **Rich Menu** (ดูขั้นตอนที่ 8) — ระบบจะพาเข้าแดชบอร์ดผ่าน LINE โดยอัตโนมัติ (ไม่ต้องล็อกอินซ้ำ)
4. ในแดชบอร์ด:
   - ดูอัตราการทานยาตรงเวลา, จำนวนยาที่ตั้ง Repeat, สถานะการทานยาวันนี้แบบเรียลไทม์
   - กด **"+ เพิ่มรายการยาใหม่"** เพื่อเพิ่มยา พร้อมตั้งค่า:
     - **ทุกวัน (Daily)** — แจ้งเตือนทุกวันเวลาเดิม
     - **ระบุวันในสัปดาห์ (Weekly)** — เลือกเฉพาะวันที่ต้องทาน เช่น จ. พ. ศ.
     - **ทานแบบเว้นวัน (Interval)** — ระบุจำนวนวันเว้น เช่น ทุก 2 วัน
   - แก้ไข (✏️) หรือลบ (🗑️) รายการยาได้ทันที การเปลี่ยนแปลงมีผลกับตารางแจ้งเตือนของวันถัดไปทันที

### รูปแบบการนับ Repeat
ระบบจะรันงานทุกเที่ยงคืน (เวลาไทย) เพื่อสร้างตาราง "ต้องกินยาอะไรบ้างวันนี้" ตามกฎที่ตั้งไว้ในแดชบอร์ด แล้ว cron รายนาทีจะเทียบเวลาปัจจุบันกับเวลานัดหมายเพื่อส่ง Flex Message โดยอัตโนมัติ — ไม่ต้องสร้างรายการแจ้งเตือนใหม่ทุกวันด้วยมือ

---

## 8. (แนะนำ) ตั้งค่า Rich Menu ให้ผู้ดูแลกดเข้าแดชบอร์ดง่ายขึ้น

1. ออกแบบรูปเมนู (ขนาด 2500×1686 หรือ 2500×843 px) เช่น ปุ่ม "แดชบอร์ดผู้ดูแล", "ตารางยาวันนี้"
2. ไปที่ LINE Developers Console → ช่องทาง → แท็บ **Messaging API** → เลื่อนหา **Rich menu** หรือใช้ [LINE Official Account Manager](https://manager.line.biz) → เมนู **Rich menu** → **Create**
3. เพิ่มปุ่ม action ประเภท **Link** ชี้ไปที่ `https://liff.line.me/<LIFF_ID>`
4. บันทึกและตั้งเป็นเมนู default

---

## 9. โครงสร้างไฟล์ทั้งหมด

```
eldercare-medreminder/
├── server.js                 # Express app + LINE webhook + REST API
├── package.json
├── .env.example
├── data/
│   └── db.json                # ฐานข้อมูล (สร้างอัตโนมัติ, seed ข้อมูลตัวอย่างไว้แล้ว)
├── services/
│   ├── db.js                  # lowdb wrapper + schema
│   ├── lineClient.js          # สร้าง Flex Message + ส่งข้อความ
│   └── scheduler.js           # cron: generate log / reminder / snooze / escalation
└── public/
    └── liff/
        ├── index.html          # แดชบอร์ดผู้ดูแล (LIFF)
        ├── style.css
        └── app.js
```

---

## 10. อัปเกรดที่แนะนำสำหรับใช้งานจริงระยะยาว

- ย้ายจาก `lowdb` (ไฟล์ JSON) ไปใช้ **MongoDB Atlas** หรือ **PostgreSQL** เมื่อมีผู้ป่วยหลายคน เพื่อรองรับการเขียนพร้อมกัน
- เพิ่มระบบผูกบัญชีที่ปลอดภัยกว่านี้ (ตอนนี้เดโมใช้วิธี "คนแรกที่แอด = ผู้ป่วย" เพื่อความง่าย) เช่น สร้างรหัสเชื่อมบัญชี (invite code) ต่อผู้ป่วย 1 คน
- ใช้ **LINE Notify** หรือปุ่มโทรฉุกเฉินเพิ่มเติมในข้อความ Escalation
- เพิ่ม Basic Auth หรือ LINE Login สำหรับหน้าแดชบอร์ดสรุปผลย้อนหลัง (ใช้ `CAREGIVER_PASSCODE` ที่เตรียมไว้ใน .env ได้ทันที)

---

หากต้องการให้ช่วยต่อยอด (เช่น เพิ่มหน้าประวัติการทานยาย้อนหลัง, เชื่อม MongoDB, หรือระบบผูกบัญชีหลายผู้ป่วย) แจ้งได้เลยครับ
