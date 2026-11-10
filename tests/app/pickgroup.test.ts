/**
 * 59차 코어 0.53.0 후보 묶음 열쇠(keypick.ts pickGroupKey — pickCandidates·가상 커서 pickCycle의 group)를 가짜 WebGL2 위 코어 뷰어로 본다.
 * - 묶어 빠지는 후보는 앞 후보와 고를 것이 같은 것뿐: 한도가 넉넉하면 겹친 것 목록 줄(이름·고를 것·후보)이 묶지 않은 것과 같다(세 방식·펼침, 화면 여러 자리)
 * - 촘촘한 자리(판 20장 뒤 상자): 묶지 않으면 한도 16을 판이 채워 뒤 상자가 목록·Tab 차례에 들지 못하고, 묶으면 든다
 * - 펼친 단계 방식에서 접힌 그룹 안 후보는 묶지 않는다(첫 후보 줄은 펼친 단계, 뒤 후보 줄은 가장 안쪽이라 열쇠 하나로 나타낼 수 없다 — 앱의 같은 고른 것 빼기 그대로)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d, type Pick3d, type PickEvent } from 'opencad-viewer3d';
import { selectionForPick, type createDoc } from '../../src/app/doc';
import { KeyPick, PICK_CYCLE, SECTION_GROUP, keyPickName, pickGroupKey } from '../../src/app/keypick';
import { selKey } from '../../src/app/panel';
import { PICK_LIST_MAX, pickListItems } from '../../src/app/picklist';
import { childrenOf, nodeName, type PickMode } from '../../src/app/tree';
import { type FakeElement, installDom } from '../fakegl/fakedom';
import { rowDoc, stackDoc } from './rowdoc';

type Doc = ReturnType<typeof createDoc>;

let dom: ReturnType<typeof installDom>;
const views: Viewer3d[] = [];
beforeAll(() => {
  dom = installDom();
});
afterAll(() => {
  for (const v of views) v.dispose();
  dom.restore();
});

function view(d: Doc): { v: Viewer3d; host: FakeElement } {
  const host = dom.host();
  const v = new Viewer3d(host as unknown as HTMLElement, { animate: false, keyboard: true, viewCube: false, grid: false });
  views.push(v);
  v.setScene(d.scene);
  v.setView('right', false);
  v.fit(false);
  return { v, host };
}

/** 같은 자리 코어 후보(grouped면 앱 묶음 열쇠) */
function picks(v: Viewer3d, d: Doc, x: number, y: number, max: number, grouped: boolean): Pick3d[] {
  return v.pickCandidates(x, y, { ...PICK_CYCLE, pointerType: 'mouse', max, ...(grouped ? { group: pickGroupKey(() => d) } : {}) });
}

/** 목록 줄: 이름·고를 것 열쇠·그 줄의 후보(그물·삼각형) */
function rows(d: Doc, list: readonly Pick3d[]): [string, string, string, string, number][] {
  return pickListItems(d, list, (t) => t).map((i) => [i.name, i.kind, selKey(i.sel), i.pick.id, i.pick.index]);
}

/** 모형의 노드 번호(이름으로) */
function node(d: Doc, name: string): number {
  const t = d.tree!;
  const walk = (p: number): number => {
    for (const c of childrenOf(t, p)) {
      if (nodeName(t, c) === name) return c;
      const r = walk(c);
      if (r >= 0) return r;
    }
    return -1;
  };
  return walk(-1);
}

const key = (cv: FakeElement, k: string, shiftKey = false): void => cv.fire('keydown', { key: k, shiftKey, defaultPrevented: false });

