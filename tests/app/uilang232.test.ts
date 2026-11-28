// @vitest-environment jsdom
/**
 * 232차: 214차 시험(uilang214.test.ts)이 그리지 않는 받기 실패 화면(228·229차)에 앱 한국어가 남지 않는지(WCAG 3.1.2 — 214차와 같은 모음·같은 파일 글 칸 가름).
 * 실제 앱 틀(SkpViewerApp.mount)에 main.ts처럼 번역층을 걸고(사전을 받지 못하면 앱 loadFailed), 가짜 import 실패(vi.doMock — 228·229차 시험 꼴)로 네 언어에서 그린다:
 * 알림 상자 — 키보드 바로 가기·그림 저장·예제 모형·3D 보기(코어 입구 — 연결됨·끊김 글)·측정 도구(연결됨·끊김 글)·언어 바꾸기 사전의 받지 못한 알림과 ✕ 앞 다시 시도,
 * 다시 시도 뒤 또 받지 못한 새로 고침(229차), 패널 — 구성·선택·정보 탭 몸통과 선택 탭 속성 사전 칸의 알림 글(role=alert)과 다시 시도·새로 고침,
 * 그리고 실패 글이 떠 있는 채 한국어로 바꿨다가 돌아온 화면(알림 글은 앱이 다시 옮겨 넣고 버튼은 번역층이 옮긴다).
 * 언어마다 모듈을 새로 받는다(vi.resetModules — 앞 언어에서 받은 사전·조각이 남지 않게, 같은 조각을 두 앱이 동시에 받지 않게 — 228차 NC 211차 꼴).
 * 가짜는 그 언어 it 안에서만 쓰고 끝에 푼다. 기다림은 조건과 마감 시간(공용 규칙 13번 — 번역층은 DOM이 잇달아 조용할 때까지, uilang214 tick 꼴).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { catalogs, languages } from '../../site/i18n.mjs';
import { rowDoc } from './rowdoc';

type AppModule = typeof import('../../src/app/app');
type I18nModule = typeof import('../../src/app/i18n');
type CoreModule = typeof import('../../src/app/core');
type Doc = ReturnType<typeof rowDoc>;
/** 시험에서 보는 앱 안쪽 */
interface Inner {
  els: { notice: HTMLElement };
  viewer: unknown;
  doc: Doc | null;
  panel: { el: HTMLElement; show(d: Doc): void; rerender(): void };
  refreshChrome(): void;
  openShortcuts(): void;
  savePng(): void;
  openSample(): Promise<void>;
  ensureViewer(again?: () => unknown): Promise<boolean>;
  toggleMeasure(on?: boolean): void;
}

