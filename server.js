'use strict';

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Brak SESSION_SECRET lub jest za krótki. Ustaw go w zmiennych środowiskowych.');
  process.exit(1);
}

const db = new Database(path.join(DATA_DIR, 'bluebird.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: '1mb' }));

// --------------------------------------------------
// BAZA DANYCH I MIGRACJE
// --------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    badge TEXT DEFAULT '',
    rank TEXT DEFAULT 'Funkcjonariusz',
    department TEXT DEFAULT 'KPP Lubin',
    role_group TEXT DEFAULT 'Funkcjonariusz',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    dob TEXT DEFAULT '',
    address TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    wanted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT NOT NULL UNIQUE,
    model TEXT DEFAULT '',
    color TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    status TEXT DEFAULT 'Brak informacji'
  );

  CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person TEXT DEFAULT '',
    charge TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    officer TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT '',
    type TEXT DEFAULT '',
    officer TEXT DEFAULT '',
    narrative TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    callsign TEXT NOT NULL,
    officers TEXT DEFAULT '',
    status TEXT DEFAULT 'Dostępny',
    area TEXT DEFAULT ''
  );
`);

function getColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function addColumn(table, column, definition) {
  if (!getColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Uzupełnianie starszej bazy bez usuwania dotychczasowych danych.
const migrations = {
  users: {
    display_name: "TEXT DEFAULT ''",
    badge: "TEXT DEFAULT ''",
    rank: "TEXT DEFAULT 'Funkcjonariusz'",
    department: "TEXT DEFAULT 'KPP Lubin'",
    role_group: "TEXT DEFAULT 'Funkcjonariusz'",
    active: 'INTEGER DEFAULT 1',
    created_at: 'TEXT'
  },
  people: {
    first_name: "TEXT DEFAULT ''",
    last_name: "TEXT DEFAULT ''",
    pesel: "TEXT DEFAULT ''",
    phone: "TEXT DEFAULT ''",
    documents: "TEXT DEFAULT ''",
    verification_status: "TEXT DEFAULT 'Niezweryfikowane'"
  },
  vehicles: {
    brand: "TEXT DEFAULT ''",
    notes: "TEXT DEFAULT ''",
    person_id: 'INTEGER'
  },
  citations: {
    date: "TEXT DEFAULT ''",
    notes: "TEXT DEFAULT ''",
    person_id: 'INTEGER'
  },
  reports: {
    date: "TEXT DEFAULT ''",
    status: "TEXT DEFAULT 'Otwarty'",
    person_id: 'INTEGER'
  },
  units: {
    vehicle: "TEXT DEFAULT ''",
    notes: "TEXT DEFAULT ''"
  }
};

for (const [table, columns] of Object.entries(migrations)) {
  for (const [column, definition] of Object.entries(columns)) {
    addColumn(table, column, definition);
  }
}

// --------------------------------------------------
// KONFIGURACJA MODUŁÓW
// --------------------------------------------------

const modules = {
  people: {
    table: 'people',
    fields: [
      'first_name',
      'last_name',
      'pesel',
      'dob',
      'address',
      'phone',
      'documents',
      'notes',
      'wanted',
      'verification_status'
    ],
    required: ['first_name', 'last_name']
  },
  vehicles: {
    table: 'vehicles',
    fields: [
      'plate',
      'brand',
      'model',
      'color',
      'owner',
      'status',
      'notes',
      'person_id'
    ],
    required: ['plate']
  },
  citations: {
    table: 'citations',
    fields: [
      'person',
      'charge',
      'amount',
      'officer',
      'date',
      'notes',
      'person_id'
    ],
    required: ['person', 'charge']
  },
  reports: {
    table: 'reports',
    fields: [
      'title',
      'type',
      'officer',
      'narrative',
      'date',
      'status',
      'person_id'
    ],
    required: ['title']
  },
  units: {
    table: 'units',
    fields: [
      'callsign',
      'officers',
      'status',
      'area',
      'vehicle',
      'notes'
    ],
    required: ['callsign']
  }
};

function cleanText(value, maxLength = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

function cleanRecord(moduleName, body) {
  const config = modules[moduleName];
  const result = {};

  for (const field of config.fields) {
    if (body[field] !== undefined) {
      if (field === 'wanted') {
        result[field] = body[field] ? 1 : 0;
      } else if (field === 'person_id') {
        const value = Number(body[field]);
        result[field] = Number.isInteger(value) && value > 0 ? value : null;
      } else if (field === 'amount') {
        const value = Number(body[field]);
        result[field] = Number.isFinite(value) && value >= 0 ? value : 0;
      } else {
        result[field] = cleanText(body[field], field === 'notes' || field === 'narrative' ? 5000 : 500);
      }
    }
  }

  if (moduleName === 'people') {
    const firstName = result.first_name ?? cleanText(body.first_name, 100);
    const lastName = result.last_name ?? cleanText(body.last_name, 100);

    if (firstName || lastName) {
      result.name = `${firstName} ${lastName}`.trim();
    }
  }

  return result;
}

// --------------------------------------------------
// SESJE I LOGOWANIE
// --------------------------------------------------

app.use(session({
  name: 'bluebird.sid',
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

function currentUser(req) {
  if (!req.session.user) return null;

  return {
    id: req.session.user.id,
    username: req.session.user.username,
    displayName: req.session.user.displayName,
    badge: req.session.user.badge,
    rank: req.session.user.rank,
    department: req.session.user.department,
    roleGroup: req.session.user.roleGroup
  };
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Zaloguj się, aby kontynuować.' });
  }

  const user = db.prepare(
    'SELECT active FROM users WHERE id = ?'
  ).get(req.session.user.id);

  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Konto jest nieaktywne.' });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (req.session.user?.roleGroup !== 'Komendantura') {
    return res.status(403).json({ error: 'Brak uprawnień Komendantury.' });
  }

  next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Wystąpił błąd serwera.' });
    }
  };
}

// --------------------------------------------------
// STATUS I PIERWSZA KONFIGURACJA
// --------------------------------------------------

app.get('/api/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

  res.json({
    needsSetup: count === 0,
    authenticated: Boolean(req.session.user),
    user: currentUser(req)
  });
});

app.post('/api/setup', asyncRoute(async (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;

  if (count > 0) {
    return res.status(403).json({
      error: 'Konto Komendantury zostało już utworzone.'
    });
  }

  const username = cleanText(req.body.username, 40).toLowerCase();
  const password = String(req.body.password || '');

  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) {
    return res.status(400).json({
      error: 'Login musi mieć 3–40 znaków: litery, cyfry, kropka, myślnik lub podkreślenie.'
    });
  }

  if (password.length < 12) {
    return res.status(400).json({
      error: 'Hasło musi mieć co najmniej 12 znaków.'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = db.prepare(`
    INSERT INTO users
    (username, password_hash, display_name, badge, rank, department, role_group, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    username,
    passwordHash,
    'Komendantura',
    '',
    'Komendant',
    'KPP Lubin',
    'Komendantura'
  );

  req.session.regenerate(error => {
    if (error) {
      console.error(error);
      return res.status(500).json({ error: 'Nie udało się rozpocząć sesji.' });
    }

    req.session.user = {
      id: result.lastInsertRowid,
      username,
      displayName: 'Komendantura',
      badge: '',
      rank: 'Komendant',
      department: 'KPP Lubin',
      roleGroup: 'Komendantura'
    };

    req.session.save(saveError => {
      if (saveError) {
        console.error(saveError);
        return res.status(500).json({ error: 'Nie udało się zapisać sesji.' });
      }

      res.json({ success: true, user: currentUser(req) });
    });
  });
}));

