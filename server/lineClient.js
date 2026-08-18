const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.Client(config);

/** สร้างลิงก์ไปหน้าอ่านออกเสียง (ใช้ Web Speech API ของเบราว์เซอร์ ไม่มีค่าใช้จ่ายเพิ่ม) */
function buildReadAloudUrl(text) {
  const base = process.env.BASE_URL || '';
  return `${base}/read-aloud?text=${encodeURIComponent(text)}`;
}

/**
 * Flex Message แจ้งเตือนให้ผู้สูงอายุทานยา (ส่งไปหา patient.lineUserId)
 * มีปุ่ม "ทานยาแล้ว" ที่ผูก postback event: action=TAKEN&logId=...
 * และปุ่ม "ฟังเสียงอ่าน" เปิดหน้าเว็บอ่านออกเสียงข้อความแจ้งเตือน
 */
function buildMedReminderFlex({ patientName, mealTag, time, meds, logId }) {
  const medBubbles = meds.map((m) => ({
    type: 'box',
    layout: 'horizontal',
    margin: 'md',
    contents: [
      {
        type: 'text',
        text: '💊',
        flex: 0,
        size: 'lg'
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        margin: 'sm',
        contents: [
          { type: 'text', text: m.medName, weight: 'bold', size: 'md', wrap: true },
          { type: 'text', text: `${m.dosage} • ${m.instruction}`, size: 'sm', color: '#888888', wrap: true }
        ]
      }
    ]
  }));

  let readAloudText = `สวัสดีค่ะ คุณ${patientName} ได้เวลาทาน${mealTag}แล้วค่ะ ยาที่ต้องทานคือ ${meds
    .map((m) => `${m.medName} จำนวน ${m.dosage}`)
    .join(' และ ')}`;
  // จำกัดความยาวไม่ให้ URI เกินขีดจำกัดของ LINE (uri action รองรับไม่เกิน 1000 ตัวอักษร)
  if (readAloudText.length > 300) readAloudText = readAloudText.slice(0, 300);

  return {
    type: 'flex',
    altText: `ได้เวลาทานยา${mealTag}แล้วค่ะ คุณ${patientName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1DB446',
        paddingAll: 'lg',
        contents: [
          { type: 'text', text: `⏰ ${mealTag} (${time} น.)`, color: '#FFFFFF', weight: 'bold', size: 'sm' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `สวัสดีค่ะ คุณ${patientName} 👴`, weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: 'ได้เวลาทานยาประจำวันแล้วค่ะ!', size: 'md', color: '#555555', wrap: true, margin: 'sm' },
          { type: 'separator', margin: 'lg' },
          ...medBubbles
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#1DB446',
            action: {
              type: 'postback',
              label: '✅ ทานยาแล้ว',
              data: `action=TAKEN&logId=${logId}`,
              displayText: 'ทานยาแล้วค่ะ ✅'
            }
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'uri',
              label: '🔊 ฟังเสียงอ่าน',
              uri: buildReadAloudUrl(readAloudText)
            }
          }
        ]
      }
    }
  };
}

/** ข้อความสะกิดซ้ำ (Snooze) เมื่อผ่านไปตามเวลาที่ตั้งแล้วยังไม่กดยืนยัน */
function buildSnoozeFlex({ patientName, mealTag, logId }) {
  const readAloudText = `คุณ${patientName} ยังไม่ได้กดยืนยันทาน${mealTag}เลยนะคะ รบกวนทานยาด้วยค่ะ`;

  return {
    type: 'flex',
    altText: `⏰ อย่าลืมทานยา ${mealTag} นะคะ`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🔔 เตือนอีกครั้ง', weight: 'bold', color: '#FF9900', size: 'md' },
          { type: 'text', text: `คุณ${patientName} ยังไม่ได้กดยืนยันทานยา${mealTag}เลยนะคะ`, wrap: true, margin: 'md' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#FF9900',
            action: {
              type: 'postback',
              label: '✅ ทานยาแล้ว',
              data: `action=TAKEN&logId=${logId}`,
              displayText: 'ทานยาแล้วค่ะ ✅'
            }
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'uri',
              label: '🔊 ฟังเสียงอ่าน',
              uri: buildReadAloudUrl(readAloudText)
            }
          }
        ]
      }
    }
  };
}

/** ข้อความแจ้งผู้ดูแล (Escalation) เมื่อผ่านไปตามเวลาที่ตั้งแล้วยังไม่ทานยา */
function buildEscalationFlex({ patientName, mealTag, time, escalateAfterMin }) {
  return {
    type: 'flex',
    altText: `⚠️ คุณ${patientName} ยังไม่ได้ทานยา ${mealTag}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '⚠️ แจ้งเตือนด่วน', weight: 'bold', color: '#E53935', size: 'md' },
          {
            type: 'text',
            text: `คุณ${patientName} ยังไม่ได้ทานยา${mealTag} (เวลานัด ${time} น.) หลังผ่านไป ${escalateAfterMin} นาที รบกวนโทรเช็คอาการด้วยนะคะ`,
            wrap: true,
            margin: 'md'
          }
        ]
      }
    }
  };
}

async function pushMessage(userId, message) {
  if (!userId) {
    console.warn('[lineClient] skip push: ยังไม่มี lineUserId ผูกบัญชี');
    return;
  }
  return client.pushMessage(userId, message);
}

module.exports = {
  client,
  config,
  buildMedReminderFlex,
  buildSnoozeFlex,
  buildEscalationFlex,
  pushMessage
};
