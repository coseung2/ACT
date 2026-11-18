import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db, schema } from "@/lib/db";
import { deleteThumbnail, deleteVideo } from "@/lib/uploads";
import type { WorkInput } from "./form";
import { findOrCreateMakers, invalidateContentCache } from "./queries";
import type { WorkStatus } from "./types";

async function newSlug() {
  for (;;) {
    const slug = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    if (slug.length < 6) continue;
    if (!(await db.select({ s: schema.work.slug }).from(schema.work).where(eq(schema.work.slug, slug)).get())) return slug;
  }
}

async function projectOrNull(slug: string) {
  if (!slug) return null;
  return (await db.select({ s: schema.project.slug }).from(schema.project).where(eq(schema.project.slug, slug)).get())?.s ?? null;
}

/** 제작자 연결을 통째로 바꾸는 문장들. 호출하는 쪽이 batch에 함께 담는다. */
function setMakerStatements(workSlug: string, makerSlugs: string[]): BatchItem<"sqlite">[] {
  return [
    db.delete(schema.workMaker).where(eq(schema.workMaker.workSlug, workSlug)),
    ...makerSlugs.map((m, i) => db.insert(schema.workMaker).values({ workSlug, makerSlug: m, position: i })),
  ];
}

const batch = async (statements: BatchItem<"sqlite">[]) => {
  const result = await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  invalidateContentCache();
  return result;
};

export async function createWork(input: WorkInput, opts: { thumbnail: string | null; ownerId: string; status?: WorkStatus }) {
  const slug = await newSlug();
  const makers = await findOrCreateMakers(input.makers);
  const projectSlug = await projectOrNull(input.project);
  await batch([
    db.insert(schema.work)
      .values({
        slug,
        purpose: input.purpose,
        type: input.type,
        title: input.title,
        summary: input.summary,
        body: input.body,
        links: input.links,
        audience: input.audience,
        subjects: input.subjects,
        projectSlug,
        thumbnail: opts.thumbnail,
        thumbnailAlt: input.thumbnailAlt || null,
        contactEmail: input.contactEmail || null,
        ownerId: opts.ownerId,
        status: opts.status ?? "review",
        publishedAt: opts.status === "published" ? new Date() : null,
      }),
    ...setMakerStatements(slug, makers),
  ]);
  return slug;
}

export async function updateWork(slug: string, input: WorkInput, opts: { thumbnail?: string | null; ownerId?: string }) {
  const prev = await db.select().from(schema.work).where(eq(schema.work.slug, slug)).get();
  if (!prev) throw new Error("not found");
  if (opts.ownerId !== undefined && prev.ownerId !== opts.ownerId) throw new Error("Work permission changed");
  const makers = await findOrCreateMakers(input.makers);
  const projectSlug = await projectOrNull(input.project);
  const linksChanged = JSON.stringify(prev.links) !== JSON.stringify(input.links);
  await batch([
    db.update(schema.work)
      .set({
        purpose: input.purpose,
        type: input.type,
        title: input.title,
        summary: input.summary,
        body: input.body,
        links: input.links,
        audience: input.audience,
        subjects: input.subjects,
        projectSlug,
        thumbnailAlt: input.thumbnailAlt || null,
        contactEmail: input.contactEmail || null,
        ...(opts.thumbnail !== undefined ? { thumbnail: opts.thumbnail } : {}),
        ...(linksChanged ? { linkBroken: false, linkCheckedAt: null } : {}),
        // 반려(숨김)된 작품을 고치면 다시 검수 대기로 돌린다.
        ...(prev.status === "hidden" || prev.status === "draft" ? { status: "review" as const } : {}),
        updatedAt: new Date(),
      })
      // 그사이 소유자가 바뀌었다면 갱신하지 않는다.
      .where(opts.ownerId !== undefined ? and(eq(schema.work.slug, slug), eq(schema.work.ownerId, opts.ownerId)) : eq(schema.work.slug, slug)),
    ...setMakerStatements(slug, makers),
  ]);
  if (opts.thumbnail !== undefined && prev.thumbnail && prev.thumbnail !== opts.thumbnail) await deleteThumbnail(prev.thumbnail);
  // 더 이상 쓰지 않는 직접 올린 영상 파일은 지운다.
  const kept = new Set(input.links.filter((l) => l.kind === "file").map((l) => l.url));
  for (const link of prev.links) if (link.kind === "file" && !kept.has(link.url)) await deleteVideo(link.url);
}

export async function setWorkStatus(slug: string, status: WorkStatus, note?: string) {
  const prev = await db.select().from(schema.work).where(eq(schema.work.slug, slug)).get();
  if (!prev) return;
  await db.update(schema.work)
    .set({
      status,
      reviewNote: note?.trim() ? note.trim().slice(0, 500) : status === "published" ? null : prev.reviewNote,
      publishedAt: status === "published" ? (prev.publishedAt ?? new Date()) : prev.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.work.slug, slug))
    .run();
  invalidateContentCache();
}

export async function deleteWork(slug: string) {
  const prev = await db.select().from(schema.work).where(eq(schema.work.slug, slug)).get();
  if (!prev) return;
  await db.delete(schema.work).where(eq(schema.work.slug, slug)).run();
  invalidateContentCache();
  await deleteThumbnail(prev.thumbnail);
  for (const link of prev.links) if (link.kind === "file") await deleteVideo(link.url);
}

export async function createProject(p: { year: number; term: string; name: string; summary: string }) {
  const base = `${p.year}-${randomBytes(3).toString("hex")}`;
  await db.insert(schema.project).values({ slug: base, ...p }).run();
  return base;
}

export async function updateMaker(slug: string, data: { name: string; bio: string; member: boolean }) {
  await db.update(schema.maker).set(data).where(eq(schema.maker.slug, slug)).run();
}
