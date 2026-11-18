import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/lib/db";
import { textList } from "@/lib/db/text-list";
import { isVideoPath } from "@/lib/video";
import { bookmarkCounts, likeCounts } from "./stats";
import {
  DEFAULT_SORT,
  isArchiveSort,
  sortWorks,
  type ArchiveSort,
  LINK_KINDS,
  type LinkKind,
  type MakerRef,
  type WorkDetail,
  type WorkLink,
  type WorkStatus,
  type WorkSummary,
  type WorkPurpose,
  type WorkType,
  WORK_PURPOSES,
  WORK_TYPES,
} from "./types";

// 모든 조회는 요청 시점에 실행한다(빌드 시 DB 내용을 굳히지 않도록 connection()으로 동적 처리).

type WorkRow = typeof schema.work.$inferSelect;

function toLinks(raw: WorkRow["links"]): WorkLink[] {
  return raw.filter((l): l is WorkLink => (LINK_KINDS as readonly string[]).includes(l.kind) && !!l.url);
}

async function makersFor(slugs: string[]): Promise<Map<string, MakerRef[]>> {
  const map = new Map<string, MakerRef[]>();
  if (!slugs.length) return map;
  const rows = await db
    .select({ workSlug: schema.workMaker.workSlug, slug: schema.maker.slug, name: schema.maker.name })
    .from(schema.workMaker)
    .innerJoin(schema.maker, eq(schema.maker.slug, schema.workMaker.makerSlug))
    .where(inArray(schema.workMaker.workSlug, textList(slugs)))
    .orderBy(asc(schema.workMaker.position))
    .all();
  for (const r of rows) {
    const list = map.get(r.workSlug) ?? [];
    list.push({ slug: r.slug, name: r.name });
    map.set(r.workSlug, list);
  }
  return map;
}

function toSummary(w: WorkRow, makers: MakerRef[], counts: { likes: number; bookmarks: number } = { likes: 0, bookmarks: 0 }): WorkSummary {
  const links = toLinks(w.links);
  return {
    slug: w.slug,
    purpose: w.purpose,
    type: w.type,
    title: w.title,
    summary: w.summary,
    thumbnail: w.thumbnail,
    thumbnailAlt: w.thumbnailAlt,
    audience: w.audience,
    subjects: w.subjects,
    makers,
    primaryLink: links[0] ?? null,
    videoUrl: links.find((l) => isVideoPath(l.url))?.url ?? null,
    status: w.status,
    publishedAt: w.publishedAt,
    updatedAt: w.updatedAt,
    linkBroken: w.linkBroken,
    viewCount: w.viewCount,
    likeCount: counts.likes,
    bookmarkCount: counts.bookmarks,
  };
}

async function summaries(rows: WorkRow[]): Promise<WorkSummary[]> {
  const slugs = rows.map((r) => r.slug);
  const [m, likes, bookmarks] = await Promise.all([makersFor(slugs), likeCounts(slugs), bookmarkCounts(slugs)]);
  return rows.map((r) => toSummary(r, m.get(r.slug) ?? [], { likes: likes.get(r.slug) ?? 0, bookmarks: bookmarks.get(r.slug) ?? 0 }));
}

const published = eq(schema.work.status, "published");
const newest = [desc(schema.work.publishedAt), desc(schema.work.createdAt)];

// ── Archive ──────────────────────────────────────────────────────

// 정렬 기준은 화면(아케이드)에서도 쓰므로 types.ts에 있다. 기존 import 경로를 위해 그대로 다시 내보낸다.
export { ARCHIVE_SORTS, DEFAULT_SORT, type ArchiveSort } from "./types";

export type ArchiveQuery = { purpose?: WorkPurpose; type?: WorkType; audience?: string; subject?: string; q?: string; sort?: ArchiveSort; page?: number };

export const PAGE_SIZE = 24;

