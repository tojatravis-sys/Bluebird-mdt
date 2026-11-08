
'use strict';

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Brak SESSION_SECRET lub jest za krótki. Ustaw go w zmiennych środowiskowych.');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('Brak DATABASE_URL. Dodaj connection string Neon w zmiennych środowiskowych Render.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'bluebird.sid',
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
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

// --------------------------------------------------
// BAZA DANYCH POSTGRESQL
// --------------------------------------------------

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      badge TEXT DEFAULT '',
      rank TEXT DEFAULT 'Funkcjonariusz',
      department TEXT DEFAULT 'KPP Lubin',
      role_group TEXT DEFAULT 'Funkcjonariusz',
      active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      name TEXT DEFAULT '',
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      pesel TEXT DEFAULT '',
      dob TEXT DEFAULT '',
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      documents TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      wanted INTEGER DEFAULT 0,
      verification_status TEXT DEFAULT 'Niezweryfikowane'
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      plate TEXT NOT NULL UNIQUE,
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      color TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      status TEXT DEFAULT 'Brak informacji',
      notes TEXT DEFAULT '',
      person_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS citations (
      id SERIAL PRIMARY KEY,
      person TEXT DEFAULT '',
      charge TEXT DEFAULT '',
      amount DOUBLE PRECISION DEFAULT 0,
      officer TEXT DEFAULT '',
      date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      person_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      title TEXT DEFAULT '',
      type TEXT DEFAULT '',
      officer TEXT DEFAULT '',
      narrative TEXT DEFAULT '',
      date TEXT DEFAULT '',
      status TEXT DEFAULT 'Otwarty',
      person_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS units (
      id SERIAL PRIMARY KEY,
      callsign TEXT NOT NULL,
      officers TEXT DEFAULT '',
      status TEXT DEFAULT 'Dostępny',
      area TEXT DEFAULT '',
      vehicle TEXT DEFAULT '',
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      PRIMARY KEY (sid)
    );

    CREATE INDEX IF NOT EXISTS user_sessions_expire_idx
    ON user_sessions (expire);
  `);
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

const searchableFields = {
  people: ['name', 'pesel', 'address', 'phone'],
  vehicles: ['plate', 'brand', 'model', 'owner'],
  citations: ['person', 'charge', 'officer'],
  reports: ['title', 'type', 'officer', 'narrative'],
  units: ['callsign', 'officers', 'area']
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
        result[field] =
          Number.isInteger(value) && value > 0 ? value : null;
      } else if (field === 'amount') {
        const value = Number(body[field]);
        result[field] =
          Number.isFinite(value) && value >= 0 ? value : 0;
      } else {
        result[field] = cleanText(
          body[field],
          field === 'notes' || field === 'narrative' ? 5000 : 500
        );
      }
    }
  }

  if (moduleName === 'people') {
    const firstName =
      result.first_name ?? cleanText(body.first_name, 100);
    const lastName =
      result.last_name ?? cleanText(body.last_name, 100);

    if (firstName || lastName) {
      result.name = `${firstName} ${lastName}`.trim();
    }
  }

  return result;
}

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

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'Zaloguj się, aby kontynuować.'
    });
  }

  pool.query(
    'SELECT active FROM users WHERE id = $1',
    [req.session.user.id]
  )
    .then(({ rows }) => {
      if (!rows[0] || !rows[0].active) {
        req.session.destroy(() => {});
        return res.status(401).json({
          error: 'Konto jest nieaktywne.'
        });
      }

      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  if (req.session.user?.roleGroup !== 'Komendantura') {
    return res.status(403).json({
      error: 'Brak uprawnień Komendantury.'
    });
  }

  next();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error =>
      error ? reject(error) : resolve()
    );
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error =>
      error ? reject(error) : resolve()
    );
  });
}

// --------------------------------------------------
// STATUS I PIERWSZA KONFIGURACJA
// --------------------------------------------------

app.get('/api/status', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users'
  );

  res.json({
    needsSetup: rows[0].count === 0,
    authenticated: Boolean(req.session.user),
    user: currentUser(req)
  });
}));

app.post('/api/setup', asyncRoute(async (req, res) => {
  const username =
    cleanText(req.body.username, 40).toLowerCase();
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
  const client = await pool.connect();
  let created;

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(72819461)');

    const count = await client.query(
      'SELECT COUNT(*)::int AS count FROM users'
    );

    if (count.rows[0].count > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Konto Komendantury zostało już utworzone.'
      });
    }

    const result = await client.query(`
      INSERT INTO users
      (username, password_hash, display_name, badge, rank,
       department, role_group, active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
      RETURNING id
    `, [
      username,
      passwordHash,
      'Komendantura',
      '',
      'Komendant',
      'KPP Lubin',
      'Komendantura'
    ]);

    created = result.rows[0];
    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Ten login jest już zajęty.'
      });
    }

    throw error;

  } finally {
    client.release();
  }

  await regenerateSession(req);

  req.session.user = {
    id: created.id,
    username,
    displayName: 'Komendantura',
    badge: '',
    rank: 'Komendant',
    department: 'KPP Lubin',
    roleGroup: 'Komendantura'
  };

  await saveSession(req);

  res.json({
    success: true,
    user: currentUser(req)
  });
}));

// --------------------------------------------------
// LOGOWANIE I WYLOGOWANIE
// --------------------------------------------------

app.post('/api/login', asyncRoute(async (req, res) => {
  const username =
    cleanText(req.body.username, 40).toLowerCase();
  const password = String(req.body.password || '');

  const result = await pool.query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );

  const user = result.rows[0];

  if (
    !user ||
    !user.active ||
    !(await bcrypt.compare(password, user.password_hash))
  ) {
    return res.status(401).json({
      error: 'Nieprawidłowy login lub hasło.'
    });
  }

  await regenerateSession(req);

  req.session.user = {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    badge: user.badge || '',
    rank: user.rank || 'Funkcjonariusz',
    department: user.department || 'KPP Lubin',
    roleGroup: user.role_group || 'Funkcjonariusz'
  };

  await saveSession(req);

  res.json({
    success: true,
    user: currentUser(req)
  });
}));

app.get('/api/me', (req, res) => {
  res.json(currentUser(req));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({
        error: 'Nie udało się wylogować.'
      });
    }

    res.clearCookie('bluebird.sid');
    res.json({ success: true });
  });
});

// --------------------------------------------------
// PULPIT
// --------------------------------------------------

app.get('/api/summary', requireLogin, asyncRoute(async (req, res) => {
  const tables = [
    'people',
    'vehicles',
    'citations',
    'reports',
    'units'
  ];

  const counts = await Promise.all(
    tables.map(async table => {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM ${table}`
      );

      return result.rows[0].count;
    })
  );

  res.json({
    people: counts[0],
    vehicles: counts[1],
    citations: counts[2],
    reports: counts[3],
    units: counts[4]
  });
}));

