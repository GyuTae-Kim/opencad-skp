// @vitest-environment jsdom
/**
 * 181차: 측정 중 상태 막대 고른 것 칸(app.ts refreshStatus — `.st-sel`, 최대 폭·말줄임)의 잠금 안내가 `title`에 없던 것(177차 남은 일 —
 * WCAG 1.4.12·1.4.10 「내용을 잃지 않음」: 글 간격을 넓히거나 좁은 화면에서 칸이 「…」로 잘리면 잘린 글을 `title`로 다시 본다).
 * 보이는 글은 「안내 · 잠금」(두 마디 — 번역층이 마디마다 따로 옮김)인데 `title`은 안내만(`mixText([sel])`)이었다.
 * 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) title 함수(i18n.ts `statusTitle`)를 앱과 같은 꼴 칸에 두고 번역층을 다섯 언어로 깐 뒤
 * 보이는 글과 견주고, 앱 원문이 그 칸을 그 함수로 맞추는지 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileText, mix } from '../../src/app/filetext';
import { installLocalization, mixText, statusTitle } from '../../src/app/i18n';
import { LOCK_HINTS, lockHint, measureHint, trackHint } from '../../src/app/measure';
import { translate } from '../../site/i18n.mjs';

/**
 * 번역층이 붙인 칸을 옮길 때까지(CI 14차 마무리, 225차 — 공용 규칙 13번·223차 i18n-collide174 tick 꼴: setTimeout(0) k번 → 조건과 마감 시간):
 * DOM이 매크로 작업 k 차례 잇달아 조용할 때까지(MutationObserver — 앞 k번보다 짧지 않다), 마감 5초
 */
const tick = async (k = 4): Promise<void> => {
  let changed = false;
  const watch = new MutationObserver(() => {
    changed = true;
  });
  watch.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  try {
    for (let quiet = 0, end = Date.now() + 5_000; quiet < k && Date.now() < end; ) {
      changed = false;
      await new Promise((r) => setTimeout(r, 0));
      quiet = changed ? 0 : quiet + 1;
    }
  } finally {
    watch.disconnect();
  }
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

async function use(code: string): Promise<void> {
  dispose?.();
  document.body.innerHTML = '';
  history.replaceState(null, '', code === 'ko' ? '/opencad-skp/' : `/opencad-skp/${code}/`);
  dispose = await installLocalization(document.body);
}

/** 측정 중 [안내 글, 잠금 안내 글] — 측정 도구가 내는 글 그대로(잠금 안내는 lockHintText 꼴: 잠금 · 끌어온 점 n개) */
const CASES: [sel: string, lock: string][] = [
  [measureHint('tape', 1, false)!, lockHint('tape', 1, null, null)!],
  [measureHint('protractor', 1, false)!, `${LOCK_HINTS.parallel} · ${trackHint(2)}`],
  [measureHint('protractor', 0, false)!, lockHint('protractor', 0, null, 'z')!],
];

describe('측정 중 상태 막대 잠금 안내 칸의 title(181차 — WCAG 1.4.12·1.4.10)', () => {
  it('잠금 안내가 있으면 칸의 title이 보이는 글 「안내 · 잠금」 그대로 — 다섯 언어(번역층이 두 마디를 따로 옮긴 글과 같음)', async () => {
    expect(CASES.map(([sel, lock]) => `${sel} · ${lock}`)).toEqual([
      '줄자: 끝점을 누르세요 · 길이를 치면 안내점 · Esc 취소 · Shift·화살표로 방향 잠금',
      '각도기: 기준 방향의 점을 누르세요 · Esc 취소 · 모서리와 나란히 잠금 · 끌어온 점 2개',
      '각도기: 중심점을 누르세요 · Shift를 누르고 있으면 평면 고정 · 파랑 각도기로 고정',
    ]);
    for (const code of ['ko', 'en', 'de', 'ja', 'zh-CN']) {
      await use(code);
      for (const [sel, lock] of CASES) {
        // 앱 refreshStatus 꼴: 안내 마디 · 잠금 마디(.st-lock), title은 앱이 옮겨 넣고 번역층은 건너뜀(data-i18n-keep)
        const cell = document.createElement('span');
        cell.className = 'st-sel';
        const a = document.createElement('span');
        a.textContent = sel;
        const b = document.createElement('span');
        b.className = 'st-lock';
        b.textContent = lock;
        cell.append(a, ' · ', b);
        cell.title = statusTitle([sel], lock);
        cell.setAttribute('data-i18n-keep', 'title');
        document.body.append(cell);
      }
      await tick();
      const cells = [...document.querySelectorAll<HTMLElement>('.st-sel')];
      expect(cells.length).toBe(CASES.length);
      cells.forEach((cell, i) => {
        const [sel, lock] = CASES[i]!;
        expect(cell.title, `${code} ${i}`).toBe(cell.textContent);
        expect(cell.title, `${code} ${i}`).toBe(`${translate(sel, code)} · ${translate(lock, code)}`);
        // 예전 title(안내만)에는 잠금 안내가 없었다
        expect(mixText([sel]), `${code} ${i}`).not.toBe(cell.textContent);
      });
    }
    // 두 마디를 한 글로 이어 옮기면 통째 열쇠가 아니라 조각마다 옮겨져 보이는 글과 다르다(그래서 따로 옮겨 잇는다)
    const [sel, lock] = CASES[0]!;
    expect(translate(`${sel} · ${lock}`, 'en')).not.toBe(`${translate(sel, 'en')} · ${translate(lock, 'en')}`);
  });

  it('잠금 안내가 없으면 title은 지금과 같고(안내·고른 것), 글이 비면 title도 빈 글 — 앱은 글을 바꾸는 두 자리에서 맞춘다', async () => {
    await use('en');
    const sel = measureHint('tape', 0, false)!;
    expect(statusTitle([sel], null)).toBe(mixText([sel]));
    expect(statusTitle([sel])).toBe(mixText([sel]));
    const picked = mix`그룹 ${fileText('무늬 · 이')} · 면 ${6}`;
    expect(statusTitle(picked, null)).toBe(mixText(picked));
    expect(statusTitle(picked, null)).toContain('무늬 · 이');
    expect(statusTitle([''], null)).toBe('');
    expect(statusTitle([], null)).toBe('');
    // 앱 원문: 보이는 칸 꼴(위 시험과 같은 마디), title은 이 함수로, 번역층은 title을 건너뜀, 문서가 없을 때(빈 글)도 title을 비움
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toContain("else if (lock) e.stSel.replaceChildren(h('span', {}, sel), ' · ', h('span', { class: 'st-lock' }, lock));");
    expect(app).toContain('e.stSel.title = statusTitle(picked.length ? picked : [sel], lock);');
    expect(app).toContain("e.stSel.setAttribute('data-i18n-keep', 'title');");
    expect(app).toContain("e.stSel.textContent = e.stSel.title = '';");
    expect(app).not.toContain('e.stSel.title = mixText(');
  });
});
