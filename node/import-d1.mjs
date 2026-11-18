// Cloudflare D1 덤프(.sql)를 노트북의 sqlite 파일로 옮긴다.
//   npx wrangler d1 export act-db --remote --output=.data/act.sql
//   node node/import-d1.mjs            (기본: .data/act.sql → .data/act.db)
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const dir = process.env.ACT_DATA_DIR ?? path.join(process.cwd(), ".data");
const sqlPath = process.argv[2] ?? path.join(dir, "act.sql");
const dbPath = process.argv[3] ?? path.join(dir, "act.db");

await mkdir(dir, { recursive: true });
const sql = await readFile(sqlPath, "utf8");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");
db.exec(sql);
db.pragma("foreign_keys = ON");

const tables = db.prepare("select name from sqlite_master where type = 'table' order by name").all();
console.log(`[d1-import] ${sqlPath} → ${dbPath}`);
for (const { name } of tables) {
  if (name.startsWith("sqlite_") || name.startsWith("_cf")) continue;
  const { n } = db.prepare(`select count(*) as n from "${name}"`).get();
  console.log(`  ${name}: ${n}`);
}
db.close();
