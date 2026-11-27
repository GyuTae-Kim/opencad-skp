// @vitest-environment jsdom
/**
 * 182차: 화면 영역이 랜드마크로 드러나는지(WCAG 1.3.1 정보와 관계·2.4.1 블록 건너뛰기 — 화면 읽기 프로그램의 랜드마크 이동으로 되풀이되는 띠를 건너뛰어 본문으로).
 * 보기 도구 막대(app.ts — `role=toolbar`, 제목 막대 header의 형제)는 쓴 역할(toolbar)이 랜드마크가 아니고 어느 랜드마크 안에도 없어, 늘 보이는 내용 가운데
 * 그것 하나만 랜드마크 밖이었다(랜드마크로 훑으면 배너 다음이 곧 본문 — 도구 막대에 닿지 않음). 제목 막대 header가 `aria-owns`로 도구 막대를 품는다
 * (DOM·모양·Tab 차례 그대로 — 도구 막대는 DOM에서도 header 바로 뒤라 읽는 차례가 같다).
 * 앱 클래스는 시험에서 만들지 않으므로(153차 꼴) 앱 원문의 틀 속성으로 앱과 같은 꼴 틀(제목 막대·도구 막대·작업 공간·처음 화면·최근 문서·상태 막대)을 짓고
 * 실제 패널(panel.ts — aside)과 실제 번역층의 언어 메뉴(제목 막대 끝에 붙음)를 넣어 HTML-AAM 판정(아래 `roleOf`·`landmarkOf`)으로 본다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { h } from '../../src/app/dom';
import { installLocalization } from '../../src/app/i18n';
import { Panel, section, type PanelHost } from '../../src/app/panel';

const SRC = resolve(__dirname, '../../src/app');
const APP = readFileSync(resolve(SRC, 'app.ts'), 'utf8');

/** 앱 원문에서 그 요소를 짓는 h(...)의 속성 묶음(글·참 값 — 틀 속성은 모두 이 꼴) */
function attrsOf(pattern: RegExp): Record<string, string | true> {
  const m = APP.match(pattern);
  expect(m, String(pattern)).not.toBeNull();
  const out: Record<string, string | true> = {};
  for (const [, k, v] of m![1]!.matchAll(/'?([\w-]+)'?: ('[^']*'|true)/g)) out[k!] = v === 'true' ? true : v!.slice(1, -1);
  return out;
}

/** 접근성 이름(aria-labelledby → aria-label — 이 틀이 쓰는 것만) */
function nameOf(el: Element): string {
  const ids = el.getAttribute('aria-labelledby');
  if (ids) return ids.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '').join(' ').trim();
  return el.getAttribute('aria-label')?.trim() ?? '';
}

/** header·footer를 banner·contentinfo가 아니게 하는 범위(HTML-AAM) */
const SCOPE = 'article, aside, main, nav, section, [role=article], [role=complementary], [role=main], [role=navigation], [role=region]';
const LANDMARKS = new Set(['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search']);

/** HTML-AAM 역할: 쓴 role이 암묵 역할을 덮고, 구획 밖 header·footer만 banner·contentinfo, body·main 범위 aside는 complementary, 이름 있는 section만 region */
function roleOf(el: Element): string | null {
  const own = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (own) return own;
  const scoped = !el.parentElement?.closest(SCOPE);
  switch (el.localName) {
    case 'header':
      return scoped ? 'banner' : 'generic';
    case 'footer':
      return scoped ? 'contentinfo' : 'generic';
    case 'main':
      return 'main';
    case 'nav':
      return 'navigation';
    case 'search':
      return 'search';
    case 'aside':
      return !el.parentElement?.closest('article, aside, nav, section') || nameOf(el) ? 'complementary' : 'generic';
    case 'section':
      return nameOf(el) ? 'region' : 'generic';
    case 'form':
      return nameOf(el) ? 'form' : 'generic';
    default:
      return null;
  }
}

/** 이 요소가 랜드마크면 「역할」·「역할:이름」(region·form은 이름이 있을 때만) */
function landmark(el: Element): string | null {
  const role = roleOf(el);
  if (!role || !LANDMARKS.has(role)) return null;
  const name = nameOf(el);
  if ((role === 'region' || role === 'form') && !name) return null;
  return name ? `${role}:${name}` : role;
}

/** 접근성 트리의 부모(aria-owns로 품은 요소는 그 주인 — WAI-ARIA aria-owns) */
function a11yParent(el: Element): Element | null {
  return (el.id && el.ownerDocument.querySelector(`[aria-owns~="${el.id}"]`)) || el.parentElement;
}

/** 이 요소를 품은 가장 가까운 랜드마크(접근성 트리로 올라감), 없으면 null */
function landmarkOf(el: Element): string | null {
  for (let e: Element | null = el; e; e = a11yParent(e)) {
    const m = landmark(e);
    if (m) return m;
  }
  return null;
}

/** 접근성 트리 차례로 훑은 요소(DOM 자식 가운데 이 요소가 부모인 것 → 품은 요소) */
function a11yWalk(el: Element, out: Element[] = []): Element[] {
  out.push(el);
  const owned = (el.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean).map((id) => el.ownerDocument.getElementById(id));
  for (const c of [...[...el.children].filter((c) => a11yParent(c) === el), ...owned]) if (c) a11yWalk(c, out);
  return out;
}

const shown = (el: Element): boolean => !el.closest('[hidden], [aria-hidden=true]');
const FOCUS = 'button, a[href], input, canvas, [tabindex]';

/** 보이는 내용: 숨김 조상이 없는 글 마디의 부모와 초점 받는 칸 */
function visibleContent(root: Element): Element[] {
  const out = new Set<Element>();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n instanceof Element ? n : n.parentElement!;
    if (shown(el) && (n instanceof Element ? el.matches(FOCUS) : !!n.textContent?.trim())) out.add(el);
  }
  return [...out];
}