// --------------------------------------------------
// LOGOWANIE I WYLOGOWANIE
// --------------------------------------------------

app.post('/api/login', asyncRoute(async (req, res) => {
  const username = cleanText(req.body.username, 40).toLowerCase();
  const password = String(req.body.password || '');

  const user = db.prepare(`
    SELECT * FROM users WHERE username = ?
  `).get(username);

  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Nieprawidłowy login lub hasło.' });
  }

  req.session.regenerate(error => {
    if (error) {
      console.error(error);
      return res.status(500).json({ error: 'Nie udało się rozpocząć sesji.' });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      badge: user.badge || '',
      rank: user.rank || 'Funkcjonariusz',
      department: user.department || 'KPP Lubin',
      roleGroup: user.role_group || 'Funkcjonariusz'
    };

    req.session.save(saveError => {
      if (saveError) {
        console.error(saveError);
        return res.status(500).json({ error: 'Nie udało się zapisać sesji.' });
      }

      res.json({ success: true, user: currentUser(req) });
    });
  });
}));

app.get('/api/me', (req, res) => {
  res.json(currentUser(req));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({ error: 'Nie udało się wylogować.' });
    }

    res.clearCookie('bluebird.sid');
    res.json({ success: true });
  });
});

// --------------------------------------------------
// PULPIT
// --------------------------------------------------

