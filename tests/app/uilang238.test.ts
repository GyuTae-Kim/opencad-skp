// @vitest-environment jsdom
/**
 * 238차: 그려진 채 언어를 바꿀 수 있는 화면마다, 언어를 다섯 번 바꾼 화면이 처음부터 그 언어로 그린 화면과 같은지(앞 언어 글이 남는 칸 — WCAG 3.1.2·4.1.3, STEP 230차와 같은 꼴).
 * 실제 앱 틀(SkpViewerApp.mount)에 main.ts처럼 번역층을 걸고 같은 차례로 여덟 장면을 만든다: 처음 화면과 받지 못한 알림의 새로 고침, 태그 탭·장면 탭과 해석 경고, 구성 탭과 그림 저장 실패,
 * 선택 탭·상태 막대 고른 것과 측정 도구 받기 실패, 정보 탭 장면 카드와 장면 재생 중 버튼, 측정 띠·측정값 칸·툴팁·잠금 안내·가상 커서 알림 칸·복사 알림·그림 저장 창(모달 아님),
 * 휴대폰 꼴 측정 띠(칸·복사 잠깐 알림), 휴대폰 꼴 고른 것 카드.
 * 「처음부터 그 언어로」: 다섯 언어마다 앱을 새로 붙여 장면마다 글 칸을 찍는다. 「다섯 번 바꿈」: 한국어(ko→en→ja→zh-CN→de→ko)·영어(en→ja→zh-CN→de→ko→en)로 붙여 장면을 만든 뒤
 * 공용 언어 메뉴로 다섯 번 바꾸며 그때마다 그 언어의 처음 그린 칸과 견준다. 칸은 숨지 않은 요소마다 제 글 마디와 번역층이 옮기는 속성(파일 글 칸·언어 메뉴는 뺀다 — uilang214와 같은 가름).
 * 값이 다르거나 처음 그린 화면에 없는 칸은 「남음」(앞 언어 글), 처음 그린 화면에 있는데 비거나 없어진 칸은 「비움」 — 가상 커서 알림 칸만 비운다(216차, 다음 키가 새 언어로 알린다).
 * 대조: 장면 A에 앱 글을 미리 옮겨 번역층이 건너뛰는 칸에 넣고 다시 그리지 않는 칸 하나를 두어, 바꿀 때마다(돌아온 언어 빼고) 「남음」으로 잡히는지 본다(셈이 비지 않음).
 * 그려진 채 언어를 바꿀 수 없는 것 — 열린 앱 메뉴(언어 메뉴를 누르거나 초점을 옮기면 닫힘)·바로 가기 안내(모달 — 언어 메뉴가 inert 안) — 은 아래 다른 it이 본다.
 * 받기 실패 탭 몸통(가짜 import 실패 — 모듈을 언어마다 새로 받아야 함)은 uilang232가, 여는 중 덮개는 uilang214가 본다.
 * 기다림은 조건과 마감 시간(공용 규칙 13번 — 번역층·다시 그리기는 DOM이 잇달아 조용할 때까지).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { KeyboardSnapOptions, Viewer3d } from 'opencad-viewer3d';
import type { CameraState } from 'opencad-viewer3d/camera';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import { createDoc, type SkpDoc } from '../../src/app/doc';
import { SAMPLE_NAME, sampleSkpBytes } from '../../src/app/sample';
import { errorParts, installLocalization, uiText } from '../../src/app/i18n';
import { SkpViewerApp } from '../../src/app/app';
import type { Mixed } from '../../src/app/filetext';
import { KeyPick } from '../../src/app/keypick';
import type { MeasureMode, MeasureTool, MeasureViewer } from '../../src/app/measure';
import { Overlay } from '../../src/app/overlay';
import type { Panel } from '../../src/app/panel';
import { unsupportedNotice } from '../../src/worker/notice';

const CODES = ['ko', 'en', 'ja', 'zh-CN', 'de'] as const;
type Code = (typeof CODES)[number];
/** 시작 언어와 다섯 번 바꾸는 차례(끝은 시작 언어로 돌아옴) */
const CYCLES: Record<'ko' | 'en', readonly Code[]> = { ko: ['en', 'ja', 'zh-CN', 'de', 'ko'], en: ['ja', 'zh-CN', 'de', 'ko', 'en'] };
const I18N = readFileSync(resolve(__dirname, '../../src/app/i18n.ts'), 'utf8');
/** 파일 글 칸(uilang214와 같음): 파일 글 묶음(translate="no" — 언어 메뉴도)과 번역층이 건너뛰는 이름 칸(i18n.ts SKIP의 클래스 선택자) */
const FILE_CELLS = ['[translate="no"]', '[data-static-languages]', ...I18N.match(/const SKIP = '([^']+)'/)![1]!.split(', ').filter((s) => s.startsWith('.'))].join(', ');
/** 번역층이 옮기는 속성과 화면 읽기 값(uilang214와 같음) */
const ATTRS = ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'alt'];
/** 비워도 되는 칸: 가상 커서 알림 칸(언어를 바꾸면 앞 언어 글을 비운다 — 216차) */
const CLEARED = /div\.kp-live:\d+$/;
/** 대조 칸(장면 A — 미리 옮겨 넣고 다시 그리지 않는다) */
const CONTROL = 'span.ctl238';
/** 예제 모형(한국어 이름 그대로 — 파일 글이 앱마다 같게. 앱마다 이 바이트로 새 문서를 연다) */
const SAMPLE = sampleSkpBytes(undefined, (s) => s);

