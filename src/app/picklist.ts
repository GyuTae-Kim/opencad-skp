/**
 * 3D 보기 겹친 것 고르기 목록(57차 — 코어 0.47.0 pickCandidates, 여러 CAD의 "다른 것 고르기" 목록). 고르기 도구일 때만 켠다(keypick.ts와 같은 조건 — app.ts).
 *
 * - 여는 법: 마우스 오른쪽 단추를 끌지 않고 뗄 때(오른쪽 끌기는 코어의 화면 옮기기), 손가락·펜을 끌기 시작 거리 안에서 LONG_PRESS_MS 동안 누르고 있을 때
 *   (코어에서 그 포인터를 맡는다 — 떼어도 고르거나 돌리지 않는다), 3D 보기에 초점이 있을 때 Shift+F10·메뉴 키
 *   (가상 커서를 켰으면 커서 자리, 아니면 3D 보기 위 마우스 자리, 마우스가 밖이면 3D 보기 가운데 — 58차).
 * - 미리 강조(58차): 줄에 초점이 가거나 마우스가 오르면 그 줄을 고를 때의 고른 것을 3D에 강조하고(앱 강조 길 — 고른 것·패널은 그대로), 목록을 닫으면 되돌린다.
 *   60차: 그 줄의 후보(면이면 그 SketchUp 면, 모서리·보조점)도 코어 0.54.0 setPickPreview로 화면 덧그림에 표식한다 — 앱 강조는 깊이를 따져 그려
 *   앞 형상에 가린 뒤 후보(목록이 있는 까닭)의 고른 것이 화면에 안 보일 수 있고, 덧그림 표식은 깊이를 따지지 않는다(가상 커서 면 표식과 같은 꼴).
 *   앱 강조 길을 코어 표식으로 바꾸지는 않는다 — 코어 표식은 맞은 기본 도형(면 하나)만이라 그 줄로 고를 그룹·컴포넌트를 보이지 못한다.
 * - 후보: 그 자리의 pickCandidates(앱 onPick과 같은 선택 PICK_CYCLE, 최대 PICK_LIST_MAX). 잘린 면은 뺀다(앱이 고르지 않는다).
 *   앱 고르기로 묶는다(코어 후보는 기본 도형 단위 — 같은 그물의 앞·뒷면, 같은 그룹의 면·모서리): 첫째는 누르기와 같은 고르기(펼친 단계),
 *   둘째부터는 가상 커서로 돌려 고른 것과 같은 고르기(펼친 단계를 건너뛴 가장 안쪽 그룹·컴포넌트, 면·모서리 방식이면 그 면·모서리). 같은 고른 것은 처음 것 하나.
 *   59차: 코어 0.53.0 묶음 열쇠(keypick.ts pickGroupKey — 차례와 상관없이 고를 것이 같은 후보만)를 주어 그런 후보는 코어가 하나로 센다(한도가 묶음 수 —
 *   촘촘한 자리에서 뒤의 것이 목록에 든다). 접힌 그룹 안 후보는 열쇠가 없어 위 같은 고른 것 빼기가 맡는다.
 * - 항목: 그 고르기의 그룹·컴포넌트 이름(keyPickName — 파일 글은 그대로)과 맞은 것의 종류(면·모서리·보조점 — 가상 커서 알림과 같은 사전 열쇠).
 *   고르면 앱 처리기에 그 후보와 고른 것을 넘긴다(목록이 보인 그대로 고른다).
 * - 목록은 메뉴(role=menu — 표준 뷰 메뉴와 같은 꼴, 손가락 기기는 항목 높이 44px): ↑↓·Home·End로 오가고 Enter·Space로 고르며,
 *   Esc·Tab은 닫고 3D 보기로 초점을 돌린다. 바깥을 누르거나 창 크기가 바뀌면 닫는다. 글은 지금 화면 언어로 넣고 번역층에서 뺀다(app.ts openMenu와 같다).
 * 코어 입구와 함께 받는다(core.ts loadViewerCore — 첫 화면 조각 밖).
 */
import type { Pick3d, Viewer3d } from 'opencad-viewer3d';
import { dragStartPx } from 'opencad-viewer3d/pointer';
import { selectionForPick, type Selection, type SkpDoc } from './doc';
import { uiText } from './i18n';
import { listKeys } from './kbd';
import { KEY_PICK_TEXT, PICK_CYCLE, keyPickName, pickFaceRanges, pickGroupKey } from './keypick';
import { selKey } from './panel';

