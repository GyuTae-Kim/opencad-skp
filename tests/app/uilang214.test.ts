// @vitest-environment jsdom
/**
 * 214차: 다른 언어 화면에 앱이 만든 한국어가 남지 않는지(WCAG 3.1.2 — 212차 테마 title처럼 틀 값·앱이 지은 이름·번역하지 않는 칸으로 새는 것, STEP 209차와 같은 꼴).
 * 실제 앱 틀(SkpViewerApp.mount — 제목 막대·보기 도구 막대·처음 화면·측정 띠·고른 것 카드·카메라 띠·새 판 띠·상태 막대)에 번역층을 걸고,
 * 화면 언어로 지은 예제 모형(앱의 「예제 열기」와 같은 sampleSkpBytes(…, 화면 언어) — 53차) 문서를 앱 자리에 넣어 장면 탭·상태 막대·패널 네 탭(태그·구성·정보·고른 것)·
 * 앱 설정 메뉴·여는 중 덮개·알림 띠를 네 언어로 그린 뒤, 글 마디와 title·aria-label 등에 한글이 든 자리를 모은다.
 * 예제는 안의 이름까지 화면 언어라 파일 글 칸(translate="no"·번역층이 건너뛰는 이름 칸 — i18n.ts SKIP)도 함께 본다: 앱이 지은 이름이 파일 글 칸에 들어가는 것도 잡고,
 * 그 칸 안이면 「[파일 칸]」을 앞에 붙인다. 언어 메뉴(원어 이름 — 「한국어」)만 뺀다.
 * 지금 고치지 못한 자리는 「아직 둔 것」(LEFT) — 목록에 있는데 이제 한글이 없으면 실패한다(목록을 줄인다).
 * 그래픽(뷰어)은 문서를 처음 열 때 받는 조각이라 만들지 않고, 문서를 앱 자리에 바로 넣은 뒤 앱이 문서를 연 뒤 부르는 화면 갱신 함수를 부른다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import { createDoc, type Selection, type SkpDoc } from '../../src/app/doc';
import { SAMPLE_NAME, sampleSkpBytes } from '../../src/app/sample';
import { installLocalization } from '../../src/app/i18n';
import { SkpViewerApp } from '../../src/app/app';
import type { Mixed } from '../../src/app/filetext';
import type { Panel } from '../../src/app/panel';
import { unsupportedNotice } from '../../src/worker/notice';
import { catalogs, sourceMessage, translate } from '../../site/i18n.mjs';

const CODES = ['en', 'ja', 'zh-CN', 'de'] as const;
const HANGUL = /[가-힣]/;
const I18N = readFileSync(resolve(__dirname, '../../src/app/i18n.ts'), 'utf8');
/** 파일 글 칸: 파일 글 묶음(translate="no")과 번역층이 건너뛰는 이름 칸(i18n.ts SKIP의 클래스 선택자 — 파일·모형에서 온 이름을 담는다) */
const FILE_CELLS = ['[translate="no"]', '[data-static-languages]', ...I18N.match(/const SKIP = '([^']+)'/)![1]!.split(', ').filter((s) => s.startsWith('.'))].join(', ');
/** 번역층이 옮기는 속성과 화면 읽기 값 */
const ATTRS = ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'alt'];

/**
 * 아직 둔 것(언어마다 — 이 시험이 그리는 화면 안): 없음.
 * 그리지 않는 둔 자리(해석기 기본 이름 「태그 n」·「정의 n」, 경로의 「(이름 없음)」 — 이름 칸이 없는 깨진 파일만)는 README 214차 줄
 */
const LEFT: Record<(typeof CODES)[number], string[]> = { en: [], ja: [], 'zh-CN': [], de: [] };

/** 시험에서 부르는 앱 안쪽(문서를 연 뒤 앱이 부르는 화면 갱신 함수·여는 중 덮개·알림 띠·메뉴) */
interface Inner {
  doc: SkpDoc | null;
  openSeq: number;
  panel: Panel;
  refreshChrome(): void;
  refreshStatus(): void;
  renderSceneTabs(): void;
  setBusy(name: string | null): void;
  showNotice(kind: 'warn', title: Mixed, text: Mixed): boolean;
  toggleThemeMenu(): void;
  closeMenu(): void;
}

/** 한글이 든 자리: 「요소: 글」·「요소@속성: 값」(파일 글 칸 안이면 앞에 「[파일 칸] 」). 언어 메뉴(원어 이름)는 뺀다 */
function hangulSpots(root: Element): string[] {
  const out: string[] = [];
  const tag = (el: Element): string => el.localName + [...el.classList].map((c) => `.${c}`).join('');
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.closest('.language-control, .language-list, script, style')) continue;
    const mark = el.closest(FILE_CELLS) ? '[파일 칸] ' : '';
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HANGUL.test(v)) out.push(`${mark}${tag(el)}@${a}: ${v}`);
    }
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && HANGUL.test(n.nodeValue ?? '')) out.push(`${mark}${tag(el)}: ${n.nodeValue!.trim()}`);
  }
  return out;
}