export type ArchiveResult = {
  items: WorkSummary[];
  total: number;
  page: number;
  pageCount: number;
  facets: { purpose: Record<string, number>; type: Record<string, number>; audience: Record<string, number>; subject: Record<string, number>; all: number };
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * 공개 작품 목록은 아케이드·작품 목록·홈이 같은 쿼리로 시작한다. 프로세스(isolate) 단위로 짧게 캐시해
 * 반복 요청에서 D1 조회와 요약 매핑을 건너뛴다. 글을 쓰면 invalidateContentCache()로 즉시 비운다.
 */
const LIST_TTL_MS = 15_000;
let listCache: { at: number; items: WorkSummary[] } | null = null;
/** 무효화 세대. 조회가 도는 사이 글이 바뀌면 옛 목록을 캐시에 다시 넣지 않으려고 센다. */
let listGeneration = 0;

export function invalidateContentCache() {
  listCache = null;
  listGeneration += 1;
}

async function publishedWorks(): Promise<WorkSummary[]> {
  const now = Date.now();
  if (listCache && now - listCache.at < LIST_TTL_MS) return listCache.items;
  const generation = listGeneration;
  const items = await summaries(await db.select().from(schema.work).where(published).orderBy(...newest).all());
  // 읽는 동안 글이 바뀌었으면(무효화) 이 결과는 이미 낡았다 — 캐시에 넣지 않는다.
  if (generation === listGeneration) listCache = { at: now, items };
  return items;
}

export function parseArchiveQuery(sp: Record<string, string | string[] | undefined>): ArchiveQuery {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const purpose = one("use");
  const type = one("type");
  const page = Number(one("page") ?? 1);
  const sort = one("sort");
  return {
    purpose: (WORK_PURPOSES as readonly string[]).includes(purpose ?? "") ? (purpose as WorkPurpose) : undefined,
    type: (WORK_TYPES as readonly string[]).includes(type ?? "") ? (type as WorkType) : undefined,
    audience: one("audience"),
    subject: one("subject"),
    q: one("q")?.slice(0, 60),
    sort: isArchiveSort(sort) ? sort : DEFAULT_SORT,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

/**
 * 연구회 규모(수백~수천 건)에서는 공개 작품을 한 번에 읽어 메모리에서 거르는 편이
 * 패싯 개수 계산까지 단순하고 충분히 빠르다. 1만 건을 넘기면 FTS5로 옮긴다.
 */
export async function getArchive(query: ArchiveQuery): Promise<ArchiveResult> {
  await connection();
  const all = await publishedWorks();

  const q = query.q ? norm(query.q) : "";
  const matchQ = (w: WorkSummary) =>
    !q || norm([w.title, w.summary, ...w.subjects, ...w.audience, ...w.makers.map((m) => m.name)].join(" ")).includes(q);
  const matchPurpose = (w: WorkSummary) => !query.purpose || w.purpose === query.purpose;
  const matchType = (w: WorkSummary) => !query.type || w.type === query.type;
  const matchAud = (w: WorkSummary) => !query.audience || w.audience.includes(query.audience);
  const matchSub = (w: WorkSummary) => !query.subject || w.subjects.includes(query.subject);

  // 각 패싯 개수는 "자기 자신을 뺀 나머지 필터"를 적용한 결과로 센다(선택을 바꿨을 때 나올 개수).
  const count = (list: WorkSummary[], key: (w: WorkSummary) => string[]) => {
    const out: Record<string, number> = {};
    for (const w of list) for (const k of key(w)) out[k] = (out[k] ?? 0) + 1;
    return out;
  };
  const base = all.filter(matchQ);
  const facets = {
    purpose: count(base.filter(matchType).filter(matchAud).filter(matchSub), (w) => [w.purpose]),
    type: count(base.filter(matchPurpose).filter(matchAud).filter(matchSub), (w) => [w.type]),
    audience: count(base.filter(matchPurpose).filter(matchType).filter(matchSub), (w) => w.audience),
    subject: count(base.filter(matchPurpose).filter(matchType).filter(matchAud), (w) => w.subjects),
    all: all.length,
  };

  // 정렬은 안정적이라 숫자가 같은 작품끼리는 최신순이 유지된다.
  const items = sortWorks(
    base.filter(matchPurpose).filter(matchType).filter(matchAud).filter(matchSub),
    query.sort ?? DEFAULT_SORT,
  );
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page ?? 1, pageCount);
  return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, page, pageCount, facets };
}

export async function getLatestWorks(limit = 8): Promise<WorkSummary[]> {
  await connection();
  return summaries(await db.select().from(schema.work).where(published).orderBy(...newest).limit(limit).all());
}

/**
 * 모바일 아케이드(/arcade) — 공개 작품 전체를 최신순으로 넘긴다.
 * 화면에서 정렬을 고르므로 정렬은 types.ts의 sortWorks가 하고, 같은 값끼리는 이 순서가 유지된다.
 */
export async function getArcadeWorks(): Promise<WorkSummary[]> {
  await connection();
  return await publishedWorks();
}

export type PopularThumbnail ={ slug: string; title: string; thumbnail: string; thumbnailAlt: string | null };

/**
 * 썸네일이 있는 공개 작품을 좋아요 많은 순으로 고른다(같으면 최신순 — getArchive의 likes 정렬과 같은 순서).
 * getArchive는 PAGE_SIZE에서 자르고 썸네일 없는 작품도 섞여 있어, 여기서는 조건과 개수를 SQL에서 바로 건다.
 * 요청 문맥 없이도 부를 수 있게 connection()은 getPopularThumbnails에 둔다.
 */
export async function selectPopularThumbnails(limit: number): Promise<PopularThumbnail[]> {
  const rows = await db
    .select({ slug: schema.work.slug, title: schema.work.title, thumbnail: schema.work.thumbnail, thumbnailAlt: schema.work.thumbnailAlt })
    .from(schema.work)
    .leftJoin(schema.workLike, eq(schema.workLike.workSlug, schema.work.slug))
    .where(and(published, isNotNull(schema.work.thumbnail), ne(schema.work.thumbnail, "")))
    .groupBy(schema.work.slug)
    .orderBy(desc(sql`count(${schema.workLike.clientId})`), ...newest)
    .limit(limit)
    .all();
  return rows.flatMap((r) => (r.thumbnail ? [{ ...r, thumbnail: r.thumbnail }] : []));
}

/** 홈 화면 입자 아카이브에 쓰는 인기 작품 썸네일 */
export async function getPopularThumbnails(limit = 9): Promise<PopularThumbnail[]> {
  await connection();
  return selectPopularThumbnails(limit);
}

export async function listPublishedSlugs() {
  await connection();
  return await db.select({ slug: schema.work.slug, updatedAt: schema.work.updatedAt }).from(schema.work).where(published).all();
}

export async function getStats() {
  await connection();
  const [rows, makers, projects] = await Promise.all([
    db.select({ type: schema.work.type }).from(schema.work).where(published).all(),
    db.selectDistinct({ m: schema.workMaker.makerSlug }).from(schema.workMaker).innerJoin(schema.work, eq(schema.work.slug, schema.workMaker.workSlug)).where(published).all(),
    db.select({ s: schema.project.slug }).from(schema.project).all(),
  ]);
  return { works: rows.length, makers: makers.length, projects: projects.length };
}

// ── Work ─────────────────────────────────────────────────────────

async function detail(w: WorkRow): Promise<WorkDetail> {
  const [makerMap, p, counts] = await Promise.all([
    makersFor([w.slug]),
    w.projectSlug ? db.select().from(schema.project).where(eq(schema.project.slug, w.projectSlug)).get() : Promise.resolve(undefined),
    Promise.all([likeCounts([w.slug]), bookmarkCounts([w.slug])]),
  ]);
  const makers = makerMap.get(w.slug) ?? [];
  return {
    ...toSummary(w, makers, { likes: counts[0].get(w.slug) ?? 0, bookmarks: counts[1].get(w.slug) ?? 0 }),
    body: w.body,
    links: toLinks(w.links),
    project: p ? { slug: p.slug, name: p.name, year: p.year, term: p.term } : null,
    ownerId: w.ownerId,
    reviewNote: w.reviewNote,
    contactEmail: w.contactEmail,
    createdAt: w.createdAt,
    linkCheckedAt: w.linkCheckedAt,
  };
}

/** 공개된 작품만 */
export async function getPublishedWork(slug: string): Promise<WorkDetail | null> {
  await connection();
  const w = await db.select().from(schema.work).where(and(eq(schema.work.slug, slug), published)).get();
  return w ? detail(w) : null;
}

/** 상태와 관계없이 (관리자·수정 링크용) */
export async function getAnyWork(slug: string): Promise<WorkDetail | null> {
  await connection();
  const w = await db.select().from(schema.work).where(eq(schema.work.slug, slug)).get();
  return w ? detail(w) : null;
}

export async function getRelatedWorks(w: WorkDetail, limit = 4): Promise<WorkSummary[]> {
  await connection();
  const makerSlugs = w.makers.map((m) => m.slug);
  const bySameMaker = makerSlugs.length
    ? (await db
        .selectDistinct({ slug: schema.workMaker.workSlug })
        .from(schema.workMaker)
        .where(inArray(schema.workMaker.makerSlug, textList(makerSlugs)))
        .all()).map((r) => r.slug)
    : [];
  const rows = (await db.select().from(schema.work).where(published).orderBy(...newest).all()).filter((r) => r.slug !== w.slug);
  const score = (r: WorkRow) =>
    (bySameMaker.includes(r.slug) ? 3 : 0) + (r.purpose === w.purpose ? 1 : 0) + (r.type === w.type ? 1 : 0) + r.subjects.filter((s) => w.subjects.includes(s)).length * 2;
  return await summaries(rows.map((r) => [r, score(r)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([r]) => r));
}

export async function getWorksBySlugs(slugs: string[]): Promise<WorkSummary[]> {
  await connection();
  if (!slugs.length) return [];
  const rows = await db.select().from(schema.work).where(and(inArray(schema.work.slug, textList(slugs.slice(0, 200))), published)).all();
  const order = new Map(slugs.map((s, i) => [s, i]));
  return await summaries(rows.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0)));
}