describe('pickGroupKey', () => {
  it('차례와 상관없이 고를 것이 같은 후보만 그 고른 것 열쇠로 묶고, 잘린 면은 하나로, 문서가 없으면 묶지 않는다', () => {
    const d = rowDoc();
    const { v } = view(d);
    const [front, back] = picks(v, d, 400, 300, 4, false);
    const g = pickGroupKey(() => d);
    // 펼친 단계 방식: Near 앞면은 첫째면 Row(펼친 단계), 뒤면 Near(가장 안쪽) — 묶지 않는다
    expect(selKey(selectionForPick(d, front!))).not.toBe(selKey(selectionForPick(d, front!, false, true)));
    expect(g(front!)).toBeNull();
    // 가장 안쪽 방식: 둘 다 Near — 같은 열쇠
    d.pickMode = 'deepest';
    expect(g(front!)).toBe(`n:${node(d, 'Near')}`);
    expect(g(back!)).toBe(g(front!));
    // 면 방식: 면마다(앞·뒤 면은 다른 면)
    d.pickMode = 'face';
    expect(g(front!)).toMatch(/^f:/);
    expect(g(back!)).not.toBe(g(front!));
    // 펼친 단계 방식에서 Row를 펼치면 Near가 펼친 단계 — 묶는다
    d.pickMode = 'open';
    d.expanded.add(node(d, 'Row'));
    expect(g(front!)).toBe(`n:${node(d, 'Near')}`);
    expect(g({ ...front!, section: true })).toBe(SECTION_GROUP);
    expect(pickGroupKey(() => null)(front!)).toBeNull();
  });

  it('한도가 넉넉하면 묶어도 목록 줄이 묶지 않은 것과 같다(세 방식과 펼침, 화면 117자리) — 묶어 빠진 후보는 앞 후보와 고를 것이 같은 것뿐', () => {
    const cases: [string, () => Doc, PickMode, string[]][] = [
      ['row', rowDoc, 'open', []],
      ['row', rowDoc, 'open', ['Row']],
      ['row', rowDoc, 'deepest', []],
      ['row', rowDoc, 'face', []],
      ['stack', () => stackDoc(6), 'open', []],
      ['stack', () => stackDoc(6, true), 'open', []],
      ['stack', () => stackDoc(6, true), 'open', ['Site']],
      ['stack', () => stackDoc(6, true), 'deepest', []],
      ['stack', () => stackDoc(6), 'face', []],
    ];
    let spots = 0;
    let merged = 0;
    for (const [name, make, mode, open] of cases) {
      const d = make();
      const { v } = view(d);
      d.pickMode = mode;
      for (const n of open) d.expanded.add(node(d, n));
      for (let x = 100; x <= 700; x += 50)
        for (let y = 100; y <= 500; y += 50) {
          const raw = picks(v, d, x, y, 64, false);
          const grouped = picks(v, d, x, y, 64, true);
          expect(raw.length, `${name} ${mode} ${x},${y}`).toBeLessThan(64);
          expect(rows(d, grouped), `${name} ${mode} ${open} ${x},${y}`).toEqual(rows(d, raw));
          // 한도 16: 묶은 목록 줄은 묶지 않은 줄을 모두 담는다
          const keys16 = new Set(rows(d, picks(v, d, x, y, PICK_LIST_MAX, true)).map((r) => r[2]));
          for (const r of rows(d, picks(v, d, x, y, PICK_LIST_MAX, false))) expect(keys16.has(r[2]), `${name} ${mode} ${x},${y} ${r[0]}`).toBe(true);
          if (raw.length) spots++;
          merged += raw.length - grouped.length;
        }
    }
    // 시험이 빈 자리만 보지 않았고 묶음이 실제로 일어났다
    expect(spots).toBeGreaterThan(200);
    expect(merged).toBeGreaterThan(100);
  });
});