const tick = async (k = 4): Promise<void> => {
  for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0));
};
/** 처음 그릴 때 받는 조각(정보 탭·속성 사전 칸)을 시간으로 기다린다 */
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  await tick();
};

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 패널이 기다리지 않고 받는 조각(정보 탭·속성 사전 — panel.ts void import)을 미리 받아 둔다(ci-guard 5 — 시험 파일이 끝난 뒤 모듈을 평가하지 않게)
  await import('../../src/app/infotab');
  await import('../../src/app/attrview');
  // jsdom에는 scrollIntoView가 없다(장면 탭·패널이 고른 줄을 보이는 자리로 굴린다)
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

/** 앱 틀을 붙이고(번역층은 main.ts처럼 붙인 뒤에) 앱 안쪽을 돌려준다. before: 번역층을 걸기 전에 부를 것(주소로 연 예제·파일처럼) */
async function mountApp(code: string, before?: (app: SkpViewerApp, a: Inner) => void): Promise<{ app: SkpViewerApp; a: Inner }> {
  history.replaceState(null, '', code === 'ko' ? '/opencad-skp/' : `/opencad-skp/${code}/`);
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new SkpViewerApp(root);
  app.mount();
  const a = app as unknown as Inner;
  before?.(app, a);
  dispose = await installLocalization(root);
  await tick();
  return { app, a };
}

/** 「예제 열기」의 여는 중 덮개만 보고, 뒤 차례(예제 짓기·열기)는 그만두게 한다(열기 차례 번호를 넘긴다 — 덮개는 그대로) */
function sampleBusy(app: SkpViewerApp, a: Inner): void {
  void app.openSample();
  a.openSeq++;
}

