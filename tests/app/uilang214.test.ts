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
 * 215차: 214차가 그리지 않은 화면 넷 — 측정 중 안내(줄자·각도기·측정 띠·최근 측정 기록), 뷰어가 있어야 여는 메뉴(표준 뷰·단면 보기·보기 설정), 그림 저장 창, 바로 가기 안내 창 —
 * 을 같은 걸음에 더한다. 측정 조각이 쓰는 뷰어 기능만 가진 가짜 뷰어(measure.test 꼴)와 실제 덧그림을 앱 자리에 넣고, 그 뒤는 앱의 길(도구 막대 버튼·앱 함수 — 조각 받기 포함) 그대로.
 * 이름도 정의 이름도 없는 그룹 아래 항목의 경로(상태 막대·고른 것 탭 「위치」·찾기 줄)와 해석기의 이름 없는 태그·정의 기본 이름(「#n」)도 본다.
 * 216차: 커서·포인터가 있어야 뜨는 화면 셋 — 측정 툴팁(커서 옆 스냅 이름·값), 겹친 것 고르기 목록, 가상 커서 알림(키보드 붙잡기·고르기) — 을 같은 걸음에 더한다.
 * 가짜 뷰어에 코어의 키보드 붙잡기 몫과 겹친 것 후보를 더하고 앱 ensureViewer처럼 KeyPick·PickList를 그 뷰어로 만들어, 캔버스에 보낸 포인터·키 사건이 앱 길(창 키 처리·측정 도구·목록) 그대로 띄운다.
 * 그리고 언어를 바꾼 뒤 알림 영역(role=status·alert·aria-live)에 앞 언어로 넣은 글이 남지 않는지 본다(WCAG 3.1.2·4.1.3 — 번역층이 건너뛰는 칸은 앱이 그때 언어 글을 넣는다).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { KeyboardSnapAnnouncement, KeyboardSnapOptions, Pick3d, PickGroupKey, Viewer3d } from 'opencad-viewer3d';
import type { CameraState } from 'opencad-viewer3d/camera';
import { keySnapHint, keySnapMessages, keySnapText, normalizeKeySnapKeys, orderedText, pointText, type KeySnapMessageKey, type KeySnapText } from 'opencad-viewer3d/keysnap';
import type { Scene3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import { readLayers } from '../../src/vffroot';
import { TlvReader } from '../../src/tlv';
import { createDoc, type Selection, type SkpDoc } from '../../src/app/doc';
import { SAMPLE_NAME, sampleSkpBytes } from '../../src/app/sample';
import { installLocalization } from '../../src/app/i18n';
import { SkpViewerApp } from '../../src/app/app';
import type { Mixed } from '../../src/app/filetext';
import { KEY_PICK_TEXT, KeyPick } from '../../src/app/keypick';
import type { MeasureTool, MeasureViewer } from '../../src/app/measure';
import { Overlay } from '../../src/app/overlay';
import type { Panel } from '../../src/app/panel';
import { PickList } from '../../src/app/picklist';
import { nodeName } from '../../src/app/tree';
import { unsupportedNotice } from '../../src/worker/notice';
import { catalogs, sourceMessage, translate } from '../../site/i18n.mjs';
import { header, i32, tlv, u8 } from '../build';
import { ID13, mfcFile, squareEntities } from '../mfcwrite';

const CODES = ['en', 'ja', 'zh-CN', 'de'] as const;
const HANGUL = /[가-힣]/;
const I18N = readFileSync(resolve(__dirname, '../../src/app/i18n.ts'), 'utf8');
/** 파일 글 칸: 파일 글 묶음(translate="no")과 번역층이 건너뛰는 이름 칸(i18n.ts SKIP의 클래스 선택자 — 파일·모형에서 온 이름을 담는다) */
const FILE_CELLS = ['[translate="no"]', '[data-static-languages]', ...I18N.match(/const SKIP = '([^']+)'/)![1]!.split(', ').filter((s) => s.startsWith('.'))].join(', ');
/** 번역층이 옮기는 속성과 화면 읽기 값 */
const ATTRS = ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'alt'];

/**
 * 아직 둔 것(언어마다 — 이 시험이 그리는 화면 안): 없음.
 * 214차가 둔 해석기 기본 이름 「태그 n」·「정의 n」과 경로의 「(이름 없음)」은 215차에 고쳐 아래 걸음·시험이 본다
 */
const LEFT: Record<(typeof CODES)[number], string[]> = { en: [], ja: [], 'zh-CN': [], de: [] };

/** 시험에서 부르는 앱 안쪽(문서를 연 뒤 앱이 부르는 화면 갱신 함수·여는 중 덮개·알림 띠·메뉴, 215차 — 뷰어 자리·측정 도구·창) */
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
  viewer: MeasureViewer | null;
  overlay: Overlay | null;
  measureTool: MeasureTool | null;
  measureHint: string | null;
  phoneQuery: { matches: boolean } | null;
  els: { viewHost: HTMLElement; viewBtn: HTMLButtonElement; secMenuBtn: HTMLButtonElement; moreBtn: HTMLButtonElement; measureGuide: HTMLButtonElement };
  exportDialog: { close(): void } | null;
  shortcutsClose: (() => void) | null;
  toggleMeasureLock(): void;
  toggleMeasureLog(): void;
  // 216차: 가상 커서·겹친 것 목록(앱 ensureViewer가 코어 뷰어로 만든다)과 그 둘을 도구에 맞추는 도구 막대 갱신
  keyPick: KeyPick | null;
  pickList: PickList | null;
  refreshToolbar(): void;
}