/** 시험에서 부르는 앱 안쪽 */
interface Inner {
  doc: SkpDoc | null;
  panel: Panel;
  panelOpen: boolean;
  sliding: boolean;
  menu: HTMLElement | null;
  viewer: MeasureViewer | null;
  overlay: Overlay | null;
  measureTool: MeasureTool | null;
  keyPick: KeyPick | null;
  exportDialog: { close(): void } | null;
  shortcutsClose: (() => void) | null;
  phoneQuery: { matches: boolean } | null;
  bandQuery: { matches: boolean } | null;
  coarseQuery: { matches: boolean } | null;
  vcb: { el: HTMLFormElement; input: HTMLInputElement };
  els: { viewHost: HTMLElement; notice: HTMLElement; measureGuide: HTMLButtonElement; measureFlash: HTMLElement };
  refreshChrome(): void;
  refreshStatus(): void;
  refreshToolbar(): void;
  renderSceneTabs(): void;
  showNotice(kind: 'info' | 'warn' | 'error', title: string | Mixed, text: string | Mixed, light?: boolean): boolean;
  measureArrived(want: MeasureMode | null, error: unknown): void;
  toggleMeasureLog(): void;
  toggleThemeMenu(): void;
}

/** 가짜 뷰어(uilang214 꼴을 줄임): 캔버스 한 변(CSS 화소)과 위에서 본 평행 투영 — 화면 (100 + X, 100 − Y) */
const W = 200;
const FOV = (40 * Math.PI) / 180;
const TOP: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };
type FakeCore = MeasureViewer & Pick<Viewer3d, 'setKeyboardSnap' | 'handleKey' | 'pickCandidates' | 'claimPointer' | 'setPickPreview' | 'viewCubeSize' | 'setViewCubeSize'>;

/**
 * 측정 도구가 쓰는 뷰어 몫(누른 자리 밑 면 위 점)과 코어 가상 커서 몫(Enter로 3D 보기 가운데에 켜고 'start'를 알림 — 줄자·각도기 방식은 keypick이 측정 도구 글로 바꾼다)만 가진 뷰어와
 * 실제 덧그림·가상 커서(KeyPick)를 앱 자리에 넣는다
 */