// ── Makers ───────────────────────────────────────────────────────

export async function listMakers() {
  await connection();
  const [makers, counts] = await Promise.all([
    db.select().from(schema.maker).orderBy(asc(schema.maker.name)).all(),
    db
    .select({ maker: schema.workMaker.makerSlug, work: schema.work.slug })
    .from(schema.workMaker)
    .innerJoin(schema.work, eq(schema.work.slug, schema.workMaker.workSlug))
    .where(published)
    .all(),
  ]);
  const c = new Map<string, number>();
  for (const r of counts) c.set(r.maker, (c.get(r.maker) ?? 0) + 1);
  return makers.map((m) => ({ ...m, workCount: c.get(m.slug) ?? 0 })).filter((m) => m.workCount > 0);
}

export async function listAllMakers() {
  await connection();
  return await db.select().from(schema.maker).orderBy(asc(schema.maker.name)).all();
}

export async function getMaker(slug: string) {
  await connection();
  const m = await db.select().from(schema.maker).where(eq(schema.maker.slug, slug)).get();
  if (!m) return null;
  const slugs = (await db.select({ s: schema.workMaker.workSlug }).from(schema.workMaker).where(eq(schema.workMaker.makerSlug, slug)).all()).map((r) => r.s);
  const rows = slugs.length ? await db.select().from(schema.work).where(and(inArray(schema.work.slug, textList(slugs)), published)).orderBy(...newest).all() : [];
  return { maker: m, works: await summaries(rows) };
}

