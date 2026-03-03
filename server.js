const express = require('express');
const http = require('http');
const path = require('path');
const mysql = require('mysql2');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.11.5',
  user: process.env.DB_USER || 'zadani2025_13',
  password: process.env.DB_PASS || 'T#hQ$z+zARpc+R',
  database: process.env.DB_NAME || 'rocnikovka2025_zadani_13',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
}).promise();

(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('DB pool OK');
  } catch (e) {
    console.error('DB pool error (DB queries will fail):', e.message || e);
  }
})();

io.on('connection', socket => {
  console.log('Socket connected', socket.id);
  socket.on('disconnect', () => console.log('Socket disconnected', socket.id));
});


app.get('/api/rozvrh', async (req, res) => {
  const den = req.query.den ? Number(req.query.den) : null;

  try {
  
    let sql = `
      SELECT
        g.id_grid AS idrozvrh,
        g.den,
        g.hodina,
        g.trida,
        g.id_data,
        d.ucitel_jmeno,
        d.ucitel_prijmeni,
        d.predmet,
        d.misto
      FROM rozvrh_grid g
      LEFT JOIN rozvrh_data d ON g.id_data = d.id_data
    `;
    const params = [];
    if (Number.isInteger(den)) {
      sql += ' WHERE g.den = ? ';
      params.push(den);
    }
    sql += ' ORDER BY g.trida, g.hodina, g.den;';

    const [rows] = await pool.query(sql, params);

    if (!rows || rows.length === 0) return res.json([]);

  
    const [suplRows] = await pool.query('SELECT * FROM suplovani');

    const suplCols = suplRows && suplRows.length ? Object.keys(suplRows[0]) : [];
    const has = name => suplCols.includes(name);

    let matchKey = null; 
    if (has('id_grid')) matchKey = 'id_grid';
    else if (has('id_data')) matchKey = 'id_data';
    else {
      
      const candidate = suplCols.find(c => /grid|rozvrh|id_rozvrh|idRozvrh/i.test(c));
      if (candidate) matchKey = candidate;
    }

    if (!matchKey && suplCols.length && suplRows.length) {
      const gridIds = new Set(rows.map(r => Number(r.idrozvrh)).filter(n => !Number.isNaN(n)));
      for (const col of suplCols) {
      
        const found = suplRows.some(s => {
          const v = s[col];
          if (v === null || v === undefined) return false;
          const n = Number(v);
          return !Number.isNaN(n) && gridIds.has(n);
        });
        if (found) {
          matchKey = col;
          break;
        }
      }
    }

    
    const suplMap = new Map(); 
    if (matchKey) {
      for (const s of suplRows) {
        const keyVal = s[matchKey];
        if (keyVal === null || keyVal === undefined) continue;
        suplMap.set(String(keyVal), s);
      }
    } else {

      if (has('idsuplovani')) {
        for (const s of suplRows) {
          const keyVal = s['idsuplovani'];
          if (keyVal === null || keyVal === undefined) continue;
          suplMap.set(String(keyVal), s);
        }
      }
    }


    const out = rows.map(r => {
      const copy = { ...r, idsuplovani: null, suplujici_jmeno: null, suplujici_prijmeni: null, poznamka: null };
    
      if (matchKey) {
        const s = suplMap.get(String(r.idrozvrh));
        if (s) {
          copy.idsuplovani = s.idsuplovani ?? null;
          copy.suplujici_jmeno = s.suplujici_jmeno ?? s.suplujici_jmeno ?? null;
          copy.suplujici_prijmeni = s.suplujici_prijmeni ?? s.suplujici_prijmeni ?? null;
          copy.poznamka = s.poznamka ?? null;
          return copy;
        }
      }
 
      if (suplMap.has(String(r.idrozvrh))) {
        const s = suplMap.get(String(r.idrozvrh));
        copy.idsuplovani = s.idsuplovani ?? null;
        copy.suplujici_jmeno = s.suplujici_jmeno ?? null;
        copy.suplujici_prijmeni = s.suplujici_prijmeni ?? null;
        copy.poznamka = s.poznamka ?? null;
        return copy;
      }

    
      return copy;
    });

    return res.json(out);
  } catch (e) {
    console.error('GET /api/rozvrh error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});


app.get('/api/available_teachers/:period', async (req, res) => {
  const period = parseInt(req.params.period, 10);
  const day = parseInt(req.query.day, 10) || 1;
  if (isNaN(period) || isNaN(day)) return res.status(400).json({ error: 'Invalid day/period' });

  try {
    const sql = `
      SELECT rd.id_data, rd.ucitel_jmeno, rd.ucitel_prijmeni
      FROM rozvrh_data rd
      WHERE rd.id_data NOT IN (
        SELECT g.id_data
        FROM rozvrh_grid g
        WHERE g.den = ? AND g.hodina = ? AND g.id_data IS NOT NULL
      )
      ORDER BY rd.ucitel_prijmeni, rd.ucitel_jmeno;
    `;
    const [rows] = await pool.query(sql, [day, period]);
    return res.json(rows);
  } catch (e) {
    console.error('GET /api/available_teachers error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/suplovani', async (req, res) => {
  const { idrozvrh, suplujici_jmeno, suplujici_prijmeni, poznamka } = req.body || {};
  if (!idrozvrh || !suplujici_jmeno || !suplujici_prijmeni) return res.status(400).json({ error: 'Missing fields' });

  try {

    const [cols] = await pool.query("SHOW COLUMNS FROM suplovani");
    const colNames = (cols || []).map(c => c.Field);
    const hasIdGrid = colNames.includes('id_grid');

    if (hasIdGrid) {
      const [existing] = await pool.query('SELECT idsuplovani FROM suplovani WHERE id_grid = ? LIMIT 1', [idrozvrh]);
      if (existing && existing.length) {
        await pool.query('UPDATE suplovani SET suplujici_jmeno = ?, suplujici_prijmeni = ?, poznamka = ? WHERE id_grid = ?', [suplujici_jmeno, suplujici_prijmeni, poznamka || null, idrozvrh]);
        io.emit('substitution_added');
        return res.json({ message: 'updated' });
      }
      await pool.query('INSERT INTO suplovani (id_grid, suplujici_jmeno, suplujici_prijmeni, poznamka) VALUES (?, ?, ?, ?)', [idrozvrh, suplujici_jmeno, suplujici_prijmeni, poznamka || null]);
      io.emit('substitution_added');
      return res.json({ message: 'inserted' });
    } else {
  
      await pool.query('INSERT INTO suplovani (suplujici_jmeno, suplujici_prijmeni, poznamka) VALUES (?, ?, ?)', [suplujici_jmeno, suplujici_prijmeni, `auto-for-grid:${idrozvrh} ${poznamka || ''}`]);
      io.emit('substitution_added');
      return res.json({ message: 'inserted_no_id_grid' });
    }
  } catch (e) {
    console.error('POST /api/suplovani error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});


app.delete('/api/suplovani/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {

    const [cols] = await pool.query("SHOW COLUMNS FROM suplovani");
    const colNames = (cols || []).map(c => c.Field);
    if (colNames.includes('id_grid')) {
      const [result] = await pool.query('DELETE FROM suplovani WHERE idsuplovani = ? OR id_grid = ?', [id, id]);
      io.emit('substitution_removed');
      return res.json({ message: 'deleted', affected: result.affectedRows });
    } else {

      const numeric = Number(id);
      if (!Number.isNaN(numeric)) {
        const [result] = await pool.query('DELETE FROM suplovani WHERE idsuplovani = ?', [numeric]);
        io.emit('substitution_removed');
        return res.json({ message: 'deleted_by_idsuplovani', affected: result.affectedRows });
      }
      return res.status(400).json({ error: 'Cannot delete: no id_grid and provided id is not numeric' });
    }
  } catch (e) {
    console.error('DELETE /api/suplovani error:', e);
    return res.status(500).json({ error: 'DB error' });
  }
});

server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