function fakeViewer(a: Inner): { press(x: number, y: number): void; move(x: number, y: number): void; key(k: string): void } {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { get: () => W });
  Object.defineProperty(canvas, 'clientHeight', { get: () => W });
  a.els.viewHost.append(canvas);
  let ks: KeyboardSnapOptions | null = null;
  let cur: { x: number; y: number } | null = null;
  const viewer: FakeCore = {
    canvas,
    pick: (x, y) => ({ kind: 'mesh', id: 'fake', index: 0, point: [x - W / 2, W / 2 - y, 0] }),
    getCamera: () => TOP,
    onCameraChange: () => () => {},
    getRenderMode: () => 'wireframe',
    section: null,
    get keyboardCursor() {
      return cur && { x: cur.x, y: cur.y, mode: 'pick' as const, index: 0, count: 0 };
    },
    setKeyboardSnap: (o) => {
      if (!o) cur = null;
      ks = !o ? null : o === true ? {} : { ...o };
    },
    handleKey: (e) => {
      if (!ks || cur || e.key !== 'Enter' || e.defaultPrevented || (e.target && e.target !== canvas)) return false;
      cur = { x: W / 2, y: W / 2 };
      ks.announce?.({ reason: 'start', mode: 'pick', x: cur.x, y: cur.y, snap: null, index: 0, count: 0, pick: null, text: '' });
      e.preventDefault();
      return true;
    },
    pickCandidates: () => [],
    claimPointer: () => false,
    setPickPreview: () => {},
    viewCubeSize: 0,
    setViewCubeSize: () => {},
  };
  const overlay = new Overlay(a.els.viewHost);
  overlay.attach(viewer as never);
  a.viewer = viewer;
  a.overlay = overlay;
  a.keyPick = new KeyPick(viewer as unknown as Viewer3d, a.els.viewHost, () => a.doc, a as never);
  a.refreshToolbar();
  const ptr = (type: string, x: number, y: number, buttons = 0): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(e);
  };
  return {
    press(x, y) {
      ptr('pointerdown', x, y, 1);
      ptr('pointerup', x, y);
      overlay.paintNow();
    },
    move(x, y) {
      ptr('pointermove', x, y);
      overlay.paintNow();
    },
    key(k) {
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      overlay.paintNow();
    },
  };
}

const tag = (el: Element): string => el.localName + [...el.classList].map((c) => `.${c}`).join('');
/**
 * 글 칸: 숨지 않은(hidden·display:none 조상 없음) 요소마다 제 글 마디(빈칸을 하나로)와 번역층이 옮기는 속성. 파일 글 칸·언어 메뉴는 그 아래까지 뺀다.
 * 열쇠는 body부터의 요소 자리(태그·클래스·형제 차례)
 */
function cells(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (el: Element, path: string): void => {
    if (el.hasAttribute('hidden') || (el as HTMLElement).style?.display === 'none' || el.matches(`script, style, ${FILE_CELLS}`)) return;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.nodeValue)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (own) out.set(path, own);
    for (const at of ATTRS) {
      const v = el.getAttribute(at);
      if (v) out.set(`${path}@${at}`, v);
    }
    [...el.children].forEach((c, i) => walk(c, `${path}>${tag(c)}:${i}`));
  };
  walk(document.body, 'body');
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
/** 조건을 시간으로 기다린 뒤 번역층을 기다린다(마감 5초 — 지나면 아래 확인이 잡는다) */
async function until(ok: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 10));
  await tick();
}
const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
/** 공용 언어 메뉴로 바꾼다(사전을 받은 뒤 앱 languagechange까지), 측정 툴팁은 다음 그림에 다시 그린다(app.ts — overlay.invalidate) */
async function choose(code: Code): Promise<void> {
  document.querySelector<HTMLButtonElement>(`.language-list [data-language="${code}"]`)!.click();
  await until(() => document.documentElement.lang === code);
  await frame();
  await tick();
}
/** 브라우저가 조각을 받지 못한 꼴의 오류(core.ts isChunkLoadError가 알아본다) */
const chunkError = (name: string): TypeError => new TypeError(`Failed to fetch dynamically imported module: http://x/assets/${name}-x.js`);