/** 손가락·펜 길게 누르기(ms) — 줄자·각도기 정밀 조준(350 ms)보다 길게, 브라우저·OS 길게 누르기 메뉴와 비슷하게 */
export const LONG_PRESS_MS = 500;
/** 목록 후보 수 한도(코어 PICK_CANDIDATES_MAX와 같다 — 59차부터 코어 묶음 수) */
export const PICK_LIST_MAX = 16;
/** 목록 이름(메뉴 aria-label) */
export const PICK_LIST_LABEL = '겹친 것 고르기';

export interface PickListItem {
  /** 코어 후보 */
  pick: Pick3d;
  /** 고르면 앱이 고를 것 */
  sel: Selection | null;
  /** 그룹·컴포넌트 이름(지금 언어 — 파일 글은 그대로) */
  name: string;
  /** 맞은 것의 종류(면·모서리·보조점, 지금 언어) */
  kind: string;
}

/** 코어 후보 → 목록 항목(잘린 면은 빼고, 같은 고른 것은 처음 것 하나). tr = 사전 번역 */
export function pickListItems(d: SkpDoc, picks: readonly Pick3d[], tr: (text: string) => string = uiText): PickListItem[] {
  const out: PickListItem[] = [];
  const seen = new Set<string>();
  picks.forEach((p, i) => {
    if (p.section) return;
    const cycle = i > 0;
    const sel = selectionForPick(d, p, false, cycle);
    const key = selKey(sel);
    if (seen.has(key)) return;
    seen.add(key);
    const kind = KEY_PICK_TEXT[`pick.${p.kind}` as 'pick.mesh' | 'pick.line' | 'pick.edge' | 'pick.point'] ?? KEY_PICK_TEXT['pick.mesh'];
    out.push({ pick: p, sel, name: keyPickName(d, p, cycle), kind: tr(kind) });
  });
  return out;
}

/** 목록이 쓰는 뷰어 부분(시험은 가짜로 준다) */
export type PickListViewer = Pick<Viewer3d, 'canvas' | 'pickCandidates' | 'claimPointer' | 'keyboardCursor' | 'setPickPreview'>;

export interface PickListHost {
  /** 지금 목록을 열 수 있는지(문서가 있고 걷기·측정 중이 아님) */
  allowed(): boolean;
  /** 목록에서 고른 것(고르기 직전에 allowed를 다시 본다 — 목록이 열린 사이 걷기를 켰을 때) */
  choose(p: Pick3d, sel: Selection | null): void;
  /**
   * 3D 강조(58차 미리 강조 — 고른 것·패널은 바꾸지 않는다): 줄에 초점·마우스가 가면 그 줄의 고른 것으로, 미리 강조한 목록을 닫으면 문서의 지금 고른 것으로 부른다.
   * 없으면 미리 강조하지 않는다
   */
  preview?(sel: Selection | null): void;
}

interface Press {
  id: number;
  type: string;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

export class PickList {
  private on = false;
  private menu: HTMLElement | null = null;
  private menuOff: (() => void) | null = null;
  /** 손가락·펜 길게 누르기를 기다리는 포인터(하나뿐 — 둘째 손가락이 닿으면 그만둔다) */
  private press: Press | null = null;
  /** 누른 마우스 오른쪽 단추(끌면 지운다 — 코어 화면 옮기기) */
  private right: { id: number; x: number; y: number } | null = null;
  /** 3D 보기 위 마우스 자리(client 좌표 — 가상 커서 없이 메뉴 키로 열 때. 3D 보기를 떠나면 지운다) */
  private hover: { x: number; y: number } | null = null;
  /** 줄을 미리 강조했는지(닫을 때 되돌린다) */
  private previewed = false;
  /** 코어 후보 묶음 열쇠(59차 — 가상 커서 Tab 차례와 같은 열쇠) */
  private readonly group: ReturnType<typeof pickGroupKey>;