/** 215차 가짜 뷰어: 캔버스 한 변(CSS 화소)과 위에서 본 평행 투영(measure.test 꼴 — 화면 1화소 = 세계 1, 화면 (100 + X, 100 − Y)) */
const W = 200;
const FOV = (40 * Math.PI) / 180;
const TOP: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };

/** 216차 가짜 코어 가상 커서: 화살표 한 번에 옮기는 화소(코어 기본 5화소 대신 — 후보가 있는 곳과 빈 곳을 몇 번에 오가게) */
const FAKE_STEP = 40;
/** 216차 가짜 후보: 캔버스 이 x(CSS 화소)보다 오른쪽은 빈 곳(후보 없음) */
const EMPTY_X = 160;
/** 216차 가짜 뷰어(측정 도구 몫 + 코어 키보드 붙잡기·겹친 것 후보 몫) */
type FakeCore = MeasureViewer & Pick<Viewer3d, 'setKeyboardSnap' | 'handleKey' | 'pickCandidates' | 'claimPointer' | 'setPickPreview' | 'viewCubeSize' | 'setViewCubeSize'>;

/** 가짜 뷰어를 다루는 포인터·키(캔버스에 사건을 보낸다 — 앱 창 키 처리·측정 도구·겹친 것 목록이 듣는 길 그대로) */
interface FakeView {
  /** 누르기(마우스 — 누르고 떼기) */
  press(x: number, y: number): void;
  /** 216차: 마우스 옮기기(측정 툴팁) */
  move(x: number, y: number): void;
  /** 216차: 마우스 오른쪽 버튼을 끌지 않고 누르고 떼기(겹친 것 목록) */
  right(x: number, y: number): void;
  /** 216차: 키 누르기(keydown — 대상 el, 없으면 캔버스) */
  key(k: string, el?: Element | null): void;
  /** 216차: 가짜 코어 가상 커서가 켜졌는지 */
  readonly cursor: boolean;
}

/**
 * 뷰어가 있어야 여는 화면(측정 도구·보기 메뉴·그림 저장 창)을 그리려고, 측정 조각이 쓰는 뷰어 기능만 가진 가짜 뷰어(누른 자리 밑 면 위 점 — 와이어프레임이라 가림 없음)와
 * 실제 덧그림을 앱 자리(3D 보기 칸)에 넣는다.
 * 216차: 코어의 키보드 붙잡기(setKeyboardSnap·keyboardCursor·handleKey — 고르기 모드만, 앱은 코어 측정을 쓰지 않는다)와 겹친 것 후보(pickCandidates)도 갖고,
 * 앱 ensureViewer처럼 가상 커서(KeyPick)·겹친 것 목록(PickList)을 이 뷰어로 만들어 앱 자리에 둔다(도구 막대 갱신이 도구에 맞춘다 — 3D 강조 미리 보기는 그래픽 길이라 뺀다).
 * 가짜 코어 알림 글은 코어 keyAnnounce와 같은 차례로 코어 글 함수(keysnap — keySnapText·orderedText·pointText·keySnapHint)에 앱이 준 틀·이름·수 꼴을 넣어 만든다.
 * 커서는 첫 화살표·Enter에 3D 보기 가운데에 켜고(옮기지 않음) 그 뒤 화살표마다 FAKE_STEP 화소 옮긴다. 후보는 빈 곳(EMPTY_X 오른쪽)이 아니면 예제 문서 메시에서 묶음 열쇠로 하나씩 셋까지
 */
