/**
 * 3D 보기 키보드 고르기(56차 — 코어 0.46.0 가상 커서·0.47.0 겹친 것 고르기 돌리기)와 줄자·각도기의 키보드 점 찍기(59차 — setMode·handleKey).
 *
 * - 줄자·각도기(59차): 화살표는 방향 잠금(SketchUp)이라 가상 커서는 3D 보기의 Enter로만 켠다. 켠 동안 화살표는 커서 옮기기(방향 잠금은 Shift),
 *   Enter는 커서 자리에 측정 도구의 붙잡기로 점 찍기, Esc는 측정 도구가 지울 것이 먼저이고 없으면 커서 끄기(NC 56·57차와 같은 키).
 *   코어는 측정 모드 없이 고르기 모드(후보 돌리기 없음)로 켜고 알림의 커서 자리만 측정 도구(KeyMeasureHost)에 넘긴다 — 알림 글은 측정 도구가 만든다.
 * - 3D 보기에 초점이 있을 때 화살표로 가상 커서를 켜고 옮기며, Tab·Shift+Tab으로 커서 자리에 겹친 면·모서리(앞 면 뒤의 것까지 — 코어 pickCandidates 차례)를 돌리고
 *   Enter로 고른다. 둘째 이후 후보는 onPick의 e.cycle로 오고 앱은 펼친 단계 규칙을 건너뛰어 그것을 그대로 고른다(doc.ts selectionForPick).
 * - 후보 고르기 선택(PICK_CYCLE)은 앱 onPick 선택과 같다(앱은 반투명 너머·면만 고르기를 쓰지 않는다).
 *   59차: 코어 0.53.0 후보 묶음 열쇠(group — pickGroupKey)로 같은 고른 것이 될 후보를 하나로 센다(후보 한도·Tab 수·알림 수가 묶음 수 — 겹친 것 목록과 같다).
 * - 알림 글: 코어 알림 틀 가운데 이 앱이 보일 수 있는 것(고르기 모드)만 네 언어 사전 열쇠(KEY_PICK_TEXT)로 옮겨 setKeyboardSnap({ messages })로 준다.
 *   한글이 없는 틀(pickItem '{0} {1}'·candidate '{0}: {1}'·order '{0} {1}/{2}'·point 'X {0}, Y {1}, Z {2}'·hintJoin)은 사전에 넣지 않는다 —
 *   사전의 {0} 틀은 화면 번역층이 모든 글에 맞춰 보므로 그런 틀은 아무 글이나 잡는다. 키 안내 틀은 이 앱 키(코어 기본 키)를 끼운 글로 둔다('옮기기 ←→↑↓' — 자리 없는 열쇠).
 *   측정 모드 틀(첫 점·둘째 점·붙잡은 종류 등)은 이 앱이 코어 측정을 쓰지 않아 넣지 않는다(줄자·각도기 알림 글은 measure.ts KEY_MEASURE_TEXT).
 * - 고른 것 이름: 코어는 그물 이름(재질 · 태그 묶음)을 끼우므로, 앱이 그 후보를 Enter로 고를 때의 그룹·컴포넌트 이름(고른 것 설명의 첫 조각 — 파일 글은 그대로)과
 *   모형 단위 좌표로 같은 틀에 다시 만든다. 이름과 맞은 것 종류는 코어 pickItem 대신 종류마다 한글이 든 사전 틀(KEY_PICK_ITEM — 58차, 언어마다 말 차례)로 잇는다.
 *   글은 보이지 않는 알림 칸(role=status, 번역층 밖 — 이미 옮긴 글)에 넣는다.
 *   60차: 코어 0.54.0 고른 것 이름 함수(setKeyboardSnap pickName)로 바꾸지 않는다 — 이름은 후보 차례(첫째는 펼친 단계, 둘째부터 가장 안쪽)에 따라 다른데
 *   pickName은 후보만 받고(pickGroupKey와 같은 까닭), 좌표는 모형 단위 글(formatLength — cm·피트 등)이라 코어 글(장면 수, 단위 없음)을 그대로 쓸 수 없어
 *   글 전체를 앱이 만드는 길이 그대로 남는다(이름만 코어에 맡겨도 줄지 않는다).
 * - 그물 면 후보 표식(60차 — 코어 0.54.0 pickCycle.facePreview): 지금 후보가 그물 면이면 코어가 그 SketchUp 면(pickFaceRanges — 해석기 면 경계)을
 *   화면 덧그림에 강조 색으로 옅게 칠하고 테두리를 긋는다(깊이를 따지지 않는다 — 뒤 후보도 보인다). 줄자·각도기 방식은 후보 돌리기가 없어(pickCycle false) 그리지 않는다.
 * 코어 입구와 함께 받는다(core.ts loadViewerCore — 첫 화면 조각 밖).
 */
