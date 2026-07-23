const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const crypto = require('crypto');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'attendance.db');

fs.mkdirSync(dataDir, { recursive: true });

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
});

const qrSessions = new Map();
const authTokens = new Map();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function ensureAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-auth-token'];
  const user = authTokens.get(token);
  if (!user || user.role !== 'admin') {
    return res.status(401).json({ error: 'No autorizado. Inicia sesión como administrador.' });
  }
  req.user = user;
  return next();
}

function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        location TEXT,
        createdAt TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document TEXT UNIQUE,
        fullName TEXT NOT NULL,
        username TEXT UNIQUE,
        passwordHash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        createdAt TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS attendance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branchId INTEGER NOT NULL,
        employeeId TEXT NOT NULL,
        employeeName TEXT NOT NULL,
        employeeEmail TEXT,
        scannedAt TEXT NOT NULL,
        scanDate TEXT NOT NULL,
        deviceInfo TEXT,
        source TEXT NOT NULL DEFAULT 'qr',
        qrToken TEXT,
        attendanceType TEXT DEFAULT 'entrada',
        verified INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT,
        FOREIGN KEY(branchId) REFERENCES branches(id)
      )
    `);

    db.run('ALTER TABLE attendance_records ADD COLUMN attendanceType TEXT DEFAULT "entrada"', (err) => {
      if (err && !/duplicate column/i.test(err.message)) {
        console.warn('No se pudo agregar attendanceType:', err.message);
      }
    });

    db.run('ALTER TABLE attendance_records ADD COLUMN verified INTEGER NOT NULL DEFAULT 0', (err) => {
      if (err && !/duplicate column/i.test(err.message)) {
        console.warn('No se pudo agregar verified:', err.message);
      }
    });

    db.run(`
      INSERT OR IGNORE INTO branches (id, name, location, createdAt)
      VALUES (1, 'Sede Central', 'Bogotá', ?)`, [new Date().toISOString()]
    );

    const adminPasswordHash = hashPassword('admin123');
    db.run(`
      INSERT OR IGNORE INTO users (document, fullName, username, passwordHash, role, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['0000000000', 'Administrador', 'admin', adminPasswordHash, 'admin', new Date().toISOString()]);
  });
}

function getDeviceInfo(req) {
  const userAgent = req.headers['user-agent'] || 'Desconocido';
  const browser = /chrome|crios/i.test(userAgent) ? 'Chrome' : /firefox/i.test(userAgent) ? 'Firefox' : /safari/i.test(userAgent) ? 'Safari' : /edg/i.test(userAgent) ? 'Edge' : 'Otro';
  const platform = /android/i.test(userAgent) ? 'Android' : /iphone|ipad|ipod/i.test(userAgent) ? 'iOS' : /windows/i.test(userAgent) ? 'Windows' : /mac/i.test(userAgent) ? 'macOS' : 'Otro';

  return {
    userAgent,
    browser,
    platform,
    ip: req.ip || 'N/A',
    language: req.headers['accept-language'] || 'N/A',
  };
}

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto']?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'Servicio de asistencia activo' });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });
  }

  const passwordHash = hashPassword(password);
  db.get('SELECT * FROM users WHERE username = ? AND passwordHash = ?', [username, passwordHash], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = randomUUID();
    authTokens.set(token, user);
    return res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
      },
    });
  });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-auth-token'];
  const user = authTokens.get(token);
  if (!user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, fullName: user.fullName } });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-auth-token'];
  if (token) {
    authTokens.delete(token);
  }
  return res.json({ ok: true });
});

app.get('/api/branches', (_req, res) => {
  db.all('SELECT * FROM branches ORDER BY id ASC', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/branches', ensureAdmin, (req, res) => {
  const { name, location } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'El nombre de la sede es obligatorio' });
  }

  const createdAt = new Date().toISOString();
  db.run('INSERT INTO branches (name, location, createdAt) VALUES (?, ?, ?)', [name, location || '', createdAt], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.status(201).json({ id: this.lastID, name, location, createdAt });
  });
});

app.post('/api/qr', (req, res) => {
  const { branchId, attendanceType } = req.body;
  if (!branchId) {
    return res.status(400).json({ error: 'Falta la sede para generar el QR' });
  }

  const token = randomUUID();
  const payload = `${getBaseUrl(req)}/?module=scan&token=${token}`;

  qrSessions.set(token, {
    branchId,
    attendanceType: attendanceType || 'entrada',
    createdAt: new Date().toISOString(),
  });

  QRCode.toDataURL(payload, { width: 240, margin: 1 })
    .then((image) => {
      res.json({ token, payload, image });
    })
    .catch((err) => {
      res.status(500).json({ error: err.message });
    });
});

app.post('/api/attendance/scan', (req, res) => {
  const { token, employeeId, employeeName } = req.body;
  if (!token || !employeeId || !employeeName) {
    return res.status(400).json({ error: 'Faltan datos para registrar la asistencia' });
  }

  const session = qrSessions.get(token);
  if (!session) {
    return res.status(404).json({ error: 'QR no válido o expirado' });
  }

  const now = new Date();
  const scannedAt = now.toISOString();
  const scanDate = now.toISOString().split('T')[0];
  const deviceInfo = JSON.stringify(getDeviceInfo(req));

  db.get('SELECT id FROM attendance_records WHERE employeeId = ? AND scanDate = ? AND attendanceType = ?', [employeeId, scanDate, session.attendanceType || 'entrada'], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un registro de este tipo para hoy.' });
    }

    db.run(
      `
        INSERT INTO attendance_records (
          branchId, employeeId, employeeName, employeeEmail, scannedAt, scanDate, deviceInfo, source, qrToken, attendanceType, verified, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'qr', ?, ?, 0, ?)
      `,
      [session.branchId, employeeId, employeeName, '', scannedAt, scanDate, deviceInfo, token, session.attendanceType || 'entrada', scannedAt],
      function (insertErr) {
        if (insertErr) {
          return res.status(500).json({ error: insertErr.message });
        }
        qrSessions.delete(token);
        return res.status(201).json({ ok: true, message: 'Asistencia registrada correctamente', id: this.lastID });
      }
    );
  });
});

app.get('/api/attendance', (_req, res) => {
  const query = `
    SELECT ar.*, b.name AS branchName
    FROM attendance_records ar
    LEFT JOIN branches b ON ar.branchId = b.id
    ORDER BY ar.scannedAt DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.json(rows);
  });
});

app.post('/api/attendance/:id/verify', ensureAdmin, (req, res) => {
  const { verified } = req.body;
  db.run('UPDATE attendance_records SET verified = ? WHERE id = ?', [verified ? 1 : 0, req.params.id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.json({ ok: true, updated: this.changes });
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDatabase();

app.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});