function fakeViewer(a: Inner): FakeView {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { get: () => W });
  Object.defineProperty(canvas, 'clientHeight', { get: () => W });
  a.els.viewHost.append(canvas);
  let ks: KeyboardSnapOptions | null = null;
  let cur: { x: number; y: number; index: number; picks: Pick3d[] } | null = null;
  const candidates = (x: number, y: number, group?: PickGroupKey | null, max = 3): Pick3d[] => {
    const d = a.doc;
    const out: Pick3d[] = [];
    if (!d || x > EMPTY_X) return out;
    const seen = new Set<string | number>();
    for (const m of d.scene.meshes) {
      const p: Pick3d = { kind: 'mesh', id: m.id, index: 0, point: [x - W / 2, W / 2 - y, 0] };
      const k = group?.(p, out.length) ?? m.id;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
      if (out.length >= Math.min(3, max)) break;
    }
    return out;
  };
  const messages = (): KeySnapText => (typeof ks!.messages === 'function' ? ks!.messages : keySnapMessages(ks!.messages));
  const num = (v: number): string => {
    const s = ks?.formatNumber?.(v, { kind: 'x', text: String(v), digits: 0, unit: '' });
    return typeof s === 'string' && s ? s : String(v);
  };
  const pickText = (p: Pick3d, M: KeySnapText, index: number): string => {
    const s = ks?.pickName?.(p, index);
    const name = (typeof s === 'string' && s.trim()) || p.id;
    return keySnapText(M, 'pickItem', [name, keySnapText(M, p.section ? 'pick.section' : (`pick.${p.kind}` as KeySnapMessageKey))]);
  };
  const say = (reason: KeyboardSnapAnnouncement['reason'], lead?: string): void => {
    const c = cur;
    if (!ks?.announce || !c) return;
    const M = messages();
    const p = c.picks[c.index] ?? null;
    const n = c.picks.length;
    const body = p ? orderedText(pickText(p, M, c.index), c.index, n, pointText(p.point, num, M), null, M) : keySnapText(M, 'noPick');
    let text = lead ?? (reason === 'cycle' && n === 1 ? keySnapText(M, 'only', [body]) : body);
    if (reason === 'start') text = keySnapText(M, 'start', [body, keySnapHint(normalizeKeySnapKeys(ks.keys), 'pick', !!ks.pickCycle, M)]);
    ks.announce({ reason, mode: 'pick', x: c.x, y: c.y, snap: null, index: c.index, count: n, pick: p, text });
  };
  const at = (x: number, y: number): void => {
    const pc = ks!.pickCycle;
    cur = { x, y, index: 0, picks: pc ? candidates(x, y, typeof pc === 'object' ? pc.group : null) : [] };
  };
  const ARROWS: Record<string, readonly [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const viewer: FakeCore = {
    canvas,
    pick: (x, y) => ({ kind: 'mesh', id: 'fake', index: 0, point: [x - W / 2, W / 2 - y, 0] }),
    getCamera: () => TOP,
    onCameraChange: () => () => {},
    getRenderMode: () => 'wireframe',
    section: null,
    get keyboardCursor() {
      const c = cur;
      return c && { x: c.x, y: c.y, mode: 'pick' as const, index: c.index, count: c.picks.length };
    },
    // 코어처럼: 끄면 켜진 커서도 알리지 않고 끄고, 다시 주면 틀만 바꾼다(켜진 커서는 그대로 — 알리지 않는다)
    setKeyboardSnap: (o) => {
      if (!o) cur = null;
      ks = !o ? null : o === true ? {} : { ...o };
    },
    // 코어 keyboardKey 꼴(대상이 3D 보기일 때만): 화살표 켜기·옮기기, Tab 후보 돌리기(고르기 모드), Enter 켜기·고르기, Esc 끄기
    handleKey: (e) => {
      const c = cur;
      if (!ks || e.defaultPrevented || (e.target && e.target !== canvas) || e.ctrlKey || e.metaKey || e.altKey) return false;
      const d = ARROWS[e.key];
      if (d || (e.key === 'Enter' && !c)) {
        if (c) at(c.x + d![0] * FAKE_STEP, c.y + d![1] * FAKE_STEP);
        else at(W / 2, W / 2);
        say(c ? 'move' : 'start');
      } else if (e.key === 'Tab' && c && ks.pickCycle && c.picks.length) {
        c.index = (c.index + (e.shiftKey ? c.picks.length - 1 : 1)) % c.picks.length;
        say('cycle');
      } else if (e.key === 'Enter' && c) {
        const M = messages();
        const p = c.picks[c.index];
        say('commit', p ? keySnapText(M, 'picked', [pickText(p, M, c.index)]) : keySnapText(M, 'pickedNothing'));
      } else if (e.key === 'Escape' && c) {
        cur = null;
        ks.announce?.({ reason: 'end', mode: 'pick', x: c.x, y: c.y, snap: null, index: 0, count: 0, pick: null, text: keySnapText(messages(), 'end') });
      } else return false;
      e.preventDefault();
      return true;
    },
    pickCandidates: (x, y, o) => (typeof o === 'object' ? candidates(x, y, o.group, o.max) : candidates(x, y)),
    claimPointer: () => false,
    setPickPreview: () => {},
    // 앱 languagechange가 뷰 큐브 글을 다시 그리게 부른다(216차 언어 바꾸기 걸음)
    viewCubeSize: 0,
    setViewCubeSize: () => {},
  };
  const overlay = new Overlay(a.els.viewHost);
  overlay.attach(viewer as never);
  a.viewer = viewer;
  a.overlay = overlay;
  // 앱 ensureViewer와 같은 둘(겹친 것 목록은 측정·걷기가 아닐 때만 연다 — 고른 것은 이 시험이 보지 않는다)
  a.keyPick = new KeyPick(viewer as unknown as Viewer3d, a.els.viewHost, () => a.doc, a as never);
  a.pickList = new PickList(viewer as never, () => a.doc, { allowed: () => !!a.doc && !a.measureTool?.active, choose: () => {} });
  a.refreshToolbar();
  const ptr = (type: string, x: number, y: number, button = 0, buttons = 0): void => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button, buttons, bubbles: true });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(e);
  };
  return {
    press(x, y) {
      ptr('pointerdown', x, y, 0, 1);
      ptr('pointerup', x, y);
      overlay.paintNow();
    },
    move(x, y) {
      ptr('pointermove', x, y);
      overlay.paintNow();
    },
    right(x, y) {
      ptr('pointerdown', x, y, 2, 2);
      ptr('pointerup', x, y, 2);
    },
    key(k, el) {
      (el ?? canvas).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      overlay.paintNow();
    },
    get cursor() {
      return !!cur;
    },
  };
}

