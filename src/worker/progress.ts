/**
 * 해석 워커의 진행 알림 거르기(parse.worker.ts). 같은 단계 글은 40 ms마다만 보내고, 비율은 뒤로 가지 않는다
 * (2020 이하는 그림을 꺼내며 모형을 먼저 다 읽고, 해석기는 그 모형을 이어 쓰며 앞 단계 값을 다시 알린다).
 * 48차: 첫 알림과 앞으로 나아간 새 단계 글은 곧바로 보낸다 — 예전에는 워커를 띄운 지 40 ms 안의 첫 알림('그림 꺼내는 중')이 빠져
 * 큰 모형은 그림·재질을 읽는 동안(0.1~0.3초) 단계 글 없이 기다렸고, 앞 알림 뒤 40 ms 안에 바뀐 단계도 빠졌다.
 * 앞 단계로 돌아가는 글(비율이 나아가지 않는 새 글)은 예전처럼 40 ms 거르기를 따른다.
 */

/** 같은 단계 글을 다시 보내는 가장 짧은 사이(ms) */
export const PROGRESS_GAP_MS = 40;

export function progressFor(send: (fraction: number, stage: string) => void, now: () => number = () => performance.now()): (fraction: number, stage: string) => void {
  let last = -Infinity;
  let lastStage = '';
  let high = 0;
  return (fraction, stage) => {
    const t = now();
    if (fraction < 1 && t - last < PROGRESS_GAP_MS && !(stage !== lastStage && fraction > high)) return;
    last = t;
    lastStage = stage;
    high = Math.max(high, Math.max(0, Math.min(1, fraction)));
    send(high, stage);
  };
}