// --------------------------------------------------
// REJESTRY: ODCZYT, DODAWANIE, EDYCJA, USUWANIE
// --------------------------------------------------

for (const [moduleName, config] of Object.entries(modules)) {
  const endpoint = `/api/${moduleName}`;
  const table = config.table;

  app.get(
    endpoint,
    requireLogin,
    asyncRoute(async (req, res) => {
      const search = cleanText(req.query.q, 100);
      let result;

      if (search) {
        const fields = searchableFields[moduleName];

        const where = fields
          .map((field, index) => `${field} ILIKE $${index + 1}`)
          .join(' OR ');

        const params = fields.map(() => `%${search}%`);

        result = await pool.query(
          `SELECT * FROM ${table}
           WHERE ${where}
           ORDER BY id DESC LIMIT 200`,
          params
        );
      } else {
        result = await pool.query(
          `SELECT * FROM ${table}
           ORDER BY id DESC LIMIT 200`
        );
      }

      res.json(result.rows);
    })
  );

  app.post(
    endpoint,
    requireLogin,
    asyncRoute(async (req, res) => {
      const data = cleanRecord(moduleName, req.body);

      for (const field of config.required) {
        if (!data[field] || !String(data[field]).trim()) {
          return res.status(400).json({
            error: `Uzupełnij wymagane pole: ${field}.`
          });
        }
      }

      const columns = Object.keys(data);

      if (!columns.length) {
        return res.status(400).json({
          error: 'Brak danych do zapisania.'
        });
      }

      const placeholders = columns
        .map((_, index) => `$${index + 1}`)
        .join(', ');

      const values = columns.map(column => data[column]);

      try {
        const result = await pool.query(
          `INSERT INTO ${table} (${columns.join(', ')})
           VALUES (${placeholders})
           RETURNING *`,
          values
        );

        res.status(201).json(result.rows[0]);

      } catch (error) {
        if (error.code === '23505') {
          return res.status(409).json({
            error: 'Taki wpis już istnieje.'
          });
        }

        throw error;
      }
    })
  );

  app.patch(
    `${endpoint}/:id`,
    requireLogin,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: 'Nieprawidłowy identyfikator.'
        });
      }

      const data = cleanRecord(moduleName, req.body);

      if (
        moduleName === 'people' &&
        (data.first_name !== undefined ||
         data.last_name !== undefined)
      ) {
        const existingResult = await pool.query(
          'SELECT first_name, last_name FROM people WHERE id = $1',
          [id]
        );

        const existing = existingResult.rows[0];

        if (!existing) {
          return res.status(404).json({
            error: 'Nie znaleziono wpisu.'
          });
        }

        const firstName =
          data.first_name ?? existing.first_name;
        const lastName =
          data.last_name ?? existing.last_name;

        data.name = `${firstName} ${lastName}`.trim();
      }

      const columns = Object.keys(data);

      if (!columns.length) {
        return res.status(400).json({
          error: 'Brak danych do zmiany.'
        });
      }

      const assignments = columns
        .map((column, index) => `${column} = $${index + 1}`)
        .join(', ');

      const values = columns.map(column => data[column]);
      values.push(id);

      const result = await pool.query(
        `UPDATE ${table}
         SET ${assignments}
         WHERE id = $${values.length}
         RETURNING *`,
        values
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Nie znaleziono wpisu.'
        });
      }

      res.json(result.rows[0]);
    })
  );

  app.delete(
    `${endpoint}/:id`,
    requireLogin,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: 'Nieprawidłowy identyfikator.'
        });
      }

      const result = await pool.query(
        `DELETE FROM ${table} WHERE id = $1`,
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Nie znaleziono wpisu.'
        });
      }

      res.json({ success: true });
    })
  );
}

