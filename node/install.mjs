// 노트북(일반 Node)에서 돌릴 때 Cloudflare 바인딩 자리에 로컬 구현을 꽂는다.
// 앱의 src/lib/db/index.ts가 보는 globalThis.__actDb / __actUploads / __actImages 를 채우는 방식이라
// 앱 코드는 한 줄도 바뀌지 않는다. Workers 빌드에는 이 파일이 포함되지 않는다.
//   사용: node --import ./node/install.mjs node_modules/next/dist/bin/next start
import path from "node:path";
import { drizzle } from "drizzle-orm/d1";
import { createD1 } from "./sqlite-d1.mjs";
import { createBucket } from "./r2-fs.mjs";
import { createImages } from "./images-sharp.mjs";

const dir = process.env.ACT_DATA_DIR ?? path.join(process.cwd(), ".data");
const dbPath = process.env.ACT_DB_PATH ?? path.join(dir, "act.db");

/** Drizzle는 여기서 만든 D1 호환 객체를 그대로 쓴다(스키마는 앱이 테이블을 직접 import 하므로 필요 없다). */
globalThis.__actDb = drizzle(createD1(dbPath));
globalThis.__actUploads = createBucket(path.join(dir, "uploads"));
globalThis.__actImages = createImages();

console.log(`[node-host] sqlite ${dbPath} · uploads ${path.join(dir, "uploads")}`);
