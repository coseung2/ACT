// 콘텐츠 모델 — CONSTITUTION.md §4

// 대분류: 어디에 쓰는가. 작품마다 하나.
export const WORK_PURPOSES = ["class", "work", "play", "other"] as const;
export type WorkPurpose = (typeof WORK_PURPOSES)[number];

export const WORK_PURPOSE_LABEL: Record<WorkPurpose, string> = {
  class: "수업 도구",
  work: "업무 도구",
  play: "교실 놀이",
  other: "기타",
};

export const WORK_PURPOSE_HINT: Record<WorkPurpose, string> = {
  class: "수업 시간에 학생과 함께 쓰는 도구와 자료",
  work: "기록·평가·행정 등 선생님 업무를 돕는 도구",
  play: "게임, 레크리에이션, 자투리 시간 활동",
  other: "앞의 셋에 딱 들어가지 않는 그 밖의 작품",
};

// 소분류: 어떤 형태인가.
export const WORK_TYPES = ["web-app", "mobile-app", "video", "material", "other"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  "web-app": "웹앱",
  "mobile-app": "모바일 앱",
  video: "영상",
  material: "수업 자료",
  other: "기타",
};

export const AUDIENCES = ["유아", "초등 저", "초등 중", "초등 고", "중등"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const LINK_KINDS = ["open", "store-ios", "store-android", "youtube", "source", "file"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_LABEL: Record<LinkKind, string> = {
  open: "바로 열기",
  "store-ios": "App Store",
  "store-android": "Google Play",
  youtube: "YouTube에서 보기",
  source: "소스 코드",
  file: "영상 파일",
};

export type WorkLink = { kind: LinkKind; url: string };

export type WorkStatus = "draft" | "review" | "published" | "hidden";

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  draft: "임시 저장",
  review: "검수 대기",
  published: "공개",
  hidden: "숨김",
};

export type MakerRef = { slug: string; name: string };

export type WorkSummary = {
  slug: string;
  purpose: WorkPurpose;
  type: WorkType;
  title: string;
  summary: string;
  thumbnail: string | null;
  thumbnailAlt: string | null;
  audience: string[];
  subjects: string[];
  makers: MakerRef[];
  primaryLink: WorkLink | null;
  /** 직접 올린 영상 파일 주소. 카드에서 마우스를 올리면 미리 재생한다. */
  videoUrl: string | null;
  status: WorkStatus;
  publishedAt: Date | null;
  updatedAt: Date;
  linkBroken: boolean;
  viewCount: number;
  likeCount: number;
  bookmarkCount: number;
};

export type WorkDetail = WorkSummary & {
  body: string;
  links: WorkLink[];
  project: { slug: string; name: string; year: number; term: string } | null;
  ownerId: string | null;
  reviewNote: string | null;
  /** 비공개. 운영진·수정 링크 화면에서만 쓴다. */
  contactEmail: string | null;
  createdAt: Date;
  linkCheckedAt: Date | null;
};

// 개발 시드 전용 입력 형식
export type Work = {
  slug: string;
  purpose: WorkPurpose;
  type: WorkType;
  title: string;
  summary: string;
  body: string[];
  links: WorkLink[];
  audience: Audience[];
  subjects: string[];
  makers: string[];
  project?: string;
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
  linkCheckedAt?: string;
  linkBroken?: boolean;
};

export type Maker = {
  slug: string;
  name: string;
  bio: string;
  member: boolean;
  links: { label: string; url: string }[];
};

export type Project = {
  slug: string;
  year: number;
  term: string;
  name: string;
  summary: string;
};
