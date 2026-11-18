// D1(Cloudflare) 호환 sqlite 어댑터 — 노트북에서 앱을 돌릴 때 DB로 쓴다.
// drizzle-orm/d1 드라이버가 쓰는 메서드(prepare/bind/all/raw/run/batch)만 그대로 흉내 낸다.
import Database from "better-sqlite3";

/** D1이 돌려주는 meta 모양. 앱은 값을 쓰지 않지만 드라이버가 형태를 기대한다. */
const meta = (info) => ({
  duration: 0,
  changes: info?.changes ?? 0,
  last_row_id: Number(info?.lastInsertRowid ?? 0),
  changed_db: (info?.changes ?? 0) > 0,
  size_after: 0,
  rows_read: 0,
  rows_written: info?.changes ?? 0,
});

function statement(db, sql, params = []) {
  // 행을 돌려주지 않는 문(DELETE·INSERT 등)은 all()을 부르면 예외가 난다. reader로 갈라 run()으로 보낸다.
  const exec = () => {
    const stmt = db.prepare(sql);
    if (!stmt.reader) {
      const info = stmt.run(...params);
      return { results: [], success: true, meta: meta(info) };
    }
    return { results: stmt.all(...params), success: true, meta: meta() };
  };
  const api = {
    bind: (...values) => statement(db, sql, values),
    all: async () => exec(),
    raw: async () => {
      const stmt = db.prepare(sql);
      if (!stmt.reader) {
        stmt.run(...params);
        return [];
      }
      return stmt.raw(true).all(...params);
    },
    run: async () => {
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      return { results: [], success: true, meta: meta(info) };
    },
    first: async () => exec().results[0] ?? null,
    /** batch에서만 쓴다. */
    __exec: () => exec(),
  };
  return api;
}

export function createD1(file) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return {
    prepare: (sql) => statement(db, sql),
    /** D1의 batch는 한 트랜잭션에서 순서대로 실행된다. */
    batch: async (statements) => {
      const run = db.transaction(() => statements.map((stmt) => stmt.__exec()));
      return run();
    },
    exec: async (sql) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    close: () => db.close(),
  };
}
