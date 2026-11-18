import Link from "next/link";
import { LINK_LABEL, type WorkSummary } from "@/lib/content/types";
import { formatMonth } from "@/lib/format";
import { CardActions } from "./CardActions";
import { Thumbnail } from "./Thumbnail";
import { VideoPreview } from "./VideoPreview";
import { ExternalButton, TypeBadge } from "./ui";
import s from "./WorkCard.module.css";

export function WorkCard({ work, priority, liked, bookmarked }: { work: WorkSummary; priority?: boolean; liked?: boolean; bookmarked?: boolean }) {
  const meta = [work.audience.join("·"), work.subjects.join("·"), work.publishedAt && formatMonth(work.publishedAt)].filter(Boolean).join(" · ");
  return (
    <article className={s.card}>
      <Link href={`/works/${work.slug}`} className={s.thumb}>
        {work.videoUrl ? (
          // 영상 주소가 바뀌면 재생 상태를 새로 잡도록 다시 마운트한다.
          <VideoPreview key={work.videoUrl} src={work.videoUrl}>
            <Thumbnail src={work.thumbnail} alt={work.thumbnailAlt} title={work.title} purpose={work.purpose} priority={priority} />
          </VideoPreview>
        ) : (
          <Thumbnail src={work.thumbnail} alt={work.thumbnailAlt} title={work.title} purpose={work.purpose} priority={priority} />
        )}
      </Link>
      <div className={s.body}>
        <h3 className={s.title}>
          <Link href={`/works/${work.slug}`}>{work.title}</Link>
        </h3>
        <p className={s.summary}>{work.summary}</p>
      </div>
      <p className={s.meta}>{meta}</p>
      <div className={s.reactionsRow}>
        <CardActions
          slug={work.slug}
          title={work.title}
          likeCount={work.likeCount}
          viewCount={work.viewCount}
          bookmarkCount={work.bookmarkCount}
          liked={liked}
          bookmarked={bookmarked}
        />
        <TypeBadge purpose={work.purpose} type={work.type} />
      </div>
      <div className={s.footer}>
        {work.primaryLink ? (
          <ExternalButton href={work.primaryLink.url} size="sm" aria-label={`${work.title} ${LINK_LABEL[work.primaryLink.kind]}`}>
            {work.primaryLink.kind === "youtube" ? "영상 보기" : work.primaryLink.kind.startsWith("store") ? "앱 받기" : "바로 열기"}
          </ExternalButton>
        ) : (
          <Link href={`/works/${work.slug}`} className={s.more}>
            자세히
          </Link>
        )}
        <div className={s.footerRight}>
          {work.makers.length > 0 && (
            <span className={s.maker}>
              <span className={s.by}>BY</span>
              <Link href={`/makers/${work.makers[0].slug}`}>{work.makers[0].name}</Link>
              {work.makers.length > 1 && <span className={s.more}> 외 {work.makers.length - 1}</span>}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function WorkGrid({ works, priorityCount = 0, reactions }: { works: WorkSummary[]; priorityCount?: number; reactions?: { liked: string[]; bookmarked: string[] } }) {
  const liked = new Set(reactions?.liked);
  const bookmarked = new Set(reactions?.bookmarked);
  return (
    <ul className={s.grid}>
      {works.map((w, i) => (
        <li key={w.slug}>
          <WorkCard work={w} priority={i < priorityCount} liked={liked.has(w.slug)} bookmarked={bookmarked.has(w.slug)} />
        </li>
      ))}
    </ul>
  );
}

export function WorkGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className={s.grid} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={s.skeleton}>
          <div className={s.skelThumb} />
          <div className={s.skelLine} style={{ width: "60%" }} />
          <div className={s.skelLine} />
        </li>
      ))}
    </ul>
  );
}
