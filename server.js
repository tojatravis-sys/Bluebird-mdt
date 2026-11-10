
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
// BAZA DANYCH I MIGRACJE
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

    CREATE TABLE IF NOT EXISTS interventions (
      id SERIAL PRIMARY KEY,
      incident_number TEXT UNIQUE,
      address TEXT NOT NULL,
      reporter TEXT DEFAULT '',
      description TEXT NOT NULL,
      priority TEXT DEFAULT 'Normalny',
      status TEXT NOT NULL DEFAULT 'Oczekuje na przydział',
      unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
      callsign TEXT DEFAULT '',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intervention_history (
      id SERIAL PRIMARY KEY,
      intervention_id INTEGER NOT NULL
        REFERENCES interventions(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      details TEXT DEFAULT '',
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role_group TEXT DEFAULT 'Funkcjonariusz';

    ALTER TABLE interventions
      ADD COLUMN IF NOT EXISTS incident_number TEXT;

    ALTER TABLE interventions
      ADD COLUMN IF NOT EXISTS callsign TEXT DEFAULT '';

    ALTER TABLE interventions
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

    UPDATE interventions
    SET completed_at = updated_at
    WHERE status = 'Zakończona'
      AND completed_at IS NULL;

    CREATE INDEX IF NOT EXISTS interventions_status_idx
      ON interventions(status);

    CREATE INDEX IF NOT EXISTS interventions_unit_idx
      ON interventions(unit_id);

    CREATE INDEX IF NOT EXISTS intervention_history_intervention_idx
      ON intervention_history(intervention_id, created_at DESC);
  `);
}

// --------------------------------------------------
// POMOCNICZE
// --------------------------------------------------

function cleanText(value, maxLength = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
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
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
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
  ).then(({ rows }) => {
    if (!rows[0] || !rows[0].active) {
      req.session.destroy(() => {});
      return res.status(401).json({
        error: 'Konto jest nieaktywne.'
      });
    }

    next();
  }).catch(next);
}

function requireAdmin(req, res, next) {
  if (req.session.user?.roleGroup !== 'Komendantura') {
    return res.status(403).json({
      error: 'Brak uprawnień Komendantury.'
    });
  }

  next();
}

function requireDispatcher(req, res, next) {
  const role = req.session.user?.roleGroup;

  if (role !== 'DYŻURNY' && role !== 'Komendantura') {
    return res.status(403).json({
      error: 'Dostęp tylko dla Dyżurnego lub Komendantury.'
    });
  }

  next();
}

function requireFunctionary(req, res, next) {
  const role = req.session.user?.roleGroup;

  if (role === 'DYŻURNY') {
    return res.status(403).json({
      error: 'Konto Dyżurnego nie ma dostępu do tego modułu.'
    });
  }

  next();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function cleanRecord(moduleName, body) {
  const config = modules[moduleName];
  const result = {};

  for (const field of config.fields) {
    if (body[field] === undefined) continue;

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

const modules = {
  people: {
    table: 'people',
    fields: [
      'first_name','last_name','pesel','dob','address',
      'phone','documents','notes','wanted','verification_status'
    ],
    required: ['first_name','last_name']
  },

  vehicles: {
    table: 'vehicles',
    fields: [
      'plate','brand','model','color','owner',
      'status','notes','person_id'
    ],
    required: ['plate']
  },

  citations: {
    table: 'citations',
    fields: [
      'person','charge','amount','officer','date','notes','person_id'
    ],
    required: ['person','charge']
  },

  reports: {
    table: 'reports',
    fields: [
      'title','type','officer','narrative','date','status','person_id'
    ],
    required: ['title']
  },

  units: {
    table: 'units',
    fields: [
      'callsign','officers','status','area','vehicle','notes'
    ],
    required: ['callsign']
  }
};

const searchableFields = {
  people: ['name','pesel','address','phone'],
  vehicles: ['plate','brand','model','owner'],
  citations: ['person','charge','officer'],
  reports: ['title','type','officer','narrative'],
  units: ['callsign','officers','area']
};

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

const interventionStatuses = [
  'Oczekuje na przydział',
  'Przydzielona',
  'W drodze',
  'Na miejscu',
  'Zakończona'
];

const interventionPriorities = [
  'Niski',
  'Normalny',
  'Wysoki',
  'Pilny'
];

const activeInterventionStatuses = [
  'Przydzielona',
  'W drodze',
  'Na miejscu'
];

async function unitHasActiveIntervention(client, unitId, exceptInterventionId = null) {
  const result = await client.query(`
    SELECT 1
    FROM interventions
    WHERE unit_id = $1
      AND status = ANY($2::text[])
      AND ($3::integer IS NULL OR id <> $3)
    LIMIT 1
  `, [unitId, activeInterventionStatuses, exceptInterventionId]);

  return result.rowCount > 0;
}

function isUnitAvailable(unit) {
  if (typeof unit?.available_for_dispatch === 'boolean') {
    return unit.available_for_dispatch;
  }

  const status = String(unit?.status || '')
    .trim()
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return ['dostepny', 'wolny', 'available'].includes(status);
}

// --------------------------------------------------
// STATUS, SETUP, LOGOWANIE
// --------------------------------------------------

app.get('/api/status', asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS count FROM users'
  );

  res.json({
    needsSetup: result.rows[0].count === 0,
    authenticated: Boolean(req.session.user),
    user: currentUser(req)
  });
}));

app.post('/api/setup', asyncRoute(async (req, res) => {
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
        (username,password_hash,display_name,badge,rank,department,role_group,active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1)
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

app.post('/api/login', asyncRoute(async (req, res) => {
  const username = cleanText(req.body.username, 40).toLowerCase();
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

app.get(
  '/api/summary',
  requireLogin,
  requireFunctionary,
  asyncRoute(async (req, res) => {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM people) AS people,
        (SELECT COUNT(*)::int FROM vehicles) AS vehicles,
        (SELECT COUNT(*)::int FROM citations) AS citations,
        (SELECT COUNT(*)::int FROM reports) AS reports,
        (SELECT COUNT(*)::int FROM units) AS units
    `);

    res.json(result.rows[0]);
  })
);

