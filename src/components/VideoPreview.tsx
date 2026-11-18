"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import s from "./VideoPreview.module.css";

/**
 * 카드 썸네일 위에 마우스를 올리면 영상을 조용히 미리 재생한다(스트리밍 사이트처럼).
 * 터치 기기·모션 최소화 설정에서는 썸네일 그대로 두고, 영상이라는 표시만 남긴다.
 * 영상은 hover 전까지 preload="none"이라 목록을 훑기만 해도 데이터를 쓰지 않는다.
 */
export function VideoPreview({ src, children }: { src: string; children: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const timer = useRef<number | null>(null);
  /** 재생 시도마다 올린다. 포인터가 먼저 나가면 늦게 도착한 play() 결과를 버리는 데 쓴다. */
  const attempt = useRef(0);
  const [playing, setPlaying] = useState(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    attempt.current += 1;
    clearTimer();
    const el = video.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPlaying(false);
  }, [clearTimer]);

  // 재생 중이거나 예약된 뒤에 모션 감소를 켜면 영상이 계속 돌아간다. 설정이 바뀌는 즉시 접는다.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const el = video.current;
    const onChange = () => {
      if (reduce.matches) stop();
    };
    reduce.addEventListener("change", onChange);
    return () => {
      reduce.removeEventListener("change", onChange);
      clearTimer();
      el?.pause();
    };
  }, [clearTimer, stop]);

  const canPreview = () =>
    window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** 지나가듯 스치는 움직임에는 영상을 받지 않도록 잠깐 기다린다. */
  const start = () => {
    if (timer.current !== null || playing) return;
    const id = ++attempt.current;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const el = video.current;
      // 기다리는 사이 모션 감소가 켜졌으면 시작하지 않는다.
      if (!el || !canPreview()) return;
      el.play().then(
        () => {
          if (attempt.current === id) setPlaying(true);
        },
        () => {
          if (attempt.current === id) setPlaying(false);
        },
      );
    }, 220);
  };

  return (
    <span
      className={s.wrap}
      data-playing={playing ? "" : undefined}
      onPointerEnter={(ev) => {
        if (ev.pointerType === "mouse" && canPreview()) start();
      }}
      onPointerLeave={(ev) => {
        if (ev.pointerType === "mouse") stop();
      }}
    >
      {children}
      {/* 장식용이라 초점·낭독 대상에서 뺀다. 링크 이동은 카드가 그대로 맡는다. */}
      <video ref={video} className={s.video} src={src} muted loop playsInline preload="none" tabIndex={-1} aria-hidden />
      <span className={s.badge} aria-hidden>
        <svg viewBox="0 0 24 24" width="11" height="11">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
        영상
      </span>
    </span>
  );
}