const CODES = ['en', 'ja', 'zh-CN', 'de'] as const;
type Code = (typeof CODES)[number];
/** 언어 바꾸기에서 받지 못하게 할 사전(그 화면 언어가 아닌 것) */
const TARGET: Record<Code, Code> = { en: 'de', ja: 'de', 'zh-CN': 'de', de: 'en' };
const HANGUL = /[가-힣]/;
const I18N = readFileSync(resolve(__dirname, '../../src/app/i18n.ts'), 'utf8');
/** 파일 글 칸(uilang214와 같음): 파일 글 묶음(translate="no")과 번역층이 건너뛰는 이름 칸(i18n.ts SKIP의 클래스 선택자) */
const FILE_CELLS = ['[translate="no"]', '[data-static-languages]', ...I18N.match(/const SKIP = '([^']+)'/)![1]!.split(', ').filter((s) => s.startsWith('.'))].join(', ');
/** 번역층이 옮기는 속성과 화면 읽기 값(uilang214와 같음) */
const ATTRS = ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'alt'];
const tag = (el: Element): string => el.localName + [...el.classList].map((c) => `.${c}`).join('');
/** 한글이 든 자리(uilang214 hangulSpots와 같음 — 언어 메뉴 원어 이름은 뺀다) */
function hangulSpots(root: Element): string[] {
  const out: string[] = [];
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
/** 번역층·다시 그리기를 기다린다: DOM이 매크로 작업 네 차례 잇달아 조용할 때까지, 마감 5초(uilang214 tick 꼴) */
async function tick(): Promise<void> {
  let changed = false;
  const watch = new MutationObserver(() => {
    changed = true;
  });
  watch.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  try {
    for (let quiet = 0, end = Date.now() + 5_000; quiet < 4 && Date.now() < end; ) {
      changed = false;
      await new Promise((r) => setTimeout(r, 0));
      quiet = changed ? 0 : quiet + 1;
    }
  } finally {
    watch.disconnect();
  }
}
/** 조건을 시간으로 기다린 뒤 번역층을 기다린다(마감 5초 — 지나면 아래 soft 확인이 잡는다) */
async function until(ok: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
  await tick();
}

/**
 * 시험 모형(rowDoc — 감싼 그룹 안 상자 둘). 실제 파일 문서는 해석기가 늘 면·모서리 수를 적는다(index.ts sceneFrom — 그릴 것이 없는 장면은 문서를 만들지 않는다, app.ts openBlob).
 * 이 모형은 수가 없다: 232차에는 상태 막대가 「면 — · 모서리 —」가 되어 그 「 — 」가 번역층의 조각 가름 글자와 겹쳐 「모서리」가 옮겨지지 않아 수를 적어 두었다.
 * 233차: 상태 막대가 모르는 수 조각을 빼므로(app.ts refreshStatus — 정보 탭·태그 줄 꼴) 수 없는 모형 그대로 그려 그 자리도 한글 0을 지킨다
 */
function doc(): Doc {
  return rowDoc();
}

/** 브라우저가 조각을 받지 못한 꼴의 오류(app.ts isChunkLoadError가 알아본다) */
const chunkError = (name: string): TypeError => new TypeError(`Failed to fetch dynamically imported module: http://x/assets/${name}-x.js`);
/** 받는 모듈이 던진다(공장이 던지면 vitest는 캐시하지 않아 다음 받기에서 다시 부른다 — 228차 시험 꼴) */
const fail = (name: string) => (): never => {
  throw chunkError(name);
};
/** 받을 수 있게 된 조각 — 탭 몸통 조각(infotab)만 속성 사전 칸 걸음에서 받는다 */
const ready = new Set<string>();
const MOCKED = ['../../src/app/shortcuts', '../../src/app/exporter', '../../src/app/sample', '../../src/app/attrview', '../../src/app/infotab', '../../src/app/core', ...CODES.map((c) => `../../site/locales/${c}.json`)];

/** 그 언어 차례의 새 모듈(가짜 받기 실패를 건 뒤 앱·번역층·코어 입구를 받는다) */
async function load(code: Code): Promise<{ mod: AppModule; i18n: I18nModule; core: CoreModule }> {
  vi.resetModules();
  ready.clear();
  for (const p of MOCKED) vi.doUnmock(p);
  vi.doMock(`../../site/locales/${TARGET[code]}.json`, fail(TARGET[code]));
  vi.doMock('../../src/app/shortcuts', fail('shortcuts'));
  vi.doMock('../../src/app/exporter', fail('exporter'));
  vi.doMock('../../src/app/sample', fail('sample'));
  vi.doMock('../../src/app/attrview', fail('attrview'));
  vi.doMock('../../src/app/infotab', (importOriginal) => {
    if (!ready.has('infotab')) throw chunkError('infotab');
    return importOriginal();
  });
  // 코어 입구·측정 도구는 조각 오류일 때만 다시 시도를 주므로 받기 함수를 브라우저 꼴 TypeError로 거부한다(229차 시험 꼴)
  vi.doMock('../../src/app/core', async (importOriginal) => {
    const m = await importOriginal<CoreModule>();
    return { ...m, loadViewerCore: () => Promise.reject(chunkError('viewer')), loadMeasure: () => Promise.reject(chunkError('measure')) };
  });
  return { mod: await import('../../src/app/app'), i18n: await import('../../src/app/i18n'), core: await import('../../src/app/core') };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  Reflect.deleteProperty(navigator, 'onLine');
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const p of MOCKED) vi.doUnmock(p);
});

/** 앱 틀을 붙이고 main.ts처럼 번역층을 건다(사전을 받지 못하면 앱 loadFailed) */
async function mount(m: { mod: AppModule; i18n: I18nModule }, code: Code): Promise<Inner> {
  history.replaceState(null, '', `/opencad-skp/${code}/`);
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new m.mod.SkpViewerApp(root);
  app.mount();
  dispose = await m.i18n.installLocalization(root, (...x) => app.loadFailed(...x));
  await tick();
  return app as unknown as Inner;
}