import type { IndexRange, KeyboardSnapAnnouncement, KeyPickCycleOptions, Pick3d, PickGroupKey, Viewer3d } from 'opencad-viewer3d';
import { KEY_SNAP_KEYS, formatKeySnapMessage, keySnapHint, keySnapMessages, orderedText, pointText, type KeySnapMessageKey, type KeySnapMessages } from 'opencad-viewer3d/keysnap';
import { selectionForPick, selectionParts, type SkpDoc } from './doc';
import { mixText, uiText } from './i18n';
import { isEditableTarget } from './keys';
import { selKey } from './panel';
import { formatLength, mmPerSceneUnit } from './units';

/** 가상 커서 고르기 후보 선택: 앱 onPick 선택과 같다(반투명 너머·면만 고르기 없음, 윤곽선은 코어 기본) */
export const PICK_CYCLE: KeyPickCycleOptions = { throughTranslucent: false, meshesOnly: false };

/** 잘린 면 후보의 묶음 열쇠(앱은 잘린 면을 고르지 않는다 — 고른 것 열쇠 selKey와 겹치지 않는 글) */
export const SECTION_GROUP = '§';

/**
 * 59차 코어 0.53.0 후보 묶음 열쇠(pickCandidates·pickCycle의 group): 후보를 그 후보로 앱이 고를 것의 열쇠(panel.ts selKey)로 묶는다.
 * 앱은 첫째 후보를 누르기와 같은 고르기(펼친 단계), 둘째부터 펼친 단계를 건너뛴 가장 안쪽 그룹·컴포넌트로 고르는데(doc.ts selectionForPick의 cycle),
 * 열쇠 함수는 후보 하나만 받아 그 차례를 모른다. 그래서 두 고르기가 같은 후보만 그 열쇠로 묶고 다른 후보는 묶지 않는다(null — 코어는 0.47.0처럼 기본 도형마다,
 * 겹친 것 목록이 같은 고른 것을 뺀다): 가장 안쪽 방식·면 방식은 모든 후보가, 펼친 단계 방식은 접힌 그룹·컴포넌트 안에 들지 않은 후보(맨 위 단계 그룹의 면,
 * 펼친 단계의 면·모서리, 맨 위 낱 형상)가 묶인다. 접힌 그룹 안 후보까지 가장 안쪽 열쇠로 묶으면 첫 후보와 같은 안쪽 그룹의 뒤 후보(닫힌 몸의 뒷면)가 빠져,
 * 그 안쪽 그룹을 고르는 줄·Tab 차례가 없어진다(첫 후보 줄은 펼친 단계를 고른다).
 * 이렇게 묶어 빠지는 후보는 늘 앞 후보와 고를 것이 같아 목록이 빼던 것뿐이라 목록 줄·Enter로 고르는 것은 그대로이고, 한도(16)는 묶음 수라
 * 촘촘한 자리에서 뒤 후보가 목록·Tab 차례에 든다. 잘린 면은 앱이 고르지 않으므로 하나로 묶는다(SECTION_GROUP)
 */
export function pickGroupKey(doc: () => SkpDoc | null): PickGroupKey {
  return (p) => {
    const d = doc();
    if (!d) return null;
    if (p.section) return SECTION_GROUP;
    const key = selKey(selectionForPick(d, p, false, true));
    return key && key === selKey(selectionForPick(d, p, false, false)) ? key : null;
  };
}

