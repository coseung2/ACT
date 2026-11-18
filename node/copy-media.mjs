// 기존 업로드 파일(R2)을 노트북 버킷 디렉터리로 복사한다.
// 키는 DB에서 뽑는다(작품 썸네일 /media/<uuid>.webp, 영상 링크 /media/video/<file>).
//   node node/copy-media.mjs            (기본: .data/act.db → .data/uploads)
//   node node/copy-media.mjs --dry      (무엇을 복사할지 먼저 보기)
import { mkdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import Database from "better-sqlite3";

const dry = process.argv.includes("--dry");
const dir = process.env.ACT_DATA_DIR ?? path.join(process.cwd(), ".data");
const dbPath = process.env.ACT_DB_PATH ?? path.join(dir, "act.db");
const uploads = path.join(dir, "uploads");
const bucket = process.env.ACT_R2_BUCKET ?? "act-uploads";

const db = new Database(dbPath, { readonly: true });
const thumbs = db.prepare("select thumbnail as t from work where thumbnail is not null").all().map((r) => r.t);
const files = db.prepare("select links as l from work where links is not null").all().flatMap((r) => {
  try {
    return (JSON.parse(r.l) ?? []).filter((link) => link.kind === "file").map((link) => link.url);
  } catch {
    return [];
  }
});
db.close();

const keys = new Set();
for (const t of thumbs) {
  const m = String(t).match(/^\/media\/([0-9a-f-]{36})\.webp$/);
  if (!m) continue;
  keys.add(`thumbs/${m[1]}.webp`);
  keys.add(`thumbs/${m[1]}-640.webp`);
}
for (const url of files) {
  const m = String(url).match(/^\/media\/video\/([0-9a-f-]{36}\.(?:mp4|webm))$/);
  if (m) keys.add(`videos/${m[1]}`);
}

console.log(`복사할 객체 ${keys.size}개 (${bucket} → ${uploads})`);
let copied = 0;
let skipped = 0;
let failed = 0;

for (const key of [...keys].sort()) {
  const target = path.join(uploads, key);
  const exists = await stat(target).then(() => true).catch(() => false);
  if (exists) {
    skipped += 1;
    continue;
  }
  if (dry) {
    console.log(`  (dry) ${key}`);
    continue;
  }
  await mkdir(path.dirname(target), { recursive: true });
  const run = spawnSync(
    "npx",
    ["wrangler", "r2", "object", "get", `${bucket}/${key}`, `--file=${target}`, "--remote"],
    { stdio: "pipe", encoding: "utf8", shell: true },
  );
  if (run.status === 0) {
    copied += 1;
    console.log(`  ✓ ${key}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${key}: ${(run.stderr || run.stdout || "").trim().split("\n").slice(-2).join(" ")}`);
  }
}

console.log(`완료 — 복사 ${copied} · 이미 있음 ${skipped} · 실패 ${failed}`);
if (failed) process.exitCode = 1;
