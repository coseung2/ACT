import "server-only";
import { MAX_UPLOAD_BYTES } from "./uploads";

// 작품 링크의 대표 이미지(og:image, YouTube 썸네일)를 가져온다.
// 사용자가 넣은 주소를 서버가 여는 것이므로 내부망·루프백 등으로는 연결하지 않는다.
// Workers의 fetch는 사설망에 닿지 않지만, 주소 형태로 쓴 내부 주소와 리디렉션도 직접 걸러 둔다.

const UA = "ACT-Thumbnail/1.0 (+teacher archive)";
const HTML_MAX = 512 * 1024;
const DEADLINE_MS = 10_000;

type Cidr = [bigint, number];
const v4 = (a: number, b: number, c: number, d: number): bigint => (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d);
const V4_BLOCKED: [string, number][] = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]];
const V6_BLOCKED: [string, number][] = [["::", 127], ["64:ff9b::", 96], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]];

function parseV4(text: string): bigint | null {
  const m = text.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const n = m.slice(1).map(Number);
  return n.some((x) => x > 255) ? null : v4(n[0], n[1], n[2], n[3]);
}

function parseV6(text: string): bigint | null {
  let t = text.toLowerCase();
  const tail = t.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const ip = parseV4(tail[1]);
    if (ip === null) return null;
    t = t.slice(0, -tail[1].length) + ((ip >> 16n) & 0xffffn).toString(16) + ":" + (ip & 0xffffn).toString(16);
  }
  const halves = t.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : fill < 1) return null;
  const groups = halves.length === 1 ? left : [...left, ...Array(fill).fill("0"), ...right];
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

const inCidr = (value: bigint, [base, prefix]: Cidr, bits: number) => value >> BigInt(bits - prefix) === base >> BigInt(bits - prefix);
const V4_LIST: Cidr[] = V4_BLOCKED.map(([n, p]) => [parseV4(n)!, p]);
const V6_LIST: Cidr[] = V6_BLOCKED.map(([n, p]) => [parseV6(n)!, p]);

/** IP 주소 문자열이 내부망·루프백·예약 대역이면 true. 형식을 읽지 못하면 안전하게 true. */
export function isBlockedAddress(address: string, family: 4 | 6) {
  if (family === 4) {
    const ip = parseV4(address);
    return ip === null || V4_LIST.some((c) => inCidr(ip, c, 32));
  }
  const ip = parseV6(address);
  if (ip === null) return true;
  if (ip >> 32n === 0xffffn) return isBlockedAddress([24, 16, 8, 0].map((s) => Number((ip >> BigInt(s)) & 0xffn)).join("."), 4);
  return V6_LIST.some((c) => inCidr(ip, c, 128));
}

function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("blocked address");
  if (host.includes(":")) {
    if (isBlockedAddress(host, 6)) throw new Error("blocked address");
  } else if (/^[\d.]+$/.test(host) && isBlockedAddress(host, 4)) throw new Error("blocked address");
}

type Fetched = { body: Uint8Array; type: string; url: URL };

async function get(url: URL, maxBytes: number, truncate: boolean, deadline: number, redirects = 3): Promise<Fetched> {
  if (!/^https?:$/.test(url.protocol) || (url.port && url.port !== "80" && url.port !== "443") || url.username || url.password) throw new Error("unsupported url");
  assertPublicHost(url);
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": UA, Accept: "text/html,image/*;q=0.9,*/*;q=0.5" },
    signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    await res.body?.cancel().catch(() => {});
    if (redirects <= 0) throw new Error("too many redirects");
    return get(new URL(res.headers.get("location")!, url), maxBytes, truncate, deadline, redirects - 1);
  }
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`status ${res.status}`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      if (!truncate) throw new Error("too large");
      chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
      break;
    }
    chunks.push(value);
    if (Date.now() > deadline) {
      await reader.cancel().catch(() => {});
      throw new Error("deadline");
    }
  }
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.byteLength;
  }
  return { body, type: (res.headers.get("content-type") ?? "").toLowerCase(), url };
}

const META_KEYS = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];

/** HTML에서 대표 이미지 주소를 찾는다. 상대 경로는 페이지 주소 기준으로 푼다. */
export function findImageUrl(html: string, base: URL): URL | null {
  const tags = html.slice(0, HTML_MAX).match(/<meta\b[^>]*>/gi) ?? [];
  const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"))?.slice(1).find(v => v !== undefined);
  for (const key of META_KEYS) {
    for (const tag of tags) {
      if ((attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase() !== key) continue;
      const content = attr(tag, "content")?.trim().replace(/&amp;/g, "&");
      if (!content) continue;
      try {
        const url = new URL(content, base);
        if (url.protocol === "https:" || url.protocol === "http:") return url;
      } catch {}
    }
  }
  return null;
}

/** YouTube 영상 ID는 [A-Za-z0-9_-]만 쓴다. `watch?v=%23`처럼 풀린 값이 들어오면 '#'이 ID에 남아
 * 임베드 주소의 ?autoplay... 가 프래그먼트로 밀리므로, ID 모양일 때만 돌려준다. */
const YT_ID = /^[\w-]{6,20}$/;

export function youtubeId(url: string) {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1) || null;
    else if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
        if (m) id = m[2];
      }
    }
    return id && YT_ID.test(id) ? id : null;
  } catch {}
  return null;
}

/** 링크의 대표 이미지 바이트를 돌려준다. 찾지 못하면 null. 연결 실패·차단은 예외로 던진다. */
export async function fetchLinkImage(link: string): Promise<Uint8Array | null> {
  const deadline = Date.now() + DEADLINE_MS;
  const yt = youtubeId(link);
  let image: URL | null = yt ? new URL(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`) : null;
  if (!image) {
    const page = await get(new URL(link), HTML_MAX, true, deadline);
    if (!/text\/html|application\/xhtml\+xml/.test(page.type)) return null;
    image = findImageUrl(new TextDecoder().decode(page.body), page.url);
  }
  if (!image) return null;
  const res = await get(image, MAX_UPLOAD_BYTES, false, deadline);
  return res.type.startsWith("image/") ? res.body : null;
}
