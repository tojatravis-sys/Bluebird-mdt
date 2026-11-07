'use strict';

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('Brak prawidłowego SESSION_SECRET. Ustaw go w Render.');
  process.exit(1);
}

const db = new Database(path.join(DATA_DIR, 'bluebird.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  badge TEXT DEFAULT '',
  rank TEXT DEFAULT 'Funkcjonariusz',
  department TEXT DEFAULT 'KPP Lubin',
  role_group TEXT DEFAULT 'Funkcjonariusz',
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dob TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  wanted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT UNIQUE NOT NULL,
  model TEXT DEFAULT '',
  color TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  status TEXT DEFAULT 'Zarejestrowany'
);

CREATE TABLE IF NOT EXISTS citations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  charge TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  officer TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'Interwencja',
  officer TEXT NOT NULL,
  narrative TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  callsign TEXT NOT NULL,
  officers TEXT DEFAULT '',
  status TEXT DEFAULT 'Dostępny',
  area TEXT DEFAULT 'Lubin'
);
`);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'bluebird.sid',
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: DATA_DIR
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const ranks = [
  'Posterunkowy',
  'Starszy posterunkowy',
  'Sierżant',
  'Starszy sierżant',
  'Sierżant sztabowy',
  'Młodszy aspirant',
  'Aspirant',
  'Starszy aspirant',
  'Aspirant sztabowy',
  'Podkomisarz',
  'Komisarz',
  'Nadkomisarz',
  'Podinspektor',
  'Młodszy inspektor',
  'Inspektor',
  'Nadinspektor',
  'Generalny inspektor',
  'Komendant',
  'Zastępca Komendanta'
];

const auth = (req, res, next) => {
  if (req.session.user) return next();
  res.status(401).json({ error: 'Zaloguj się ponownie.' });
};

const adminOnly = (req, res, next) => {
  if (req.session.user?.roleGroup === 'Komendantura') return next();
  res.status(403).json({ error: 'Dostęp tylko dla Komendantury.' });
};

const userCount = () =>
  db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// Sprawdzenie pierwszego uruchomienia
app.get('/api/status', (req, res) => {
  res.json({
    needsSetup: userCount() === 0,
    authenticated: !!req.session.user
  });
});

// Utworzenie pierwszego konta Komendantury
app.post('/api/setup', (req, res) => {
  if (userCount() !== 0) {
    return res.status(403).json({ error: 'Konto zostało już utworzone.' });
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Nieprawidłowy login.' });
  }

  if (password.length < 12) {
    return res.status(400).json({
      error: 'Hasło musi mieć co najmniej 12 znaków.'
    });
  }

  const result = db.prepare(`
    INSERT INTO users
    (username,password_hash,display_name,badge,rank,department,role_group)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    username,
    bcrypt.hashSync(password, 12),
    username,
    'ADMIN',
    'Komendant',
    'KPP Lubin',
    'Komendantura'
  );

  req.session.user = {
    id: Number(result.lastInsertRowid),
    username,
    displayName: username,
    badge: 'ADMIN',
    rank: 'Komendant',
    department: 'KPP Lubin',
    roleGroup: 'Komendantura'
  };

  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Błąd sesji.' });
    res.json({ ok: true, user: req.session.user });
  });
});

// Logowanie
app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  const user = db.prepare(
    'SELECT * FROM users WHERE username=? AND active=1'
  ).get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({
      error: 'Nieprawidłowy login lub hasło.'
    });
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Błąd sesji.' });

    req.session.user = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      badge: user.badge,
      rank: user.rank,
      department: user.department,
      roleGroup: user.role_group
    };

    req.session.save(saveErr => {
      if (saveErr) return res.status(500).json({ error: 'Błąd zapisu sesji.' });
      res.json(req.session.user);
    });
  });
});

app.get('/api/me', (req, res) => {
  res.json(req.session.user || null);
});

app.post('/api/logout', auth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('bluebird.sid');
    res.json({ ok: true });
  });
});

// Pulpit
app.get('/api/summary', auth, (req, res) => {
  res.json({
    people: db.prepare('SELECT COUNT(*) n FROM people').get().n,
    wanted: db.prepare('SELECT COUNT(*) n FROM people WHERE wanted=1').get().n,
    vehicles: db.prepare('SELECT COUNT(*) n FROM vehicles').get().n,
    citations: db.prepare('SELECT COUNT(*) n FROM citations').get().n,
    reports: db.prepare('SELECT COUNT(*) n FROM reports').get().n,
    units: db.prepare("SELECT COUNT(*) n FROM units WHERE status='Dostępny'").get().n
  });
});