// --------------------------------------------------
// SPRAWDZANIE OBYWATELI I POWIĄZANE WPISY
// --------------------------------------------------

app.get(
  '/api/citizens/search',
  requireLogin,
  asyncRoute(async (req, res) => {
    const query = cleanText(req.query.q, 100);

    if (!query) return res.json([]);

    const pattern = `%${query}%`;

    const result = await pool.query(`
      SELECT * FROM people
      WHERE name ILIKE $1
         OR first_name ILIKE $2
         OR last_name ILIKE $3
         OR pesel ILIKE $4
      ORDER BY id DESC
      LIMIT 50
    `, [pattern, pattern, pattern, pattern]);

    res.json(result.rows);
  })
);

app.get(
  '/api/citizens/:id',
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'Nieprawidłowy identyfikator.'
      });
    }

    const personResult = await pool.query(
      'SELECT * FROM people WHERE id = $1',
      [id]
    );

    const person = personResult.rows[0];

    if (!person) {
      return res.status(404).json({
        error: 'Nie znaleziono obywatela.'
      });
    }

    const [citations, vehicles, reports] = await Promise.all([
      pool.query(
        `SELECT * FROM citations
         WHERE person_id = $1 OR person = $2
         ORDER BY id DESC`,
        [id, person.name]
      ),

      pool.query(
        `SELECT * FROM vehicles
         WHERE person_id = $1 OR owner = $2
         ORDER BY id DESC`,
        [id, person.name]
      ),

      pool.query(
        `SELECT * FROM reports
         WHERE person_id = $1
         ORDER BY id DESC`,
        [id]
      )
    ]);

    res.json({
      person,
      citations: citations.rows,
      vehicles: vehicles.rows,
      reports: reports.rows
    });
  })
);