/**
 * 60차 코어 0.54.0 그물 면 후보 표식의 면: 그물 면 후보가 든 SketchUp 면 하나의 삼각형 구간(해석기 meta.faceRuns — 면·모서리 방식으로 고를 때의 면:
 * 그 방식의 selectionForPick이 doc.ts faceOrEdgeSelection을 먼저 본다. 첫 화면 조각에서 이 조각으로 내보내는 이름을 늘리지 않게 이미 쓰는 함수로 묻는다).
 * 면 경계가 없는 그물(옛 장면)·잘린 면·선분·점은 null — 코어가 맞은 삼각형과 같은 평면으로 이어진 삼각형으로 어림한다(가상 커서는 그물 면만 묻는다)
 */
export function pickFaceRanges(d: SkpDoc | null, p: Pick3d): IndexRange[] | null {
  const s = d && selectionForPick({ ...d, pickMode: 'face' }, p);
  return s?.kind === 'face' ? [{ start: s.start, count: s.count }] : null;
}

/**
 * 코어 알림 틀 → 이 앱의 한국어 원문(네 언어 사전 열쇠). 선분 묶음은 SketchUp 모서리라 '모서리', 점 묶음은 보조점이다.
 * 키 안내는 코어 기본 키 그대로라 키를 끼운 글(자리 없는 열쇠 — 코어가 넘기는 키 글은 쓰지 않는다)
 */
export const KEY_PICK_TEXT = {
  start: '가상 커서를 켰습니다. {0}. {1}',
  end: '가상 커서를 껐습니다',
  only: '{0} (후보 하나)',
  noPick: '고를 것이 없습니다',
  picked: '골랐습니다: {0}',
  pickedNothing: '빈 곳을 골랐습니다',
  hintMove: '옮기기 ←→↑↓',
  hintNext: '후보 Tab',
  hintPick: '고르기 Enter',
  hintExit: '끄기 Esc',
  'pick.mesh': '면',
  'pick.line': '모서리',
  'pick.edge': '모서리',
  'pick.point': '보조점',
  'pick.section': '잘린 면',
} as const satisfies Partial<Record<KeySnapMessageKey, string>>;

/** 지금 언어의 알림 틀(tr = 사전 번역 — 한국어면 원문) */
export function keyPickMessages(tr: (text: string) => string = uiText): Partial<Record<KeySnapMessageKey, string>> {
  const out: Partial<Record<KeySnapMessageKey, string>> = {};
  for (const [k, v] of Object.entries(KEY_PICK_TEXT)) out[k as KeySnapMessageKey] = tr(v);
  return out;
}

/**
 * 알림의 "고른 것 이름 + 맞은 것 종류"(58차 — 말 차례를 언어마다 사전이 정한다: 'Face of {0}'·'{0}の面'·'{0}的面').
 * 코어 pickItem('{0} {1}' — "Group Wall Face"처럼 이름 뒤에 종류)은 한글이 없어 사전에 넣지 못하므로, 종류마다 자리 밖에 한글이 든 틀을 사전 열쇠로 둔다.
 * 겹친 것 목록 줄(picklist.ts)은 이름 · 종류 두 칸이라 이 틀을 쓰지 않는다
 */
export const KEY_PICK_ITEM = {
  mesh: '{0}의 면',
  line: '{0}의 모서리',
  edge: '{0}의 모서리',
  point: '{0}의 보조점',
  section: '{0}의 잘린 면',
} as const;
export type KeyPickItems = Record<keyof typeof KEY_PICK_ITEM, string>;

/** 지금 언어의 "이름 + 종류" 틀(tr = 사전 번역 — 한국어면 원문) */
export function keyPickItems(tr: (text: string) => string = uiText): KeyPickItems {
  const out = {} as KeyPickItems;
  for (const [k, v] of Object.entries(KEY_PICK_ITEM)) out[k as keyof KeyPickItems] = tr(v);
  return out;
}

/** 캔버스가 받는 키(aria-keyshortcuts — Tab은 커서가 켜진 동안만이라 적지 않는다) */
const KEY_SHORTCUTS = 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter';