// Moduły służbowe
const modules = {
  people: {
    fields: ['name', 'dob', 'address', 'notes', 'wanted'],
    search: ['name', 'address']
  },
  vehicles: {
    fields: ['plate', 'model', 'color', 'owner', 'status'],
    search: ['plate', 'model', 'owner']
  },
  citations: {
    fields: ['person', 'charge', 'amount', 'officer'],
    search: ['person', 'charge', 'officer']
  },
  reports: {
    fields: ['title', 'type', 'officer', 'narrative'],
    search: ['title', 'type', 'officer', 'narrative']
  },
  units: {
    fields: ['callsign', 'officers', 'status', 'area'],
    search: ['callsign', 'officers', 'area']
  }
};

for (const [name, config] of Object.entries(modules)) {
  app.get('/api/' + name, auth, (req, res) => {
    const q = String(req.query.q || '').slice(0, 100);
    let sql = `SELECT * FROM ${name}`;
    let params = [];

    if (q) {
      sql += ' WHERE ' + config.search.map(f => `${f} LIKE ?`).join(' OR ');
      params = config.search.map(() => `%${q}%`);
    }

    res.json(db.prepare(sql + ' ORDER BY id DESC LIMIT 300').all(...params));
  });

  app.post('/api/' + name, auth, (req, res) => {
    const data = req.body || {};
    const fields = config.fields.filter(f => data[f] !== undefined);

    if (!fields.length) {
      return res.status(400).json({ error: 'Brak danych.' });
    }

    const values = fields.map(f =>
      f === 'wanted' ? (data[f] ? 1 : 0) : data[f]
    );

    try {
      db.prepare(
        `INSERT INTO ${name} (${fields.join(',')})
         VALUES (${fields.map(() => '?').join(',')})`
      ).run(...values);

      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'Nie udało się zapisać wpisu.' });
    }
  });

  app.delete('/api/' + name + '/:id', auth, (req, res) => {
    db.prepare(`DELETE FROM ${name} WHERE id=?`)
      .run(Number(req.params.id));
    res.json({ ok: true });
  });
}

// Zarządzanie kontami — tylko Komendantura
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare(`
    SELECT id,username,display_name,badge,rank,department,role_group,active
    FROM users ORDER BY id
  `).all());
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const d = req.body || {};
  const username = String(d.username || '').trim();
  const password = String(d.password || '');

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Nieprawidłowy login.' });
  }

  if (password.length < 10) {
    return res.status(400).json({ error: 'Hasło musi mieć minimum 10 znaków.' });
  }

  if (!ranks.includes(d.rank)) {
    return res.status(400).json({ error: 'Nieprawidłowy stopień.' });
  }

  const group = d.role_group === 'Komendantura'
    ? 'Komendantura'
    : 'Funkcjonariusz';

  try {
    db.prepare(`
      INSERT INTO users
      (username,password_hash,display_name,badge,rank,department,role_group)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      username,
      bcrypt.hashSync(password, 12),
      String(d.display_name || username),
      String(d.badge || ''),
      d.rank,
      'KPP Lubin',
      group
    );

    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Ten login jest już zajęty.' });
  }
});

app.patch('/api/users/:id/active', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);

  if (id === req.session.user.id) {
    return res.status(400).json({ error: 'Nie możesz zablokować własnego konta.' });
  }

  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);

  if (!target) return res.status(404).json({ error: 'Nie znaleziono konta.' });

  const active = req.body?.active ? 1 : 0;

  if (
    !active &&
    target.role_group === 'Komendantura' &&
    db.prepare("SELECT COUNT(*) n FROM users WHERE role_group='Komendantura' AND active=1").get().n <= 1
  ) {
    return res.status(400).json({ error: 'Musi pozostać aktywne konto Komendantury.' });
  }

  db.prepare('UPDATE users SET active=? WHERE id=?').run(active, id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);

  if (id === req.session.user.id) {
    return res.status(400).json({ error: 'Nie możesz usunąć własnego konta.' });
  }

  const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);

  if (!target) return res.status(404).json({ error: 'Nie znaleziono konta.' });

  if (
    target.role_group === 'Komendantura' &&
    db.prepare("SELECT COUNT(*) n FROM users WHERE role_group='Komendantura'").get().n <= 1
  ) {
    return res.status(400).json({ error: 'Musi pozostać konto Komendantury.' });
  }

  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

// Pliki strony
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Bluebird MDT KPP Lubin działa na porcie ${PORT}`);
});
