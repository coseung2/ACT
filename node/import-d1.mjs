// Cloudflare D1 덤프(.sql)를 노트북의 sqlite 파일로 옮긴다.
//   npx wrangler d1 export act-db --remote --output=.data/act.sql
//   node node/import-d1.mjs            (기본: .data/act.sql → .data/act.db)
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const defaultDir = process.env.ACT_DATA_DIR ?? path.join(process.cwd(), ".data");
const sqlPath = process.argv[2] ?? path.join(defaultDir, "act.sql");
// 인자 > ACT_DB_PATH > 기본값 — 서버(install.mjs)가 여는 파일과 같은 규칙을 쓴다.
const dbPath = process.argv[3] ?? process.env.ACT_DB_PATH ?? path.join(defaultDir, "act.db");

await mkdir(path.dirname(dbPath), { recursive: true });
const sql = await readFile(sqlPath, "utf8");

// 임시 파일에 먼저 적용하고 성공했을 때만 제자리로 옮긴다(중간 실패로 반쯤 든 DB가 남지 않게).
const tempPath = `${dbPath}.importing`;
await rm(tempPath, { force: true }).catch(() => {});
const db = new Database(tempPath);
try {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF");
  db.exec(sql);
  db.pragma("foreign_keys = ON");
} catch (error) {
  db.close();
  await rm(tempPath, { force: true }).catch(() => {});
  await rm(`${tempPath}-wal`, { force: true }).catch(() => {});
  await rm(`${tempPath}-shm`, { force: true }).catch(() => {});
  throw error;
}

const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all();
console.log(`[d1-import] ${sqlPath} → ${dbPath}`);
for (const { name } of tables) {
  if (name.startsWith("sqlite_") || name.startsWith("_cf")) continue;
  const { n } = db.prepare(`select count(*) as n from "${name}"`).get();
  console.log(`  ${name}: ${n}`);
}
db.close();
await rm(dbPath, { force: true }).catch(() => {});
await rm(`${dbPath}-wal`, { force: true }).catch(() => {});
await rm(`${dbPath}-shm`, { force: true }).catch(() => {});
await rename(tempPath, dbPath);