let dispose: (() => void) | undefined;
beforeAll(async () => {
  // 앱이 기다리지 않고 받는 조각(탭 몸통 — panel.ts loadPanelTabs, 속성 사전 칸, 측정 도구, 그림 저장 창, 바로 가기 안내 창)을 미리 받아 둔다(ci-guard 5 — 모두 맨 위 곁효과 없음)
  await (await import('../../src/app/panel')).loadPanelTabs();
  await import('../../src/app/attrview');
  await import('../../src/app/measure');
  await import('../../src/app/exporter');
  await import('../../src/app/shortcuts');
  // jsdom에는 scrollIntoView가 없다(장면 탭·패널이 고른 줄을 보이는 자리로 굴린다)
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

/** 앱 틀을 붙이고 main.ts처럼 번역층을 건다(사전을 받지 못하면 앱 loadFailed) */
async function mountApp(code: Code): Promise<{ app: SkpViewerApp; a: Inner }> {
  dispose?.();
  document.body.innerHTML = '';
  history.replaceState(null, '', code === 'ko' ? '/opencad-skp/' : `/opencad-skp/${code}/`);
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new SkpViewerApp(root);
  app.mount();
  dispose = await installLocalization(root, (...x) => app.loadFailed(...x));
  await tick();
  return { app, a: app as unknown as Inner };
}

/**
 * 한 언어로 붙인 앱에서 여덟 장면을 차례로 만들고 장면마다 visit(장면 이름)을 부른다(처음 그린 칸 찍기 또는 다섯 번 바꾸며 견주기).
 * 끝에는 이 앱의 가짜 뷰어·측정 도구·가상 커서를 거둔다(다음 앱이 붙은 뒤에도 앞 앱의 창 키 처리는 남으므로 — 문서·도구 없이 둔다)
 */
async function drive(code: Code, visit: (scene: string) => Promise<void>): Promise<void> {
  const { app, a } = await mountApp(code);
  const root = document.getElementById('app')!;
  const d = createDoc(SAMPLE_NAME, SAMPLE.length, { scene: skpToScene(SAMPLE, { name: SAMPLE_NAME, outline: true }), ms: 12 });
  const n = a.els.notice;
  const closeNotice = (): void => {
    if (!n.hidden) (n.lastElementChild as HTMLElement).click();
  };
  // A. 처음 화면·상태 막대 기본 글, 알림 상자 받기 실패(228·229차 — 다시 시도 → 또 받지 못함 → 새로 고침), 대조 칸
  const fail = (): void => app.loadFailed('키보드 바로 가기', fail, chunkError('shortcuts'));
  fail();
  await tick();
  n.querySelector<HTMLButtonElement>('button.mini-btn')!.click();
  await until(() => !n.hidden);
  const control = root.appendChild(document.createElement('span'));
  control.className = 'ctl238';
  control.setAttribute('data-i18n-skip', '');
  control.textContent = uiText('다시 시도');
  await tick();
  await visit('A 처음 화면·받기 실패 새로 고침');
  control.remove();
  // B. 문서: 태그 탭·장면 탭 줄(재생 버튼)·상태 막대, 해석 경고 알림(파일 이름 섞임 — worker/notice.ts)
  a.doc = d;
  a.refreshChrome();
  a.renderSceneTabs();
  d.panelTab = 'tags';
  a.panel.show(d);
  const old = unsupportedNotice({ name: 'old.skp', units: 'unknown', meshes: [], lines: [], meta: { unsupported: true } } as unknown as Scene3d, 'old.skp')!;
  a.showNotice('warn', old.title, old.text);
  await tick();
  await visit('B 태그 탭·장면 탭·해석 경고');
  // C. 구성 탭(모두 펼침), 그림 저장 실패 알림(app.ts savePng notify와 같은 부름 — 까닭은 exporter.ts toBlob 실패 원문)
  d.panelTab = 'outline';
  for (let i = 0; i < (d.tree?.count ?? 0); i++) d.expanded.add(i);
  a.panel.rerender();
  a.showNotice('error', '그림을 저장하지 못했습니다', errorParts(new Error('그림을 만들지 못했습니다')));
  await tick();
  await visit('C 구성 탭·그림 저장 실패');
  // D. 선택 탭·상태 막대 고른 것, 측정 도구 받기 실패 알림(229차 — 조각 오류면 다시 시도)
  d.selection = { kind: 'node', index: 1 };
  d.panelTab = 'entity';
  a.panel.rerender();
  a.refreshStatus();
  a.measureArrived('tape', chunkError('measure'));
  // 탭 몸통·속성 사전 칸 조각은 미리 받아 두어 곧바로 그린다
  await tick();
  await visit('D 선택 탭·고른 것·측정 도구 받기 실패');
  // E. 정보 탭 장면 카드(활성 칩), 장면 재생 중 버튼(멈추기 — 재생 차례는 뷰어 몫이라 깃발만)
  d.panelTab = 'info';
  a.panel.rerender();
  a.sliding = true;
  a.renderSceneTabs();
  await until(() => !!a.panel.el.querySelector('.scene-card'));
  await visit('E 정보 탭 장면 카드·장면 재생 중');
  a.sliding = false;
  a.renderSceneTabs();
  // F. 측정(가짜 뷰어): 툴팁·안내 두기 잠깐 알림(올린 채 — 166차)·시작점 뒤 빨강 축 잠금(잠금 안내)·측정값 칸 못 읽음·결과·복사 알림·최근 측정 기록·가상 커서 켬·그림 저장 창
  d.selection = null;
  closeNotice();
  const fv = fakeViewer(a);
  app.toggleMeasure(true);
  await until(() => !!a.measureTool?.active);
  fv.move(120, 90);
  a.els.measureGuide.click();
  a.els.measureGuide.click();
  a.els.measureFlash.dispatchEvent(new Event('pointerenter'));
  fv.press(100, 100);
  fv.move(150, 100);
  a.measureTool!.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
  fv.move(150, 130);
  a.vcb.input.value = 'abc';
  a.vcb.el.dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  fv.press(150, 100);
  app.copyMeasure('current');
  await until(() => !n.hidden);
  a.toggleMeasureLog();
  fv.key('Enter');
  app.savePng();
  await until(() => !!document.querySelector('.export-dialog'));
  await visit('F 측정 띠·칸·툴팁·잠금·가상 커서·복사·그림 저장 창');
  // G. 휴대폰 꼴(좁은 화면·손가락): 측정 띠 안 측정값 칸, 복사 결과는 띠 잠깐 알림
  a.exportDialog?.close();
  a.phoneQuery = a.bandQuery = a.coarseQuery = { matches: true };
  a.refreshToolbar();
  a.refreshStatus();
  app.copyMeasure('current');
  await until(() => !a.els.measureFlash.hidden);
  await visit('G 휴대폰 꼴 측정 띠');
  // H. 휴대폰 꼴 고른 것 카드(측정 끔·패널 닫음)
  app.toggleMeasure(false);
  a.panelOpen = false;
  a.refreshChrome();
  d.selection = { kind: 'node', index: 1 };
  a.refreshStatus();
  await tick();
  await visit('H 휴대폰 꼴 고른 것 카드');
  a.keyPick?.set(false);
  a.keyPick = null;
  a.measureTool?.dispose();
  a.measureTool = null;
  a.overlay?.dispose();
  a.overlay = null;
  a.viewer = null;
  a.doc = null;
}

it('238차: 그려진 채 언어를 다섯 번 바꾼 화면(한국어·영어에서 시작)이 처음부터 그 언어로 그린 화면과 같다 — 앞 언어 글이 남는 칸 0(대조 칸만 잡힘)', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // 처음부터 그 언어로 그린 칸(언어 → 장면 → 칸)
  const fresh = new Map<Code, Map<string, Map<string, string>>>();
  const summary: string[] = [];
  for (const code of CODES) {
    const shots = new Map<string, Map<string, string>>();
    fresh.set(code, shots);
    const t0 = Date.now();
    await drive(code, async (scene) => void shots.set(scene, cells()));
    summary.push(`처음부터 ${code}: ${Date.now() - t0} ms`);
    expect(document.documentElement.lang, code).toBe(code);
  }
  const scenes = [...fresh.get('ko')!.keys()];
  expect(scenes).toHaveLength(8);
  for (const code of CODES) expect([...fresh.get(code)!.keys()], code).toEqual(scenes);
  const left: string[] = [];
  const cleared: string[] = [];
  for (const start of ['ko', 'en'] as const) {
    const t0 = Date.now();
    await drive(start, async (scene) => {
      let compared = 0;
      let changed = 0;
      let leftHere = 0;
      for (const code of CYCLES[start]) {
        await choose(code);
        const want = fresh.get(code)!.get(scene)!;
        const base = fresh.get(start)!.get(scene)!;
        const got = cells();
        compared += want.size;
        for (const [k, v] of want) if (base.get(k) !== v) changed++;
        for (const k of new Set([...want.keys(), ...got.keys()])) {
          const f = want.get(k);
          const s = got.get(k);
          if (f === s) continue;
          const line = `${start}→${code} ${scene}: ${k}: «${s ?? ''}» ≠ «${f ?? ''}»`;
          if (f !== undefined && !s) cleared.push(line);
          else {
            left.push(line);
            leftHere++;
          }
        }
      }
      summary.push(`${start} ${scene}: 견준 칸 ${compared}, 시작 언어와 다른 칸 ${changed}, 남음 ${leftHere}`);
      // 셈이 비지 않음: 바꿀 때마다 글이 실제로 바뀐다(시작 언어의 처음 그린 칸과 다른 칸이 있다)
      expect.soft(changed, `${start} ${scene}`).toBeGreaterThan(10);
    });
    summary.push(`${start}에서 다섯 번 바꿈: ${Date.now() - t0} ms`);
  }
  // 로컬 셈 기록(진행 기록 표 — 그 경로를 줄 때만, CI는 쓰지 않는다)
  if (process.env.UILANG238_REPORT) writeFileSync(process.env.UILANG238_REPORT, [...summary, `비움 ${cleared.length}`, ...cleared, ...left].join('\n') + '\n');
  // 남음은 대조 칸만(시작 둘 × 돌아오기 전 넷), 비움은 가상 커서 알림 칸만
  const control = left.filter((l) => l.includes(CONTROL));
  expect(control.length).toBe(8);
  expect(left.filter((l) => !l.includes(CONTROL))).toEqual([]);
  expect(cleared.filter((l) => !CLEARED.test(l.split(': ')[1]!))).toEqual([]);
  expect(cleared.length).toBeGreaterThan(0);
});

it('238차 셈 밖: 열린 앱 메뉴는 언어 메뉴 버튼을 누르거나 초점을 옮기면 닫히고, 바로 가기 안내(모달) 동안 언어 메뉴 버튼은 inert 안이다', async () => {
  const { app, a } = await mountApp('ko');
  const trigger = document.querySelector<HTMLButtonElement>('.language-trigger')!;
  expect(trigger).not.toBeNull();
  // 메뉴 밖 누르기·초점 듣기는 연 다음 매크로 작업부터(kbd.ts closeOutside)
  a.toggleThemeMenu();
  await tick();
  expect(a.menu).not.toBeNull();
  trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  expect(a.menu).toBeNull();
  a.toggleThemeMenu();
  await tick();
  expect(a.menu).not.toBeNull();
  trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(a.menu).toBeNull();
  app.openShortcuts();
  await until(() => !!document.querySelector('.sc-box'));
  expect(trigger.closest('[inert]')).not.toBeNull();
  a.shortcutsClose?.();
  expect(trigger.closest('[inert]')).toBeNull();
});
