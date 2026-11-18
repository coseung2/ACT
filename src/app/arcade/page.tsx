import type { Metadata, Viewport } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { getArcadeWorks } from "@/lib/content/queries";
import { DEFAULT_SORT, isArchiveSort, type ArchiveSort, type WorkSummary } from "@/lib/content/types";
import { Arcade, type ArcadeWork } from "./Arcade";

export const metadata: Metadata = {
  title: "아케이드",
  description: "선생님들이 만든 작품을 게임 콘솔처럼 골라 바로 여는 모바일 화면",
  alternates: { canonical: "/arcade" },
};

export const viewport: Viewport = {
  themeColor: "#2747c9",
  viewportFit: "cover",
};

function toArcade(w: WorkSummary): ArcadeWork {
  return {
    slug: w.slug,
    title: w.title,
    summary: w.summary,
    purpose: w.purpose,
    type: w.type,
    thumbnail: w.thumbnail,
    thumbnailAlt: w.thumbnailAlt,
    makers: w.makers.map((m) => m.name),
    url: w.primaryLink && !w.linkBroken ? w.primaryLink.url : null,
    likeCount: w.likeCount,
    bookmarkCount: w.bookmarkCount,
    publishedAt: w.publishedAt ? w.publishedAt.getTime() : 0,
  };
}

async function ArcadeData({ sort }: { sort: ArchiveSort }) {
  let works: ArcadeWork[] = [];
  try {
    works = (await getArcadeWorks()).map(toArcade);
  } catch (err) {
    unstable_rethrow(err);
    console.error("[arcade] 작품 조회 실패", err);
  }
  return <Arcade works={works} sort={sort} />;
}

/**
 * 모바일 전용 콘솔형 작품 선택 화면. 홈(/)에 휴대폰으로 들어오면 이리로 보낸다(MobileRedirect).
 * 상·하단 내비 없이 화면 전체를 덮는다(루트 레이아웃의 헤더·푸터 위에 고정 오버레이로 그린다).
 * ?sort=로 정렬을 고정하면 화면 안에서 바꾸지 않아도 그 순서로 처음 열린다.
 */
export default async function ArcadePage(props: PageProps<"/arcade">) {
  const raw = (await props.searchParams).sort;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const sort = isArchiveSort(value) ? value : DEFAULT_SORT;
  return (
    <Suspense fallback={<Arcade works={null} sort={sort} />}>
      <ArcadeData sort={sort} />
    </Suspense>
  );
}