// --------------------------------------------------
// MODUŁY
// --------------------------------------------------

for (const [moduleName, config] of Object.entries(modules)) {
  const endpoint = `/api/${moduleName}`;
  const table = config.table;

  const roleGuard = moduleName === 'units'
    ? ((req, res, next) => {
        if (
          req.session.user?.roleGroup === 'DYŻURNY' &&
          req.method !== 'GET'
        ) {
          return res.status(403).json({
            error: 'Dyżurny może tylko przeglądać patrole.'
          });
        }

        next();
      })
    : requireFunctionary;

  app.get(
    endpoint,
    requireLogin,
    roleGuard,
    asyncRoute(async (req, res) => {
      const search = cleanText(req.query.q, 100);
      let result;

      if (search) {
        const fields = searchableFields[moduleName];
        const where = fields
          .map((field, index) => `${field} ILIKE $${index + 1}`)
          .join(' OR ');

        result = await pool.query(
          `SELECT * FROM ${table}
           WHERE ${where}
           ORDER BY id DESC
           LIMIT 200`,
          fields.map(() => `%${search}%`)
        );
      } else if (moduleName === 'units') {
        result = await pool.query(`
          SELECT u.*,
            NOT EXISTS (
              SELECT 1
              FROM interventions i
              WHERE i.unit_id = u.id
                AND i.status = ANY($1::text[])
            ) AS available_for_dispatch
          FROM units u
          ORDER BY u.id DESC
          LIMIT 200
        `, [activeInterventionStatuses]);
      } else {
        result = await pool.query(
          `SELECT * FROM ${table} ORDER BY id DESC LIMIT 200`
        );
      }

      res.json(result.rows);
    })
  );

  app.post(
    endpoint,
    requireLogin,
    roleGuard,
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

      try {
        const result = await pool.query(
          `INSERT INTO ${table} (${columns.join(', ')})
           VALUES (${placeholders})
           RETURNING *`,
          columns.map(column => data[column])
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
    roleGuard,
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
        (data.first_name !== undefined || data.last_name !== undefined)
      ) {
        const existingResult = await pool.query(
          'SELECT first_name,last_name FROM people WHERE id = $1',
          [id]
        );

        const existing = existingResult.rows[0];

        if (!existing) {
          return res.status(404).json({
            error: 'Nie znaleziono wpisu.'
          });
        }

        data.name =
          `${data.first_name ?? existing.first_name} ${data.last_name ?? existing.last_name}`.trim();
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

  // Usuwanie wpisów. Patrolu przypisanego do aktywnej
  // interwencji nie można usunąć, dopóki interwencja trwa.
  app.delete(
    `${endpoint}/:id`,
    requireLogin,
    roleGuard,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({
          error: 'Nieprawidłowy identyfikator.'
        });
      }

      if (moduleName === 'units') {
        const activeIntervention = await pool.query(`
          SELECT id, incident_number
          FROM interventions
          WHERE unit_id = $1
            AND status = ANY($2::text[])
          LIMIT 1
        `, [id, activeInterventionStatuses]);

        if (activeIntervention.rowCount) {
          return res.status(409).json({
            error: 'Nie można usunąć patrolu przypisanego do aktywnej interwencji. Najpierw zakończ interwencję lub zmień jej przydział.'
          });
        }
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
// SPRAWDZANIE OBYWATELI
// --------------------------------------------------

app.get(
  '/api/citizens/search',
  requireLogin,
  requireFunctionary,
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
  requireFunctionary,
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
        'SELECT * FROM citations WHERE person_id = $1 OR person = $2 ORDER BY id DESC',
        [id, person.name]
      ),
      pool.query(
        'SELECT * FROM vehicles WHERE person_id = $1 OR owner = $2 ORDER BY id DESC',
        [id, person.name]
      ),
      pool.query(
        'SELECT * FROM reports WHERE person_id = $1 ORDER BY id DESC',
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
// ZARZĄDZANIE DOSTĘPAMI
// --------------------------------------------------

app.get(
  '/api/users',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const result = await pool.query(`
      SELECT id,username,display_name,badge,rank,department,
             role_group,active,created_at
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
    const username = cleanText(req.body.username, 40).toLowerCase();
    const password = String(req.body.password || '');
    const displayName = cleanText(req.body.display_name, 100);
    const badge = cleanText(req.body.badge, 30);
    const rank = cleanText(req.body.rank, 60);
    const roleGroup = cleanText(
      req.body.role_group || 'Funkcjonariusz',
      30
    );

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

    if (!['Funkcjonariusz', 'DYŻURNY'].includes(roleGroup)) {
      return res.status(400).json({
        error: 'Nieprawidłowy rodzaj konta.'
      });
    }

    if (
      roleGroup === 'Funkcjonariusz' &&
      !allowedRanks.includes(rank)
    ) {
      return res.status(400).json({
        error: 'Nieprawidłowy stopień.'
      });
    }

    const finalRank = roleGroup === 'DYŻURNY'
      ? (allowedRanks.includes(rank) ? rank : 'Dyżurny')
      : rank;

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const result = await pool.query(`
        INSERT INTO users
          (username,password_hash,display_name,badge,rank,department,role_group,active)
        VALUES ($1,$2,$3,$4,$5,'KPP Lubin',$6,1)
        RETURNING id,username,display_name,badge,rank,department,role_group,active
      `, [
        username,
        passwordHash,
        displayName || username,
        badge,
        finalRank,
        roleGroup
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
// INTERWENCJE — HISTORIA
// --------------------------------------------------

async function addInterventionHistory(
  client,
  interventionId,
  event,
  details,
  user
) {
  await client.query(`
    INSERT INTO intervention_history
      (intervention_id,event,details,actor_id,actor_name)
    VALUES ($1,$2,$3,$4,$5)
  `, [
    interventionId,
    event,
    details || '',
    user?.id || null,
    user?.displayName || user?.username || 'System'
  ]);
}

// --------------------------------------------------
// LISTA INTERWENCJI
// --------------------------------------------------

app.get(
  '/api/interventions',
  requireLogin,
  asyncRoute(async (req, res) => {
    const archive = req.query.archive === '1';

    const result = await pool.query(`
      SELECT i.*,
        u.callsign AS unit_callsign,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id',h.id,
              'event',h.event,
              'details',h.details,
              'actor_name',h.actor_name,
              'created_at',h.created_at
            )
            ORDER BY h.created_at ASC
          )
          FROM intervention_history h
          WHERE h.intervention_id = i.id
        ), '[]'::json) AS history
      FROM interventions i
      LEFT JOIN units u ON u.id = i.unit_id
      WHERE
        (
          $1::boolean = false
          AND (
            i.status <> 'Zakończona'
            OR i.completed_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
          )
        )
        OR
        (
          $1::boolean = true
          AND i.status = 'Zakończona'
          AND (
            i.completed_at IS NULL
            OR i.completed_at <= CURRENT_TIMESTAMP - INTERVAL '10 minutes'
          )
        )
      ORDER BY
        CASE WHEN i.status = 'Zakończona' THEN 1 ELSE 0 END,
        COALESCE(i.completed_at, i.updated_at) DESC,
        i.id DESC
      LIMIT 300
    `, [archive]);

    res.json(result.rows);
  })
);

// --------------------------------------------------
// TWORZENIE INTERWENCJI
// --------------------------------------------------

app.post(
  '/api/interventions',
  requireLogin,
  requireDispatcher,
  asyncRoute(async (req, res) => {
    const address = cleanText(req.body.address, 300);
    const reporter = cleanText(req.body.reporter, 150);
    const description = cleanText(req.body.description, 5000);
    const priority = cleanText(req.body.priority || 'Normalny', 30);

    const unitIdRaw = req.body.unit_id;
    const unitId =
      unitIdRaw === undefined || unitIdRaw === null || unitIdRaw === ''
        ? null
        : Number(unitIdRaw);

    if (!address || !description) {
      return res.status(400).json({
        error: 'Podaj adres i opis interwencji.'
      });
    }

    if (!interventionPriorities.includes(priority)) {
      return res.status(400).json({
        error: 'Nieprawidłowy priorytet.'
      });
    }

    if (
      unitId !== null &&
      (!Number.isInteger(unitId) || unitId < 1)
    ) {
      return res.status(400).json({
        error: 'Nieprawidłowy patrol.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      let unit = null;

      if (unitId !== null) {
        const unitResult = await client.query(
          'SELECT * FROM units WHERE id = $1 FOR UPDATE',
          [unitId]
        );

        unit = unitResult.rows[0];

        if (!unit) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Nie znaleziono wybranego patrolu.'
          });
        }

        if (await unitHasActiveIntervention(client, unit.id)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Wybrany patrol jest już przydzielony do aktywnej interwencji.'
          });
        }
      }

      const sequenceResult = await client.query(`
        SELECT nextval(
          pg_get_serial_sequence('interventions','id')
        ) AS next_id
      `);

      const nextId = Number(sequenceResult.rows[0].next_id);
      const incidentNumber =
        `INT-${String(nextId).padStart(5, '0')}`;

      const inserted = await client.query(`
        INSERT INTO interventions
          (id,incident_number,address,reporter,description,priority,
           status,unit_id,callsign,created_by,created_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
      `, [
        nextId,
        incidentNumber,
        address,
        reporter,
        description,
        priority,
        unit ? 'Przydzielona' : 'Oczekuje na przydział',
        unit ? unit.id : null,
        unit ? unit.callsign : '',
        req.session.user.id,
        req.session.user.displayName
      ]);

      const intervention = inserted.rows[0];

      if (unit) {
        await client.query(
          "UPDATE units SET status = 'Zajęty' WHERE id = $1",
          [unit.id]
        );

        await addInterventionHistory(
          client,
          intervention.id,
          'Przydzielono patrol',
          `Przydzielony patrol: ${unit.callsign}`,
          req.session.user
        );
      } else {
        await addInterventionHistory(
          client,
          intervention.id,
          'Utworzono interwencję',
          'Interwencja oczekuje na przydział patrolu.',
          req.session.user
        );
      }

      await client.query('COMMIT');
      res.status(201).json(intervention);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

// --------------------------------------------------
// ZMIANA STATUSU I PRZYDZIAŁU INTERWENCJI
// --------------------------------------------------

app.patch(
  '/api/interventions/:id',
  requireLogin,
  requireDispatcher,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const status = cleanText(req.body.status, 50);

    const hasUnitChange =
      Object.prototype.hasOwnProperty.call(req.body, 'unit_id');

    const unitIdRaw = req.body.unit_id;

    const newUnitId =
      unitIdRaw === null || unitIdRaw === '' || unitIdRaw === undefined
        ? null
        : Number(unitIdRaw);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        error: 'Nieprawidłowy identyfikator interwencji.'
      });
    }

    if (status && !interventionStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Nieprawidłowy status interwencji.'
      });
    }

    if (
      hasUnitChange &&
      newUnitId !== null &&
      (!Number.isInteger(newUnitId) || newUnitId < 1)
    ) {
      return res.status(400).json({
        error: 'Nieprawidłowy patrol.'
      });
    }

    if (!status && !hasUnitChange) {
      return res.status(400).json({
        error: 'Brak zmian do zapisania.'
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const currentResult = await client.query(
        'SELECT * FROM interventions WHERE id = $1 FOR UPDATE',
        [id]
      );

      const current = currentResult.rows[0];

      if (!current) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'Nie znaleziono interwencji.'
        });
      }

      let targetUnitId = hasUnitChange
        ? newUnitId
        : current.unit_id;

      let targetUnit = null;

      if (targetUnitId !== null) {
        const unitResult = await client.query(
          'SELECT * FROM units WHERE id = $1 FOR UPDATE',
          [targetUnitId]
        );

        targetUnit = unitResult.rows[0];

        if (!targetUnit) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Nie znaleziono wybranego patrolu.'
          });
        }

        if (
          targetUnitId !== current.unit_id &&
          await unitHasActiveIntervention(client, targetUnitId, current.id)
        ) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Wybrany patrol jest już przydzielony do innej aktywnej interwencji.'
          });
        }
      }

      let finalStatus = status || current.status;

      // Samo wybranie patrolu w formularzu automatycznie
      // zmienia oczekiwanie na status "Przydzielona".
      if (
        hasUnitChange &&
        newUnitId !== null &&
        finalStatus === 'Oczekuje na przydział'
      ) {
        finalStatus = 'Przydzielona';
      }

      if (
        activeInterventionStatuses.includes(finalStatus) &&
        !targetUnitId
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Ten status wymaga przydzielonego patrolu.'
        });
      }

      if (
        finalStatus === 'Oczekuje na przydział' &&
        targetUnitId !== null
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Usuń przydział patrolu, aby ustawić oczekiwanie na przydział.'
        });
      }

      // Zwolnienie poprzedniego patrolu po zmianie jednostki.
      if (
        hasUnitChange &&
        current.unit_id &&
        current.unit_id !== targetUnitId
      ) {
        await client.query(`
          UPDATE units
          SET status = 'Dostępny'
          WHERE id = $1 AND status = 'Zajęty'
        `, [current.unit_id]);
      }

      // Patrol przypisany do aktywnej interwencji zawsze jest zajęty.
      if (
        targetUnitId &&
        activeInterventionStatuses.includes(finalStatus)
      ) {
        await client.query(
          "UPDATE units SET status = 'Zajęty' WHERE id = $1",
          [targetUnitId]
        );
      }

      // Zakończenie interwencji zwalnia jej patrol.
      if (finalStatus === 'Zakończona' && targetUnitId) {
        await client.query(`
          UPDATE units
          SET status = 'Dostępny'
          WHERE id = $1 AND status = 'Zajęty'
        `, [targetUnitId]);
      }

      const updated = await client.query(`
        UPDATE interventions
        SET status = $1,
            unit_id = $2,
            callsign = $3,
            completed_at = CASE
              WHEN $1 = 'Zakończona' AND status <> 'Zakończona'
                THEN CURRENT_TIMESTAMP
              WHEN $1 <> 'Zakończona'
                THEN NULL
              ELSE completed_at
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `, [
        finalStatus,
        targetUnitId,
        targetUnit ? targetUnit.callsign : '',
        id
      ]);

      if (
        hasUnitChange &&
        current.unit_id !== targetUnitId
      ) {
        await addInterventionHistory(
          client,
          id,
          'Zmieniono przydział patrolu',
          targetUnit
            ? `Przydzielono patrol: ${targetUnit.callsign}`
            : 'Usunięto przydział patrolu.',
          req.session.user
        );
      }

      if (status && status !== current.status) {
        await addInterventionHistory(
          client,
          id,
          'Zmieniono status',
          `${current.status} → ${finalStatus}`,
          req.session.user
        );
      } else if (
        finalStatus !== current.status &&
        !status
      ) {
        await addInterventionHistory(
          client,
          id,
          'Zmieniono status',
          `${current.status} → ${finalStatus}`,
          req.session.user
        );
      }

      await client.query('COMMIT');
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

// --------------------------------------------------
// INTERWENCJE FUNKCJONARIUSZA
// --------------------------------------------------

app.get(
  '/api/interventions/mine',
  requireLogin,
  requireFunctionary,
  asyncRoute(async (req, res) => {
    const displayName = cleanText(
      req.session.user.displayName,
      100
    );

    const badge = cleanText(
      req.session.user.badge,
      30
    );

    const username = cleanText(
      req.session.user.username,
      40
    );

    const terms = [
      ...new Set([displayName, badge, username].filter(Boolean))
    ];

    if (!terms.length) return res.json([]);

    const patterns = terms.map(term => `%${term}%`);

    const clauses = patterns
      .map((_, index) => `u.officers ILIKE $${index + 1}`)
      .join(' OR ');

    const result = await pool.query(`
      SELECT i.*, u.callsign AS unit_callsign
      FROM interventions i
      JOIN units u ON u.id = i.unit_id
      WHERE i.status <> 'Zakończona'
        AND (${clauses})
      ORDER BY i.updated_at DESC
      LIMIT 50
    `, patterns);

    res.json(result.rows);
  })
);

// --------------------------------------------------
// PLIKI STRONY I BŁĘDY
// --------------------------------------------------

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true, lastModified: true }));

app.get('/', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
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
// START
// --------------------------------------------------

async function start() {
  try {
    await pool.query('SELECT 1');
    await initializeDatabase();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `Bluebird działa na porcie ${PORT} i korzysta z PostgreSQL.`
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