app.get('/api/summary', requireLogin, (req, res) => {
  const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;

  res.json({
    people: count('people'),
    vehicles: count('vehicles'),
    citations: count('citations'),
    reports: count('reports'),
    units: count('units')
  });
});

// --------------------------------------------------
// REJESTRY: ODCZYT, DODAWANIE, EDYCJA, USUWANIE
// --------------------------------------------------

for (const [moduleName, config] of Object.entries(modules)) {
  const endpoint = `/api/${moduleName}`;
  const table = config.table;

  app.get(endpoint, requireLogin, asyncRoute((req, res) => {
    const search = cleanText(req.query.q, 100);

    let records;

    if (search) {
      const searchableFields = {
        people: ['name', 'pesel', 'address', 'phone'],
        vehicles: ['plate', 'brand', 'model', 'owner'],
        citations: ['person', 'charge', 'officer'],
        reports: ['title', 'type', 'officer', 'narrative'],
        units: ['callsign', 'officers', 'area']
      }[moduleName];

      const where = searchableFields.map(field => `${field} LIKE ?`).join(' OR ');
      const params = searchableFields.map(() => `%${search}%`);

      records = db.prepare(
        `SELECT * FROM ${table} WHERE ${where} ORDER BY id DESC LIMIT 200`
      ).all(...params);
    } else {
      records = db.prepare(
        `SELECT * FROM ${table} ORDER BY id DESC LIMIT 200`
      ).all();
    }

    res.json(records);
  }));

  app.post(endpoint, requireLogin, asyncRoute((req, res) => {
    const data = cleanRecord(moduleName, req.body);

    for (const field of config.required) {
      if (!data[field] || !String(data[field]).trim()) {
        return res.status(400).json({
          error: `Uzupełnij wymagane pole: ${field}.`
        });
      }
    }

    const columns = Object.keys(data);

    if (moduleName === 'people') {
      columns.push('name');
      data.name = data.name || '';
    }

    const uniqueColumns = [...new Set(columns)];
    const values = uniqueColumns.map(column => data[column]);

    try {
      const result = db.prepare(`
        INSERT INTO ${table} (${uniqueColumns.join(', ')})
        VALUES (${uniqueColumns.map(() => '?').join(', ')})
      `).run(...values);

      const record = db.prepare(
        `SELECT * FROM ${table} WHERE id = ?`
      ).get(result.lastInsertRowid);

      res.status(201).json(record);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Taki wpis już istnieje.' });
      }
      throw error;
    }
  }));

  app.patch(`${endpoint}/:id`, requireLogin, asyncRoute((req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Nieprawidłowy identyfikator.' });
    }

    const data = cleanRecord(moduleName, req.body);

    if (moduleName === 'people' &&
        (data.first_name !== undefined || data.last_name !== undefined)) {
      const existing = db.prepare(
        'SELECT first_name, last_name FROM people WHERE id = ?'
      ).get(id);

      if (!existing) {
        return res.status(404).json({ error: 'Nie znaleziono wpisu.' });
      }

      const firstName = data.first_name ?? existing.first_name;
      const lastName = data.last_name ?? existing.last_name;
      data.name = `${firstName} ${lastName}`.trim();
    }

    const columns = Object.keys(data);

    if (!columns.length) {
      return res.status(400).json({ error: 'Brak danych do zmiany.' });
    }

    const result = db.prepare(`
      UPDATE ${table}
      SET ${columns.map(column => `${column} = ?`).join(', ')}
      WHERE id = ?
    `).run(...columns.map(column => data[column]), id);

    if (!result.changes) {
      return res.status(404).json({ error: 'Nie znaleziono wpisu.' });
    }

    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  }));

  app.delete(`${endpoint}/:id`, requireLogin, asyncRoute((req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Nieprawidłowy identyfikator.' });
    }

    const result = db.prepare(
      `DELETE FROM ${table} WHERE id = ?`
    ).run(id);

    if (!result.changes) {
      return res.status(404).json({ error: 'Nie znaleziono wpisu.' });
    }

    res.json({ success: true });
  }));
}

// --------------------------------------------------
// SPRAWDZANIE OBYWATELI I POWIĄZANE WPISY RP
// --------------------------------------------------

app.get('/api/citizens/search', requireLogin, asyncRoute((req, res) => {
  const query = cleanText(req.query.q, 100);

  if (!query) {
    return res.json([]);
  }

  const results = db.prepare(`
    SELECT * FROM people
    WHERE name LIKE ?
       OR first_name LIKE ?
       OR last_name LIKE ?
       OR pesel LIKE ?
    ORDER BY id DESC
    LIMIT 50
  `).all(...Array(4).fill(`%${query}%`));

  res.json(results);
}));

