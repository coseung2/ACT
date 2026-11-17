"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { WORK_PURPOSE_LABEL, WORK_TYPE_LABEL, type WorkPurpose, type WorkType } from "@/lib/content/types";
import { sfx, setMuted, isMuted, subscribeMuted } from "./sfx";
import s from "./arcade.module.css";

export type ArcadeWork = {
  slug: string;
  title: string;
  summary: string;
  purpose: WorkPurpose;
  type: WorkType;
  thumbnail: string | null;
  thumbnailAlt: string | null;
  makers: string[];
  /** 바로 여는 주소. 없거나 깨진 링크면 작품 페이지로 들어간다. */
  url: string | null;
  likes: number;
};

type Dir = "left" | "right" | "up" | "down";

/** 업로드 썸네일은 1280w와 -640 두 장이 있다(components/Thumbnail.tsx와 같은 규칙). */
function small(src: string) {
  return /\.webp$/.test(src) ? src.replace(/\.webp$/, "-640.webp") : src;
}

/**
 * 게임 콘솔 라이브러리처럼 작품 타일을 고르는 화면.
 * - 타일을 누르면 선택 효과음과 함께 커지고, 하단에 "게임 입장" 패널이 바로 올라온다.
 * - 선택된 타일을 한 번 더 누르거나 [시작]을 누르면 작품을 연다.
 * - 화살표 키·Enter·Esc로도 움직인다(블루투스 컨트롤러나 키보드).
 * 작품 정보는 패널에만 띄우고, 평소에는 타일이 화면 전체를 쓴다.
 */
