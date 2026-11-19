/**
 * 배경음이 실제로 재생 중인지 알리는 아주 작은 저장소.
 * 이퀄라이저 표시를 재생 상태에 맞추기 위해서만 쓴다(음소거와는 별개 —
 * 자동재생이 막힌 경우 음소거는 풀려 있지만 소리는 나지 않는다).
 */
let playing = false;
const listeners = new Set<() => void>();

export function isPlaying() {
  return playing;
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
