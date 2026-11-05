async function initDatabase() {
  if (db) return db;
  initFirebase();

  // ชี้ไปยังไฟล์ WASM ในโฟลเดอร์ node_modules หรือ public
  const wasmPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  
  const SQL = await initSqlJs({
    locateFile: file => {
      if (file.endsWith('.wasm') && fs.existsSync(wasmPath)) {
        return wasmPath;
      }
      return `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`;
    }
  });

  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','merchant')),
      password_hash TEXT NOT NULL,
      name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(public_id, role)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS verification_codes (
      code TEXT PRIMARY KEY,
      student_user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS codes_student_idx ON verification_codes(student_user_id);
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_user_id INTEGER NOT NULL REFERENCES users(id),
      merchant_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS tx_student_idx ON transactions(student_user_id, id DESC);
    CREATE INDEX IF NOT EXISTS tx_merchant_idx ON transactions(merchant_user_id, id DESC);
  `);
  saveDb();
  return db;
}
