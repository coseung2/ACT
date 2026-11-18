// R2(Cloudflare) 호환 파일 저장소 — 노트북의 로컬 디렉터리에 그대로 둔다.
// 앱이 쓰는 put / get(레인지) / head / delete / 멀티파트 업로드만 구현한다.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

const toBytes = async (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value && typeof value.arrayBuffer === "function") return new Uint8Array(await value.arrayBuffer());
  if (value && typeof value.getReader === "function") {
    const reader = value.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
      size += chunk.byteLength;
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }
  throw new Error("지원하지 않는 업로드 값");
};

const toWeb = (nodeStream) => Readable.toWeb(nodeStream);

export function createBucket(root) {
  const fileOf = (key) => path.join(root, key);
  const metaOf = (key) => `${fileOf(key)}.meta.json`;

  const writeMeta = (key, httpMetadata) => writeFile(metaOf(key), JSON.stringify({ httpMetadata: httpMetadata ?? {} }));

  return {
    async put(key, value, options = {}) {
      const bytes = await toBytes(value);
      await mkdir(path.dirname(fileOf(key)), { recursive: true });
      await writeFile(fileOf(key), bytes);
      if (options.httpMetadata) await writeMeta(key, options.httpMetadata);
      return { key, size: bytes.byteLength };
    },

    async get(key, options = {}) {
      const target = fileOf(key);
      const info = await stat(target).catch(() => null);
      if (!info) return null;
      const httpMetadata = await this.__meta(key);
      const range = options.range;
      const stream = range
        ? createReadStream(target, { start: range.offset, end: range.offset + range.length - 1 })
        : createReadStream(target);
      return { key, size: info.size, httpMetadata, body: toWeb(stream) };
    },

    async head(key) {
      const info = await stat(fileOf(key)).catch(() => null);
      if (!info) return null;
      return { key, size: info.size, httpMetadata: await this.__meta(key) };
    },

    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        await unlink(fileOf(key)).catch(() => {});
        await unlink(metaOf(key)).catch(() => {});
      }
    },

    async list(prefix = "") {
      const dir = path.dirname(fileOf(prefix || "x"));
      const names = await readdir(dir, { recursive: true }).catch(() => []);
      return {
        objects: names
          .map((name) => String(name).replace(/\\/g, "/"))
          .filter((name) => name.startsWith(prefix) && !name.endsWith(".meta.json"))
          .map((name) => ({ key: name })),
      };
    },

    async __meta(key) {
      const raw = await stat(metaOf(key)).catch(() => null);
      if (!raw) return {};
      try {
        return JSON.parse(await readFile(metaOf(key), "utf8")).httpMetadata ?? {};
      } catch {
        return {};
      }
    },

    /** R2 멀티파트 업로드 — 파트를 파일로 쌓아 두었다가 complete에서 이어 붙인다. */
    async createMultipartUpload(key, options = {}) {
      const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const partDir = path.join(root, ".parts", uploadId);
      await mkdir(partDir, { recursive: true });
      let counter = 0;

      return {
        key,
        uploadId,
        async uploadPart(partNumber, value) {
          const bytes = await toBytes(value);
          const partPath = path.join(partDir, String(partNumber));
          await writeFile(partPath, bytes);
          counter = Math.max(counter, partNumber);
          return { partNumber, etag: `${partNumber}-${bytes.byteLength}` };
        },
        async complete(parts) {
          await mkdir(path.dirname(fileOf(key)), { recursive: true });
          const out = createWriteStream(fileOf(key));
          for (const part of parts) {
            const partPath = path.join(partDir, String(part.partNumber));
            await new Promise((resolve, reject) => {
              const input = createReadStream(partPath);
              input.on("error", reject);
              input.on("end", resolve);
              input.pipe(out, { end: false });
            });
          }
          await new Promise((resolve) => out.end(resolve));
          if (options.httpMetadata) await writeMeta(key, options.httpMetadata);
          await rm(partDir, { recursive: true, force: true });
          const info = await stat(fileOf(key));
          return { key, size: info.size };
        },
        async abort() {
          await rm(partDir, { recursive: true, force: true });
        },
      };
    },
  };
}