describe('촘촘한 자리(판 20장 뒤 상자 — 가짜 WebGL2 코어 뷰어)', () => {
  it('묶지 않으면 한도 16을 판이 채워 뒤 상자가 목록에 없고, 묶으면 판 그룹 하나 + 상자로 든다', () => {
    const d = stackDoc(20);
    const { v } = view(d);
    const raw = picks(v, d, 400, 300, PICK_LIST_MAX, false);
    expect(raw.length).toBe(16);
    expect(rows(d, raw).map((r) => r[0])).toEqual(['그룹 Slats']);
    const grouped = picks(v, d, 400, 300, PICK_LIST_MAX, true);
    // 묶음 둘: 판 20장(한 그룹의 낱 면)과 상자 앞·뒤 면
    expect(grouped.length).toBe(2);
    expect(rows(d, grouped).map((r) => r[0])).toEqual(['그룹 Slats', '그룹 Wall']);
    // 묶음 열쇠가 없던 0.47.0 꼴로 한도를 넉넉히 주어야 들던 상자 = 묶은 목록의 상자 줄
    const all = picks(v, d, 400, 300, 64, false);
    expect(all.length).toBe(22);
    expect(rows(d, all)).toEqual(rows(d, grouped));
  });

  it('가상 커서 Tab 차례도 묶음 수(판 16장이 아니라 판 그룹 → 상자)이고 Enter로 그 상자를 고른다', () => {
    const d = stackDoc(20);
    const { v, host } = view(d);
    const got: [Pick3d | null, PickEvent][] = [];
    v.onPick((p, e) => got.push([p, e]));
    const kp = new KeyPick(v, host as unknown as HTMLElement, () => d);
    kp.set(true);
    const cv = v.canvas as unknown as FakeElement;
    key(cv, 'ArrowLeft');
    // 판 20장(한 그룹의 낱 면 — 고를 것이 같다)과 상자 앞·뒤 면(같은 상자 그룹)
    expect(v.keyboardCursor!.count).toBe(2);
    expect(kp.text).toMatch(/^가상 커서를 켰습니다\. 그룹 Slats의 면 1\/2: /);
    key(cv, 'Tab');
    expect(kp.text).toMatch(/^그룹 Wall의 면 2\/2: /);
    key(cv, 'Enter');
    const [p, e] = got.at(-1)!;
    expect(e.cycle).toEqual({ index: 1, count: 2 });
    // 맨 위 단계 그룹은 개요 줄로 고른다(목록의 상자 줄과 같은 고른 것)
    expect(selectionForPick(d, p, false, true)).toEqual(pickListItems(d, picks(v, d, 400, 300, PICK_LIST_MAX, true))[1]!.sel);
    expect(keyPickName(d, p!, true)).toBe('그룹 Wall');
    key(cv, 'Tab');
    key(cv, 'Tab');
    expect(v.keyboardCursor!.index).toBe(1);
    kp.set(false);
    // 58차 꼴(묶음 열쇠 없음): 한도 16을 판이 채워 상자는 Tab 차례에 없다
    v.setKeyboardSnap({ pickCycle: PICK_CYCLE });
    key(cv, 'ArrowLeft');
    expect(v.keyboardCursor!.count).toBe(16);
    v.setKeyboardSnap(false);
  });

  it('펼친 단계 방식에서 접힌 그룹 안이면 묶지 않아 예전처럼 한도를 판이 채운다 — 가장 안쪽 방식이나 그룹을 펼치면 상자가 든다', () => {
    const d = stackDoc(20, true);
    const { v } = view(d);
    const raw = picks(v, d, 400, 300, PICK_LIST_MAX, false);
    const grouped = picks(v, d, 400, 300, PICK_LIST_MAX, true);
    // 첫 줄은 펼친 단계(Site), 둘째 줄은 판의 가장 안쪽 그룹 — 상자는 한도 밖
    expect(rows(d, grouped)).toEqual(rows(d, raw));
    expect(rows(d, grouped).map((r) => r[0])).toEqual(['그룹 Site', '그룹 Slats']);
    d.pickMode = 'deepest';
    expect(rows(d, picks(v, d, 400, 300, PICK_LIST_MAX, true)).map((r) => r[0])).toEqual(['그룹 Slats', '그룹 Wall']);
    d.pickMode = 'open';
    d.expanded.add(node(d, 'Site'));
    expect(rows(d, picks(v, d, 400, 300, PICK_LIST_MAX, true)).map((r) => r[0])).toEqual(['그룹 Slats', '그룹 Wall']);
  });
});
