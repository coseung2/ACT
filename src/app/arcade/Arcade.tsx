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
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
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
      const fromEl = tiles.current[from];
      const a = (fromEl?.parentElement ?? fromEl)?.getBoundingClientRect();
      if (!a) return from;
      const ax = a.left + a.width / 2;
      const ay = a.top + a.height / 2;
      let best = from;
      let bestScore = Infinity;
      tiles.current.forEach((el, i) => {
        if (!el || i === from) return;
        const b = (el.parentElement ?? el).getBoundingClientRect();
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

  useEffect(() => {
    const el = scrollerRef.current;
    const root = el?.parentElement;
    if (!el || !root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lastX = el.scrollLeft;
    let lastY = el.scrollTop;
    let smoothDx = 0;
    let smoothDy = 0;
    let pointerX = (el.clientWidth || window.innerWidth) * 0.5;
    let pointerY = (el.clientHeight || window.innerHeight) * 0.5;
    let rafId = 0;

    type TilePhysics = {
      x: number;
      y: number;
      rot: number;
      vx: number;
      vy: number;
      vrot: number;
      tx: number;
      ty: number;
      trot: number;
      stiff: number;
      damp: number;
      xGain: number;
      yCross: number;
      rotDir: number;
      wavePhase: number;
      waveFreq: number;
    };

    const states: TilePhysics[] = [];
    const getState = (i: number): TilePhysics => {
      let st = states[i];
      if (!st) {
        const phi = (i + 1) * 2.399963;
        st = {
          x: 0,
          y: 0,
          rot: 0,
          vx: 0,
          vy: 0,
          vrot: 0,
          tx: 0,
          ty: 0,
          trot: 0,
          stiff: 0.045 + ((i * 37) % 19) * 0.003,
          damp: 0.78 + ((i * 53) % 13) * 0.005,
          xGain: 0.45 + Math.abs(Math.sin(phi)) * 0.45,
          yCross: Math.cos(phi * 1.7) * 0.35,
          rotDir: (i % 3 === 0 ? -1 : 1) * (0.45 + Math.abs(Math.sin(phi * 2.3)) * 0.45),
          wavePhase: phi * 2.0,
          waveFreq: 0.007 + (i % 5) * 0.0018,
        };
        states[i] = st;
      }
      return st;
    };

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    const clearTileVars = () => {
      const len = Math.max(tiles.current.length, states.length);
      for (let i = 0; i < len; i++) {
        const st = states[i];
        if (st) {
          st.x = st.y = st.rot = st.vx = st.vy = st.vrot = st.tx = st.ty = st.trot = 0;
        }
        const tile = tiles.current[i];
        if (tile) {
          tile.style.setProperty("--dx", "0px");
          tile.style.setProperty("--dy", "0px");
          tile.style.setProperty("--drot", "0deg");
        }
      }
    };

    const tick = () => {
      if (reduceMotion.matches) {
        clearTileVars();
        delete root.dataset.scrolling;
        rafId = 0;
        return;
      }

      let allSettled = true;
      const len = tiles.current.length;
      for (let i = 0; i < len; i++) {
        const tile = tiles.current[i];
        if (!tile) continue;
        const st = getState(i);

        st.vx = (st.vx + (st.tx - st.x) * st.stiff) * st.damp;
        st.vy = (st.vy + (st.ty - st.y) * st.stiff) * st.damp;
        st.vrot = (st.vrot + (st.trot - st.rot) * st.stiff) * st.damp;
        st.x += st.vx;
        st.y += st.vy;
        st.rot += st.vrot;

        st.tx *= 0.84;
        st.ty *= 0.84;
        st.trot *= 0.84;

        tile.style.setProperty("--dx", `${st.x.toFixed(2)}px`);
        tile.style.setProperty("--dy", `${st.y.toFixed(2)}px`);
        tile.style.setProperty("--drot", `${st.rot.toFixed(2)}deg`);

        if (
          Math.abs(st.x) >= 0.05 ||
          Math.abs(st.y) >= 0.05 ||
          Math.abs(st.rot) >= 0.05 ||
          Math.abs(st.vx) >= 0.05 ||
          Math.abs(st.vy) >= 0.05 ||
          Math.abs(st.vrot) >= 0.05 ||
          Math.abs(st.tx) >= 0.05 ||
          Math.abs(st.ty) >= 0.05 ||
          Math.abs(st.trot) >= 0.05
        ) {
          allSettled = false;
        }
      }

      if (allSettled) {
        smoothDx = smoothDy = 0;
        clearTileVars();
        delete root.dataset.scrolling;
        rafId = 0;
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const onScroll = () => {
      const dx = el.scrollLeft - lastX;
      const dy = el.scrollTop - lastY;
      lastX = el.scrollLeft;
      lastY = el.scrollTop;

      if (reduceMotion.matches) {
        root.style.setProperty("--bg-x", "0px");
        root.style.setProperty("--bg-y", "0px");
        return;
      }

      root.style.setProperty("--bg-x", `${(-el.scrollLeft * 0.12).toFixed(1)}px`);
      root.style.setProperty("--bg-y", `${(-el.scrollTop * 0.12).toFixed(1)}px`);

      smoothDx = smoothDx * 0.65 + dx * 0.35;
      smoothDy = smoothDy * 0.65 + dy * 0.35;
      const sPos = el.scrollLeft + el.scrollTop;
      const speedFactor = clamp(Math.hypot(smoothDx, smoothDy) / 36, 0, 1);
      const len = tiles.current.length;

      for (let i = 0; i < len; i++) {
        if (!tiles.current[i]) continue;
        const st = getState(i);
        const ripple = 0.65 + 0.7 * (0.5 + 0.5 * Math.sin(st.wavePhase * 0.7 + pointerX * 0.008 + pointerY * 0.008));
        const waveX = Math.cos(sPos * st.waveFreq + st.wavePhase) * speedFactor * 1.8;
        const waveY = Math.sin(sPos * st.waveFreq + st.wavePhase) * speedFactor * 2.2;

        st.tx = clamp((-smoothDx * st.xGain + smoothDy * st.yCross * 0.5) * 0.22 * ripple + waveX, -6, 6);
        st.ty = clamp((-smoothDy * st.xGain + smoothDx * st.yCross) * 0.22 * ripple + waveY, -5, 5);
        st.trot = clamp((smoothDx * 0.11 - smoothDy * 0.08) * st.rotDir * ripple + waveY * 0.18, -2.4, 2.4);
      }

      if (!rafId) {
        root.dataset.scrolling = "";
        rafId = window.requestAnimationFrame(tick);
      }
    };

    // PC 마우스 드래그로도 가로/세로 스크롤을 당길 수 있게 지원
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      dragging = true;
      draggedRef.current = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      delete el.dataset.dragging;
      // 드래그로 끝난 클릭은 삼킨다. setTimeout(0) 순서에 기대지 않고 명시적인 시간 창을 둔다.
      if (draggedRef.current) swallowClickUntil.current = performance.now() + 400;
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (!dragging) return;
      if ((e.buttons & 1) === 0) {
        onPointerUp();
        return;
      }
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!draggedRef.current && Math.hypot(dx, dy) > 6) {
        draggedRef.current = true;
        el.dataset.dragging = "";
      }
      if (draggedRef.current) {
        el.scrollLeft = startLeft - dx;
        el.scrollTop = startTop - dy;
      }
    };

    // 가로 목록은 overflow-y가 hidden이라 세로 휠이 그냥 죽는다. 세로 휠을 가로 이동으로 돌린다.
    // 세로로 쌓이는 화면(포트레이트)에서는 가로 스크롤이 없으므로 기본 스크롤을 그대로 쓴다.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(e.deltaX) > 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (rafId) window.cancelAnimationFrame(rafId);
      clearTileVars();
      delete root.dataset.scrolling;
      delete el.dataset.dragging;
    };
  }, []);

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    if (!next) sfx("select");
  };

  return (
    <div className={s.root} data-open={current ? "" : undefined} data-launching={launching ? "" : undefined}>
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
      <div
        ref={scrollerRef}
        className={s.scroller}
        onClick={(e) => {
          if (performance.now() < swallowClickUntil.current) return;
          if (e.target === e.currentTarget) close();
        }}
      >
        {works === null ? (
          <ul className={s.grid} aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i} className={s.skeleton} />
            ))}
          </ul>
        ) : list.length === 0 ? (
          <p className={s.empty}>아직 공개된 작품이 없습니다.</p>
        ) : (
          <ul
            className={s.grid}
            onClick={(e) => {
              if (performance.now() < swallowClickUntil.current) return;
              if (e.target === e.currentTarget) close();
            }}
          >
            {list.map((w, i) => (
              <li key={w.slug} style={{ "--i": i } as CSSProperties}>
                <button
                  type="button"
                  ref={(el) => {
                    tiles.current[i] = el;
                  }}
                  className={s.tile}
                  data-purpose={w.purpose}
                  aria-pressed={sel === i}
                  aria-label={`${w.title}${sel === i ? " — 한 번 더 누르면 시작" : ""}`}
                  onClick={() => {
                    if (performance.now() < swallowClickUntil.current) return;
                    if (sel === i) launch(w);
                    else select(i, "tap");
                  }}
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
