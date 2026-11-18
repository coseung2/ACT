// sqlite 파일을 backups/ 로 복사한다(노트북이 원본이 된 뒤의 백업용).
//   node node/backup.mjs            → .data/backups/act-YYYY-MM-DD-HHmm.db
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const dir = process.env.ACT_DATA_DIR ?? path.join(process.cwd(), ".data");
const dbPath = process.env.ACT_DB_PATH ?? path.join(dir, "act.db");
const outDir = path.join(dir, "backups");
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const outPath = path.join(outDir, `act-${stamp}.db`);

await mkdir(outDir, { recursive: true });

// 백업 API를 쓰면 WAL 상태에서도 일관된 사본이 나온다.
const db = new Database(dbPath, { readonly: true });
await db.backup(outPath);
db.close();

// 최근 14개만 남긴다.
const keep = 14;
const { readdir } = await import("node:fs/promises");
const files = (await readdir(outDir)).filter((f) => f.startsWith("act-") && f.endsWith(".db")).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) await rm(path.join(outDir, f), { force: true });

console.log(`[backup] ${outPath}`);
