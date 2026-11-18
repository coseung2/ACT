"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { isMuted, subscribeMuted } from "./sfx";

/**
 * 아케이드 배경음 셋. 1→3→4→1 순서로 이어 재생한다.
 * - happy-adventure: OpenGameArt, CC0 (표기 불필요)
 * - arcade-quirkiness / nostalgic-for-arcades: Eric Matyas, soundimage.org (화면에 표기)
 * 자세한 출처는 화면 왼쪽 아래 크레딧에 적는다(Arcade.tsx).
 */
const TRACKS = ["/audio/happy-adventure.mp3", "/audio/arcade-quirkiness.mp3", "/audio/nostalgic-for-arcades.mp3"] as const;

/** 효과음을 덮지 않을 만큼만. */
const VOLUME = 0.45;
const FADE_IN_MS = 900;
const FADE_OUT_MS = 1200;

/**
 * 배경음 재생기.
 * 브라우저는 조작 없이 소리를 내지 못하므로 첫 탭·키 입력에서 시작하고,
 * 그 뒤로는 화면이 보이는 동안 계속 재생한다. 음소거는 효과음과 같은 스위치를 쓴다.
 */
export function ArcadeMusic() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const track = useRef(0);
  const started = useRef(false);
  const fadeTimer = useRef(0);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;

    el.volume = 0;

    const fadeTo = (target: number, ms: number) => {
      window.clearInterval(fadeTimer.current);
      const from = el.volume;
      const t0 = performance.now();
      fadeTimer.current = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        el.volume = from + (target - from) * k;
        if (k === 1) window.clearInterval(fadeTimer.current);
      }, 40);
    };

    const play = () => {
      if (isMuted() || !started.current || document.hidden) return;
      el.play().then(
        () => fadeTo(VOLUME, FADE_IN_MS),
        () => {
          // 자동재생이 막히면 다음 조작에서 다시 시도한다.
          started.current = false;
        },
      );
    };

    const next = () => {
      track.current = (track.current + 1) % TRACKS.length;
      el.src = TRACKS[track.current];
      el.volume = 0;
      play();
    };

    // 트랙 끝에서 뚝 끊기지 않게 마지막 구간의 볼륨을 미리 낮춘다.
    const onTime = () => {
      if (el.duration && el.currentTime > el.duration - FADE_OUT_MS / 1000) fadeTo(0, FADE_OUT_MS);
    };

    const onVisibility = () => {
      if (document.hidden) el.pause();
      else play();
    };

    const onGesture = () => {
      if (started.current) return;
      started.current = true;
      play();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };

    el.addEventListener("ended", next);
    el.addEventListener("timeupdate", onTime);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      el.removeEventListener("ended", next);
      el.removeEventListener("timeupdate", onTime);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      window.clearInterval(fadeTimer.current);
      el.pause();
    };
  }, []);

  // 음소거를 켜면 즉시 멈추고, 끄면(버튼 조작이므로 재생 허용) 이어서 튼다.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (muted) {
      window.clearInterval(fadeTimer.current);
      el.volume = 0;
      el.pause();
    } else if (started.current && el.paused && !document.hidden) {
      el.play().then(
        () => {
          el.volume = VOLUME;
        },
        () => {},
      );
    }
  }, [muted]);

  return <audio ref={audio} src={TRACKS[0]} preload="none" aria-hidden />;
}
