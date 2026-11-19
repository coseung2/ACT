/**
 * 배경음이 실제로 재생 중인지 알리는 아주 작은 저장소.
 * 이퀄라이저 표시를 재생 상태에 맞추기 위해서만 쓴다(음소거와는 별개 —
 * 자동재생이 막힌 경우 음소거는 풀려 있지만 소리는 나지 않는다).
 */
let playing = false;
/** 이번 방문에서 재생이 한 번이라도 시작됐는가. 버퍼링(waiting)과 "아직 못 틀었음"을 구분한다. */
let started = false;
/** 세 곡을 모두 받지 못해 재생 자체가 불가능한 상태. 버튼이 "재생 시도"에 갇히지 않게 구분한다. */
let failed = false;
const listeners = new Set<() => void>();

export function isPlaying() {
  return playing;
}

export function hasStarted() {
  return started;
}

export function isFailed() {
  return failed;
}

export function subscribePlaying(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setPlaying(v: boolean) {
  if (playing === v) return;
  playing = v;
  listeners.forEach((fn) => fn());
}

export function setStarted(v: boolean) {
  if (started === v) return;
  started = v;
  listeners.forEach((fn) => fn());
}

export function setFailed(v: boolean) {
  if (failed === v) return;
  failed = v;
  listeners.forEach((fn) => fn());
}

/**
 * 화면 밖(버튼)에서 재생을 요청하는 통로.
 * 자동재생이 막혀 음소거는 풀려 있는데 소리만 안 나는 상태에서,
 * 버튼을 누르면 "끄기"가 아니라 "재생 시도"가 되도록 쓰인다.
 */
let playRequest: (() => void) | null = null;

export function setPlayHandler(fn: (() => void) | null) {
  playRequest = fn;
}

export function requestPlay() {
  playRequest?.();
}
