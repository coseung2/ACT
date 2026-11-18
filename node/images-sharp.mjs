// Cloudflare Images 바인딩 흉내 — sharp로 info/transform/output만 구현한다.
import { Readable } from "node:stream";
import sharp from "sharp";

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", heif: "image/heif" };

const toBuffer = async (value) => {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value.getReader === "function") {
    const reader = value.getReader();
    const chunks = [];
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (value && typeof value.arrayBuffer === "function") return Buffer.from(await value.arrayBuffer());
  throw new Error("지원하지 않는 이미지 입력");
};

export function createImages() {
  return {
    /** 원본 형식·크기. 앱은 jpeg/png/webp/gif/avif만 받는다. */
    async info(stream) {
      const input = await toBuffer(stream);
      const meta = await sharp(input).metadata();
      // 앱(uploads.ts)은 "image/jpeg" 같은 MIME으로 검사한다. sharp는 디코더 이름(jpeg·heif)을 준다.
      const mime = meta.format === "heif" && meta.compression === "av1" ? "image/avif" : MIME[meta.format] ?? `image/${meta.format}`;
      return { format: mime, width: meta.width, height: meta.height, fileSize: input.byteLength };
    },

    input(stream) {
      const buffer = toBuffer(stream);
      const chain = { width: null, height: null, fit: "cover", gravity: "center" };
      const api = {
        transform(options = {}) {
          return api.__with({ ...options });
        },
        __with(options) {
          const next = { ...chain, ...options };
          return {
            transform: (more = {}) => api.__with({ ...next, ...more }),
            output: async (out = {}) => {
              let image = sharp(await buffer, { failOn: "none" });
              if (next.width || next.height) {
                image = image.resize({
                  width: next.width ?? undefined,
                  height: next.height ?? undefined,
                  fit: next.fit ?? "cover",
                  position: next.gravity === "auto" ? sharp.strategy.attention : next.gravity ?? "center",
                });
              }
              const format = (out.format ?? "image/webp").replace("image/", "");
              if (format === "webp") image = image.webp({ quality: out.quality ?? 82 });
              else if (format === "jpeg" || format === "jpg") image = image.jpeg({ quality: out.quality ?? 82 });
              else if (format === "png") image = image.png();
              else if (format === "avif") image = image.avif({ quality: out.quality ?? 60 });
              else image = image.toFormat(format);
              const bytes = await image.toBuffer();
              return { image: () => Readable.toWeb(Readable.from(bytes)), contentType: `image/${format}` };
            },
          };
        },
      };
      return api.__with({});
    },
  };
}
