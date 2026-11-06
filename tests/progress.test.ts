/**
 * 해석 워커의 진행 알림 거르기(src/worker/progress.ts, 48차): 같은 단계 글은 40 ms마다, 비율은 뒤로 가지 않고,
 * 첫 알림과 앞으로 나아간 새 단계 글은 곧바로 보낸다(예전에는 워커를 띄운 지 40 ms 안의 첫 알림 '그림 꺼내는 중'이 빠졌다).
 */
import { describe, expect, it } from 'vitest';
import { PROGRESS_GAP_MS, progressFor } from '../src/worker/progress';

function run(calls: [number, number, string][]): [number, string][] {
  const sent: [number, string][] = [];
  let t = 0;
  const p = progressFor(
    (f, s) => sent.push([f, s]),
    () => t,
  );
  for (const [at, f, s] of calls) {
    t = at;
    p(f, s);
  }
  return sent;
}

describe('진행 알림 거르기', () => {
  it('워커를 띄운 지 40 ms 안의 첫 알림도 보낸다', () => {
    expect(run([[5, 0.01, '그림 꺼내는 중']])).toEqual([[0.01, '그림 꺼내는 중']]);
  });

  it('같은 단계 글은 40 ms마다, 끝(1)은 늘 보낸다', () => {
    const sent = run([
      [0, 0.4, '모형 요소 읽는 중'],
      [10, 0.41, '모형 요소 읽는 중'],
      [PROGRESS_GAP_MS - 1, 0.42, '모형 요소 읽는 중'],
      [PROGRESS_GAP_MS, 0.43, '모형 요소 읽는 중'],
      [PROGRESS_GAP_MS + 1, 1, '끝'],
    ]);
    expect(sent).toEqual([
      [0.4, '모형 요소 읽는 중'],
      [0.43, '모형 요소 읽는 중'],
      [1, '끝'],
    ]);
  });

  it('앞으로 나아간 새 단계 글은 40 ms 안이어도 곧바로, 뒤로 가는 글은 예전처럼 거르고 비율은 뒤로 가지 않는다', () => {
    const sent = run([
      [0, 0.01, '그림 꺼내는 중'],
      [3, 0.02, '파일 머리 읽는 중'],
      [6, 0.05, '꾸러미(ZIP) 목록 읽는 중'],
      [8, 0.1, '재질 읽는 중'],
      // 2020 이하처럼 앞 단계 값을 다시 알림(비율이 나아가지 않는 새 글) — 40 ms 안이면 거름
      [20, 0.02, '파일 머리 읽는 중'],
      [70, 0.02, '파일 머리 읽는 중'],
    ]);
    expect(sent).toEqual([
      [0.01, '그림 꺼내는 중'],
      [0.02, '파일 머리 읽는 중'],
      [0.05, '꾸러미(ZIP) 목록 읽는 중'],
      [0.1, '재질 읽는 중'],
      [0.1, '파일 머리 읽는 중'],
    ]);
  });
});