/**
 * 고르기 모드 알림 글: 코어 글(a.text)과 같은 틀·차례로, 고른 것 이름(name)과 좌표 글(num)만 앱 것으로(고른 것이 없으면 코어 글 그대로).
 * 이름과 종류는 items(keyPickItems — 58차, 언어마다 말 차례)로 잇는다.
 * 'start' 커서 켬(키 안내를 붙인다), 'commit' Enter로 고름, 후보가 하나인 자리에서 돌리면 only, 그 밖은 후보 글
 */
export function keyPickText(
  a: Pick<KeyboardSnapAnnouncement, 'reason' | 'index' | 'count' | 'pick' | 'text'>,
  M: KeySnapMessages,
  items: KeyPickItems,
  name: string,
  num: (v: number) => string,
): string {
  const p = a.pick;
  if (!p) return a.text;
  const label = formatKeySnapMessage(items[p.section ? 'section' : p.kind], [name]);
  if (a.reason === 'commit') return formatKeySnapMessage(M.picked, [label]);
  const body = orderedText(label, a.index, a.count, pointText(p.point, num, M), null, M);
  if (a.reason === 'start') return formatKeySnapMessage(M.start, [body, keySnapHint(KEY_SNAP_KEYS, 'pick', true, M)]);
  if (a.reason === 'cycle' && a.count === 1) return formatKeySnapMessage(M.only, [body]);
  return body;
}

/**
 * 후보를 Enter로 고를 때의 그룹·컴포넌트 이름(고른 것 설명의 첫 조각, 지금 언어 — 파일 글은 그대로). cycle = 둘째 이후 후보(펼친 단계를 건너뛴다).
 * 면·모서리 방식은 면을 종류 글로 알리고 이름은 그 면을 품은 가장 안쪽 노드로
 */
export function keyPickName(d: SkpDoc, p: Pick3d, cycle: boolean): string {
  const parts = selectionParts(d, selectionForPick(d, p, d.pickMode === 'face' || cycle));
  // 첫 조각: joinMixed가 조각 사이에 넣은 ' · ' 앞(종류 이름 (정의))
  const i = parts.indexOf(' · ');
  return mixText(i < 0 ? parts : parts.slice(0, i)) || p.id;
}

/**
 * 키 대상이 화살표를 스스로 쓰는 곳(패널 목록·메뉴·장면 탭·패널 크기 손잡이·슬라이더 등 입력)의 고르개 — app.ts inList와 같다(시험이 맞춰 본다).
 * 첫 화면 조각이 함수를 내보내지 않게 이 조각에 따로 둔다(59차)
 */
export const LIST_TARGETS = '.panel, .menu, .scene-tabs, .resizer, .measure-log, input, select, [role="tree"], [role="listbox"]';
const inList = (t: EventTarget | null): boolean => !!t && typeof (t as Element).closest === 'function' && !!(t as Element).closest(LIST_TARGETS);

/** 59차 줄자·각도기 가상 커서의 키 안내(커서를 켤 때 알림 끝 — 고르기의 후보 Tab·고르기 Enter 대신, 사전 열쇠) */
export const KEY_MEASURE_HINT = ['옮기기 ←→↑↓', '찍기 Enter', '방향 잠금 Shift', '끄기 Esc'] as const;

/** 키보드 고르기 방식: 고르기 도구, 줄자·각도기(59차 — 가상 커서로 점 찍기), 끔 */
export type KeyPickMode = 'pick' | 'tape' | 'protractor' | null;

/**
 * 59차 줄자·각도기의 키보드 점 찍기를 맡는 측정 도구(measure.ts MeasureTool — 앱 붙잡기로 찍는다). 코어는 측정 모드 없이 고르기 모드로 켜고
 * (코어 측정을 쓰지 않는다 — 코어 README 0.46.0 "SKP: keyboardCursor의 자리로 제 고르기·붙잡기"), 알림의 커서 자리를 이 도구에 넘긴다
 */