describe('214차: 다른 언어 화면에 앱 한국어가 남지 않는다(WCAG 3.1.2)', () => {
  it('모음 시험: 한국어 화면에서는 같은 모음이 도구 막대 풀이·처음 화면 글·파일 글 칸의 한글을 잡는다', async () => {
    const { a } = await mountApp('ko');
    const tr = (s: string): string => s;
    const bytes = sampleSkpBytes(undefined, tr);
    a.doc = createDoc(SAMPLE_NAME, bytes.length, { scene: skpToScene(bytes, { name: SAMPLE_NAME, outline: true }), ms: 12 });
    a.refreshChrome();
    a.renderSceneTabs();
    const spots = hangulSpots(document.body);
    expect(spots).toContain('button.tbtn@title: 전체 보기 (F)');
    expect(spots).toContain('h1: SketchUp 파일을 브라우저에서 3D로 보기');
    expect(spots).toContain('[파일 칸] span.docname: OpenCAD 예제 집.skp');
    expect(spots.some((s) => s.startsWith('[파일 칸] button.scene-tab'))).toBe(true);
  });

  it.each(CODES)('%s: 처음 화면·도구 막대·측정 띠·상태 막대, 예제 문서의 장면 탭·패널 네 탭·앱 설정 메뉴, 여는 중 덮개·알림 띠', async (code) => {
    const spots = new Set<string>();
    const collect = (): void => void hangulSpots(document.body).forEach((s) => spots.add(s));
    // 주소로 연 예제(?sample — main.ts는 launch 뒤에 번역층을 붙인다): 번역층이 서기 전에 그린 여는 중 제목
    const { app, a } = await mountApp(code, sampleBusy);
    const cat = catalogs[code]!;
    const title = (): string => document.querySelector('.busy-title')!.textContent!;
    // 덮개 제목은 끝까지 모은 뒤 맨 아래에서 한 번에 견주도록 soft로(고치기 전에도 다른 자리까지 다 모은다)
    expect.soft(title(), code).toBe(cat['{0} 여는 중…']!.replace('{0}', cat['예제 모형']!));
    collect();
    // 처음 화면 「예제 열기」(번역층이 선 뒤)
    a.setBusy(null);
    sampleBusy(app, a);
    await tick();
    expect.soft(title(), code).toBe(cat['{0} 여는 중…']!.replace('{0}', cat['예제 모형']!));
    collect();
    a.setBusy(null);
    // 예제 문서(화면 언어로 지은 것 — 앱이 「예제 열기」로 여는 것과 같다)
    const tr = (s: string): string => translate(s, code);
    const bytes = sampleSkpBytes(undefined, tr);
    const name = tr(SAMPLE_NAME);
    const d = createDoc(name, bytes.length, { scene: skpToScene(bytes, { name, outline: true }), ms: 12 });
    a.doc = d;
    a.refreshChrome();
    a.renderSceneTabs();
    await tick();
    collect();
    for (const tab of ['tags', 'outline', 'info'] as const) {
      d.panelTab = tab;
      a.panel.show(d);
      await (tab === 'info' ? until(() => !!a.panel.el.querySelector('.scene-card')) : tick());
      collect();
    }
    d.panelTab = 'outline';
    for (let i = 0; i < (d.tree?.count ?? 0); i++) d.expanded.add(i);
    a.panel.rerender();
    await tick();
    collect();
    // 고른 것 탭·상태 막대 고른 것·패널 아래 띠: 노드(앞 12 — 그룹·컴포넌트·안쪽 컴포넌트)·윗단계 줄·재질·정의마다
    d.panelTab = 'entity';
    const sels: (Selection | null)[] = [
      ...Array.from({ length: Math.min(12, d.tree?.count ?? 0) }, (_, i): Selection => ({ kind: 'node', index: i })),
      ...d.outline.map((r): Selection => ({ kind: 'outline', index: r.index })),
      ...d.materials.map((m): Selection => ({ kind: 'material', name: m.name })),
      { kind: 'definition', name: tr('의자') },
      null,
    ];
    expect(sels.length).toBeGreaterThan(20);
    for (const s of sels) {
      d.selection = s;
      a.panel.rerender();
      a.refreshStatus();
      await until(() => !a.panel.el.querySelector('.pbody > div:empty'), 2000);
      collect();
    }
    // 상태 막대 단위: 모형 단위가 장면 좌표 단위와 다른 파일(cm 모형 — 해석기는 mm 장면으로 읽는다, scene-meta.ts unitsFor)
    a.doc = { ...d, info: { ...d.info, lengthUnit: 'cm' } };
    a.refreshStatus();
    await tick();
    expect(document.querySelector('.st-main')!.textContent, code).toContain(' cm');
    collect();
    a.doc = d;
    a.refreshStatus();
    // 앱 설정 메뉴(번역층이 건너뛰는 칸 — 옮겨 넣는다)
    a.toggleThemeMenu();
    await tick();
    expect(document.querySelector('.menu')).not.toBeNull();
    collect();
    a.closeMenu();
    // 알림 띠: 판 글이 없는데 해석기가 거절한 옛 파일(worker/notice.ts — protocol.test가 보는 상태)
    const old = unsupportedNotice({ name: 'old.skp', units: 'unknown', meshes: [], lines: [], meta: { unsupported: true } } as unknown as Scene3d, 'old.skp')!;
    a.showNotice('warn', old.title, old.text);
    await tick();
    collect();
    // 언어 메뉴 단추 이름은 화면 언어(원어 이름 목록은 위에서 뺐다)
    expect(document.querySelector('.language-trigger')!.getAttribute('aria-label'), code).not.toMatch(HANGUL);
    expect([...spots].sort(), code).toEqual([...LEFT[code]].sort());
  });

  it('새 열쇠는 같은 사전의 낱말이고 네 사전에서 하나뿐(거꾸로 찾기 제 원문) — 상태 막대 「좌표 {0}」·못 읽는 판 알림 제목', () => {
    const KEYS = ['좌표 {0}', '아직 읽지 못하는 판입니다: SketchUp (알 수 없음)'];
    const all = CODES.flatMap((l) => Object.values(catalogs[l]!));
    for (const l of CODES) {
      const c = catalogs[l]!;
      // 「{0} · 좌표 {1}」의 뒤쪽, 「아직 읽지 못하는 판입니다: {0} ({1})」에 「알 수 없음」 값
      expect(c['{0} · 좌표 {1}']!.replace('{0}', '').replace(/^\s*[·・]\s*/, '').replace('{1}', '{0}'), l).toBe(c['좌표 {0}']);
      expect(c['아직 읽지 못하는 판입니다: {0} ({1})']!.replace('{0}', 'SketchUp').replace('{1}', c['알 수 없음']!), l).toBe(c[KEYS[1]!]);
      for (const k of KEYS) {
        expect(c[k], `${l}: ${k}`).not.toMatch(HANGUL);
        expect(all.filter((v) => v === c[k]).length, `${l}: ${k}`).toBe(1);
        expect(sourceMessage(c[k]!), `${l}: ${k}`).toBe(k);
      }
      // 상태 막대 꼴(app.ts refreshStatus — 글은 「  |  」, title은 「 · 」로 이음 — 조각 「단위 cm」·「좌표 mm」을 따로 옮긴다)
      const parts = ['SketchUp 2026 · 26.1.194', '단위 cm · 좌표 mm', '113 KB', '면 117 · 모서리 267', '읽기 12 ms'];
      for (const line of [parts.join('  |  '), parts.join(' · ')]) expect(translate(line, l), `${l}: ${line}`).not.toMatch(HANGUL);
    }
  });
});
