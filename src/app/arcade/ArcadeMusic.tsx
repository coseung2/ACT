"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { isMuted, subscribeMuted } from "./sfx";
import { setPlaying, setPlayHandler } from "./player";

/**
 * 아케이드 배경음 셋. 이 순서로 이어 재생하고 끝나면 처음으로 돌아간다.
 * - happy-adventure: TinyWorlds / OpenGameArt, CC0 (표기 불필요)
 * - arcade-quirkiness, nostalgic-for-arcades: Eric Matyas / soundimage.org, CC BY
 * 크레딧은 화면 왼쪽 아래에 있다(Arcade.tsx).
 */
const TRACKS = ["/audio/happy-adventure.mp3", "/audio/arcade-quirkiness.mp3", "/audio/nostalgic-for-arcades.mp3"] as const;

/** 효과음을 덮지 않을 만큼만. */
const VOLUME = 0.45;
const FADE_IN_MS = 900;
const FADE_OUT_MS = 1200;

/**
 * 배경음 재생기.
 * 들어오면 바로 재생을 시도한다. 브라우저가 막으면(첫 방문에 조작이 없었던 경우)
 * 그때만 첫 클릭·키 입력을 기다렸다가 시작하고, 그 뒤로는 화면이 보이는 동안 계속 재생한다.
 * 음소거는 효과음과 같은 스위치를 쓴다.
 */
export function ArcadeMusic() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const audio = useRef<HTMLAudioElement | null>(null);
  /** 음소거 상태가 바뀔 때 effect 밖에서 재생을 멈추고 트는 통로. */
  const api = useRef({ pause() {}, resume() {} });

  useEffect(() => {
    const el = audio.current;
    if (!el) return;

    let track = 0;
    /** 사용자가 한 번이라도 조작했는가. 자동재생이 막히면 첫 조작에서 다시 시도한다. */
    let started = true;
    let fadingOut = false;
    let failures = 0;
    let fadeTimer = 0;
    /** 정리(언마운트) 뒤에 늦게 도착한 play() 콜백이 타이머를 다시 만들지 않게 한다. */
    let alive = true;

    el.volume = 0;

    const clearFade = () => {
      window.clearInterval(fadeTimer);
      fadeTimer = 0;
    };

    const fadeTo = (target: number, ms: number) => {
      clearFade();
      const from = el.volume;
      const t0 = performance.now();
      fadeTimer = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        el.volume = from + (target - from) * k;
        if (k === 1) clearFade();
      }, 40);
    };

    const stopListening = () => {
      window.removeEventListener("click", onGesture);
      window.removeEventListener("keydown", onGesture);
    };

    const play = () => {
      if (isMuted() || !started || document.hidden) return;
      el.play().then(
        () => {
          // 그사이 음소거가 걸렸거나 언마운트됐으면 페이드 인을 시작하지 않는다.
          if (!alive || isMuted()) return;
          failures = 0;
          fadingOut = false;
          // 재생이 실제로 시작됐으니 첫 조작 대기 리스너는 이제 필요 없다.
          stopListening();
          fadeTo(VOLUME, FADE_IN_MS);
        },
        (err: unknown) => {
          // 탭을 숨겨 중단된 경우(AbortError)나 곡 자체를 못 읽은 경우는 의지를 유지하고,
          // 자동재생 차단(NotAllowedError)일 때만 다음 조작에서 다시 시도한다.
          if ((err as DOMException | undefined)?.name === "NotAllowedError") started = false;
        },
      );
    };

    const next = () => {
      if (!alive) return;
      clearFade();
      fadingOut = false;
      track = (track + 1) % TRACKS.length;
      el.volume = 0;
      el.src = TRACKS[track];
      play();
    };

    // 끝에서 뚝 끊기지 않게 미리 볼륨을 낮춘다. 남은 시간에 맞춰 0까지 내려간다.
    // timeupdate는 여러 번 오므로 한 번만 건다.
    const onTime = () => {
      if (fadingOut || !el.duration) return;
      const left = el.duration - el.currentTime;
      if (left <= FADE_OUT_MS / 1000) {
        fadingOut = true;
        // 타이머 첫 틱(40ms) 뒤에도 끝나기 전에 0이 되도록 조금 일찍 끝낸다.
        fadeTo(0, Math.max(120, left * 1000 - 80));
      }
    };

    const onError = () => {
      // 받지 못한 곡은 건너뛴다. 세 곡이 모두 실패하면 조용히 멈춘다.
      if (failures + 1 >= TRACKS.length) {
        started = false;
        return;
      }
      failures += 1;
      next();
    };

    const onVisibility = () => {
      if (document.hidden) el.pause();
      else play();
    };

    // 이퀄라이저 표시는 실제로 소리가 나는 상태를 따른다. 데이터가 모자라 소리가 끊긴
    // 구간(waiting)에도 막대가 움직이지 않게 하고, 재생이 시작될 때만 켠다.
    const onPlaying = () => setPlaying(true);
    const onWaiting = () => setPlaying(false);
    const onPause = () => setPlaying(false);

    // 첫 소리는 사용자 조작 안에서 시작해야 한다. 터치·마우스 모두 click으로 들어온다.
    function onGesture() {
      started = true;
      play();
    }

    el.addEventListener("ended", next);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("error", onError);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("pause", onPause);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("click", onGesture);
    window.addEventListener("keydown", onGesture);

    api.current = {
      pause() {
        clearFade();
        el.volume = 0;
        el.pause();
      },
      resume() {
        started = true;
        play();
      },
    };

    // 들어오자마자 재생을 시도한다. 사이트 안에서 이동해 왔다면 이 조작이 인정되어 바로 시작한다.
    play();
    // 자동재생이 막혔을 때 버튼 한 번으로 재생을 다시 시도할 수 있게 한다.
    setPlayHandler(() => {
      started = true;
      play();
    });

    return () => {
      alive = false;
      setPlaying(false);
      setPlayHandler(null);
      el.removeEventListener("ended", next);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("error", onError);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("pause", onPause);
      document.removeEventListener("visibilitychange", onVisibility);
      stopListening();
      clearFade();
      el.pause();
      api.current = { pause() {}, resume() {} };
    };
  }, []);

  // 음소거를 켜면 즉시 멈추고, 끄면(그 조작으로 재생이 허용되므로) 이어서 튼다.
  useEffect(() => {
    if (muted) api.current.pause();
    else api.current.resume();
  }, [muted]);

  return <audio ref={audio} src={TRACKS[0]} preload="none" aria-hidden />;
}
