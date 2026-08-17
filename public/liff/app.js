let CURRENT_PATIENT_ID = null;
let CURRENT_CAREGIVER_ID = null;
let MY_LINE_PROFILE = null; // { userId, displayName } จาก LIFF login

const dayLabels = { MON: 'จ.', TUE: 'อ.', WED: 'พ.', THU: 'พฤ.', FRI: 'ศ.', SAT: 'ส.', SUN: 'อา.' };
const statusLabel = { TAKEN: ['ทานแล้ว', 'status-taken'], PENDING: ['รอทาน', 'status-pending'], MISSED: ['ลืมทานยา', 'status-missed'] };

async function initLiff() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    if (cfg.liffId) {
      await liff.init({ liffId: cfg.liffId });
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }
      const profile = await liff.getProfile();
      MY_LINE_PROFILE = { userId: profile.userId, displayName: profile.displayName };
      document.getElementById('profile').innerHTML = `
        <img src="${profile.pictureUrl || ''}" alt="" />
        <span>${profile.displayName}</span>`;
    } else {
      console.warn('ยังไม่ได้ตั้งค่า LIFF_ID — รันในโหมดพรีวิวนอก LINE');
    }
  } catch (e) {
    console.warn('LIFF init ล้มเหลว (อาจเปิดนอกแอป LINE):', e.message);
  }
  boot();
}

async function boot() {
  const patients = await fetch('/api/patients').then((r) => r.json());
  if (!patients.length) return;
  CURRENT_PATIENT_ID = patients[0].patientId;
  await refreshDashboard();
}

async function refreshDashboard() {
  const data = await fetch(`/api/patients/${CURRENT_PATIENT_ID}/dashboard`).then((r) => r.json());

  document.getElementById('onTimeRate').textContent = `${data.onTimeRate}%`;
  document.getElementById('repeatCount').textContent = `${data.repeatMedCount} รายการ`;
  const daily = data.meds.filter((m) => m.repeatType === 'DAILY' && m.isActive).length;
  const others = data.meds.filter((m) => m.repeatType !== 'DAILY' && m.isActive).length;
  document.getElementById('repeatSub').textContent = `ทานซ้ำทุกวัน ${daily} / แบบอื่น ${others}`;

  const cg = (data.patient.caregivers || [])[0];
  CURRENT_CAREGIVER_ID = cg ? cg.caregiverId : null;
  document.getElementById('caregiverName').textContent = cg ? cg.name : 'ยังไม่ผูกบัญชี';

  renderLinkStatus(data.patient);
  renderTable(data.meds, data.logsToday);
}

function renderLinkStatus(patient) {
  const banner = document.getElementById('linkBanner');
  const statusBox = document.getElementById('linkedStatus');

  if (!MY_LINE_PROFILE) {
    banner.classList.add('hidden');
    statusBox.classList.add('hidden');
    return;
  }

  const myId = MY_LINE_PROFILE.userId;
  const isPatient = patient.lineUserId === myId;
  const myCaregiverEntry = (patient.caregivers || []).find((c) => c.lineUserId === myId);

  if (!isPatient && !myCaregiverEntry) {
    banner.classList.remove('hidden');
    statusBox.classList.add('hidden');
  } else {
    banner.classList.add('hidden');
    statusBox.classList.remove('hidden');
    const pills = [];
    if (isPatient) {
      pills.push(`<span class="linked-pill">🧓 บัญชีนี้คือผู้ป่วย (${patient.name}) <button onclick="unlinkPatient()">ยกเลิก</button></span>`);
    }
    if (myCaregiverEntry) {
      pills.push(`<span class="linked-pill">🧑‍🤝‍🧑 บัญชีนี้คือผู้ดูแล (${myCaregiverEntry.name}) <button onclick="unlinkCaregiver('${myCaregiverEntry.caregiverId}')">ยกเลิก</button></span>`);
    }
    statusBox.innerHTML = pills.join('');
  }
}

document.getElementById('linkAsPatientBtn').onclick = async () => {
  if (!MY_LINE_PROFILE) return;
  if (!confirm(`ยืนยันผูกบัญชี "${MY_LINE_PROFILE.displayName}" เป็นผู้ป่วยหรือไม่?\n(ระบบจะส่งข้อความแจ้งเตือนทานยามาที่บัญชีนี้)`)) return;

  await fetch(`/api/patients/${CURRENT_PATIENT_ID}/link-patient`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUserId: MY_LINE_PROFILE.userId, name: MY_LINE_PROFILE.displayName })
  });
  refreshDashboard();
};

document.getElementById('linkAsCaregiverBtn').onclick = async () => {
  if (!MY_LINE_PROFILE) return;
  if (!confirm(`ยืนยันผูกบัญชี "${MY_LINE_PROFILE.displayName}" เป็นผู้ดูแลหรือไม่?\n(ระบบจะแจ้งเตือนมาที่บัญชีนี้เมื่อผู้ป่วยลืมทานยา)`)) return;

  await fetch(`/api/patients/${CURRENT_PATIENT_ID}/link-caregiver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineUserId: MY_LINE_PROFILE.userId, name: MY_LINE_PROFILE.displayName })
  });
  refreshDashboard();
};

async function unlinkPatient() {
  if (!confirm('ยกเลิกการผูกบัญชีผู้ป่วยนี้หรือไม่?')) return;
  await fetch(`/api/patients/${CURRENT_PATIENT_ID}/unlink-patient`, { method: 'POST' });
  refreshDashboard();
}

async function unlinkCaregiver(caregiverId) {
  if (!confirm('ยกเลิกการผูกบัญชีผู้ดูแลนี้หรือไม่?')) return;
  await fetch(`/api/patients/${CURRENT_PATIENT_ID}/caregivers/${caregiverId}/unlink`, { method: 'POST' });
  refreshDashboard();
}

document.getElementById('editCaregiverBtn').onclick = async () => {
  if (!CURRENT_CAREGIVER_ID) {
    alert('ยังไม่มีผู้ดูแลผูกบัญชีไว้ — ให้ผู้ดูแลแอดเพื่อนบอทและพิมพ์ "ผูกบัญชีผู้ดูแล" ก่อน');
    return;
  }
  const currentName = document.getElementById('caregiverName').textContent;
  const newName = prompt('แก้ชื่อผู้ดูแล:', currentName);
  if (!newName || !newName.trim()) return;

  await fetch(`/api/patients/${CURRENT_PATIENT_ID}/caregivers/${CURRENT_CAREGIVER_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName.trim() })
  });
  refreshDashboard();
};

