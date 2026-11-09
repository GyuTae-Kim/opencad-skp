/**
 * 3D 보기 키보드 고르기(56차 — 코어 0.46.0 가상 커서·0.47.0 겹친 것 고르기 돌리기). 고르기 도구일 때만 켠다(줄자·각도기는 화살표를 방향 잠금에 쓴다 — app.ts).
 *
 * - 3D 보기에 초점이 있을 때 화살표로 가상 커서를 켜고 옮기며, Tab·Shift+Tab으로 커서 자리에 겹친 면·모서리(앞 면 뒤의 것까지 — 코어 pickCandidates 차례)를 돌리고
 *   Enter로 고른다. 둘째 이후 후보는 onPick의 e.cycle로 오고 앱은 펼친 단계 규칙을 건너뛰어 그것을 그대로 고른다(doc.ts selectionForPick).
 * - 후보 고르기 선택(PICK_CYCLE)은 앱 onPick 선택과 같다(앱은 반투명 너머·면만 고르기를 쓰지 않는다).
 * - 알림 글: 코어 알림 틀 가운데 이 앱이 보일 수 있는 것(고르기 모드)만 네 언어 사전 열쇠(KEY_PICK_TEXT)로 옮겨 setKeyboardSnap({ messages })로 준다.
 *   한글이 없는 틀(pickItem '{0} {1}'·candidate '{0}: {1}'·order '{0} {1}/{2}'·point 'X {0}, Y {1}, Z {2}'·hintJoin)은 사전에 넣지 않는다 —
 *   사전의 {0} 틀은 화면 번역층이 모든 글에 맞춰 보므로 그런 틀은 아무 글이나 잡는다. 키 안내 틀은 이 앱 키(코어 기본 키)를 끼운 글로 둔다('옮기기 ←→↑↓' — 자리 없는 열쇠).
 *   측정 모드 틀(첫 점·둘째 점·붙잡은 종류 등)은 이 앱이 코어 측정을 쓰지 않아 넣지 않는다(measure.ts).
 * - 고른 것 이름: 코어는 그물 이름(재질 · 태그 묶음)을 끼우므로, 앱이 그 후보를 Enter로 고를 때의 그룹·컴포넌트 이름(고른 것 설명의 첫 조각 — 파일 글은 그대로)과
 *   모형 단위 좌표로 같은 틀에 다시 만든다. 글은 보이지 않는 알림 칸(role=status, 번역층 밖 — 이미 옮긴 글)에 넣는다.
 * 코어 입구와 함께 받는다(core.ts loadViewerCore — 첫 화면 조각 밖).
 */
import type { KeyboardSnapAnnouncement, KeyPickCycleOptions, Pick3d, Viewer3d } from 'opencad-viewer3d';
import { KEY_SNAP_KEYS, formatKeySnapMessage, keySnapHint, keySnapMessages, orderedText, pointText, type KeySnapMessageKey, type KeySnapMessages } from 'opencad-viewer3d/keysnap';
import { selectionForPick, selectionParts, type SkpDoc } from './doc';
import { mixText, uiText } from './i18n';
import { formatLength, mmPerSceneUnit } from './units';

/** 가상 커서 고르기 후보 선택: 앱 onPick 선택과 같다(반투명 너머·면만 고르기 없음, 윤곽선은 코어 기본) */
export const PICK_CYCLE: KeyPickCycleOptions = { throughTranslucent: false, meshesOnly: false };

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

/** 캔버스가 받는 키(aria-keyshortcuts — Tab은 커서가 켜진 동안만이라 적지 않는다) */
const KEY_SHORTCUTS = 'ArrowLeft ArrowRight ArrowUp ArrowDown Enter';

/**
 * 고르기 모드 알림 글: 코어 글(a.text)과 같은 틀·차례로, 고른 것 이름(name)과 좌표 글(num)만 앱 것으로(고른 것이 없으면 코어 글 그대로).
 * 'start' 커서 켬(키 안내를 붙인다), 'commit' Enter로 고름, 후보가 하나인 자리에서 돌리면 only, 그 밖은 후보 글
 */
export function keyPickText(
  a: Pick<KeyboardSnapAnnouncement, 'reason' | 'index' | 'count' | 'pick' | 'text'>,
  M: KeySnapMessages,
  name: string,
  num: (v: number) => string,
): string {
  const p = a.pick;
  if (!p) return a.text;
  const kind = (p.section ? 'pick.section' : `pick.${p.kind}`) as KeySnapMessageKey;
  const label = formatKeySnapMessage(M.pickItem, [name, M[kind]]);
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

export class KeyPick {
  private on = false;
  private readonly live: HTMLElement;

  constructor(
    private readonly v: Viewer3d,
    host: HTMLElement,
    private readonly doc: () => SkpDoc | null,
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

  /** 켜졌는지(고르기 도구) */
  get enabled(): boolean {
    return this.on;
  }

  /** 마지막 알림 글(시험·상태 보내기) */
  get text(): string {
    return this.live.textContent ?? '';
  }

  /** 고르기 도구면 켜고 줄자·각도기면 끈다(켜진 커서는 알리지 않고 끈다). 같으면 그대로 */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.apply();
  }

  /** 화면 언어를 바꿨으면 새 언어 틀로(켜진 커서는 그 자리를 다시 구한다) */
  relocalize(): void {
    if (this.on) this.apply();
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
    if (!this.on) {
      this.v.setKeyboardSnap(false);
      cv.removeAttribute('aria-keyshortcuts');
      this.live.textContent = '';
      return;
    }
    const messages = keyPickMessages();
    const M = keySnapMessages(messages);
    this.v.setKeyboardSnap({ pickCycle: PICK_CYCLE, messages, announce: (a) => this.say(a, M) });
    cv.setAttribute('aria-keyshortcuts', KEY_SHORTCUTS);
  }

  private say(a: KeyboardSnapAnnouncement, M: KeySnapMessages): void {
    const d = this.doc();
    const p = a.mode === 'pick' && d ? a.pick : null;
    if (!d || !p) {
      this.live.textContent = a.text;
      return;
    }
    const mm = mmPerSceneUnit(d.scene.units);
    this.live.textContent = keyPickText(a, M, keyPickName(d, p, a.index > 0), (x) => formatLength(x * mm, d.units));
  }
}
