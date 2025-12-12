// public/script.js (reverted to user's version)
const socket = io();

const scheduleBody = document.getElementById('scheduleBody');
const scheduleTable = document.getElementById('scheduleTable');

const floatingControl = document.getElementById('floatingControl');
const panelTitle = document.getElementById('panelTitle');
const infoClassHour = document.getElementById('infoClassHour');
const infoOrigTeacher = document.getElementById('infoOrigTeacher');
const infoSubTeacher = document.getElementById('infoSubTeacher');
const reasonInput = document.getElementById('reason');
const subTeacherSelect = document.getElementById('subTeacherSelect');
const saveBtn = document.getElementById('saveBtn');
const closeBtn = document.getElementById('closeBtn');
const deleteBtn = document.getElementById('deleteBtn');

const PERIODS = [1,2,3,4,5,6,7,8,9];

let scheduleData = []; 
let groupedByClass = {};
let subFlagPerPeriod = {}; 
let selectedCell = null; 

document.addEventListener('DOMContentLoaded', loadSchedule);

socket.on('substitution_added', () => {
  loadSchedule();
  hidePanel();
});
socket.on('substitution_removed', () => {
  loadSchedule();
  hidePanel();
});

async function loadSchedule() {
  try {
    const res = await fetch('/api/rozvrh');
    if (!res.ok) throw new Error('Chyba při načítání rozvrhu');
    const data = await res.json();
    scheduleData = data;
    buildGroupings(data);
    renderTable();
  } catch (err) {
    scheduleBody.innerHTML = `<tr><td colspan="10" style="color:red">Chyba: ${escapeHtml(err.message)}</td></tr>`;
    console.error('loadSchedule error', err);
  }
}

function buildGroupings(data) {
  groupedByClass = {};
  subFlagPerPeriod = {};
  PERIODS.forEach(p => subFlagPerPeriod[p] = false);

  data.forEach(item => {
    const tr = item.trida || '---';
    if (!groupedByClass[tr]) groupedByClass[tr] = { byPeriod: {} };
    groupedByClass[tr].byPeriod[item.hodina] = item;

    if (item.idsuplovani) subFlagPerPeriod[item.hodina] = true;
  });

  // update header alerts if header cells exist
  document.querySelectorAll('th.period').forEach(th => {
    const p = Number(th.dataset.period);
    if (subFlagPerPeriod[p]) th.classList.add('alert'); else th.classList.remove('alert');
  });
}

function renderTable() {
  scheduleBody.innerHTML = '';
  const classes = Object.keys(groupedByClass).sort((a,b) => a.localeCompare(b, 'cs'));

  if (classes.length === 0) {
    scheduleBody.innerHTML = `<tr><td colspan="10">Žádná data</td></tr>`;
    return;
  }

  classes.forEach(trida => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'class-name';
    tdName.textContent = trida;
    tr.appendChild(tdName);

    const byPeriod = groupedByClass[trida].byPeriod || {};

    PERIODS.forEach(p => {
      const td = document.createElement('td');
      td.className = 'cell';
      td.dataset.trida = trida;
      td.dataset.period = p;

      const lesson = byPeriod[p];
      if (!lesson) {
        td.innerHTML = '-';
        td.classList.add('empty');
      } else {

        const teacherName = `${lesson.ucitel_prijmeni || ''} ${lesson.ucitel_jmeno || ''}`.trim();
        td.innerHTML = `
          <span class="teacher">${escapeHtml(teacherName)}</span>
          <span class="subject">${escapeHtml(lesson.predmet || '-')}</span>
          <span class="room">${escapeHtml(lesson.misto || '-')}</span>
        `;
        if (lesson.idrozvrh !== undefined) td.dataset.idrozvrh = lesson.idrozvrh;

        if (lesson.idsuplovani) {
          td.classList.add('subbed');
          const badge = document.createElement('div');
          badge.className = 'sub-indicator';
          const subName = `${lesson.suplujici_prijmeni || ''} ${lesson.suplujici_jmeno || ''}`.trim();
          badge.textContent = `SUPLUJE: ${subName}`;
          td.appendChild(badge);

          const note = lesson.poznamka ? ` — ${lesson.poznamka}` : '';
          td.title = `SUPLUJE: ${subName}${note}`;
        } else {
          td.title = '';
        }
      }

      td.addEventListener('click', () => cellClicked(td));
      tr.appendChild(td);
    });

    scheduleBody.appendChild(tr);
  });
}