export interface KeyMeasureHost {
  /** 측정 도구가 켜졌는지(줄자·각도기) */
  readonly active: boolean;
  /** 측정 도구 키(화살표 방향 잠금·Shift·Esc 지우기·안내 두기·지우기 — 다뤘으면 true) */
  handleKey(e: KeyboardEvent): boolean;
  /** 가상 커서를 켜거나 옮겼다(캔버스 CSS 좌표): 그 자리에서 추정하고 알림 글(지금 언어) */
  keyHover(x: number, y: number): string;
  /** 가상 커서를 껐다. keep이면 표식을 그 자리에 둔다(초점이 측정값 칸 등으로 갔을 때 — 친 길이의 방향) */
  keyEnd(keep: boolean): void;
  /** Enter: 커서 자리에 점을 찍고 알림 글(shift = Shift+Enter — 각도기 평면 고정) */
  keyPlace(shift: boolean): string;
}

/** 59차 측정 도구를 가진 앱(app.ts App — 측정 도구 조각을 받기 전에는 measureTool null) */
export interface KeyPickApp {
  readonly measureTool: KeyMeasureHost | null;
}

export class KeyPick {
  private mode: KeyPickMode = null;
  private readonly live: HTMLElement;

  /** app = 줄자·각도기 키보드 점 찍기의 측정 도구를 가진 앱(59차 — 주지 않으면 고르기 도구만) */
  constructor(
    private readonly v: Viewer3d,
    host: HTMLElement,
    private readonly doc: () => SkpDoc | null,
    private readonly app: KeyPickApp = { measureTool: null },
  ) {
    // 보이지 않는 알림 칸: 화면 읽기 프로그램만 읽는다(이미 옮긴 글이라 번역층 밖)
    const el = document.createElement('div');
    el.className = 'kp-live';
    el.setAttribute('role', 'status');
    el.setAttribute('data-i18n-skip', '');
    el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    host.append(el);
    this.live = el;
  }

  /** 고르기 도구로 켜졌는지 */
  get enabled(): boolean {
    return this.mode === 'pick';
  }

  /** 마지막 알림 글(시험·상태 보내기) */
  get text(): string {
    return this.live.textContent ?? '';
  }

  /** 고르기 도구면 켜고(true) 끈다(false — 켜진 커서는 알리지 않고 끈다). 같으면 그대로 */
  set(on: boolean): void {
    this.setMode(on ? 'pick' : null);
  }

  /**
   * 방식 바꾸기(59차): 고르기 도구 'pick', 줄자·각도기 'tape'·'protractor'(측정 도구를 받은 뒤 — 없으면 끈다), 끄기 null.
   * 방식이 바뀌면 켜진 커서는 알리지 않고 끈다(다음 커서는 새 방식으로). 같으면 그대로
   */
  setMode(mode: KeyPickMode): void {
    if (mode && mode !== 'pick' && !this.app.measureTool) mode = null;
    if (mode === this.mode) return;
    if (this.mode && mode) this.v.setKeyboardSnap(false);
    this.mode = mode;
    this.apply();
  }

  /**
   * 앱 도구 막대에 맞추기(59차): measure = 앱의 측정 방식(받는 중인 도구 포함). 측정 도구가 켜졌으면 줄자·각도기 방식,
   * 받는 중이면 끄고, 측정이 아니면 고르기 도구
   */
  follow(measure: 'tape' | 'protractor' | null): void {
    this.setMode(!measure ? 'pick' : this.app.measureTool?.active ? measure : null);
  }

  /** 화면 언어를 바꿨으면 새 언어 틀로(켜진 커서는 그 자리를 다시 구한다) */
  relocalize(): void {
    if (this.mode) this.apply();
  }

