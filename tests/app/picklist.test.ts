// @vitest-environment jsdom
/**
 * 3D 보기 겹친 것 고르기 목록(57차 — picklist.ts, 코어 0.47.0 pickCandidates): 여는 법(마우스 오른쪽 단추·손가락 길게 누르기·Shift+F10),
 * 여지 않는 경우(오른쪽 끌기·손가락 끌기·두 손가락·줄자·각도기·걷기), 목록 꼴(메뉴·이름·종류·첫 항목 초점), 키(↑↓·Esc·Tab)와 고르기, 네 언어 사전.
 * 후보는 가짜 뷰어가 준다(코어 pickCandidates를 앱 고르기로 묶는 것은 keypick.test.ts가 가짜 WebGL2 뷰어로 본다).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pick3d } from 'opencad-viewer3d';
import { catalogs, languages, registerCatalog, sourceMessage, translate } from '../../site/i18n.mjs';
import { faceOrEdgeSelection, pickDeepest, selectionForPick, type Selection } from '../../src/app/doc';
import { PICK_CYCLE } from '../../src/app/keypick';
import { LONG_PRESS_MS, PICK_LIST_LABEL, PICK_LIST_MAX, PickList, pickListTexts, type PickListViewer } from '../../src/app/picklist';
import { SHORTCUTS } from '../../src/app/shortcuts';
import { childrenOf } from '../../src/app/tree';
import { rowDoc } from './rowdoc';

const CODES = languages.filter((l) => l.code !== 'ko').map((l) => l.code);
const HANGUL = /[가-힣]/;
const LIST_ROW = SHORTCUTS.flatMap((g) => g.items).find((i) => i.keys.includes('Shift+F10'))!;
const ADDED = [PICK_LIST_LABEL, LIST_ROW.label];

/** 모형의 상자 Near·Far 삼각형으로 만든 후보(가운데 시선 차례: Near 앞·뒤, Far 앞·뒤 — 코어 후보와 같은 꼴) */
function candidates(d: ReturnType<typeof rowDoc>): Pick3d[] {
  const t = d.tree!;
  const row = childrenOf(t, -1)[0]!;
  const [far, near] = childrenOf(t, row);
  const of = (node: number): Pick3d[] => {
    const out: Pick3d[] = [];
    for (const mesh of d.scene.meshes) {
      const tris = (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3;
      for (let i = 0; i < tris && out.length < 2; i++) {
        const p: Pick3d = { kind: 'mesh', id: mesh.id, index: i, point: [0.5, 0.5, 0.5] };
        if (pickDeepest(d, p) === node) out.push(p);
      }
    }
    return out;
  };
  return [...of(near!), ...of(far!)];
}

interface Setup {
  list: PickList;
  cv: HTMLCanvasElement;
  view: PickListViewer & { cursor: { x: number; y: number } | null };
  pickCandidates: ReturnType<typeof vi.fn>;
  claimPointer: ReturnType<typeof vi.fn>;
  /** 60차 코어 덧그림 표식(setPickPreview — 후보, 선택) */
  setPickPreview: ReturnType<typeof vi.fn>;
  chosen: [Pick3d, Selection | null][];
  allowed: { on: boolean };
  d: ReturnType<typeof rowDoc>;
  /** 앱에 간 차례(3D 강조 'preview'·고르기 'choose') */
  calls: [string, Selection | null][];
}

function setup(picks?: Pick3d[], withPreview = true): Setup {
  const d = rowDoc();
  const cv = document.createElement('canvas');
  cv.tabIndex = 0;
  document.body.append(cv);
  cv.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620, x: 10, y: 20, toJSON: () => ({}) });
  const list = picks ?? candidates(d);
  const pickCandidates = vi.fn(() => list);
  const claimPointer = vi.fn(() => true);
  const setPickPreview = vi.fn();
  const view = { canvas: cv, pickCandidates, claimPointer, setPickPreview, cursor: null } as unknown as Setup['view'];
  Object.defineProperty(view, 'keyboardCursor', { get: () => (view.cursor ? ({ x: view.cursor.x, y: view.cursor.y } as PickListViewer['keyboardCursor']) : null) });
  const chosen: [Pick3d, Selection | null][] = [];
  const calls: [string, Selection | null][] = [];
  const allowed = { on: true };
  const pl = new PickList(view, () => d, {
    allowed: () => allowed.on,
    choose: (p, sel) => {
      chosen.push([p, sel]);
      calls.push(['choose', sel]);
    },
    ...(withPreview ? { preview: (sel: Selection | null) => void calls.push(['preview', sel]) } : {}),
  });
  pl.set(true);
  return { list: pl, cv, view, pickCandidates, claimPointer, setPickPreview, chosen, allowed, d, calls };
}

