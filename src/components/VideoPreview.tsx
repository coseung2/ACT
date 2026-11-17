"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./VideoPreview.module.css";

/**
 * 카드 썸네일 위에 마우스를 올리면 영상을 조용히 미리 재생한다(스트리밍 사이트처럼).
 * 터치 기기·모션 최소화 설정에서는 썸네일 그대로 두고, 영상이라는 표시만 남긴다.
 * 영상은 hover 전까지 preload="none"이라 목록을 훑기만 해도 데이터를 쓰지 않는다.
 */
export function VideoPreview({ src, children }: { src: string; children: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const timer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const stop = () => {
    clearTimer();
    const el = video.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPlaying(false);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      video.current?.pause();
    },
    [],
  );

  const canPreview = () =>
    window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** 지나가듯 스치는 움직임에는 영상을 받지 않도록 잠깐 기다린다. */
  const start = () => {
    if (timer.current !== null || playing) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const el = video.current;
      if (!el) return;
      el.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
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