interface Shell {
  root: HTMLElement;
  header: HTMLElement;
  toolbar: HTMLElement;
  canvas: HTMLElement;
  panel: Panel;
  psec: HTMLElement;
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

/** 앱 mount 꼴 틀(app.ts — 제목 막대 · 보기 도구 막대 · 작업 공간(stage + 가르개 + 패널) · 상태 막대 · 끌어 놓기 덮개 · 파일 입력 차례) */
async function shell(open: boolean): Promise<Shell> {
  history.replaceState(null, '', '/opencad-skp/');
  const root = h('div', { class: 'app' });
  document.body.append(root);
  const header = h(
    'header',
    attrsOf(/h\(\s*'header',\s*(\{[^}]*\})/),
    h('a', { class: 'brand', href: './' }, 'OpenCAD'),
    h('span', { class: 'docname' }, open ? '집.skp' : ''),
    h('button', {}, '열기'),
    h('button', {}, '예제 열기'),
    h('button', { 'aria-label': '앱 설정' }),
  );
  // 처음 화면은 도구 막대 버튼이 모두 꺼져 있다(refreshToolbar — 보이지만 Tab 차례에 없음)
  const toolbar = h(
    'div',
    attrsOf(/h\(\s*'div',\s*(\{ class: 'toolbar', role: 'toolbar'[^}]*\})/),
    h('button', { disabled: !open }, '전체 보기'),
    h('button', { disabled: !open }, '줄자'),
  );
  const canvas = h('canvas', { tabindex: '0' });
  const recent = h('section', attrsOf(/h\('section', (\{ class: 'recent'[^}]*\})/), h('h2', { id: 'recent-title' }, '최근 문서'), h('button', {}, '집.skp'));
  // 최근 문서가 있으면 카드를 보인다(refreshRecent)
  recent.hidden = false;
  const start = h('div', { class: 'start', hidden: open }, h('div', { class: 'start-card' }, h('h1', {}, 'SketchUp 파일을 브라우저에서 3D로 보기'), h('button', {}, '파일 열기'), recent));
  const stage = h('div', { class: 'stage' }, h('div', { class: 'view-host' }, canvas), start, h('div', { class: 'notice', role: 'alert', hidden: true }));
  const panel = new Panel({} as PanelHost);
  panel.el.hidden = !open;
  const psec = section('태그', h('p', {}, '태그 3개'));
  panel.el.append(psec);
  const resizer = h('div', { class: 'resizer', role: 'separator', tabindex: '0', 'aria-label': '패널 크기 바꾸기', hidden: !open });
  const main = h('main', attrsOf(/h\('main', (\{[^}]*\})/), stage, resizer, panel.el);
  const footer = h('footer', attrsOf(/h\('footer', (\{[^}]*\})/), h('span', { class: 'st-main' }, open ? '면 6개' : 'SketchUp 파일을 여세요'));
  const drop = h('div', { class: 'dropcover', hidden: true }, h('b', {}, '놓으면 엽니다'));
  const file = h('input', { type: 'file', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  root.append(header, toolbar, main, footer, drop, file);
  // 번역층이 언어 메뉴 버튼을 제목 막대 끝에 붙인다(i18n.ts mountSelector)
  dispose = await installLocalization(root);
  return { root, header, toolbar, canvas, panel, psec };
}

describe('화면 영역의 랜드마크(182차 — WCAG 1.3.1·2.4.1)', () => {
  it.each([
    ['처음 화면', false],
    ['문서가 열린 화면', true],
  ] as [string, boolean][])('%s: 보이는 칸이 모두 랜드마크 안 — 보기 도구 막대는 제목 막대(배너) 안', async (_, open) => {
    const s = await shell(open);
    const outside = visibleContent(s.root)
      .filter((el) => !landmarkOf(el))
      .map((el) => el.textContent?.trim() || el.localName);
    expect(outside).toEqual([]);
    for (const b of s.toolbar.querySelectorAll('button')) expect(landmarkOf(b)).toBe('banner');
    // 도구 막대는 그대로 이름 붙은 toolbar(쓴 역할이 암묵 역할을 덮어 랜드마크가 아님 — 배너가 품을 뿐)
    expect([roleOf(s.toolbar), nameOf(s.toolbar), landmark(s.toolbar)]).toEqual(['toolbar', '보기 도구', null]);
    expect(landmarkOf(s.header.querySelector('.language-trigger')!)).toBe('banner');
    expect(landmarkOf(s.canvas)).toBe('main');
    if (open) expect(landmarkOf(s.panel.el.querySelector('button')!)).toBe('complementary:모형 패널');
    else expect(landmarkOf(s.root.querySelector('#recent-title')!)).toBe('region:최근 문서');
  });

  it('랜드마크는 종류마다 하나라 이름이 겹치지 않고 HTML-AAM대로 읽힌다(구획 밖 header·footer, main 안 aside = complementary, 이름 없는 section은 region 아님)', async () => {
    for (const [open, want] of [
      [false, ['banner', 'main', 'region:최근 문서', 'contentinfo']],
      [true, ['banner', 'main', 'complementary:모형 패널', 'contentinfo']],
    ] as const) {
      dispose?.();
      document.body.innerHTML = '';
      const s = await shell(open);
      const marks = [...s.root.querySelectorAll('*')].filter(shown).map(landmark).filter((m): m is string => !!m);
      expect(marks, String(open)).toEqual(want);
      expect(new Set(marks.map((m) => m.split(':')[0])).size).toBe(marks.length);
      // 패널 절(h3만 — 이름 없음)은 region이 아니다
      expect([roleOf(s.psec), landmark(s.psec)]).toEqual(['generic', null]);
    }
    // 앱 전체(src/app)에서 랜드마크가 되는 요소: header·main·footer·aside 하나씩, nav 없음, search는 패널 찾기 칸 하나, region은 바로 가기 창(모달) 안 하나,
    // 이름 붙은 section은 최근 문서 하나(패널 절·속성 사전·바로 가기 묶음 section은 이름이 없음)
    const all = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(resolve(SRC, f), 'utf8'))
      .join('\n');
    const count = (re: RegExp): number => all.match(re)?.length ?? 0;
    expect([/h\(\s*'header'/g, /h\(\s*'main'/g, /h\(\s*'footer'/g, /h\(\s*'aside'/g, /h\(\s*'nav'/g, /role: 'search'/g, /role: 'region'/g, /h\('section', \{[^}]*aria-label/g].map(count)).toEqual([1, 1, 1, 1, 0, 1, 1, 1]);
    expect(readFileSync(resolve(SRC, 'shortcuts.ts'), 'utf8')).toMatch(/role: 'dialog', 'aria-modal': 'true'/);
  });

  it('aria-owns 꼴: DOM·Tab 차례 그대로 — 도구 막대가 DOM에서도 제목 막대 바로 뒤라 접근성 트리 차례(제목 막대 … 언어 메뉴 → 도구 막대)가 DOM 차례와 같다', async () => {
    const s = await shell(true);
    const owns = s.header.getAttribute('aria-owns');
    expect(owns).toBeTruthy();
    expect(document.getElementById(owns!)).toBe(s.toolbar);
    // 앱 원문: 붙이는 차례(제목 막대 → 도구 막대 → 작업 공간 → 상태 막대)와 작업 공간이 stage·가르개·패널을 품는 것
    expect(APP).toContain('this.root.append(title, toolbar, workspace, status, dropCover, fileInput);');
    expect(APP).toContain("const workspace = h('main', { class: 'workspace' }, stage, resizer, this.panel.el);");
    // 그 id는 앱에서 도구 막대 하나(id와 aria-owns 두 번 — 다른 파일·정적 첫 화면에는 없음)
    const others = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && f !== 'app.ts')
      .map((f) => readFileSync(resolve(SRC, f), 'utf8'))
      .join('\n');
    expect(APP.split(`'${owns}'`).length - 1).toBe(2);
    expect(others.includes(owns!)).toBe(false);
    expect(readFileSync(resolve(__dirname, '../../index.html'), 'utf8').includes(owns!)).toBe(false);
    // 접근성 트리 차례의 초점 칸 = DOM(Tab) 차례의 초점 칸 — 언어 메뉴 버튼(제목 막대 끝)이 도구 막대 앞
    const a11y = a11yWalk(s.root).filter((el) => el.matches(FOCUS) && shown(el));
    const dom = [...s.root.querySelectorAll(FOCUS)].filter(shown);
    expect(a11y).toEqual(dom);
    const lang = s.header.querySelector('.language-trigger')!;
    expect(a11y.indexOf(lang)).toBe(a11y.indexOf(s.toolbar.querySelector('button')!) - 1);
  });
});