  /**
   * 측정 도구를 켠 동안의 창 키(app.ts 캡처 단계 — 입력 칸의 키는 받지 않는다): 측정 도구 키와 59차 가상 커서 점 찍기. 다뤘으면 true(앱은 전파를 막는다).
   * - 가상 커서가 켜진 동안: 3D 보기의 Enter는 커서 자리에 점 찍기, 화살표는 코어로 넘겨 커서 옮기기(그동안 방향 잠금은 Shift — 측정 도구 몫),
   *   Esc는 측정 도구가 지울 것(점·결과)이 먼저, 없으면 커서 끄기
   * - 그 밖: 측정 도구 키(handleKey — SketchUp 화살표 방향 잠금 등). 화살표는 초점이 그것을 스스로 쓰는 곳(LIST_TARGETS — 목록·메뉴·슬라이더)이면 그쪽 것이고,
   *   도구가 다루지 않은 화살표도 코어로 보내지 않는다(커서는 Enter로만 켠다 — NC 56차와 같다)
   */
  handleKey(e: KeyboardEvent): boolean {
    const h = this.app.measureTool;
    if (!h?.active || isEditableTarget(e.target)) return false;
    const arrow = e.key.startsWith('Arrow');
    const list = inList(e.target);
    const on = !!this.mode && this.mode !== 'pick';
    if (on && !list && this.v.keyboardCursor) {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && e.target === this.v.canvas) {
        e.preventDefault();
        this.live.textContent = h.keyPlace(e.shiftKey);
        return true;
      }
      if (arrow) return this.v.handleKey(e);
      if (e.key === 'Escape') return h.handleKey(e) || this.v.handleKey(e);
    }
    if (arrow && list) return false;
    return h.handleKey(e) || (arrow && on);
  }

  /** 가상 커서의 화면 자리(client 좌표 — 키보드로 고른 자리의 안내 고르기). 꺼져 있으면 null */
  clientPoint(): { x: number; y: number } | null {
    const c = this.v.keyboardCursor;
    if (!c) return null;
    const r = this.v.canvas.getBoundingClientRect();
    return { x: r.left + c.x, y: r.top + c.y };
  }

  private apply(): void {
    const cv = this.v.canvas;
    if (!this.mode) {
      this.v.setKeyboardSnap(false);
      cv.removeAttribute('aria-keyshortcuts');
      this.live.textContent = '';
      return;
    }
    const messages = keyPickMessages();
    const M = keySnapMessages(messages);
    if (this.mode === 'pick') {
      const items = keyPickItems();
      // 60차: 지금 후보가 그물 면이면 그 SketchUp 면을 화면 덧그림에 표식(코어 0.54.0 facePreview — 선분·보조점 후보는 0.47.0부터 코어가 그린다)
      const pickCycle = { ...PICK_CYCLE, group: pickGroupKey(this.doc), facePreview: true, faceRanges: (p: Pick3d) => pickFaceRanges(this.doc(), p) };
      this.v.setKeyboardSnap({ pickCycle, messages, announce: (a) => this.say(a, M, items) });
    } else {
      // 줄자·각도기: 코어는 고르기 모드(후보 돌리기 없음 — Tab은 초점 이동), 자리만 받아 측정 도구가 추정한다
      const hint = KEY_MEASURE_HINT.map((t) => uiText(t)).join(M.hintJoin);
      this.v.setKeyboardSnap({ pickCycle: false, messages, announce: (a) => this.sayMeasure(a, M, hint) });
    }
    cv.setAttribute('aria-keyshortcuts', KEY_SHORTCUTS);
  }

  /** 줄자·각도기 알림: 커서를 켜고 옮길 때마다 측정 도구의 그 자리 추정 글, 끌 때 끈 글(Enter 찍기는 handleKey가 알린다) */
  private sayMeasure(a: KeyboardSnapAnnouncement, M: KeySnapMessages, hint: string): void {
    const h = this.app.measureTool;
    if (!h) return;
    if (a.reason === 'end') {
      // 초점이 측정값 칸 등으로 갔으면(그 칸에 친 길이의 방향) 표식을 그 자리에 둔다 — Esc·포인터로 끄면 거둔다
      h.keyEnd(document.activeElement !== this.v.canvas);
      this.live.textContent = M.end;
      return;
    }
    const body = h.keyHover(a.x, a.y);
    this.live.textContent = a.reason === 'start' ? formatKeySnapMessage(M.start, [body, hint]) : body;
  }

  private say(a: KeyboardSnapAnnouncement, M: KeySnapMessages, items: KeyPickItems): void {
    const d = this.doc();
    const p = a.mode === 'pick' && d ? a.pick : null;
    if (!d || !p) {
      this.live.textContent = a.text;
      return;
    }
    const mm = mmPerSceneUnit(d.scene.units);
    this.live.textContent = keyPickText(a, M, items, keyPickName(d, p, a.index > 0), (x) => formatLength(x * mm, d.units));
  }
}
