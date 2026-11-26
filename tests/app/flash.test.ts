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

describe('166차: 잠깐 알림 위에 마우스·펜을 올린 동안은 사라지지 않는다(WCAG 2.2.1 연장 — 측정 띠 화면의 복사 결과는 다시 볼 곳이 없음)', () => {
  afterEach(() => vi.useRealTimers());

  it('올린 동안 멈추고 떠나면 그 시간을 처음부터 다시 재며, 올린 채 바뀐 알림도 떠날 때까지 남는다', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.hidden = true;
    const n = new FlashNote(el);
    n.show('복사했습니다');
    vi.advanceTimersByTime(1000);
    el.dispatchEvent(new Event('pointerenter'));
    // 1.6초가 한참 지나도 올린 동안은 남는다(고치기 전에는 0.6초 뒤 사라졌다)
    vi.advanceTimersByTime(5000);
    expect(el.hidden).toBe(false);
    // 올린 채 새 알림으로 바뀌어도 남는다
    n.show('복사하지 못했습니다');
    vi.advanceTimersByTime(5000);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('복사하지 못했습니다');
    // 떠나면 처음부터 다시 1.6초
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(1500);
    expect(el.hidden).toBe(false);
    vi.advanceTimersByTime(100);
    expect(el.hidden).toBe(true);
    // 떠난 뒤의 알림은 지금처럼 1.6초
    n.show('복사했습니다');
    vi.advanceTimersByTime(1600);
    expect(el.hidden).toBe(true);
  });

  it('올린 채 종류로 거두면 숨고, 다음 알림은 다시 시간을 잰다(숨은 칸에는 떠남이 오지 않을 수 있음)', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    const n = new FlashNote(el);
    n.show('잠글 방향이 없습니다', 3200, 'no-lock');
    el.dispatchEvent(new Event('pointerenter'));
    n.drop('no-lock');
    expect(el.hidden).toBe(true);
    n.show('복사했습니다');
    vi.advanceTimersByTime(1600);
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
      /void copyText\(text\)\.then\(\(ok\) => \{\n\s*const t = ok \? '복사했습니다' : '복사하지 못했습니다';\n(?:\s*\/\/[^\n]*\n)*\s*if \(barShown\(this\.els\.measureBar, this\.bandQuery\)\) this\.flashMeasure\(t\);\n\s*else this\.showNotice\(ok \? 'info' : 'error', t, '', true\);\n\s*\}\);/,
    );
    // 떠 있는 경고·오류를 덮지 않는 판정은 159차부터 알림 상자를 쓰는 한 자리(가벼운 글 light — 아래 159차). 띄운 복사 결과를 따로 쥐지 않는다
    expect(app).not.toMatch(/copyNotice/);
    // 띠 잠깐 알림을 부르는 다른 길은 띠 안 안내 두기 버튼(측정 중에만)뿐 — 띠가 숨으면 누를 수 없다
    expect(app.match(/this\.flashMeasure\(/g)).toHaveLength(2);
    expect(app).toMatch(/measureGuide\.addEventListener\('click', \(\) => \{\n\s*const t = this\.measureTool;\n\s*if \(!t\?\.active\) return;\n\s*t\.setGuideMode\(!t\.guideMode\);\n\s*this\.flashMeasure\(/);
  });
});

describe('159차: 한 칸 알림 상자의 가벼운 글(복사 결과·2점 투시 거절·문맥 잃음·되찾는 중 안내)은 떠 있는 경고·오류를 덮지 않는다', () => {
  it('판정: 비었거나 안내(info)·앞 가벼운 글이면 띄우고, 앞 무거운 경고·오류(해석 경고·열기 오류·문맥 안내의 일부 실패)는 둔다', () => {
    const box = document.createElement('div');
    box.hidden = false;
    // 앞 가벼운 글이 오류여도(복사 실패) 다음 가벼운 글(2점 투시 거절·문맥 잃음 안내·복사 결과)로 바꾼다 — 154차 「자기 앞 글」을 「앞 가벼운 글」로
    expect(noticeFree(box, 'error', true)).toBe(true);
    expect(noticeFree(box, 'info', false)).toBe(true);
    // 해석 경고(warn)·열기 오류(error)·문맥 안내의 일부 실패(warn — 무거운 글)는 그대로 둔다(가벼운 글을 띄우지 않음)
    expect(noticeFree(box, 'warn', false)).toBe(false);
    expect(noticeFree(box, 'error', false)).toBe(false);
  });

  it('앱: 규칙은 showNotice 한 자리 — 가벼운 글은 셋(복사 결과·2점 투시 거절·문맥 안내 info)만 light로 부르고, 문맥 안내는 띄웠을 때만 쥔다(남의 경고를 쥐면 거둘 때 그것을 닫음)', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    const show = app.slice(app.indexOf('  private showNotice('), app.indexOf('  /** 알림 제목·글을 지금 언어로'));
    // light면 154차 판정(비었거나 info거나 앞 가벼운 글)일 때만 띄우고 띄웠는지 돌려준다. 무거운 글은 지금처럼 늘 띄운다
    expect(show).toMatch(
      /^ {2}private showNotice\(kind: NoticeKind, title: string \| Mixed, text: string \| Mixed, light = false\): boolean \{\n\s*const n = this\.els\.notice;\n\s*if \(light && !noticeFree\(n, this\.notice\?\.kind, !!this\.notice\?\.light\)\) return false;\n\s*this\.notice = \{ kind, title: [^\n]*, light \};\n/,
    );
    expect(show).toMatch(/n\.hidden = false;\n\s*return true;\n\s*\}\n/);
    expect(app).toMatch(/interface NoticeState \{\n {2}kind: NoticeKind;\n {2}title: Mixed;\n {2}text: Mixed;\n {2}\/\*\*[^\n]*\*\/\n {2}light: boolean;\n\}/);
    // 판정을 부르는 곳은 이 한 자리뿐, 복사 결과를 따로 쥐던 것은 없다
    expect(app.match(/noticeFree\(/g)).toHaveLength(1);
    expect(app).not.toMatch(/copyNotice/);
    // 부르는 곳 17 가운데 가벼운 글은 셋 — 나머지(열기 결과·해석 경고·오류, 빈 장면 info도 사용자가 연 파일의 결과)는 넷째 인자 없이 늘 띄운다
    expect(app.match(/this\.showNotice\(/g)).toHaveLength(17);
    expect(app.match(/this\.showNotice\([^\n]*, (?:true|kind === 'info')\)/g)).toHaveLength(3);
    expect(app).toMatch(/else this\.showNotice\(ok \? 'info' : 'error', t, '', true\);/);
    expect(app).toMatch(/this\.showNotice\('info', '2점 투시로 바꿀 수 없습니다', '[^'\n]*', true\);/);
    expect(app).toMatch(/if \(res\.notice\) this\.showNotice\('warn', res\.notice\.title, res\.notice\.text\);/);
    expect(app).toMatch(/if \(n\) this\.showNotice\(n\.kind, n\.title, n\.text\);/);
    // 문맥 안내: 잃음·되찾는 중(info)은 가벼운 글, 일부 실패(warn)는 무거운 글. 띄우지 못하면 ctxNotice를 바꾸지 않아 hide가 떠 있는 경고를 닫지 않는다
    expect(app).toMatch(
      /show: \(kind, title, text\) => \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(this\.showNotice\(kind, title, text, kind === 'info'\)\) this\.ctxNotice = this\.notice;\n\s*\},\n\s*hide: \(\) => \{\n\s*if \(this\.ctxNotice && this\.notice === this\.ctxNotice\) this\.closeNotice\(\);/,
    );
    expect(app.match(/this\.ctxNotice = this\.notice/g)).toHaveLength(1);
    const rel = readFileSync(resolve(__dirname, '../../src/app/release.ts'), 'utf8');
    expect(rel.match(/this\.ui\.show\(/g)).toHaveLength(4);
    expect(rel.match(/this\.ui\.show\('info', (?:CONTEXT_LOST|RESTORE)_TITLE/g)).toHaveLength(3);
    expect(rel.match(/this\.ui\.show\('warn', RESTORE_FAIL_TITLE/g)).toHaveLength(1);
  });
});
