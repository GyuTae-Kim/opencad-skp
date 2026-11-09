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
import { pickDeepest, type Selection } from '../../src/app/doc';
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
  chosen: [Pick3d, Selection | null][];
  allowed: { on: boolean };
  d: ReturnType<typeof rowDoc>;
}

function setup(picks?: Pick3d[]): Setup {
  const d = rowDoc();
  const cv = document.createElement('canvas');
  cv.tabIndex = 0;
  document.body.append(cv);
  cv.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600, right: 810, bottom: 620, x: 10, y: 20, toJSON: () => ({}) });
  const list = picks ?? candidates(d);
  const pickCandidates = vi.fn(() => list);
  const claimPointer = vi.fn(() => true);
  const view = { canvas: cv, pickCandidates, claimPointer, cursor: null } as unknown as Setup['view'];
  Object.defineProperty(view, 'keyboardCursor', { get: () => (view.cursor ? ({ x: view.cursor.x, y: view.cursor.y } as PickListViewer['keyboardCursor']) : null) });
  const chosen: [Pick3d, Selection | null][] = [];
  const allowed = { on: true };
  const pl = new PickList(view, () => d, { allowed: () => allowed.on, choose: (p, sel) => chosen.push([p, sel]) });
  pl.set(true);
  return { list: pl, cv, view, pickCandidates, claimPointer, chosen, allowed, d };
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
    expect(pickCandidates).toHaveBeenCalledWith(401, 301, { ...PICK_CYCLE, pointerType: 'mouse', max: PICK_LIST_MAX });
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
    expect(pickCandidates).toHaveBeenCalledWith(290, 180, { ...PICK_CYCLE, pointerType: 'touch', max: PICK_LIST_MAX });
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

  it('가상 커서를 켠 동안 Shift+F10·메뉴 키는 커서 자리 목록, 커서가 없으면 그대로(브라우저 몫)', () => {
    const s = setup();
    key(s.cv, 'F10', true);
    expect(menu()).toBeNull();
    s.view.cursor = { x: 400, y: 300 };
    key(s.cv, 'F10');
    expect(menu()).toBeNull();
    key(s.cv, 'F10', true);
    expect(s.pickCandidates).toHaveBeenCalledWith(400, 300, { ...PICK_CYCLE, pointerType: 'keyboard', max: PICK_LIST_MAX });
    expect(menu()).not.toBeNull();
    key(items()[0]!, 'Escape');
    expect(menu()).toBeNull();
    key(s.cv, 'ContextMenu');
    expect(menu()).not.toBeNull();
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
    expect(app).toMatch(/this\.keyPick\?\.set\(!mode\);\n\s*this\.pickList\?\.set\(!mode\);/);
    expect(app).toMatch(/allowed: \(\) => !!this\.doc && !this\.measureTool\?\.active && !this\.walking/);
    expect(app).toMatch(/private choosePicked\(p: Pick3d, sel: Selection \| null\): void \{[^}]*this\.selectPicked\(d, p, sel\);/);
    expect(app).toMatch(/const sel = selectionForPick\(d, p, !!e\?\.altKey, !!e\?\.cycle\);\n\s*this\.selectPicked\(d, p, sel\);/);
    expect(app.match(/this\.pickList\?\.close\(\);/g)?.length).toBe(2);
    // 창 키 처리(캡처 단계)는 목록이 열려 있으면 Esc를 목록에 보낸다(고른 것 지우기로 가지 않는다)
    expect(app).toMatch(/if \(this\.pickList\?\.element && ev\.key === 'Escape'\) \{[^}]*this\.pickList\.dismiss\(\);/);
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