// --------------------------------------------------
// ZARZĄDZANIE DOSTĘPAMI — TYLKO KOMENDANTURA
// --------------------------------------------------

const allowedRanks = [
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
  'Generalny inspektor'
];

app.get(
  '/api/users',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const result = await pool.query(`
      SELECT id, username, display_name, badge, rank,
             department, role_group, active, created_at
      FROM users
      ORDER BY id ASC
    `);

    res.json(result.rows);
  })
);

app.post(
  '/api/users',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const username =
      cleanText(req.body.username, 40).toLowerCase();

    const password = String(req.body.password || '');
    const displayName =
      cleanText(req.body.display_name, 100);
    const badge = cleanText(req.body.badge, 30);
    const rank = cleanText(req.body.rank, 60);

    if (!/^[a-z0-9_.-]{3,40}$/.test(username)) {
      return res.status(400).json({
        error: 'Nieprawidłowy login.'
      });
    }

    if (password.length < 12) {
      return res.status(400).json({
        error: 'Hasło musi mieć co najmniej 12 znaków.'
      });
    }

    if (!allowedRanks.includes(rank)) {
      return res.status(400).json({
        error: 'Nieprawidłowy stopień.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const result = await pool.query(`
        INSERT INTO users
        (username, password_hash, display_name, badge, rank,
         department, role_group, active)
        VALUES ($1, $2, $3, $4, $5,
                'KPP Lubin', 'Funkcjonariusz', 1)
        RETURNING id, username, display_name, badge, rank,
                  department, role_group, active
      `, [
        username,
        passwordHash,
        displayName || username,
        badge,
        rank
      ]);

      res.status(201).json(result.rows[0]);

    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'Ten login jest już zajęty.'
        });
      }

      throw error;
    }
  })
);

app.patch(
  '/api/users/:id/active',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const active = req.body.active;

    if (
      !Number.isInteger(id) ||
      id < 1 ||
      typeof active !== 'boolean'
    ) {
      return res.status(400).json({
        error: 'Nieprawidłowe dane.'
      });
    }

    if (id === req.session.user.id && !active) {
      return res.status(400).json({
        error: 'Nie możesz dezaktywować własnego konta.'
      });
    }

    const result = await pool.query(
      'UPDATE users SET active = $1 WHERE id = $2',
      [active ? 1 : 0, id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Nie znaleziono konta.'
      });
    }

    res.json({ success: true });
  })
);

app.delete(
  '/api/users/:id',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'Nieprawidłowy identyfikator.'
      });
    }

    if (id === req.session.user.id) {
      return res.status(400).json({
        error: 'Nie możesz usunąć własnego konta.'
      });
    }

    const userResult = await pool.query(
      'SELECT role_group FROM users WHERE id = $1',
      [id]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        error: 'Nie znaleziono konta.'
      });
    }

    if (user.role_group === 'Komendantura') {
      return res.status(403).json({
        error: 'Nie można usunąć konta Komendantury.'
      });
    }

    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [id]
    );

    res.json({ success: true });
  })
);

// --------------------------------------------------
// PLIKI STRONY I OBSŁUGA BŁĘDÓW
// --------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Nie znaleziono endpointu.'
    });
  }

  res.status(404).send('Nie znaleziono strony.');
});

app.use((error, req, res, next) => {
  console.error('Błąd serwera:', error);

  if (res.headersSent) return next(error);

  res.status(500).json({
    error: 'Wystąpił błąd serwera.'
  });
});

// --------------------------------------------------
// START SERWERA
// --------------------------------------------------

async function start() {
  try {
    await pool.query('SELECT 1');
    await initializeDatabase();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `Bluebird MDT działa na porcie ${PORT} i korzysta z PostgreSQL.`
      );
    });

  } catch (error) {
    console.error(
      'Nie udało się połączyć z PostgreSQL lub przygotować bazy:',
      error
    );

    process.exit(1);
  }
}

start();

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