app.get('/api/citizens/:id', requireLogin, asyncRoute((req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Nieprawidłowy identyfikator.' });
  }

  const person = db.prepare(
    'SELECT * FROM people WHERE id = ?'
  ).get(id);

  if (!person) {
    return res.status(404).json({ error: 'Nie znaleziono obywatela.' });
  }

  const citations = db.prepare(`
    SELECT * FROM citations
    WHERE person_id = ? OR person = ?
    ORDER BY id DESC
  `).all(id, person.name);

  const vehicles = db.prepare(`
    SELECT * FROM vehicles
    WHERE person_id = ? OR owner = ?
    ORDER BY id DESC
  `).all(id, person.name);

  const reports = db.prepare(`
    SELECT * FROM reports
    WHERE person_id = ?
    ORDER BY id DESC
  `).all(id);

  res.json({ person, citations, vehicles, reports });
}));

// --------------------------------------------------
// ZARZĄDZANIE DOSTĘPAMI — TYLKO KOMENDANTURA
// --------------------------------------------------

const allowedRanks = [
  "Posterunkowy",
  "Starszy posterunkowy",
  "Sierżant",
  "Starszy sierżant",
  "Sierżant sztabowy",
  "Młodszy aspirant",
  "Aspirant",
  "Starszy aspirant",
  "Aspirant sztabowy",
  "Podkomisarz",
  "Komisarz",
  "Nadkomisarz",
  "Podinspektor",
  "Młodszy inspektor",
  "Inspektor",
  "Nadinspektor",
  "Generalny inspektor"
];

app.get('/api/users', requireLogin, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT
      id, username, display_name, badge, rank,
      department, role_group, active, created_at
    FROM users
    ORDER BY id ASC
  `).all();

  res.json(users);
});

app.post('/api/users', requireLogin, requireAdmin, asyncRoute(async (req, res) => {
  const username = cleanText(req.body.username, 40).toLowerCase();
  const password = String(req.body.password || '');
  const displayName = cleanText(req.body.display_name, 100);
  const badge = cleanText(req.body.badge, 30);
  const rank = cleanText(req.body.rank, 60);

  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) {
    return res.status(400).json({ error: 'Nieprawidłowy login.' });
  }

  if (password.length < 12) {
    return res.status(400).json({
      error: 'Hasło musi mieć co najmniej 12 znaków.'
    });
  }

  if (!allowedRanks.includes(rank)) {
    return res.status(400).json({ error: 'Nieprawidłowy stopień.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = db.prepare(`
      INSERT INTO users
      (username, password_hash, display_name, badge, rank, department, role_group, active)
      VALUES (?, ?, ?, ?, ?, 'KPP Lubin', 'Funkcjonariusz', 1)
    `).run(
      username,
      passwordHash,
      displayName || username,
      badge,
      rank
    );

    const created = db.prepare(`
      SELECT id, username, display_name, badge, rank,
             department, role_group, active
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(created);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ten login jest już zajęty.' });
    }
    throw error;
  }
}));

app.patch('/api/users/:id/active', requireLogin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const active = req.body.active;

  if (!Number.isInteger(id) || id < 1 || typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Nieprawidłowe dane.' });
  }

  if (id === req.session.user.id && !active) {
    return res.status(400).json({
      error: 'Nie możesz dezaktywować własnego konta.'
    });
  }

  const result = db.prepare(
    'UPDATE users SET active = ? WHERE id = ?'
  ).run(active ? 1 : 0, id);

  if (!result.changes) {
    return res.status(404).json({ error: 'Nie znaleziono konta.' });
  }

  res.json({ success: true });
});

app.delete('/api/users/:id', requireLogin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Nieprawidłowy identyfikator.' });
  }

  if (id === req.session.user.id) {
    return res.status(400).json({
      error: 'Nie możesz usunąć własnego konta.'
    });
  }

  const user = db.prepare(
    'SELECT role_group FROM users WHERE id = ?'
  ).get(id);

  if (!user) {
    return res.status(404).json({ error: 'Nie znaleziono konta.' });
  }

  if (user.role_group === 'Komendantura') {
    return res.status(403).json({
      error: 'Nie można usunąć konta Komendantury.'
    });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

// --------------------------------------------------
// PLIKI STRONY
// --------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Nie znaleziono endpointu.' });
  }

  res.status(404).send('Nie znaleziono strony.');
});

// --------------------------------------------------
// START SERWERA
// --------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bluebird MDT działa na porcie ${PORT}`);
});
