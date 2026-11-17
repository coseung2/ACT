import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { LikeButton } from "@/components/LikeButton";
import { Prose } from "@/components/Prose";
import { Thumbnail } from "@/components/Thumbnail";
import { ExternalButton, Notice, TypeBadge } from "@/components/ui";
import { WorkGrid } from "@/components/WorkCard";
import p from "@/components/page.module.css";
import { getPublishedWork, getRelatedWorks } from "@/lib/content/queries";
import { likeState, reactionProps, recordView } from "@/lib/content/stats";
import { LINK_LABEL, WORK_PURPOSE_LABEL, WORK_TYPE_LABEL, type WorkLink } from "@/lib/content/types";
import { projectAccess } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { youtubeId } from "@/lib/remote-image";
import { site } from "@/lib/site";
import { VIDEO_MIME, videoExtensionOf } from "@/lib/video";
import s from "./work.module.css";

export async function generateMetadata(props: PageProps<"/works/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const w = await getPublishedWork(slug);
  if (!w) return { title: "작품을 찾을 수 없어요" };
  return {
    title: w.title,
    description: w.summary,
    alternates: { canonical: `/works/${w.slug}` },
    openGraph: { title: w.title, description: w.summary, type: "article", images: w.thumbnail ? [{ url: w.thumbnail, width: 1280, height: 800 }] : undefined },
  };
}

export default async function WorkPage(props: PageProps<"/works/[slug]">) {
  const { slug } = await props.params;
  const work = await getPublishedWork(slug);
  if (!work) notFound();
  await recordView(work.slug);
  const likes = await likeState(work.slug);
  // 연구회 프로젝트 이름은 연구회회원과 관리자에게만 보인다.
  const showProject = !!work.project && (await projectAccess()).allowed;
  const related = await getRelatedWorks(work);
  const yt = work.links.map((l) => (l.kind === "youtube" ? youtubeId(l.url) : null)).find(Boolean);
  const video = work.links.find((l) => l.kind === "file");
  const videoExt = video ? videoExtensionOf(video.url) : null;
  const [primary, ...rest] = work.links;

  return (
    <div className={`container ${s.page}`}>
      <nav aria-label="위치" className={s.crumbs}>
        <Link href="/works">작품</Link>
        <span aria-hidden>/</span>
        <Link href={`/works?use=${work.purpose}`}>{WORK_PURPOSE_LABEL[work.purpose]}</Link>
        <span aria-hidden>/</span>
        <Link href={`/works?use=${work.purpose}&type=${work.type}`}>{WORK_TYPE_LABEL[work.type]}</Link>
      </nav>

      <div className={s.layout}>
        <div className={s.main}>
          <div className={s.media}>
            {video && videoExt ? (
              // 카드에서 넘어오면 바로 재생된다. 소리는 브라우저 정책상 음소거로 시작하고 컨트롤로 켠다.
              <video controls autoPlay muted preload="metadata" playsInline poster={work.thumbnail ?? undefined}>
                <source src={video.url} type={VIDEO_MIME[videoExt]} />
              </video>
            ) : yt ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=1&playsinline=1`}
                title={`${work.title} 영상`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            ) : (
              <Thumbnail src={work.thumbnail} alt={work.thumbnailAlt} title={work.title} purpose={work.purpose} priority sizes="(max-width: 1023px) 100vw, 760px" />
            )}
          </div>
          <Prose text={work.body} />
        </div>

        <aside className={s.aside}>
          <div className={s.head}>
            <TypeBadge purpose={work.purpose} type={work.type} />
            <h1 className="t-h1">{work.title}</h1>
            <p className={s.summary}>{work.summary}</p>
          </div>

          {work.linkBroken && (
            <Notice tone="danger">
              <strong>링크 확인이 필요해요.</strong> 최근 점검에서 바로가기 링크가 열리지 않았습니다. 작품 설명은 계속 볼 수 있어요.
            </Notice>
          )}

          <div className={s.actions}>
            {primary && <PrimaryLink link={primary} />}
            {rest.map((l) => (
              <ExternalButton key={l.url} href={l.url} block>
                {LINK_LABEL[l.kind]}
              </ExternalButton>
            ))}
            <div className={s.secondary}>
              <div className={s.reactions}>
                <FavoriteButton slug={work.slug} title={work.title} withLabel />
                <LikeButton slug={work.slug} liked={likes.liked} count={likes.count} />
              </div>
              <CopyLinkButton url={`${site.url}/works/${work.slug}`} />
            </div>
          </div>

          <dl className={s.meta}>
            <div>
              <dt>만든 사람</dt>
              <dd>
                {work.makers.map((m, i) => (
                  <span key={m.slug}>
                    {i > 0 && ", "}
                    <Link href={`/makers/${m.slug}`}>{m.name}</Link>
                  </span>
                ))}
              </dd>
            </div>
            {work.audience.length > 0 && (
              <div>
                <dt>대상</dt>
                <dd>
                  {work.audience.map((a, i) => (
                    <span key={a}>
                      {i > 0 && ", "}
                      <Link href={`/works?audience=${encodeURIComponent(a)}`}>{a}</Link>
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {work.subjects.length > 0 && (
              <div>
                <dt>교과·영역</dt>
                <dd>
                  {work.subjects.map((sub, i) => (
                    <span key={sub}>
                      {i > 0 && ", "}
                      <Link href={`/works?subject=${encodeURIComponent(sub)}`}>{sub}</Link>
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {work.project && showProject && (
              <div>
                <dt>연구회 프로젝트</dt>
                <dd>
                  <Link href={`/projects/${work.project.slug}`}>
                    {work.project.year} {work.project.term} · {work.project.name}
                  </Link>
                </dd>
              </div>
            )}
            <div>
              <dt>공개일</dt>
              <dd className="t-mono">{formatDate(work.publishedAt ?? work.createdAt)}</dd>
            </div>
            {work.linkCheckedAt && (
              <div>
                <dt>링크 점검</dt>
                <dd className="t-mono">{formatDate(work.linkCheckedAt)}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>

      {related.length > 0 && (
        <section className={p.section} aria-labelledby="related">
          <div className={p.sectionHead}>
            <h2 id="related" className="t-h3">
              함께 보면 좋은 작품
            </h2>
            <Link href={`/works?use=${work.purpose}`}>{WORK_PURPOSE_LABEL[work.purpose]} 더 보기 →</Link>
          </div>
          <WorkGrid works={related} reactions={await reactionProps(related.map((w) => w.slug))} />
        </section>
      )}
    </div>
  );
}

function PrimaryLink({ link }: { link: WorkLink }) {
  const label = link.kind === "open" ? "바로 열기" : link.kind === "file" ? "영상 열기" : LINK_LABEL[link.kind];
  let host = "";
  try {
    host = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {}
  return (
    <div className={s.primary}>
      <ExternalButton href={link.url} variant="primary" block>
        {label}
      </ExternalButton>
      {host && <span className={s.host}>{host}</span>}
    </div>
  );
}