export async function findOrCreateMakers(names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().slice(0, 30);
    if (!name) continue;
    const found = await db.select({ slug: schema.maker.slug }).from(schema.maker).where(eq(schema.maker.name, name)).get();
    if (found) {
      out.push(found.slug);
      continue;
    }
    const slug = `m-${crypto.randomUUID().slice(0, 8)}`;
    await db.insert(schema.maker).values({ slug, name, member: false }).run();
    out.push(slug);
  }
  return [...new Set(out)];
}

// ── Projects ─────────────────────────────────────────────────────

export async function listProjects() {
  await connection();
  const [ps, rows] = await Promise.all([
    db.select().from(schema.project).orderBy(desc(schema.project.year), desc(schema.project.term)).all(),
    db.select().from(schema.work).where(published).orderBy(...newest).all(),
  ]);
  const all = await summaries(rows.filter((r) => r.projectSlug));
  return ps.map((p) => ({ ...p, works: all.filter((w) => rows.find((r) => r.slug === w.slug)?.projectSlug === p.slug) }));
}

export async function getProject(slug: string) {
  await connection();
  const p = await db.select().from(schema.project).where(eq(schema.project.slug, slug)).get();
  if (!p) return null;
  const rows = await db.select().from(schema.work).where(and(eq(schema.work.projectSlug, slug), published)).orderBy(...newest).all();
  const makerSet = new Map<string, MakerRef>();
  const works = await summaries(rows);
  for (const w of works) for (const m of w.makers) makerSet.set(m.slug, m);
  return { project: p, works, makers: [...makerSet.values()] };
}

export async function listProjectOptions() {
  await connection();
  return await db.select({ slug: schema.project.slug, name: schema.project.name, year: schema.project.year, term: schema.project.term }).from(schema.project).orderBy(desc(schema.project.year)).all();
}

// ── Admin ────────────────────────────────────────────────────────

export async function listWorksByStatus(status: WorkStatus | "all") {
  await connection();
  const rows =
    status === "all"
      ? await db.select().from(schema.work).orderBy(desc(schema.work.updatedAt)).all()
      : await db.select().from(schema.work).where(eq(schema.work.status, status)).orderBy(desc(schema.work.updatedAt)).all();
  return (await summaries(rows)).map((s, i) => ({ ...s, contactEmail: rows[i].contactEmail, reviewNote: rows[i].reviewNote, createdAt: rows[i].createdAt }));
}

export async function countByStatus() {
  await connection();
  const rows = await db.select({ status: schema.work.status }).from(schema.work).all();
  const out: Record<WorkStatus, number> = { draft: 0, review: 0, published: 0, hidden: 0 };
  for (const r of rows) out[r.status]++;
  return out;
}

export async function allSubjects(): Promise<string[]> {
  await connection();
  const rows = await db.select({ s: schema.work.subjects }).from(schema.work).where(published).all();
  const c = new Map<string, number>();
  for (const r of rows) for (const s of r.s) c.set(s, (c.get(s) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

export type { LinkKind };