function renderTable(meds, logsToday) {
  const tbody = document.getElementById('medTableBody');
  if (!meds.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading">ยังไม่มีรายการยา กด "เพิ่มรายการยาใหม่" เพื่อเริ่มต้น</td></tr>';
    return;
  }

  tbody.innerHTML = meds
    .map((m) => {
      const log = logsToday.find((l) => l.medId === m.medId);
      const [label, cls] = log ? statusLabel[log.status] : ['ยังไม่ถึงรอบ', 'status-pending'];
      const repeatText =
        m.repeatType === 'DAILY'
          ? 'ทุกวัน'
          : m.repeatType === 'INTERVAL'
          ? `ทุก ${m.intervalDays} วัน`
          : (m.repeatDays || []).map((d) => dayLabels[d]).join(' ');

      return `
      <tr>
        <td class="med-name"><span class="dot"></span>${m.medName}</td>
        <td>${m.dosage} (${m.instruction || '-'})</td>
        <td><span class="tag">${m.mealTag || '-'}</span></td>
        <td class="tag-repeat">🔄 ${repeatText}</td>
        <td>${m.time} น.</td>
        <td><span class="${cls}">${label}${log && log.takenAt ? ' (' + log.takenAt.slice(11, 16) + ')' : ''}</span></td>
        <td>
          <button class="action-icon" title="แก้ไข" onclick="openEditModal('${m.medId}')">✏️</button>
          <button class="action-icon" title="ลบ" onclick="deleteMed('${m.medId}')">🗑️</button>
        </td>
      </tr>`;
    })
    .join('');
}

// ---------- Modal เพิ่ม/แก้ไขยา ----------
const modal = document.getElementById('medModal');
const form = document.getElementById('medForm');
const repeatTypeSel = document.getElementById('repeatType');

document.getElementById('addMedBtn').onclick = () => openAddModal();
document.getElementById('cancelBtn').onclick = () => modal.classList.add('hidden');

repeatTypeSel.onchange = updateRepeatFieldsVisibility;
function updateRepeatFieldsVisibility() {
  document.getElementById('weeklyDaysWrap').classList.toggle('hidden', repeatTypeSel.value !== 'WEEKLY_CUSTOM');
  document.getElementById('intervalWrap').classList.toggle('hidden', repeatTypeSel.value !== 'INTERVAL');
}

function openAddModal() {
  form.reset();
  document.getElementById('medId').value = '';
  document.getElementById('modalTitle').textContent = 'เพิ่มรายการยาใหม่';
  document.getElementById('startDate').value = new Date().toISOString().slice(0, 10);
  document.querySelectorAll('.dayChk').forEach((c) => (c.checked = true));
  updateRepeatFieldsVisibility();
  modal.classList.remove('hidden');
}

async function openEditModal(medId) {
  const meds = await fetch(`/api/patients/${CURRENT_PATIENT_ID}/medications`).then((r) => r.json());
  const m = meds.find((x) => x.medId === medId);
  if (!m) return;

  document.getElementById('modalTitle').textContent = 'แก้ไขรายการยา';
  document.getElementById('medId').value = m.medId;
  document.getElementById('medName').value = m.medName;
  document.getElementById('dosage').value = m.dosage;
  document.getElementById('instruction').value = m.instruction || '';
  document.getElementById('mealTag').value = m.mealTag || 'มื้อเช้า';
  document.getElementById('time').value = m.time;
  document.getElementById('repeatType').value = m.repeatType;
  document.getElementById('intervalDays').value = m.intervalDays || 1;
  document.getElementById('startDate').value = m.startDate || '';
  document.getElementById('endDate').value = m.endDate || '';
  document.querySelectorAll('.dayChk').forEach((c) => (c.checked = (m.repeatDays || []).includes(c.value)));
  updateRepeatFieldsVisibility();
  modal.classList.remove('hidden');
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const medId = document.getElementById('medId').value;
  const payload = {
    medName: document.getElementById('medName').value,
    dosage: document.getElementById('dosage').value,
    instruction: document.getElementById('instruction').value,
    mealTag: document.getElementById('mealTag').value,
    time: document.getElementById('time').value,
    repeatType: document.getElementById('repeatType').value,
    repeatDays: Array.from(document.querySelectorAll('.dayChk:checked')).map((c) => c.value),
    intervalDays: Number(document.getElementById('intervalDays').value) || 1,
    startDate: document.getElementById('startDate').value,
    endDate: document.getElementById('endDate').value || null
  };

  if (medId) {
    await fetch(`/api/medications/${medId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } else {
    await fetch(`/api/patients/${CURRENT_PATIENT_ID}/medications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  modal.classList.add('hidden');
  refreshDashboard();
};

async function deleteMed(medId) {
  if (!confirm('ยืนยันลบรายการยานี้หรือไม่?')) return;
  await fetch(`/api/medications/${medId}`, { method: 'DELETE' });
  refreshDashboard();
}

initLiff();
