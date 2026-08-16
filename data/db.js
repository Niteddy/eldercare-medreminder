{
  "patients": [
    {
      "patientId": "PATIENT_001",
      "name": "คุณตาบุญมี",
      "lineUserId": null,
      "caregivers": [
        {
          "caregiverId": "CG_001",
          "name": "คุณสมชาย (ลูกชาย)",
          "lineUserId": null
        }
      ]
    }
  ],
  "medications": [
    {
      "medId": "MED_001",
      "patientId": "PATIENT_001",
      "medName": "ยาลดความดัน",
      "dosage": "1 เม็ด",
      "instruction": "หลังอาหารเช้า",
      "mealTag": "มื้อเช้า",
      "time": "08:00",
      "repeatType": "DAILY",
      "repeatDays": [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
        "SAT",
        "SUN"
      ],
      "intervalDays": 1,
      "startDate": "2026-08-01",
      "endDate": null,
      "isActive": true
    },
    {
      "medId": "MED_002",
      "patientId": "PATIENT_001",
      "medName": "วิตามินบำรุงประสาท",
      "dosage": "1 เม็ด",
      "instruction": "หลังอาหารเช้า",
      "mealTag": "มื้อเช้า",
      "time": "08:00",
      "repeatType": "DAILY",
      "repeatDays": [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
        "SAT",
        "SUN"
      ],
      "intervalDays": 1,
      "startDate": "2026-08-01",
      "endDate": null,
      "isActive": true
    },
    {
      "medId": "65308e87-3859-408d-adf1-601c41d071e9",
      "patientId": "PATIENT_001",
      "medName": "ยาแก้ปวด",
      "dosage": "1 เม็ด",
      "instruction": "เมื่อปวด",
      "mealTag": "มื้อเที่ยง",
      "time": "12:00",
      "repeatType": "INTERVAL",
      "repeatDays": [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
        "SAT",
        "SUN"
      ],
      "intervalDays": 2,
      "startDate": "2026-08-16",
      "endDate": null,
      "isActive": true
    }
  ],
  "medicationLogs": [
    {
      "logId": "e8dfb032-d724-4d29-a0bc-53cc29a0b23d",
      "medId": "MED_001",
      "patientId": "PATIENT_001",
      "date": "2026-08-16",
      "scheduledTime": "08:00",
      "status": "PENDING",
      "remindedAt": null,
      "snoozedAt": null,
      "escalatedAt": null,
      "takenAt": null
    },
    {
      "logId": "b1d15a21-55a7-4a58-bf5c-379abab46e3b",
      "medId": "MED_002",
      "patientId": "PATIENT_001",
      "date": "2026-08-16",
      "scheduledTime": "08:00",
      "status": "PENDING",
      "remindedAt": null,
      "snoozedAt": null,
      "escalatedAt": null,
      "takenAt": null
    }
  ]
}
