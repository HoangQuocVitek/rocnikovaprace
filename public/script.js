const socket = io();


const scheduleBody = document.getElementById('scheduleBody');
const scheduleTable = document.getElementById('scheduleTable');
const daySelect = document.getElementById('daySelect'); // Added day selector

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


const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
let scheduleData = [];
let groupedByClass = {};
let subFlagPerPeriod = {};
let selectedCell = null;



document.addEventListener('DOMContentLoaded', () => {
  initDaySelector();
  loadSchedule();
});


socket.on('substitution_added', () => {
  loadSchedule();
  hidePanel();
});
socket.on('substitution_removed', () => {
  loadSchedule();
  hidePanel();
});


function initDaySelector() {
  if (!daySelect) return;

  const todayIndex = new Date().getDay(); 
  let appDay = todayIndex;


  if (todayIndex === 0 || todayIndex === 6) {
    appDay = 1;
  }

  
  daySelect.value = appDay;

 
  daySelect.addEventListener('change', () => {
    loadSchedule();
  });
}


async function loadSchedule() {
  const currentDay = daySelect ? daySelect.value : 1;
  
 
  scheduleBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 20px;">Načítám data pro den ${currentDay}...</td></tr>`;

  try {
   
    const res = await fetch(`/api/rozvrh?den=${encodeURIComponent(currentDay)}`);
    
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    
    const data = await res.json();
    scheduleData = data;
    
    buildGroupings(data);
    renderTable();
    
  } catch (err) {
    scheduleBody.innerHTML = `<tr><td colspan="10" style="color:var(--danger); text-align:center;">Chyba při načítání: ${escapeHtml(err.message)}</td></tr>`;
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


  document.querySelectorAll('th.period').forEach(th => {
    const p = Number(th.dataset.period);
    if (subFlagPerPeriod[p]) th.classList.add('alert'); 
    else th.classList.remove('alert');
  });
}

function renderTable() {
  scheduleBody.innerHTML = '';
  const classes = Object.keys(groupedByClass).sort((a, b) => a.localeCompare(b, 'cs'));

  if (classes.length === 0) {
    scheduleBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color: var(--text-muted);">Žádná data pro tento den</td></tr>`;
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
        }
      }

      td.addEventListener('click', () => cellClicked(td));
      tr.appendChild(td);
    });

    scheduleBody.appendChild(tr);
  });
}


async function cellClicked(td) {
  const idrozvrh = td.dataset.idrozvrh;
  const period = Number(td.dataset.period);

  if (!idrozvrh) {

    return;
  }

  const lesson = scheduleData.find(l => String(l.idrozvrh) === String(idrozvrh));
  if (!lesson) return;

  selectedCell = { lesson, period };

  panelTitle.textContent = `Suplování — ${lesson.trida} #${lesson.hodina}`;
  infoClassHour.textContent = `${lesson.trida} — hodina ${lesson.hodina}`;
  infoOrigTeacher.textContent = `${lesson.ucitel_prijmeni || ''} ${lesson.ucitel_jmeno || ''}`.trim();
  infoSubTeacher.textContent = lesson.idsuplovani 
    ? `${lesson.suplujici_prijmeni || ''} ${lesson.suplujici_jmeno || ''}`.trim() 
    : '(žádný)';
  reasonInput.value = lesson.poznamka || '';


  deleteBtn.style.display = lesson.idsuplovani ? 'inline-block' : 'none';

  floatingControl.style.display = 'block';
  

  await loadAvailableTeachers(period);
}

async function loadAvailableTeachers(period) {
  subTeacherSelect.innerHTML = '<option>Načítám...</option>';
  
  const day = daySelect ? daySelect.value : 1;

  try {
    const res = await fetch(`/api/available_teachers/${period}?day=${day}`);
    if (!res.ok) throw new Error('Chyba API');
    
    const arr = await res.json();
    

    const originalTeacher = selectedCell && selectedCell.lesson
       ? `${selectedCell.lesson.ucitel_prijmeni} ${selectedCell.lesson.ucitel_jmeno}`.trim()
       : '';

    subTeacherSelect.innerHTML = '<option value="">-- Vyber suplujícího učitele --</option>';

    arr.forEach(t => {
       const fullName = `${t.ucitel_prijmeni} ${t.ucitel_jmeno}`.trim();
       if(fullName !== originalTeacher) {
         const opt = document.createElement('option');
         opt.value = JSON.stringify({ jmeno: t.ucitel_jmeno, prijmeni: t.ucitel_prijmeni });
         opt.textContent = fullName;
         subTeacherSelect.appendChild(opt);
       }
    });

    if (subTeacherSelect.options.length === 1) {
       const opt = document.createElement('option');
       opt.disabled = true;
       opt.textContent = "Žádní dostupní učitelé";
       subTeacherSelect.appendChild(opt);
    }

  } catch (err) {
    subTeacherSelect.innerHTML = '<option disabled>Chyba při načítání</option>';
    console.error(err);
  }
}

function hidePanel() {
  floatingControl.style.display = 'none';
  selectedCell = null;
}


closeBtn.addEventListener('click', hidePanel);

saveBtn.addEventListener('click', async () => {
  if (!selectedCell) return;
  
  const val = subTeacherSelect.value;
  if (!val) return alert('Vyberte suplujícího učitele.');
  
  let parsed;
  try {
    parsed = JSON.parse(val);
  } catch (e) {
    return alert('Neplatná data učitele.');
  }

  const payload = {
    idrozvrh: selectedCell.lesson.idrozvrh,
    suplujici_jmeno: parsed.jmeno,
    suplujici_prijmeni: parsed.prijmeni,
    poznamka: reasonInput.value.trim() || null
  };

  try {
    const res = await fetch('/api/suplovani', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || res.statusText);
    }


  } catch (err) {
    alert('Chyba při ukládání: ' + err.message);
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!selectedCell || !selectedCell.lesson.idsuplovani) return;
  if (!confirm('Opravdu zrušit toto suplování?')) return;


  const idToDelete = selectedCell.lesson.idsuplovani;

  try {
    const res = await fetch(`/api/suplovani/${idToDelete}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Chyba serveru');
  } catch (err) {
    alert('Chyba při mazání: ' + err.message);
  }
});

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}