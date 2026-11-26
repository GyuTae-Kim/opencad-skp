// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashNote, barShown, noticeFree } from '../../src/app/flash';

describe('측정 띠 알림', () => {
  afterEach(() => vi.useRealTimers());

  it('잠깐 보이고 사라지며, 새 알림은 앞 알림의 시간을 바꾼다', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.hidden = true;
    const n = new FlashNote(el);
    n.show('복사했습니다');
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('복사했습니다');
    vi.advanceTimersByTime(1000);
    n.show('잠글 방향이 없습니다', 3200, 'no-lock');
    vi.advanceTimersByTime(1000);
    // 앞 알림의 1.6초가 지났어도 새 알림은 그대로
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('잠글 방향이 없습니다');
    vi.advanceTimersByTime(2300);
    expect(el.hidden).toBe(true);
  });

  it('종류를 붙인 알림만 그 종류로 거둔다(잠근 뒤 잠글 방향이 없다는 알림이 남지 않게)', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const n = new FlashNote(el);
    n.show('잠글 방향이 없습니다', 3200, 'no-lock');
    n.drop('other');
    expect(el.hidden).toBe(false);
    n.drop('no-lock');
    expect(el.hidden).toBe(true);
    // 거둔 뒤 남은 시간에 다시 띄운 알림을 앞 타이머가 지우지 않는다
    n.show('복사했습니다');
    vi.advanceTimersByTime(1500);
    expect(el.hidden).toBe(false);
    // 종류 없는 알림(복사)은 잠금으로 거두지 않는다
    n.drop('no-lock');
    expect(el.hidden).toBe(false);
    vi.advanceTimersByTime(200);
    expect(el.hidden).toBe(true);
  });
});

describe('154차: 복사 결과를 알릴 곳(넓은 마우스 화면·측정을 끈 때는 측정 띠가 숨어 있다)', () => {
  /** 앱 bandQuery 흉내(측정 띠를 쓰는 화면 — styles.css .measure-bar와 같은 조건: 좁은 화면·손가락 기기) */
  const band = (matches: boolean): MediaQueryList => ({ matches }) as MediaQueryList;

  it('측정 띠 잠깐 알림은 띠가 켜져 있고 띠를 쓰는 화면일 때만 보인다', () => {
    const bar = document.createElement('div');
    // 좁은 화면·손가락 기기에서 측정 중: 띠가 보인다(지금처럼 띠 잠깐 알림)
    expect(barShown(bar, band(true))).toBe(true);
    // 넓은 마우스 화면: 측정 중이어도 스타일시트가 띠를 늘 숨긴다
    expect(barShown(bar, band(false))).toBe(false);
    // matchMedia가 없는 환경
    expect(barShown(bar, null)).toBe(false);
    // 측정을 끈 때(패널 아래 띠의 복사): 띠째 숨는다 — 어느 화면이든
    bar.hidden = true;
    expect(barShown(bar, band(true))).toBe(false);
    expect(barShown(bar, band(false))).toBe(false);
  });

  it('알림 상자에는 비었거나 안내(info)·앞 복사 결과일 때만 복사 결과를 띄운다 — 떠 있는 해석 경고·오류는 덮어쓰지 않는다', () => {
    const box = document.createElement('div');
    box.hidden = true;
    // 빈 알림 상자
    expect(noticeFree(box, undefined, false)).toBe(true);
    box.hidden = false;
    // 안내(2점 투시·앞 복사 성공 등)는 바꿔 띄운다
    expect(noticeFree(box, 'info', false)).toBe(true);
    // 해석 경고·열기 오류 등은 그대로 둔다(복사 결과는 띄우지 않음 — 고치기 전과 같음). 복사 실패(error)도 같은 규칙
    expect(noticeFree(box, 'warn', false)).toBe(false);
    expect(noticeFree(box, 'error', false)).toBe(false);
    // 앞 복사 실패가 떠 있으면 다음 복사 결과로 바꾼다(지난 「복사하지 못했습니다」가 남지 않게)
    expect(noticeFree(box, 'error', true)).toBe(true);
  });

  it('앱: 복사 결과는 띠가 보이면 띠 잠깐 알림, 아니면 알림 상자(성공 info·실패 error — 그림 저장 실패·2점 투시 안내와 같은 길), 띠 밖에서 부르는 길은 복사뿐 — 떠 있는 경고·오류는 덮어쓰지 않음', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/import \{ FlashNote, barShown, noticeFree \} from '\.\/flash';/);
    const copy = app.slice(app.indexOf('  copyMeasure(which'), app.indexOf('  clearMeasureLog(): void'));
    expect(copy).toMatch(
      /void copyText\(text\)\.then\(\(ok\) => \{\n\s*const t = ok \? '복사했습니다' : '복사하지 못했습니다';\n(?:\s*\/\/[^\n]*\n)*\s*if \(barShown\(this\.els\.measureBar, this\.bandQuery\)\) this\.flashMeasure\(t\);\n\s*else if \(noticeFree\(this\.els\.notice, this\.notice\?\.kind, this\.notice === this\.copyNotice\)\) \{\n\s*this\.showNotice\(ok \? 'info' : 'error', t, ''\);\n\s*this\.copyNotice = this\.notice;\n\s*\}\n\s*\}\);/,
    );
    // 띄운 복사 결과 알림만 쥔다(문맥 안내 ctxNotice와 같은 꼴 — 자기 알림이 아직 떠 있을 때만 바꿈)
    expect(app).toMatch(/private copyNotice: NoticeState \| null = null;/);
    expect(app.match(/this\.copyNotice = /g)).toHaveLength(1);
    // 띠 잠깐 알림을 부르는 다른 길은 띠 안 안내 두기 버튼(측정 중에만)뿐 — 띠가 숨으면 누를 수 없다
    expect(app.match(/this\.flashMeasure\(/g)).toHaveLength(2);
    expect(app).toMatch(/measureGuide\.addEventListener\('click', \(\) => \{\n\s*const t = this\.measureTool;\n\s*if \(!t\?\.active\) return;\n\s*t\.setGuideMode\(!t\.guideMode\);\n\s*this\.flashMeasure\(/);
  });
});
