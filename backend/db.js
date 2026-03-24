const fs = require('fs');
const path = require('path');

const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'skillshift.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function openDb() {
  ensureDir(DATA_DIR);

  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
  });

  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.run(schema);
  persist(db);

  return {
    db,
    persist: () => persist(db),
    close: () => {
      try {
        persist(db);
      } finally {
        db.close();
      }
    }
  };
}

function persist(db) {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = {
  openDb,
  queryAll
};