  constructor(
    private readonly v: PickListViewer,
    private readonly doc: () => SkpDoc | null,
    private readonly host: PickListHost,
  ) {
    this.group = pickGroupKey(doc);
    const cv = v.canvas;
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    cv.addEventListener('pointerup', (e) => this.onUp(e));
    cv.addEventListener('pointercancel', (e) => this.drop(e.pointerId));
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hover = null;
    });
    cv.addEventListener('keydown', (e) => this.onKey(e));
    cv.addEventListener('contextmenu', (e) => this.onContext(e));
  }

  /** 켜졌는지(고르기 도구) */
  get enabled(): boolean {
    return this.on;
  }

  /** 열린 목록(시험·상태 보내기) */
  get element(): HTMLElement | null {
    return this.menu;
  }

  /** 고르기 도구면 켜고, 줄자·각도기면 끈다(열린 목록·기다리던 길게 누르기도 거둔다) */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (!on) {
      this.cancelPress();
      this.right = null;
      this.close();
    }
  }

  /** 화면 자리(client 좌표)에 목록을 연다. pointerType은 후보 허용 거리('touch'면 넓게). 열었으면 true */
  open(clientX: number, clientY: number, pointerType: string): boolean {
    this.close();
    const d = this.doc();
    if (!this.on || !d || !this.host.allowed()) return false;
    const r = this.v.canvas.getBoundingClientRect();
    const picks = this.v.pickCandidates(clientX - r.left, clientY - r.top, { ...PICK_CYCLE, pointerType, max: PICK_LIST_MAX, group: this.group });
    this.show(pickListItems(d, picks), clientX, clientY);
    return true;
  }

  close(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.menuOff?.();
    this.menuOff = null;
    if (this.previewed) {
      this.previewed = false;
      this.host.preview?.(this.doc()?.selection ?? null);
      this.v.setPickPreview(null);
    }
  }

  /** 앱 창 키 처리(캡처 단계)에서: 목록이 열려 있으면 Esc는 목록만 닫고 3D 보기로(고른 것을 지우지 않는다). 다뤘으면 true */
  escape(e: KeyboardEvent): boolean {
    if (!this.menu || e.key !== 'Escape') return false;
    e.preventDefault();
    e.stopPropagation();
    this.dismiss();
    return true;
  }

  /** 고르지 않고 닫아 3D 보기로 초점(Esc·Tab — 앱 창 키 처리도 Esc를 여기로 보낸다: 고른 것을 지우지 않는다) */
  dismiss(): void {
    if (!this.menu) return;
    this.close();
    this.v.canvas.focus({ preventScroll: true });
  }

  private show(items: readonly PickListItem[], x: number, y: number): void {
    const menu = document.createElement('div');
    menu.className = 'menu pick-list';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', uiText(PICK_LIST_LABEL));
    menu.setAttribute('data-i18n-skip', '');
    const buttons: HTMLButtonElement[] = [];
    const add = (label: string, kind: string | null, run: (() => void) | null, it?: PickListItem): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      const l = document.createElement('span');
      l.className = 'menu-label';
      l.textContent = label;
      b.append(l);
      if (kind) {
        const k = document.createElement('span');
        k.className = 'menu-kind';
        k.textContent = kind;
        b.append(k);
      }
      if (run) b.addEventListener('click', run);
      else b.disabled = true;
      if (it) {
        // 미리 강조: 초점이 간 줄(↑↓·처음 연 때 첫 줄). 마우스·펜이 오른 줄은 초점을 옮긴다(표준 메뉴처럼 — 강조 줄과 초점 줄을 하나로)
        b.addEventListener('focus', () => this.previewItem(it));
        b.addEventListener('pointermove', (e) => {
          if (e.pointerType !== 'touch' && document.activeElement !== b) b.focus({ preventScroll: true });
        });
      }
      buttons.push(b);
      menu.append(b);
    };
    for (const it of items)
      add(
        it.name,
        it.kind,
        () => {
          this.close();
          this.v.canvas.focus({ preventScroll: true });
          if (this.doc() && this.host.allowed()) this.host.choose(it.pick, it.sel);
        },
        it,
      );
    if (!items.length) add(uiText(KEY_PICK_TEXT.noPick), null, null);
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        // 앱 Esc(고른 것 지우기)·초점 이동으로 넘기지 않고 3D 보기로 돌아간다
        e.preventDefault();
        e.stopPropagation();
        this.dismiss();
      } else listKeys(e, buttons, 'ArrowUp', 'ArrowDown', true, 0);
    });
    // 목록 위의 브라우저 메뉴(오른쪽 단추·메뉴 키가 초점 줄에 낸 사건)는 막는다 — 3D 보기는 코어가 막는다
    menu.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(menu);
    // 자리: 누른 곳 오른쪽 아래, 화면 끝이면 안쪽·위로(낮은 화면은 목록 안에서 굴린다)
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    menu.style.left = `${Math.max(8, Math.min(W - w - 8, x))}px`;
    menu.style.top = `${y + 4 + h <= H - 8 ? y + 4 : Math.max(8, y - 4 - h)}px`;
    menu.style.maxHeight = `${Math.max(120, H - 16)}px`;
    this.menu = menu;
    (buttons.find((b) => !b.disabled) ?? buttons[0])?.focus({ preventScroll: true });
    const away = (e: Event): void => {
      if (!menu.contains(e.target as Node)) this.close();
    };
    const resize = (): void => this.close();
    // 연 누르기 뒤의 사건은 받지 않는다(다음 누르기부터)
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true));
    window.addEventListener('resize', resize);
    this.menuOff = () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', resize);
    };
  }

  /** 줄 미리 강조(열린 목록의 줄에 초점이 갈 때): 앱 강조(그 줄로 고를 것)와 코어 덧그림 표식(그 줄의 후보 — 60차, 면이면 SketchUp 면 구간) */
  private previewItem(it: PickListItem): void {
    if (!this.menu) return;
    this.previewed = true;
    this.host.preview?.(it.sel);
    this.v.setPickPreview(it.pick, { ranges: pickFaceRanges(this.doc(), it.pick) });
  }

  private onDown(e: PointerEvent): void {
    if (!this.on) return;
    if (e.pointerType === 'mouse') {
      this.right = e.button === 2 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
      return;
    }
    // 손가락·펜: 둘째 포인터가 닿으면(두 손가락 몸짓) 기다리던 것을 그만둔다
    if (this.press) {
      this.cancelPress();
      return;
    }
    if (e.isPrimary === false || e.button > 0) return;
    const id = e.pointerId;
    const type = e.pointerType || 'touch';
    this.press = { id, type, x: e.clientX, y: e.clientY, timer: setTimeout(() => this.longPress(id), LONG_PRESS_MS) };
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'mouse') this.hover = { x: e.clientX, y: e.clientY };
    const r = this.right;
    if (r && e.pointerId === r.id && Math.hypot(e.clientX - r.x, e.clientY - r.y) >= dragStartPx('mouse')) this.right = null;
    const p = this.press;
    if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= dragStartPx(p.type)) this.cancelPress();
  }

  private onUp(e: PointerEvent): void {
    const r = this.right;
    if (r && e.pointerId === r.id && e.button === 2) {
      this.right = null;
      this.open(e.clientX, e.clientY, 'mouse');
      return;
    }
    this.drop(e.pointerId);
  }

  private drop(id: number): void {
    if (this.press?.id === id) this.cancelPress();
    if (this.right?.id === id) this.right = null;
  }

  private cancelPress(): void {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  private longPress(id: number): void {
    const p = this.press;
    if (!p || p.id !== id) return;
    this.press = null;
    if (!this.on || !this.host.allowed()) return;
    // 코어에서 그 포인터를 맡는다: 떼어도 고르기·두 번 누르기 판별을 하지 않는다(움직임·떼기는 받을 곳이 없다)
    if (!this.v.claimPointer(id, null)) return;
    try {
      navigator.vibrate?.(12);
    } catch {
      /* 진동을 막은 브라우저 */
    }
    this.open(p.x, p.y, p.type);
  }

  /** 3D 보기에 초점이 있을 때 Shift+F10·메뉴 키: 가상 커서 자리(없으면 마우스 자리·가운데)에 목록 */
  private onKey(e: KeyboardEvent): void {
    if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.openAtCursor()) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * 키로 낸 contextmenu 사건(포인터 종류가 없다 — 키를 받지 못한 브라우저): 키와 같은 자리.
   * Ctrl을 누른 사건은 Mac의 Ctrl+누르기(포인터 종류를 싣지 않는 브라우저)라 열지 않는다(그 누르기는 고르기다)
   */
  private onContext(e: MouseEvent): void {
    const type = (e as PointerEvent).pointerType;
    if (type || e.ctrlKey || this.right || this.press || this.menu) return;
    if (this.openAtCursor()) e.preventDefault();
  }

  /** 키로 여는 자리: 가상 커서, 없으면 3D 보기 위 마우스 자리, 마우스가 밖이면 3D 보기 가운데 */
  private openAtCursor(): boolean {
    if (!this.on) return false;
    const r = this.v.canvas.getBoundingClientRect();
    const c = this.v.keyboardCursor;
    if (c) return this.open(r.left + c.x, r.top + c.y, 'keyboard');
    const h = this.hover;
    if (h && h.x >= r.left && h.x < r.right && h.y >= r.top && h.y < r.bottom) return this.open(h.x, h.y, 'mouse');
    return this.open(r.left + r.width / 2, r.top + r.height / 2, 'keyboard');
  }
}

/** 시험·상태 보내기용: 열린 목록의 항목 글(이름 · 종류) */
export function pickListTexts(menu: HTMLElement | null): string[] {
  if (!menu) return [];
  return [...menu.querySelectorAll('.menu-item')].map((b) => [...b.children].map((c) => c.textContent ?? '').join(' · '));
}