export function Arcade({ works }: { works: ArcadeWork[] | null }) {
  const router = useRouter();
  const [sel, setSel] = useState<number | null>(null);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const [launching, setLaunching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const swallowClickUntil = useRef(0);
  const list = works ?? [];
  const current = sel !== null ? list[sel] : null;

  const focusTile = useCallback((i: number) => {
    const el = tiles.current[i];
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, []);

  const select = useCallback(
    (i: number, how: "tap" | "move") => {
      setSel(i);
      sfx(how === "tap" ? "select" : "move");
      if (how === "tap" && "vibrate" in navigator) navigator.vibrate?.(8);
      focusTile(i);
    },
    [focusTile],
  );

  const close = useCallback(() => {
    if (sel === null) return;
    sfx("back");
    setSel(null);
  }, [sel]);

  const launch = useCallback(
    (w: ArcadeWork) => {
      if (launching) return;
      sfx("start");
      if ("vibrate" in navigator) navigator.vibrate?.([10, 40, 18]);
      setLaunching(true);
      // 시작음과 입장 연출이 끝난 뒤에 연다.
      window.setTimeout(() => {
        setLaunching(false);
        if (w.url) window.open(w.url, "_blank", "noopener,noreferrer");
        else router.push(`/works/${w.slug}`);
      }, 420);
    },
    [launching, router],
  );

  /** 화면상 위치로 다음 타일을 찾는다(행·열 수가 화면 방향마다 달라서 계산 대신 측정). */
  const neighbor = useCallback(
    (from: number, dir: Dir) => {
      const a = tiles.current[from]?.getBoundingClientRect();
      if (!a) return from;
      const ax = a.left + a.width / 2;
      const ay = a.top + a.height / 2;
      let best = from;
      let bestScore = Infinity;
      tiles.current.forEach((el, i) => {
        if (!el || i === from) return;
        const b = el.getBoundingClientRect();
        const dx = b.left + b.width / 2 - ax;
        const dy = b.top + b.height / 2 - ay;
        const main = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
        const cross = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        if (main < 4) return;
        const score = main + cross * 2.5;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      return best;
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!list.length || e.altKey || e.metaKey || e.ctrlKey) return;
      const dirs: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const dir = dirs[e.key];
      if (dir) {
        e.preventDefault();
        if (sel === null) select(0, "move");
        else {
          const next = neighbor(sel, dir);
          if (next !== sel) select(next, "move");
        }
      } else if (e.key === "Escape") {
        close();
      } else if ((e.key === "Enter" || e.key === " ") && current && document.activeElement === tiles.current[sel!]) {
        e.preventDefault();
        launch(current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.length, sel, current, select, neighbor, close, launch]);

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    if (!next) sfx("select");
  };

  /**
   * 컴퓨터에는 터치 드래그가 없으니 마우스로 끄는 동작을 스크롤로 옮긴다.
   * 6px 넘게 움직인 뒤의 클릭(타일 선택·패널 닫기)은 삼켜서 드래그가 선택으로 새지 않게 한다.
   * 가로 목록에서 마우스 휠이 먹히지 않는 것도 같은 이벤트에서 함께 처리한다.
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    const reset = () => {
      drag.current = null;
      setDragging(false);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
    };

    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved) {
        if (dx * dx + dy * dy < 36) return;
        d.moved = true;
        setDragging(true);
      }
      el.scrollLeft = d.sl - dx;
      el.scrollTop = d.st - dy;
    };

    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      if (d.moved) swallowClickUntil.current = performance.now() + 400;
      reset();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() >= swallowClickUntil.current) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return; // 세로 배치에서는 기본 스크롤을 쓴다
      if (Math.abs(e.deltaX) > 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 트랙패드 가로 제스처는 그대로
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", reset);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", reset);
    };
  }, []);

  return (
    <div className={s.root} data-open={current ? "" : undefined} data-launching={launching ? "" : undefined} data-dragging={dragging ? "" : undefined}>
      {/* 배경 — 떠다니는 윤곽 도형 */}
      <div className={s.bg} aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={s.shape} style={{ "--k": i } as CSSProperties} />
        ))}
      </div>

      {/* 떠 있는 HUD — 막대 없이 모서리에만 놓아 타일 시야를 가리지 않는다 */}
      <div className={s.hudLeft}>
        <span className={s.logo} aria-hidden>
          ACT
        </span>
        <h1 className={s.hudTitle}>선생님 작품 아케이드</h1>
        {works && <span className={s.count}>{works.length}</span>}
      </div>
      <div className={s.hudRight}>
        <button type="button" className={s.hudBtn} onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? "효과음 켜기" : "효과음 끄기"}>
          {muted ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
              <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
              <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <Link href="/?web=1" className={s.hudBtn} aria-label="웹 화면으로 보기">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </Link>
      </div>

      {/* 타일 카탈로그 */}
      <div className={s.scroller} ref={scroller} onClick={(e) => e.target === e.currentTarget && close()}>
        {works === null ? (
          <ul className={s.grid} aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i} className={s.skeleton} />
            ))}
          </ul>
        ) : list.length === 0 ? (
          <p className={s.empty}>아직 공개된 작품이 없습니다.</p>
        ) : (
          <ul className={s.grid} onClick={(e) => e.target === e.currentTarget && close()}>
            {list.map((w, i) => (
              <li key={w.slug} style={{ "--i": i } as CSSProperties}>
                <span className={s.floater}>
                  <button
                    type="button"
                    ref={(el) => {
                      tiles.current[i] = el;
                    }}
                    className={s.tile}
                    data-purpose={w.purpose}
                    aria-pressed={sel === i}
                    aria-label={`${w.title}${sel === i ? " — 한 번 더 누르면 시작" : ""}`}
                    onClick={() => (sel === i ? launch(w) : select(i, "tap"))}
                  >
                    <span className={s.thumb}>
                      {w.thumbnail ? (
                        // 업로드 시 이미 1280/640 WebP로 만들어 두므로 next/image 최적화는 쓰지 않는다.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={small(w.thumbnail)} alt="" width={640} height={400} loading={i < 12 ? "eager" : "lazy"} decoding="async" draggable={false} />
                      ) : (
                        <span className={s.fallback}>{w.title}</span>
                      )}
                    </span>
                    <span className={s.label}>
                      <span className={s.dot} aria-hidden />
                      <span className={s.labelText}>{w.title}</span>
                    </span>
                    <span className={s.corners} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 입장 패널 — 타일을 고르면 하단에서 바로 올라온다 */}
      <div className={s.panel} role="region" aria-label="선택한 작품" aria-hidden={!current} inert={!current}>
        {current && (
          <div className={s.panelInner} key={current.slug}>
            <span className={s.panelThumb} data-purpose={current.purpose}>
              {current.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={small(current.thumbnail)} alt={current.thumbnailAlt ?? ""} width={640} height={400} />
              ) : (
                <span className={s.fallback}>{current.title}</span>
              )}
            </span>
            <div className={s.panelInfo}>
              <p className={s.panelTitle}>{current.title}</p>
              <p className={s.panelMeta}>
                <span className={s.chip} data-purpose={current.purpose}>
                  {WORK_PURPOSE_LABEL[current.purpose]}
                </span>
                <span className={s.chipGhost}>{WORK_TYPE_LABEL[current.type]}</span>
                {current.makers.length > 0 && <span className={s.maker}>{current.makers.join(", ")} 선생님</span>}
              </p>
            </div>
            <div className={s.panelActions}>
              <span className={s.likes} aria-label={`좋아요 ${current.likes}`}>
                ♥ {current.likes}
              </span>
              <Link href={`/works/${current.slug}`} className={s.infoBtn} onClick={() => sfx("select")}>
                정보
              </Link>
              <button type="button" className={s.startBtn} onClick={() => launch(current)}>
                <span aria-hidden>▶</span> 시작
              </button>
            </div>
            <button type="button" className={s.closeBtn} onClick={close} aria-label="선택 닫기">
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