/** 요소 꼴 이름(태그 + 클래스) */
const tag = (el: Element): string => el.localName + [...el.classList].map((c) => `.${c}`).join('');

/** 한글이 든 자리: 「요소: 글」·「요소@속성: 값」(파일 글 칸 안이면 앞에 「[파일 칸] 」). 언어 메뉴(원어 이름)는 뺀다 */
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
let measure: typeof import('../../src/app/measure');
beforeAll(async () => {
  // 패널이 기다리지 않고 받는 조각(정보 탭·속성 사전 — panel.ts void import)을 미리 받아 둔다(ci-guard 5 — 시험 파일이 끝난 뒤 모듈을 평가하지 않게)
  await import('../../src/app/infotab');
  await import('../../src/app/attrview');
  // 215차: 앱이 처음 쓸 때 받는 조각(측정 도구 — core.ts loadMeasure, 그림 저장 창·바로 가기 안내 창 — app.ts void import)도 미리(셋 다 맨 위 곁효과 없음)
  measure = await import('../../src/app/measure');
  await import('../../src/app/exporter');
  await import('../../src/app/shortcuts');
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

  it.each(CODES)('%s: 처음 화면·도구 막대·측정 띠·상태 막대, 예제 문서의 장면 탭·패널 네 탭·앱 설정 메뉴, 여는 중 덮개·알림 띠, 215차 측정 중 안내·뷰어 메뉴·그림 저장 창·바로 가기 안내 창·이름 없는 그룹 경로', async (code) => {
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
    // ── 215차: 뷰어가 있어야 여는 화면(가짜 뷰어·실제 덧그림을 앱 자리에) ──
    const fv = fakeViewer(a);
    const press = fv.press;
    const key = (k: string): boolean => !!a.measureTool?.handleKey(new KeyboardEvent('keydown', { key: k, cancelable: true }));
    const settle = async (): Promise<void> => {
      await tick();
      collect();
    };
    // 216차: 측정 툴팁이 보이는지(커서 옆 — 글이 있고 숨기지 않음), 가상 커서 알림 칸의 지금 글
    const tipShown = (): boolean => {
      const t = document.querySelector<HTMLElement>('.measure-tip');
      return !!t && t.style.display === 'block' && !!t.textContent;
    };
    const live = (): string => document.querySelector('.kp-live')?.textContent ?? '';
    /** 216차: 키를 차례로 보내고 걸음마다 모은다(알림 칸에 글이 들었는지 — soft) */
    const keys = async (list: readonly string[]): Promise<void> => {
      for (const k of list) {
        fv.key(k);
        expect.soft(live(), `${code}: ${k}`).not.toBe('');
        await settle();
      }
    };
    /** 216차: 켜진 가상 커서를 Esc로 끈다(측정 도구가 지울 것 — 점·끌어온 점·평면 고정·결과 — 이 먼저, 다 지우면 커서 끄기. 커서가 꺼지면 더 보내지 않는다 — 측정을 끄지 않게) */
    const escape = async (): Promise<void> => {
      for (let i = 0; i < 6 && fv.cursor; i++) {
        fv.key('Escape');
        await settle();
      }
      expect.soft(fv.cursor, code).toBe(false);
    };
    // 측정 중 안내 — 줄자: 켬(측정 조각을 받아 도구를 만든 뒤 켠다 — 앱 길 그대로). 점 0: 안내·안내 두기 키
    app.toggleMeasure(true);
    await until(() => !!a.measureTool?.active);
    // 걸음 사이 확인은 soft로(어긋나도 뒤 걸음까지 다 모은 뒤 맨 아래에서 한 번에 견준다)
    expect.soft(a.measureTool?.mode, code).toBe('tape');
    await settle();
    // 216차 측정 툴팁(마우스 — 점 0: 커서 밑 추정 이름)
    fv.move(120, 90);
    expect.soft(tipShown(), code).toBe(true);
    await settle();
    // 안내 두기 켜고 끄기(측정 띠 버튼 — 안내 글·잠깐 알림)
    a.els.measureGuide.click();
    await settle();
    a.els.measureGuide.click();
    await settle();
    // 시작점: 방향을 잡는 동안(잠금 안내·방향 잠금 버튼) → 잠글 방향 고르기 줄 → 화살표 잠금 셋(빨강·녹색·파랑, 끝에 빨강)
    press(100, 100);
    expect.soft(a.measureTool?.pointCount, code).toBe(1);
    await settle();
    a.toggleMeasureLock();
    expect.soft(document.querySelectorAll('.mb-lockpick').length, code).toBe(3);
    await settle();
    // 216차: 시작점 뒤 툴팁(추정 이름 · 길이 — 시작점 빨강 축 위). 잠금 버튼 뒤에(먼저 옮기면 맞춘 방향이 생겨 버튼이 고르기 줄 대신 그 방향을 잠근다)
    fv.move(150, 100);
    expect.soft(tipShown(), code).toBe(true);
    await settle();
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) {
      key(k);
      await settle();
      // 216차: 잠근 뒤 툴팁(추정 이름 · 잠금 · 길이)
      fv.move(150, 130);
      expect.soft(tipShown(), `${code}: ${k}`).toBe(true);
      await settle();
    }
    // 결과(거리·축 성분·복사)·최근 측정 기록(측정 띠 위 목록·패널)
    press(150, 100);
    expect.soft(d.measure?.kind, code).toBe('tape');
    await settle();
    a.toggleMeasureLog();
    await settle();
    a.panel.rerender();
    await settle();
    // 216차 가상 커서 알림 — 줄자: 3D 보기 Enter로 켬(켬 틀 · 자리 글 · 키 안내) → 화살표(자리 글) → Enter 시작점 → 화살표(자리 글 · 길이) → Enter 결과 줄 → Esc로 결과 지우기·끄기
    await keys(['Enter', 'ArrowRight', 'Enter', 'ArrowRight', 'Enter']);
    expect.soft(d.measure?.kind, code).toBe('tape');
    await escape();
    // 측정 안내의 모든 갈래(손가락 기기 갈래 포함 — measureHint)를 측정 띠·상태 막대에
    d.measure = null;
    const hints = new Set<string>();
    for (const m of ['tape', 'protractor'] as const)
      for (const n of [0, 1, 2]) for (const has of [false, true]) for (const t of [false, true]) for (const edge of [false, true]) for (const g of [false, true]) hints.add(measure.measureHint(m, n, has, t, edge, g)!);
    // 마우스·키보드 갈래 12 + 손가락 갈래 11(i18n.test 213차와 같은 셈)
    expect(hints.size).toBe(23);
    for (const text of hints) {
      a.measureHint = text;
      a.refreshStatus();
      await settle();
    }
    // 각도기: 켬(중심점 안내) → 화살표 평면 고정 셋
    app.toggleProtractor(true);
    expect.soft(a.measureTool?.mode, code).toBe('protractor');
    await settle();
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp']) {
      key(k);
      await settle();
    }
    // 216차 가상 커서 알림 — 각도기: Enter 켬 → Enter 중심 → 화살표 → Enter 기준 방향 → 화살표(자리 글 · 각도) → Enter 결과 줄 → Esc. 그리고 마우스 툴팁
    await keys(['Enter', 'Enter', 'ArrowUp', 'Enter', 'ArrowRight', 'Enter']);
    await escape();
    fv.move(130, 80);
    expect.soft(tipShown(), code).toBe(true);
    await settle();
    app.toggleProtractor(false);
    // 216차 가상 커서 알림 — 고르기(측정을 끄면 고르기 도구): 화살표로 켬(후보 셋 — 차례·수) → Tab 돌리기 → 화살표 둘로 빈 곳(고를 것 없음) → Enter(빈 곳) → 화살표 둘로 후보 자리 → Enter(고름) → Esc 끔
    expect.soft(a.keyPick?.enabled, code).toBe(true);
    await keys(['ArrowRight', 'Tab', 'ArrowRight', 'ArrowRight', 'Enter', 'ArrowLeft', 'ArrowLeft', 'Enter', 'Escape']);
    expect.soft(fv.cursor, code).toBe(false);
    // 216차 겹친 것 고르기 목록: 마우스 오른쪽 버튼으로 연 목록(후보 — 이름 · 종류)과 빈 곳 목록(고를 것 없음 한 줄), 목록 줄의 Esc로 닫기
    for (const x of [100, 190]) {
      fv.right(x, 100);
      const rows = document.querySelectorAll('.pick-list .menu-item').length;
      if (x > EMPTY_X) expect.soft(rows, code).toBe(1);
      else expect.soft(rows, code).toBeGreaterThan(0);
      await settle();
      fv.key('Escape', document.activeElement);
      expect.soft(document.querySelector('.pick-list'), code).toBeNull();
    }
    a.pickList?.set(false);
    a.keyPick?.set(false);
    a.pickList = null;
    a.keyPick = null;
    // 뷰어가 있어야 여는 메뉴: 표준 뷰·단면 보기·보기 설정(넓은 화면 — 측정 조각의 안내 항목, 휴대폰 — 넓은 화면 도구 막대에만 있는 버튼까지)
    const phone = a.phoneQuery;
    for (const [btn, narrow] of [[a.els.viewBtn, false], [a.els.secMenuBtn, false], [a.els.moreBtn, false], [a.els.moreBtn, true]] as const) {
      a.phoneQuery = narrow ? { matches: true } : phone;
      btn.click();
      await tick();
      expect.soft(document.querySelector('.menu'), code).not.toBeNull();
      collect();
      a.closeMenu();
    }
    a.phoneQuery = phone;
    // 그림 저장 창(조각을 받아 창을 만든 뒤 연다 — 앱 길 그대로)
    app.savePng();
    await until(() => !!document.querySelector('.export-dialog'));
    expect.soft(document.querySelector('.export-dialog'), code).not.toBeNull();
    collect();
    a.exportDialog?.close();
    // 바로 가기 안내 창
    app.openShortcuts();
    await until(() => !!document.querySelector('.sc-box'));
    expect.soft(document.querySelector('.sc-box'), code).not.toBeNull();
    collect();
    a.shortcutsClose?.();
    a.measureTool?.dispose();
    a.measureTool = null;
    a.overlay?.dispose();
    a.overlay = null;
    a.viewer = null;
    // (ㄴ) 이름도 정의 이름도 없는 그룹 아래 항목(깨진 파일 꼴 — 나무의 그 그룹 이름 칸을 비운다): 상태 막대·고른 것 탭 「위치」, 찾기 줄 경로·풀이
    const t = d.tree!;
    const c = Array.from({ length: t.count }, (_, i) => i).find((i) => t.parent[i]! >= 0 && t.definition[i] !== t.definition[t.parent[i]!] && !!nodeName(t, i));
    expect(c, code).toBeDefined();
    const p = t.parent[c!]!;
    const was = [t.names[p]!, t.definitionNames[t.definition[p]!]!] as const;
    t.names[p] = '';
    t.definitionNames[t.definition[p]!] = '';
    d.selection = { kind: 'node', index: c! };
    d.panelTab = 'entity';
    a.panel.rerender();
    a.refreshStatus();
    await until(() => !a.panel.el.querySelector('.pbody > div:empty'), 2000);
    expect.soft(document.querySelector('.st-sel')!.textContent, code).toContain(cat['(이름 없음)']!);
    collect();
    d.panelTab = 'outline';
    d.outlineQuery = nodeName(t, c!);
    a.panel.rerender();
    await tick();
    expect.soft(a.panel.el.querySelector('.search-row .path')?.textContent, code).toContain(cat['(이름 없음)']!);
    collect();
    d.outlineQuery = '';
    // 경로 두 단계(예제는 한 단계뿐이라 그 그룹의 부모를 다른 뿌리 항목으로 — 경로 글만 부모 사슬을 따른다): 고른 것 탭 「위치」 줄이 파일 이름과 앱 자리 이름이 섞인 값
    // (한 단계면 값 전체가 앱 자리 이름이라 번역층이 옮기는 줄이었다)
    const p0 = t.parent[p]!;
    const q = Array.from({ length: t.count }, (_, i) => i).find((i) => i !== p && t.parent[i]! < 0 && !!nodeName(t, i))!;
    t.parent[p] = q;
    d.panelTab = 'entity';
    a.panel.rerender();
    a.refreshStatus();
    await until(() => !a.panel.el.querySelector('.pbody > div:empty'), 2000);
    const pos = [...a.panel.el.querySelectorAll('.prop-row')].find((r) => r.querySelector('.k')?.textContent === cat['위치']);
    expect.soft(pos?.querySelector('.v')?.textContent, code).toBe(`${nodeName(t, q)} › ${cat['(이름 없음)']}`);
    collect();
    t.parent[p] = p0;
    t.names[p] = was[0];
    t.definitionNames[t.definition[p]!] = was[1];
    // 언어 메뉴 단추 이름은 화면 언어(원어 이름 목록은 위에서 뺐다)
    expect(document.querySelector('.language-trigger')!.getAttribute('aria-label'), code).not.toMatch(HANGUL);
    expect([...spots].sort(), code).toEqual([...LEFT[code]].sort());
  });

  it('216차: 언어를 바꾸면 알림 영역(role=status·alert·aria-live)에 앞 언어로 넣은 글이 남지 않는다 — 번역층 밖 가상 커서 알림 칸은 비운다(WCAG 3.1.2·4.1.3)', async () => {
    const { app, a } = await mountApp('ko');
    const bytes = sampleSkpBytes(undefined, (s) => s);
    const d = createDoc(SAMPLE_NAME, bytes.length, { scene: skpToScene(bytes, { name: SAMPLE_NAME, outline: true }), ms: 12 });
    a.doc = d;
    a.refreshChrome();
    const fv = fakeViewer(a);
    const live = (): string => document.querySelector('.kp-live')?.textContent ?? '';
    /** 보이는(숨기지 않은 — hidden·aria-hidden·display:none 조상 없음) 알림 영역의 「요소: 글」 */
    const regions = (): string[] => {
      const hidden = (el: Element): boolean => {
        for (let e: Element | null = el; e; e = e.parentElement)
          if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true' || (e as HTMLElement).style?.display === 'none') return true;
        return false;
      };
      return [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]:not([aria-live="off"])')].filter((el) => !hidden(el)).map((el) => `${tag(el)}: ${el.textContent ?? ''}`);
    };
    /** 공용 언어 메뉴로 바꾼다(사전을 받은 뒤 앱 languagechange까지 한 차례), 측정 툴팁은 다음 그림에 다시 그린다(app.ts — overlay.invalidate) */
    const choose = async (code: string): Promise<void> => {
      (document.querySelector(`.language-list [data-language="${code}"]`) as HTMLButtonElement).click();
      await until(() => document.documentElement.lang === code);
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await tick();
    };
    const escape = (): void => {
      for (let i = 0; i < 4 && fv.cursor; i++) fv.key('Escape');
    };
    const old = unsupportedNotice({ name: 'old.skp', units: 'unknown', meshes: [], lines: [], meta: { unsupported: true } } as unknown as Scene3d, 'old.skp')!;
    app.toggleMeasure(true);
    await until(() => !!a.measureTool?.active);
    for (const code of CODES) {
      // 한국어 화면에서 알림 영역마다 글을 넣는다: 가상 커서 알림(켜고 옮기고 끈 글), 측정 툴팁(마우스), 측정 띠 안내·잠깐 알림(안내 두기), 알림 상자
      fv.key('Enter');
      fv.key('ArrowRight');
      escape();
      expect(live(), code).toBe(KEY_PICK_TEXT.end);
      fv.move(120, 90);
      a.els.measureGuide.click();
      a.showNotice('warn', old.title, old.text);
      await tick();
      const before = regions().filter((s) => HANGUL.test(s));
      expect(before, code).toContain(`div.kp-live: ${KEY_PICK_TEXT.end}`);
      expect(before.some((s) => s.startsWith('div.measure-tip: ')), code).toBe(true);
      expect(before.length, code).toBeGreaterThanOrEqual(5);
      await choose(code);
      // 보이는 알림 영역에 한국어가 남지 않고(번역층이 옮기거나 앱이 다시 그림), 가상 커서 알림 칸은 비었다(빈 글 — 알리지 않는다)
      expect.soft(regions().filter((s) => HANGUL.test(s)), code).toEqual([]);
      expect.soft(live(), code).toBe('');
      // 거꾸로: 그 언어로 넣은 알림 글도 한국어로 바꾸면 비운다
      fv.key('Enter');
      expect.soft(live(), code).not.toBe('');
      expect.soft(live(), code).not.toMatch(HANGUL);
      await choose('ko');
      expect.soft(live(), `${code} → ko`).toBe('');
      escape();
    }
    a.pickList?.set(false);
    a.keyPick?.set(false);
    a.pickList = null;
    a.keyPick = null;
    a.measureTool?.dispose();
    a.measureTool = null;
    a.overlay?.dispose();
    a.overlay = null;
    a.viewer = null;
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

  it('215차: 해석기가 이름 없는 태그·정의에 붙이는 기본 이름은 언어 없는 「#n」(이름이 묶음 열쇠라 비우지 않는다 — STEP 209차 꼴)', () => {
    // model.dat 태그 항목(3c8c) 하나 — 이름 칸(3c8d)이 없다(번호 31)
    const body = tlv(0x3a98, tlv(0x3a99, tlv(0x3c8c, header(31), tlv(0x3c8e, u8(0)), tlv(0x3c90, i32(0)))));
    const set = readLayers(new TlvReader(body), { tag: 0x01f8, start: 0, end: body.length }, new Map(), () => {});
    expect(set.layers.get(31)).toBe('#31');
    expect(set.tags.map((x) => x.name)).toEqual(['#31']);
    // 옛 형식(2020 이하) 정의 둘 — 이름이 빈 글: 나무 정의 이름이 한 줄로 합쳐지지 않고 차례 번호로
    const s = skpToScene(
      mfcFile({ schemas: 'v18', definitions: [{ name: '', entities: squareEntities() }, { name: '', entities: squareEntities() }], root: { instances: [{ def: 0, xform: ID13 }, { def: 1, xform: ID13 }] } }),
      { outline: true },
    );
    const names = (s.meta as { tree: { definitionNames: string[] } }).tree.definitionNames;
    expect(names).toEqual(expect.arrayContaining(['#1', '#2']));
    expect(names.join(' ')).not.toMatch(HANGUL);
  });
});