/** 포인터 사건(jsdom에 PointerEvent가 없어 MouseEvent에 칸을 단다) */
function ptr(el: Element, type: string, o: { x: number; y: number; id?: number; button?: number; pointerType?: string; primary?: boolean }): void {
  const e = new MouseEvent(type, { clientX: o.x, clientY: o.y, button: o.button ?? 0, bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    pointerId: { value: o.id ?? 1 },
    pointerType: { value: o.pointerType ?? 'mouse' },
    isPrimary: { value: o.primary ?? true },
  });
  el.dispatchEvent(e);
}
const key = (el: Element, k: string, shiftKey = false): void => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('.pick-list');
const items = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.pick-list .menu-item')];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('여는 법', () => {
  it('마우스 오른쪽 단추를 끌지 않고 떼면 그 자리 후보 목록(메뉴 꼴·이름 · 종류·첫 항목 초점) — 후보 선택은 앱 onPick과 같다', () => {
    const { cv, pickCandidates } = setup();
    ptr(cv, 'pointerdown', { x: 410, y: 320, button: 2 });
    expect(menu()).toBeNull();
    ptr(cv, 'pointerup', { x: 411, y: 321, button: 2 });
    const m = menu()!;
    expect(m.getAttribute('role')).toBe('menu');
    expect(m.getAttribute('aria-label')).toBe('겹친 것 고르기');
    expect(m.hasAttribute('data-i18n-skip')).toBe(true);
    expect(m.classList.contains('menu')).toBe(true);
    expect(pickCandidates).toHaveBeenCalledWith(401, 301, { ...PICK_CYCLE, pointerType: 'mouse', max: PICK_LIST_MAX, group: expect.any(Function) });
    // 같은 상자의 뒷면은 앞면과 같은 고른 것이라 하나로
    expect(pickListTexts(m)).toEqual(['그룹 Row · 면', '그룹 Near · 면', '그룹 Far · 면']);
    expect(items().every((b) => b.getAttribute('role') === 'menuitem' && b.tabIndex === -1)).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
    // 자리: 누른 곳 오른쪽 아래
    expect(m.style.left).toBe('411px');
    expect(m.style.top).toBe('325px');
  });

  it('오른쪽 끌기(코어 화면 옮기기)·왼쪽 단추·꺼진 목록·막힌 때(줄자·각도기·걷기)는 열지 않는다', () => {
    const s = setup();
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointermove', { x: 104, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 104, y: 100, button: 2 });
    expect(menu()).toBeNull();
    ptr(s.cv, 'pointerdown', { x: 100, y: 100 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100 });
    expect(menu()).toBeNull();
    s.allowed.on = false;
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(menu()).toBeNull();
    s.allowed.on = true;
    s.list.set(false);
    expect(s.list.enabled).toBe(false);
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(menu()).toBeNull();
    expect(s.pickCandidates).not.toHaveBeenCalled();
    // 다시 켜면 연다, 끄면 열린 목록도 닫는다
    s.list.set(true);
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(menu()).not.toBeNull();
    s.list.set(false);
    expect(menu()).toBeNull();
  });

  it('손가락을 끌기 시작 거리 안에서 길게 누르면 코어에서 그 포인터를 맡고(떼어도 고르지 않는다) 손가락 허용 거리로 목록을 연다', () => {
    const { cv, claimPointer, pickCandidates } = setup();
    ptr(cv, 'pointerdown', { x: 300, y: 200, id: 7, pointerType: 'touch' });
    ptr(cv, 'pointermove', { x: 306, y: 205, id: 7, pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(menu()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(claimPointer).toHaveBeenCalledWith(7, null);
    expect(pickCandidates).toHaveBeenCalledWith(290, 180, { ...PICK_CYCLE, pointerType: 'touch', max: PICK_LIST_MAX, group: expect.any(Function) });
    expect(pickListTexts(menu())).toEqual(['그룹 Row · 면', '그룹 Near · 면', '그룹 Far · 면']);
    // 연 손가락을 떼도 그대로, 다음 바깥 누르기에 닫힌다
    ptr(cv, 'pointerup', { x: 306, y: 205, id: 7, pointerType: 'touch' });
    vi.advanceTimersByTime(1);
    expect(menu()).not.toBeNull();
    ptr(document.body, 'pointerdown', { x: 5, y: 5, id: 8, pointerType: 'touch' });
    expect(menu()).toBeNull();
  });

  it('손가락 끌기·일찍 떼기·둘째 손가락·코어가 맡지 못한 포인터는 열지 않는다', () => {
    const s = setup();
    ptr(s.cv, 'pointerdown', { x: 300, y: 200, id: 1, pointerType: 'touch' });
    ptr(s.cv, 'pointermove', { x: 311, y: 200, id: 1, pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    ptr(s.cv, 'pointerup', { x: 311, y: 200, id: 1, pointerType: 'touch' });
    ptr(s.cv, 'pointerdown', { x: 300, y: 200, id: 2, pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS / 2);
    ptr(s.cv, 'pointerup', { x: 300, y: 200, id: 2, pointerType: 'touch' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    ptr(s.cv, 'pointerdown', { x: 300, y: 200, id: 3, pointerType: 'touch' });
    ptr(s.cv, 'pointerdown', { x: 500, y: 200, id: 4, pointerType: 'touch', primary: false });
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(menu()).toBeNull();
    expect(s.claimPointer).not.toHaveBeenCalled();
    ptr(s.cv, 'pointerup', { x: 300, y: 200, id: 3, pointerType: 'touch' });
    ptr(s.cv, 'pointerup', { x: 500, y: 200, id: 4, pointerType: 'touch' });
    s.claimPointer.mockReturnValue(false);
    ptr(s.cv, 'pointerdown', { x: 300, y: 200, id: 5, pointerType: 'pen' });
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(s.claimPointer).toHaveBeenCalledWith(5, null);
    expect(menu()).toBeNull();
  });

  it('가상 커서를 켠 동안 Shift+F10·메뉴 키는 커서 자리 목록(F10만·Ctrl과 함께는 브라우저 몫)', () => {
    const s = setup();
    s.view.cursor = { x: 400, y: 300 };
    key(s.cv, 'F10');
    expect(menu()).toBeNull();
    s.cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
    key(s.cv, 'F10', true);
    expect(s.pickCandidates).toHaveBeenCalledWith(400, 300, { ...PICK_CYCLE, pointerType: 'keyboard', max: PICK_LIST_MAX, group: expect.any(Function) });
    expect(menu()).not.toBeNull();
    key(items()[0]!, 'Escape');
    expect(menu()).toBeNull();
    key(s.cv, 'ContextMenu');
    expect(menu()).not.toBeNull();
  });

  it('가상 커서가 없으면 Shift+F10·메뉴 키는 3D 보기 위 마우스 자리, 마우스가 밖이면 3D 보기 가운데(58차)', () => {
    const s = setup();
    // 마우스가 3D 보기에 오른 적이 없다: 가운데(캔버스 800 × 600의 400, 300 — client 410, 320)
    const ev = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    s.cv.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(s.pickCandidates).toHaveBeenLastCalledWith(400, 300, { ...PICK_CYCLE, pointerType: 'keyboard', max: PICK_LIST_MAX, group: expect.any(Function) });
    expect(menu()!.style.left).toBe('410px');
    expect(menu()!.style.top).toBe('324px');
    key(items()[0]!, 'Escape');
    // 마우스가 3D 보기 위에 있으면 그 자리(마우스 허용 거리)
    ptr(s.cv, 'pointermove', { x: 210, y: 120 });
    key(s.cv, 'ContextMenu');
    expect(s.pickCandidates).toHaveBeenLastCalledWith(200, 100, { ...PICK_CYCLE, pointerType: 'mouse', max: PICK_LIST_MAX, group: expect.any(Function) });
    expect(menu()!.style.left).toBe('210px');
    key(items()[0]!, 'Escape');
    // 손가락 자리는 마우스 자리가 아니다, 마우스가 3D 보기를 떠나면 가운데
    ptr(s.cv, 'pointermove', { x: 600, y: 500, pointerType: 'touch' });
    key(s.cv, 'F10', true);
    expect(s.pickCandidates).toHaveBeenLastCalledWith(200, 100, { ...PICK_CYCLE, pointerType: 'mouse', max: PICK_LIST_MAX, group: expect.any(Function) });
    key(items()[0]!, 'Escape');
    ptr(s.cv, 'pointerleave', { x: 0, y: 120 });
    key(s.cv, 'F10', true);
    expect(s.pickCandidates).toHaveBeenLastCalledWith(400, 300, { ...PICK_CYCLE, pointerType: 'keyboard', max: PICK_LIST_MAX, group: expect.any(Function) });
    key(items()[0]!, 'Escape');
    // 키로 낸 contextmenu 사건(포인터 종류 없음)도 같은 자리, 막힌 때(걷기)·꺼진 목록은 브라우저 몫
    const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    s.cv.dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    key(items()[0]!, 'Escape');
    // Mac Ctrl+누르기가 낸 contextmenu(포인터 종류를 싣지 않는 브라우저)는 열지 않는다
    s.cv.dispatchEvent(new MouseEvent('contextmenu', { ctrlKey: true, bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
    s.allowed.on = false;
    const blocked = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    s.cv.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });
});

describe('줄 미리 강조(58차)', () => {
  it('처음 연 첫 줄·↑↓로 옮긴 줄·마우스가 오른 줄을 미리 강조하고, Esc로 닫으면 지금 고른 것으로 한 번 되돌린다(고르지 않는다)', () => {
    const s = setup();
    const t = s.d.tree!;
    const [far, near] = childrenOf(t, childrenOf(t, -1)[0]!);
    // 목록을 열기 전에 고른 것(닫으면 이것으로 되돌린다)
    const before: Selection = { kind: 'node', index: near! };
    s.d.selection = before;
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    // 첫 줄 = 누르기와 같은 고르기(펼친 단계 — 맨 위 그룹 Row)
    expect(s.calls).toEqual([['preview', selectionForPick(s.d, candidates(s.d)[0]!, false, false)]]);
    expect(s.calls[0]![1]).toMatchObject({ kind: 'outline' });
    key(items()[0]!, 'ArrowDown');
    expect(s.calls.at(-1)).toEqual(['preview', { kind: 'node', index: near }]);
    // 마우스가 셋째 줄에 오르면 초점도 옮긴다(강조 줄과 초점 줄이 하나), 같은 줄에서 움직여도 다시 그리지 않는다
    ptr(items()[2]!, 'pointermove', { x: 120, y: 190 });
    ptr(items()[2]!, 'pointermove', { x: 125, y: 191 });
    expect(document.activeElement).toBe(items()[2]);
    expect(s.calls.at(-1)).toEqual(['preview', { kind: 'node', index: far }]);
    expect(s.calls.length).toBe(3);
    // 손가락이 오른 줄은 초점을 옮기지 않는다(누르면 고른다)
    ptr(items()[0]!, 'pointermove', { x: 120, y: 120, pointerType: 'touch' });
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2]!, 'Escape');
    expect(s.calls.slice(3)).toEqual([['preview', before]]);
    expect(s.chosen).toEqual([]);
    expect(s.d.selection).toBe(before);
    // 이미 닫힌 목록을 다시 닫아도 되돌리지 않는다
    s.list.close();
    s.list.dismiss();
    expect(s.calls.length).toBe(4);
  });

  it('고르면 미리 강조를 되돌린 뒤 고르고, 창 크기·도구 바꾸기로 닫혀도 되돌린다. 그사이 막혔으면(걷기) 고르지 않는다. 후보가 없거나 앱이 미리 강조를 받지 않으면 부르지 않는다', () => {
    const s = setup();
    const t = s.d.tree!;
    const near = childrenOf(t, childrenOf(t, -1)[0]!)[1]!;
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    key(items()[0]!, 'ArrowDown');
    items()[1]!.click();
    // 되돌리기(닫기 — 문서의 고른 것 null) 뒤 고르기
    expect(s.calls.slice(1)).toEqual([
      ['preview', { kind: 'node', index: near }],
      ['preview', null],
      ['choose', { kind: 'node', index: near }],
    ]);
    s.calls.length = 0;
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    window.dispatchEvent(new Event('resize'));
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    s.list.set(false);
    expect(s.calls.map((c) => c[1] === null)).toEqual([false, true, false, true]);
    expect(s.calls.every((c) => c[0] === 'preview')).toBe(true);
    // 목록이 열린 사이 막히면(걷기 — 키로 켤 수 있다) 닫기만 한다
    s.list.set(true);
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    s.allowed.on = false;
    items()[0]!.click();
    expect(menu()).toBeNull();
    expect(s.chosen.length).toBe(1);
    s.allowed.on = true;
    document.body.innerHTML = '';
    const e = setup([]);
    ptr(e.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(e.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    key(items()[0]!, 'Escape');
    expect(e.calls).toEqual([]);
    document.body.innerHTML = '';
    const n = setup(undefined, false);
    ptr(n.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(n.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    key(items()[0]!, 'ArrowDown');
    items()[1]!.click();
    expect(n.chosen.length).toBe(1);
  });

  it('60차: 줄의 후보도 코어 덧그림(setPickPreview)에 표식한다 — 면이면 그 SketchUp 면 구간, 닫거나 고르면 지운다(앱 강조는 그대로 그 줄로 고를 것)', () => {
    const s = setup();
    const c = candidates(s.d);
    const face = (p: Pick3d): { start: number; count: number }[] => {
      const f = faceOrEdgeSelection(s.d, p);
      return f?.kind === 'face' ? [{ start: f.start, count: f.count }] : [];
    };
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    // 첫 줄 = 첫 후보(앞 상자 Near의 앞 면), 상자 면 하나는 삼각형 둘
    expect(s.setPickPreview.mock.calls).toEqual([[c[0], { ranges: face(c[0]!) }]]);
    expect(face(c[0]!)[0]!.count).toBe(2);
    // 둘째 줄(Near — 둘째 후보), 셋째 줄(Far — 묶어 뺀 Near 뒷면 다음의 후보)
    key(items()[0]!, 'ArrowDown');
    expect(s.setPickPreview.mock.calls.at(-1)).toEqual([c[1], { ranges: face(c[1]!) }]);
    key(items()[1]!, 'ArrowDown');
    expect(s.setPickPreview.mock.calls.at(-1)).toEqual([c[2], { ranges: face(c[2]!) }]);
    // 앱 강조는 그 줄로 고를 것(그룹)으로 따로 — 두 길이 같은 차례로 불린다
    expect(s.calls.map((x) => x[0])).toEqual(['preview', 'preview', 'preview']);
    key(items()[2]!, 'Escape');
    expect(s.setPickPreview.mock.calls.at(-1)).toEqual([null]);
    expect(s.setPickPreview.mock.calls.length).toBe(4);
    // 고르면 지운 뒤 고른다, 모서리 후보는 면 구간 없이(코어가 그 선분을 긋는다)
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    items()[0]!.click();
    expect(s.setPickPreview.mock.calls.slice(4)).toEqual([[c[0], { ranges: face(c[0]!) }], [null]]);
    expect(s.chosen.length).toBe(1);
    document.body.innerHTML = '';
    const line: Pick3d = { kind: 'line', id: 'no-such-line', index: 0, point: [0, 0, 0] };
    const l = setup([line]);
    ptr(l.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(l.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(l.setPickPreview.mock.calls).toEqual([[line, { ranges: null }]]);
    // 후보가 없으면(고를 것이 없습니다 줄) 표식하지 않는다
    document.body.innerHTML = '';
    const e = setup([]);
    ptr(e.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(e.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    key(items()[0]!, 'Escape');
    expect(e.setPickPreview).not.toHaveBeenCalled();
  });

  it('목록 위 브라우저 메뉴(오른쪽 단추·메뉴 키)는 막는다', () => {
    const s = setup();
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    items()[1]!.dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
  });

  it('앱: 미리 강조·되돌리기는 고를 때와 같은 강조 길(paintSelection)로 그린다(고른 것·패널·상태 줄은 그대로)', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/preview: \(sel\) => this\.paintSelection\(sel\),/);
    expect(app).toMatch(/d\.selection = sel;\n\s*if \(!sel\) d\.pick = null;\n\s*this\.paintSelection\(sel\);/);
    const paint = app.slice(app.indexOf('private paintSelection('), app.indexOf('private itemId('));
    expect(paint).toMatch(/v\.highlight\(/);
    expect(paint).toMatch(/v\.highlightRanges\(/);
    expect(paint).toMatch(/v\.setHighlightSegments\(/);
    expect(paint).not.toMatch(/d\.selection =|refreshSelection|refreshStatus/);
  });
});

describe('목록 키와 고르기', () => {
  it('↑↓로 오가고 누르면(Enter·Space는 단추 누르기) 그 후보와 목록이 보인 고른 것을 앱에 넘기고 3D 보기로 초점', () => {
    const s = setup();
    const t = s.d.tree!;
    const near = childrenOf(t, childrenOf(t, -1)[0]!)[1]!;
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    key(items()[0]!, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key(items()[1]!, 'ArrowUp');
    key(items()[0]!, 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
    key(items()[2]!, 'ArrowUp');
    items()[1]!.click();
    expect(menu()).toBeNull();
    expect(s.chosen.length).toBe(1);
    const [p, sel] = s.chosen[0]!;
    expect(sel).toEqual({ kind: 'node', index: near });
    expect(p.index).toBe(candidates(s.d)[1]!.index);
    expect(document.activeElement).toBe(s.cv);
  });

  it('Esc·Tab은 고르지 않고 닫아 3D 보기로 초점(앱 Esc로 넘기지 않는다), 창 크기가 바뀌면 닫는다', () => {
    const s = setup();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      for (const k of ['Escape', 'Tab']) {
        ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
        ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
        key(items()[0]!, k);
        expect(menu(), k).toBeNull();
        expect(document.activeElement).toBe(s.cv);
      }
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    window.dispatchEvent(new Event('resize'));
    expect(menu()).toBeNull();
    expect(s.chosen).toEqual([]);
  });

  it('후보가 없으면 누를 수 없는 "고를 것이 없습니다" 한 줄, 잘린 면만이면 같다', () => {
    const s = setup([]);
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(pickListTexts(menu())).toEqual(['고를 것이 없습니다']);
    expect(items()[0]!.disabled).toBe(true);
    const c = candidates(s.d)[0]!;
    const t = setup([{ ...c, section: true }]);
    ptr(t.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(t.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(pickListTexts(menu())).toEqual(['고를 것이 없습니다']);
  });

  it('앱: 고르기 도구일 때만 켜고(키보드 고르기와 같은 자리), 문서를 바꾸거나 언어를 바꾸면 닫으며, 고른 것은 onPick과 같은 길(selectPicked)로 쓴다', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    // 59차: 키보드는 줄자·각도기에서 점 찍기 방식(keypick.ts setMode) — 목록은 고르기 도구일 때만
    expect(app).toMatch(/this\.keyPick\?\.follow\(mode\);\n\s*this\.pickList\?\.set\(!mode\);/);
    expect(app).toMatch(/allowed: \(\) => !!this\.doc && !this\.measureTool\?\.active && !this\.walking/);
    // 58차: 고르기 직전 막힘(측정·걷기)은 목록이 allowed로 다시 본다(앱 choosePicked를 줄였다 — 첫 화면 조각)
    expect(app).toMatch(/choose: \(p, sel\) => this\.selectPicked\(this\.doc!, p, sel\),/);
    expect(app).toMatch(/const sel = selectionForPick\(d, p, !!e\?\.altKey, !!e\?\.cycle\);\n\s*this\.selectPicked\(d, p, sel\);/);
    expect(app.match(/this\.pickList\?\.close\(\);/g)?.length).toBe(2);
    // 창 키 처리(캡처 단계)는 목록이 열려 있으면 Esc를 목록에 보낸다(고른 것 지우기로 가지 않는다 — 58차: 판정은 목록 조각의 escape)
    expect(app).toMatch(/if \(this\.pickList\?\.escape\(ev\)\) return;/);
  });

  it('창 키 처리용 escape: 목록이 열려 있을 때 Esc만 다루고(막고 닫아 3D 보기로) 그 밖은 그대로 둔다', () => {
    const s = setup();
    const esc = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const e0 = esc();
    expect(s.list.escape(e0)).toBe(false);
    expect(e0.defaultPrevented).toBe(false);
    ptr(s.cv, 'pointerdown', { x: 100, y: 100, button: 2 });
    ptr(s.cv, 'pointerup', { x: 100, y: 100, button: 2 });
    expect(s.list.escape(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false);
    expect(menu()).not.toBeNull();
    const e1 = esc();
    expect(s.list.escape(e1)).toBe(true);
    expect(e1.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(s.cv);
    expect(s.chosen).toEqual([]);
  });
});

describe('네 언어 사전', () => {
  it('목록 이름·바로 가기 줄은 네 언어 사전에 있고 옮긴 글에 한글이 없다', () => {
    expect(LIST_ROW.label).toContain('줄자·각도기를 끈 동안');
    for (const code of CODES)
      for (const t of ADDED) {
        expect(catalogs[code][t], `${code}: ${t}`).toBeTruthy();
        expect(translate(t, code), `${code}: ${t}`).not.toMatch(HANGUL);
      }
  });

  it('새 열쇠를 더해도 화면 번역층이 옮기는 다른 글은 바뀌지 않는다', () => {
    const samples = ['A', '3', '벽', '그룹 1', 'Wood · Layer0'];
    const keys = Object.keys(catalogs.en).filter((k) => !ADDED.includes(k));
    const corpus = new Set<string>(['겹친 것', '고르기', '그룹 Row · 면', '면 · 넓이 12.5 m²', '겹친 것 고르기 목록']);
    for (const k of keys) {
      corpus.add(k);
      if (/\{\d+\}/.test(k)) for (const s of samples) corpus.add(k.replace(/\{\d+\}/g, s));
    }
    const full = Object.fromEntries(CODES.map((c) => [c, { ...catalogs[c] }]));
    const run = (): Map<string, string> => {
      const out = new Map<string, string>();
      for (const c of CODES) {
        for (const t of corpus) out.set(`${c}\t${t}`, translate(t, c));
        for (const k of keys) out.set(`src\t${c}\t${k}`, sourceMessage(full[c]![k]!));
      }
      return out;
    };
    const after = run();
    try {
      for (const c of CODES) registerCatalog(c, Object.fromEntries(Object.entries(full[c]!).filter(([k]) => !ADDED.includes(k))));
      const before = run();
      expect([...before].filter(([k, v]) => after.get(k) !== v)).toEqual([]);
    } finally {
      for (const c of CODES) registerCatalog(c, full[c]!);
    }
  });
});