it.each(CODES)('232차 %s: 받지 못한 알림(알림 상자 여섯·탭 몸통 셋·속성 사전 칸)·다시 시도·새로 고침, 그 채로 언어를 바꿨다 돌아온 화면에 앱 한국어가 남지 않는다', async (code) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const m = await load(code);
  const cat = catalogs[code]!;
  const FAIL = cat['{0}을(를) 불러오지 못했습니다.']!;
  const RETRY = cat['다시 시도']!;
  const RELOAD = cat['새로 고침']!;
  const spots = new Set<string>();
  /** 번역층을 기다린 뒤 한글 자리를 모은다 */
  const collect = async (): Promise<void> => {
    await tick();
    hangulSpots(document.body).forEach((s) => spots.add(s));
  };
  let a = await mount(m, code);
  expect(document.documentElement.lang).toBe(code);
  const n = (): HTMLElement => a.els.notice;
  const title = (): string => n().querySelector('.notice-text b')?.textContent ?? '';
  const text = (): string => n().querySelector('.notice-text > span')?.textContent ?? '';
  const button = (root: Element, label: string): HTMLButtonElement | undefined => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  /**
   * 알림 상자: show가 띄운 받지 못한 알림(✕ 앞 다시 시도)을 모으고, retry면 다시 시도(또 받지 못함 — 새로 고침, 229차)도 모은 뒤 ✕로 닫는다.
   * 제목·글은 그 화면 언어의 사전 값(soft — 어긋나도 끝까지 모은다)
   */
  const notice = async (what: string, show: () => unknown, head: string, body: string, retry: boolean): Promise<void> => {
    void show();
    await until(() => !n().hidden && !!button(n(), RETRY));
    expect.soft(title(), `${code}: ${what}`).toBe(head);
    expect.soft(text(), `${code}: ${what}`).toBe(body);
    await collect();
    if (retry) {
      button(n(), RETRY)!.click();
      await until(() => !n().hidden && !!button(n(), RELOAD));
      expect.soft(title(), `${code}: ${what} — 새로 고침`).toBe(head);
      expect.soft(button(n(), RETRY), `${code}: ${what} — 새로 고침`).toBeUndefined();
      await collect();
    }
    (n().lastElementChild as HTMLElement).click();
    expect.soft(n().hidden, `${code}: ${what} 닫기`).toBe(true);
  };
  const viewerText = (online: boolean): string => cat[m.core.chunkFailText('viewer', online)]!;
  const measureText = (online: boolean): string => cat[m.core.chunkFailText('measure', online)]!;
  // ── 알림 상자(228·229차) ──
  await notice('키보드 바로 가기', () => a.openShortcuts(), FAIL.replace('{0}', cat['키보드 바로 가기']!), '', true);
  await notice('예제 모형', () => a.openSample(), FAIL.replace('{0}', cat['예제 모형']!), '', true);
  const d = doc();
  a.doc = d;
  a.viewer = { canvas: document.createElement('canvas') };
  await notice('그림 저장', () => a.savePng(), FAIL.replace('{0}', cat['그림 저장']!), '', true);
  a.viewer = null;
  // 3D 보기·측정 도구: 연결이 끊긴 글(다시 시도 그대로) → 연결된 글(다시 시도 → 새로 고침). 다시 열 길(again)은 예제·최근 문서·주소의 열기(229차)
  const again = (): Promise<boolean> => a.ensureViewer(again);
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  await notice('3D 보기(끊김)', again, cat['3D 보기를 열 수 없습니다']!, viewerText(false), false);
  await notice('측정 도구(끊김)', () => a.toggleMeasure(), cat['측정 도구를 열 수 없습니다']!, measureText(false), false);
  Reflect.deleteProperty(navigator, 'onLine');
  await notice('3D 보기', again, cat['3D 보기를 열 수 없습니다']!, viewerText(true), true);
  await notice('측정 도구', () => a.toggleMeasure(), cat['측정 도구를 열 수 없습니다']!, measureText(true), true);
  // 언어 바꾸기: 그 사전을 받지 못하면 바꾸기 전 언어(이 화면 언어)로 알린다 — 이름은 언어 메뉴와 같은 원어 이름
  const label = languages.find((l) => l.code === TARGET[code])!.label;
  await notice('언어 바꾸기', () => document.querySelector<HTMLButtonElement>(`[data-language="${TARGET[code]}"]`)!.click(), FAIL.replace('{0}', label), '', true);
  expect.soft(document.documentElement.lang, code).toBe(code);

  // ── 패널 탭 몸통(228·229차): 조각을 받지 못하면 몸통 안 알림 글과 다시 시도, 다시 시도 뒤 또 받지 못하면 새로 고침 ──
  a.refreshChrome();
  a.panel.show(d);
  const body = (): HTMLElement => a.panel.el.querySelector<HTMLElement>('.pbody')!;
  const alert = (): string => body().querySelector('[role=alert]')?.textContent ?? '';
  for (const [tab, name] of [['outline', '구성'], ['entity', '선택'], ['info', '정보']] as const) {
    d.panelTab = tab;
    a.panel.rerender();
    await until(() => !!button(body(), RETRY));
    expect.soft(alert(), `${code}: ${tab}`).toBe(FAIL.replace('{0}', cat[name]!));
    await collect();
  }
  button(body(), RETRY)!.click();
  await until(() => !!button(body(), RELOAD));
  expect.soft(alert(), `${code}: info — 새로 고침`).toBe(FAIL.replace('{0}', cat['정보']!));
  await collect();
  for (const tab of ['outline', 'entity'] as const) {
    d.panelTab = tab;
    a.panel.rerender();
    await until(() => !!button(body(), RELOAD));
    expect.soft(button(body(), RETRY), `${code}: ${tab} — 새로 고침`).toBeUndefined();
    await collect();
  }
  // 실패 글이 떠 있는 채(탭 몸통 새로 고침·3D 보기 알림 새로 고침) 한국어로 바꿨다가 돌아온다 — 한국어 동안은 모으지 않는다
  void again();
  await until(() => !n().hidden && !!button(n(), RELOAD));
  const choose = async (c: string): Promise<void> => {
    document.querySelector<HTMLButtonElement>(`.language-list [data-language="${c}"]`)!.click();
    await until(() => document.documentElement.lang === c);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await tick();
  };
  await choose('ko');
  expect.soft(title(), `${code} → ko`).toBe('3D 보기를 열 수 없습니다');
  await choose(code);
  expect.soft(title(), `ko → ${code}`).toBe(cat['3D 보기를 열 수 없습니다']);
  expect.soft(text(), `ko → ${code}`).toBe(viewerText(true));
  expect.soft(button(n(), RELOAD), `ko → ${code}`).toBeTruthy();
  expect.soft(alert(), `ko → ${code}`).toBe(FAIL.replace('{0}', cat['선택']!));
  expect.soft(button(body(), RELOAD), `ko → ${code}`).toBeTruthy();
  await collect();

  // ── 선택 탭 속성 사전 칸(228·229차): 탭 몸통은 받고(새 앱 — 받지 못한 셈이 없는 패널) 칸 조각만 받지 못한다 ──
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  ready.add('infotab');
  a = await mount(m, code);
  const d2 = doc();
  // 모형 속성 사전 하나(고른 것이 없으면 선택 탭이 모형 정보와 그 사전을 보인다 — paneltabs226 꼴)
  d2.attributes = [{ Render: { mode: 'fast' } }] as unknown as Doc['attributes'];
  d2.modelAttrs = 0;
  d2.panelTab = 'entity';
  a.doc = d2;
  a.refreshChrome();
  a.panel.show(d2);
  await until(() => !!button(body(), RETRY));
  expect.soft(body().querySelectorAll('.prop-row').length, `${code}: 모형 정보 줄`).toBeGreaterThan(0);
  expect.soft(alert(), `${code}: 속성 사전`).toBe(FAIL.replace('{0}', cat['속성 사전']!));
  await collect();
  button(body(), RETRY)!.click();
  await until(() => !!button(body(), RELOAD));
  expect.soft(alert(), `${code}: 속성 사전 — 새로 고침`).toBe(FAIL.replace('{0}', cat['속성 사전']!));
  await collect();
  expect([...spots].sort(), code).toEqual([]);
});
