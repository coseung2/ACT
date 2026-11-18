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
  const exec = (mode) => {
    const stmt = db.prepare(sql);
    if (mode === "raw") return { results: stmt.raw(true).all(...params), success: true, meta: meta() };
    if (mode === "all") return { results: stmt.all(...params), success: true, meta: meta() };
    const info = stmt.run(...params);
    return { success: true, meta: meta(info) };
  };
  const api = {
    bind: (...values) => statement(db, sql, values),
    all: async () => exec("all"),
    raw: async () => exec("raw").results,
    run: async () => exec("run"),
    first: async () => exec("all").results[0] ?? null,
    /** batch에서만 쓴다. */
    __exec: () => exec("all"),
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
