"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  DEFAULT_SORT,
  isArchiveSort,
  SORT_OPTIONS,
  sortLabel,
  sortWorks,
  WORK_PURPOSE_LABEL,
  WORK_TYPE_LABEL,
  type ArchiveSort,
  type WorkPurpose,
  type WorkType,
} from "@/lib/content/types";
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
  likeCount: number;
  bookmarkCount: number;
  /** 최신순 정렬용 타임스탬프(ms). 화면에서 정렬을 바꿔도 서버와 같은 순서가 나온다. */
  publishedAt: number;
};

type Dir = "left" | "right" | "up" | "down";

/** 업로드 썸네일은 1280w와 -640 두 장이 있다(components/Thumbnail.tsx와 같은 규칙). */
function small(src: string) {
  return /\.webp$/.test(src) ? src.replace(/\.webp$/, "-640.webp") : src;
}

/** 드래그로 끝난 클릭만 삼킨다. 키보드로 연 클릭(detail 0)은 그대로 둔다. */
const swallowedClick = (e: { detail: number }, until: number) => e.detail > 0 && performance.now() < until;

/**
 * 게임 콘솔 라이브러리처럼 작품 타일을 고르는 화면.
 * - 타일을 누르면 선택 효과음과 함께 커지고, 하단에 "게임 입장" 패널이 바로 올라온다.
 * - 선택된 타일을 한 번 더 누르거나 [시작]을 누르면 작품을 연다.
 * - 화살표 키·Enter·Esc로도 움직인다(블루투스 컨트롤러나 키보드).
 * 작품 정보는 패널에만 띄우고, 평소에는 타일이 화면 전체를 쓴다.
 */
