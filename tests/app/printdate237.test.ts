// @vitest-environment jsdom
/**
 * 237차: 인쇄 머리(그림 한 장과 문서 이름·날짜 — exporter.ts printImage)의 날짜는 화면 언어 꼴로.
 * 전에는 `toLocaleDateString()`(브라우저 지역)이라 화면 언어와 브라우저 지역이 다르면 갈렸다(독일어 화면·영어 브라우저 「11/28/2026」, 영어 화면·한국어 브라우저 「2026. 11. 28.」).
 * 화면 언어는 번역층이 html lang에 둔다(i18n.ts metadata — ko·en·de·ja·zh-CN). 인쇄할 때 그리는 쪽이라 언어를 바꾼 뒤 다시 그릴 칸은 없다.
 * 문서 이름(파일 글)은 그대로, 쪽은 번역층 밖(data-i18n-skip)이다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printImage } from '../../src/app/exporter';

const url = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
const saved = { create: url.createObjectURL, revoke: url.revokeObjectURL };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  url.createObjectURL = saved.create;
  url.revokeObjectURL = saved.revoke;
  document.body.innerHTML = '';
  document.documentElement.lang = 'ko';
});

/**
 * 인쇄 쪽을 그리고 머리 글을 읽은 뒤 인쇄 끝(afterprint)으로 쪽을 거둔다. 날짜와 타이머는 가짜로(afterprint가 오지 않는 브라우저를 위한 60초 뒤 거두기가
 * 시험 파일이 끝난 뒤 돌지 않게 — useRealTimers가 버림)
 */
function printCap(lang: string): string {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(2026, 10, 28, 12, 0, 0));
  document.documentElement.lang = lang;
  url.createObjectURL = () => 'blob:print';
  url.revokeObjectURL = () => {};
  vi.spyOn(window, 'print').mockImplementation(() => {});
  printImage(new Blob([new Uint8Array(1)], { type: 'image/png' }), '주방 모형');
  const cap = document.querySelector('.print-sheet .print-cap');
  const text = cap?.textContent ?? '';
  expect(cap?.hasAttribute('data-i18n-skip')).toBe(true);
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.print-sheet')).toBeNull();
  return text;
}

describe('237차: 인쇄 머리 날짜는 화면 언어 꼴(브라우저 지역이 아님)', () => {
  it.each([
    ['ko', '2026. 11. 28.'],
    ['en', '11/28/2026'],
    ['de', '28.11.2026'],
    ['ja', '2026/11/28'],
    ['zh-CN', '2026/11/28'],
  ])('화면 언어 %s: 「주방 모형 · %s」', (lang, date) => {
    expect(printCap(lang)).toBe(`주방 모형 · ${date}`);
  });

  it('html lang이 비면 브라우저 지역 꼴(전과 같음)', () => {
    expect(printCap('')).toBe(`주방 모형 · ${new Date(2026, 10, 28, 12, 0, 0).toLocaleDateString()}`);
  });
});