async function cellClicked(td) {
  const trida = td.dataset.trida;
  const period = Number(td.dataset.period);
  const idrozvrh = td.dataset.idrozvrh;
  if (!idrozvrh) {
    alert('Tato buňka je volná (volno).');
    return;
  }

  const lesson = scheduleData.find(l => String(l.idrozvrh) === String(idrozvrh));
  if (!lesson) { alert('Chyba: nepodařilo se načíst lekci'); return; }

  selectedCell = { lesson, trida, period };

  panelTitle.textContent = `Suplování — ${lesson.trida} #${lesson.hodina}`;
  infoClassHour.textContent = `${lesson.trida} — hodina ${lesson.hodina}`;
  infoOrigTeacher.textContent = `${lesson.ucitel_prijmeni || ''} ${lesson.ucitel_jmeno || ''}`.trim();
  infoSubTeacher.textContent = lesson.idsuplovani ? `${lesson.suplujici_prijmeni || ''} ${lesson.suplujici_jmeno || ''}`.trim() : '(žádný)';
  reasonInput.value = lesson.poznamka || '';

  deleteBtn.style.display = lesson.idsuplovani ? 'inline-block' : 'none';

  floatingControl.style.display = 'block';
  await loadAvailableTeachers(period);
}

async function loadAvailableTeachers(period) {
  subTeacherSelect.innerHTML = '<option>Načítám...</option>';
  try {
    // include day parameter if you want (defaults to 1 server-side)
    const res = await fetch(`/api/available_teachers/${encodeURIComponent(period)}`);
    if (!res.ok) throw new Error('Chyba při načítání učitelů');
    const arr = await res.json();

    const busy = new Set();
    scheduleData.forEach(l => {
      if (Number(l.hodina) === Number(period)) {
        if (l.ucitel_prijmeni && l.ucitel_jmeno) {
          busy.add((String(l.ucitel_prijmeni) + ' ' + String(l.ucitel_jmeno)).trim());
        }
        if (l.idsuplovani && l.suplujici_prijmeni && l.suplujici_jmeno) {
          busy.add((String(l.suplujici_prijmeni) + ' ' + String(l.suplujici_jmeno)).trim());
        }
      }
    });

    const originalTeacherFullName = selectedCell && selectedCell.lesson
      ? `${selectedCell.lesson.ucitel_prijmeni || ''} ${selectedCell.lesson.ucitel_jmeno || ''}`.trim()
      : null;

    const filtered = Array.isArray(arr) ? arr.filter(t => {
      const fullname = `${t.ucitel_prijmeni || ''} ${t.ucitel_jmeno || ''}`.trim();
      if (!fullname) return false;
      if (fullname === originalTeacherFullName) return false;
      return !busy.has(fullname);
    }) : [];

    subTeacherSelect.innerHTML = '<option value="">-- Vyber suplujícího učitele --</option>';

    if (!filtered.length) {
      subTeacherSelect.innerHTML += '<option disabled>Nikdo není volný pro tuto hodinu</option>';
      return;
    }

    filtered.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ jmeno: t.ucitel_jmeno, prijmeni: t.ucitel_prijmeni });
      opt.textContent = `${t.ucitel_prijmeni || ''} ${t.ucitel_jmeno || ''}`.trim();
      subTeacherSelect.appendChild(opt);
    });
  } catch (err) {
    subTeacherSelect.innerHTML = '<option disabled>Chyba při načítání</option>';
    console.error('loadAvailableTeachers error', err);
  }
}

function hidePanel() {
  floatingControl.style.display = 'none';
  selectedCell = null;
}

closeBtn.addEventListener('click', () => hidePanel());

saveBtn.addEventListener('click', async () => {
  if (!selectedCell) return alert('Vyberte nejprve buňku.');
  const val = subTeacherSelect.value;
  if (!val) return alert('Vyber suplujícího učitele.');
  let parsed;
  try {
    parsed = JSON.parse(val);
  } catch (e) {
    return alert('Neplatná volba učitele.');
  }
  const poznamka = reasonInput.value.trim();

  const payload = {
    idrozvrh: selectedCell.lesson.idrozvrh,
    suplujici_jmeno: parsed.jmeno,
    suplujici_prijmeni: parsed.prijmeni,
    poznamka: poznamka || null
  };

  try {
    const res = await fetch('/api/suplovani', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return alert('Chyba při ukládání: ' + (json && (json.message || json.error) ? (json.message || json.error) : JSON.stringify(json)));

    await loadSchedule();
    hidePanel();
    alert('Suplování uloženo.');
  } catch (err) {
    alert('Síťová chyba: ' + (err.message || err));
    console.error('save error', err);
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!selectedCell) return;
  if (!confirm('Opravdu zrušit suplování?')) return;
  const lesson = selectedCell.lesson;
  const idToDelete = lesson.idsuplovani ? lesson.idsuplovani : lesson.idrozvrh;
  try {
    const res = await fetch('/api/suplovani/' + encodeURIComponent(idToDelete), { method: 'DELETE' });
    const json = await res.json().catch(() => null);
    if (!res.ok) return alert('Chyba při mazání: ' + (json && (json.message || json.error) ? (json.message || json.error) : JSON.stringify(json)));
    await loadSchedule();
    hidePanel();
    alert('Suplování zrušeno.');
  } catch (err) {
    alert('Síťová chyba: ' + (err.message || err));
    console.error('delete error', err);
  }
});

function escapeHtml(s){ if (s===null||s===undefined) return ''; return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