export function Arcade({ works, sort: initialSort }: { works: ArcadeWork[] | null; sort: ArchiveSort }) {
  const router = useRouter();
  const [sel, setSel] = useState<number | null>(null);
  const [sort, setSort] = useState<ArchiveSort>(initialSort);
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrap = useRef<HTMLDivElement | null>(null);
  const sortBtn = useRef<HTMLButtonElement | null>(null);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const [launching, setLaunching] = useState(false);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
  const swallowClickUntil = useRef(0);
  // 서버가 최신순으로 넘긴 목록을 화면에서 바로 정렬한다. 처음 순서는 ?sort=를 따른다.
  const list = useMemo(() => sortWorks(works ?? [], sort), [works, sort]);
  const current = sel !== null ? list[sel] : null;

  /** 키보드로 닫았거나 골랐으면 사라진 메뉴 대신 정렬 버튼에 초점을 돌려준다. */
  const closeSort = () => {
    setSortOpen(false);
    sortBtn.current?.focus();
  };

  /** 정렬을 바꾸면 처음 자리로 돌아가고, 주소에도 남겨 새로고침·공유 때 같은 순서로 연다. */
  const pickSort = (next: ArchiveSort) => {
    closeSort();
    if (next === sort) return;
    setSort(next);
    setSel(null);
    scrollerRef.current?.scrollTo({ left: 0, top: 0 });
    window.history.replaceState(null, "", next === DEFAULT_SORT ? "/arcade" : `/arcade?sort=${next}`);
    sfx("select");
  };

  // 뒤로 가기·앞으로 가기로 돌아오면 주소의 기준을 따른다 — 주소가 정렬의 기준이다.
  // (목록이 오는 동안에는 정렬 버튼을 잠가 두어, 서버가 넘긴 기준과 화면이 어긋나지 않는다.)
  const shownSort = useRef<ArchiveSort>(initialSort);
  useEffect(() => {
    shownSort.current = sort;
  }, [sort]);
  useEffect(() => {
    const onPop = () => {
      const value = new URLSearchParams(window.location.search).get("sort");
      const next = isArchiveSort(value) ? value : DEFAULT_SORT;
      // 기준이 달라지면 이전 선택은 다른 작품을 가리키므로 닫는다.
      if (next !== shownSort.current) {
        setSort(next);
        setSel(null);
        setSortOpen(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 메뉴 밖을 누르면 접는다. 누른 대상의 초점은 건드리지 않는다.
  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!sortWrap.current?.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [sortOpen]);

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
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      // Esc는 정렬 메뉴 → 작품 선택 순서로 닫는다. 목록이 비어 있거나 초점이 정렬 영역에 있어도 동작한다.
      if (e.key === "Escape") {
        if (sortOpen) {
          e.preventDefault();
          setSortOpen(false);
          sortBtn.current?.focus();
        } else {
          close();
        }
        return;
      }
      // 정렬 영역에 초점이 있으면 Tab·Enter·화살표는 그 영역의 기본 동작에 맡긴다.
      if (sortWrap.current?.contains(e.target as Node)) return;
      if (!list.length) return;
      const dirs: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const dir = dirs[e.key];
      if (dir) {
        e.preventDefault();
        if (sel === null) select(0, "move");
        else {
          const next = neighbor(sel, dir);
          if (next !== sel) select(next, "move");
        }
      } else if ((e.key === "Enter" || e.key === " ") && current && document.activeElement === tiles.current[sel!]) {
        e.preventDefault();
        launch(current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.length, sel, current, select, neighbor, close, launch, sortOpen]);

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

    /* 스크롤 흔들림의 최대 이동량. 90%로 줄인 타일이 셀에 남기는 여백과 세로 간격(--row-gap)에서
     * 나온 값이라, 이보다 키우면 스크롤 중 위아래 이웃 타일의 테두리·바닥 그림자가 서로를 파고든다
     * (모바일 가로 844×390·데스크톱에서 확인). 스프링이 목표를 넘어 튀는 만큼도 여기서 자른다. */
    const WOBBLE = { x: 3.5, y: 2.5, rot: 2 };

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

        // 스프링이 튀어도 셀 여백을 넘지 않게 실제 위치도 자른다.
        st.x = clamp(st.x, -WOBBLE.x, WOBBLE.x);
        st.y = clamp(st.y, -WOBBLE.y, WOBBLE.y);
        st.rot = clamp(st.rot, -WOBBLE.rot, WOBBLE.rot);

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

        // 진폭 상한은 타일 셀 여백에서 나온 값이다. 이보다 키우면 스크롤 중 위아래 이웃의
        // 그림자·테두리가 서로를 파고든다(모바일 가로 844×390에서 확인).
        st.tx = clamp((-smoothDx * st.xGain + smoothDy * st.yCross * 0.5) * 0.22 * ripple + waveX, -WOBBLE.x, WOBBLE.x);
        st.ty = clamp((-smoothDy * st.xGain + smoothDx * st.yCross) * 0.22 * ripple + waveY, -WOBBLE.y, WOBBLE.y);
        st.trot = clamp((smoothDx * 0.11 - smoothDy * 0.08) * st.rotDir * ripple + waveY * 0.18, -WOBBLE.rot, WOBBLE.rot);
      }

      if (!rafId) {
        root.dataset.scrolling = "";
        rafId = window.requestAnimationFrame(tick);
      }
    };

    // 스크롤한 뒤 추가 스크롤 없이 모션 감소를 켜면 배경 오프셋과 흔들림이 그대로 남는다.
    // 설정이 바뀌는 순간 0으로 되돌려 다음 스크롤까지 어긋난 위치에 머물지 않게 한다.
    const onReduceChange = () => {
      if (!reduceMotion.matches) return;
      root.style.setProperty("--bg-x", "0px");
      root.style.setProperty("--bg-y", "0px");
      // 누적된 스크롤 속도까지 지워, 다시 켠 뒤 첫 스크롤이 이전 속도로 크게 흔들리지 않게 한다.
      smoothDx = smoothDy = 0;
      clearTileVars();
      delete root.dataset.scrolling;
      if (rafId) window.cancelAnimationFrame(rafId);
      rafId = 0;
    };
    reduceMotion.addEventListener("change", onReduceChange);

    // PC 마우스 드래그로도 가로/세로 스크롤을 당길 수 있게 지원
    let dragging = false;
    let dragPointer = -1;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      // 새 입력이 시작되면 이전 드래그로 막아 둔 클릭을 풀어 준다.
      swallowClickUntil.current = 0;
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      dragging = true;
      // 드래그를 시작한 포인터만 끝낸다. 손가락을 떼는 pointerup이 마우스 드래그를 끊지 않게.
      dragPointer = e.pointerId;
      draggedRef.current = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = el.scrollLeft;
      startTop = el.scrollTop;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== dragPointer) return;
      dragging = false;
      dragPointer = -1;
      delete el.dataset.dragging;
      // 드래그로 끝난 클릭은 삼킨다. setTimeout(0) 순서에 기대지 않고 명시적인 시간 창을 둔다.
      if (draggedRef.current) swallowClickUntil.current = performance.now() + 400;
    };

    const onPointerMove = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (!dragging || e.pointerId !== dragPointer) return;
      if ((e.buttons & 1) === 0) {
        onPointerUp(e);
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
      // 트랙패드 확대(ctrl+휠)는 가로채면 안 된다.
      if (e.ctrlKey) return;
      if (el.scrollWidth <= el.clientWidth + 1) return;
      // 가로 성분이 우세하면 브라우저 기본 가로 스크롤에 맡긴다(대각선 입력 포함).
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      e.preventDefault();
      // 줄(1)·페이지(2) 단위 입력은 픽셀로 환산해 더한다.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += e.deltaY * unit;
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
      reduceMotion.removeEventListener("change", onReduceChange);
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
        {/* 정렬 — 고른 기준은 주소에 남겨 새로고침·공유에도 유지된다 */}
        <div
          className={s.sortWrap}
          ref={sortWrap}
          // Tab으로 정렬 영역을 벗어나면 메뉴만 닫고, 초점은 사용자가 옮긴 곳에 그대로 둔다.
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSortOpen(false);
          }}
        >
          <button
            type="button"
            ref={sortBtn}
            className={s.sortBtn}
            onClick={() => setSortOpen((open) => !open)}
            disabled={works === null}
            aria-expanded={sortOpen}
            aria-controls="arcade-sort-menu"
            aria-label={`정렬 기준: ${sortLabel(sort)}`}
            title={`정렬: ${sortLabel(sort)}`}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <path d="M4 7h10M4 12h7M4 17h4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M17 5v13m0 0-3-3m3 3 3-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={s.sortText}>{sortLabel(sort)}</span>
          </button>
          {sortOpen && (
            <div className={s.sortMenu} id="arcade-sort-menu" role="group" aria-label="정렬 기준">
              {SORT_OPTIONS.map((o) => (
                <button key={o.value} type="button" aria-pressed={o.value === sort} onClick={() => pickSort(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
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
          if (swallowedClick(e, swallowClickUntil.current)) return;
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
            key={sort}
            className={s.grid}
            onClick={(e) => {
              if (swallowedClick(e, swallowClickUntil.current)) return;
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
                  onClick={(e) => {
                    if (swallowedClick(e, swallowClickUntil.current)) return;
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
              <span className={s.likes} aria-label={`좋아요 ${current.likeCount}`}>
                ♥ {current.likeCount}
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
