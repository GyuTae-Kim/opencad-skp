import { describe, expect, it } from 'vitest';
import { GUIDE_FILES_MAX, GUIDE_STORE_KEY, GUIDE_STORE_MAX_CHARS, digestHex, isGuideKey, loadGuides, readGuideFiles, saveGuides, type GuideStorage } from '../../src/app/guidestore';
import type { GuideLine } from '../../src/app/snap';

/** 메모리 저장소(removeItem 있음). limit을 넘는 글은 저장 공간 가득으로 막는다 */
function store(limit = Infinity): GuideStorage & { m: Map<string, string>; writes: number } {
  const m = new Map<string, string>();
  const s = {
    m,
    writes: 0,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      s.writes++;
      if (v.length > limit) throw new DOMException('full', 'QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
  return s;
}

/** 파일 지문 열쇠(차례 n) */
const key = (n: number): string => n.toString(16).padStart(64, '0');

describe('파일별 안내 기억(guidestore)', () => {
  it('SHA-256 바이트 → 16진 열쇠, 열쇠 꼴', () => {
    const b = new Uint8Array(32);
    b[0] = 0xab;
    b[31] = 0x07;
    const k = digestHex(b.buffer);
    expect(k).toHaveLength(64);
    expect(k.startsWith('ab00')).toBe(true);
    expect(k.endsWith('07')).toBe(true);
    expect(digestHex(new Uint8Array(b.buffer, 31, 1))).toBe('07');
    expect(isGuideKey(k)).toBe(true);
    expect(isGuideKey(k.toUpperCase())).toBe(false);
    expect(isGuideKey('model.skp')).toBe(false);
    expect(isGuideKey(k + '0')).toBe(false);
  });

  it('저장한 안내를 그대로 되살린다(좌표는 자르지 않는다) — 지문 열쇠 말고는 이름·경로가 없다', () => {
    const s = store();
    const pts: [number, number, number][] = [[1 / 3, -2e7 + 0.1, 5.5], [0, 0, 0]];
    const lns: GuideLine[] = [{ point: [10, 20, 30], dir: [0, 0.6, 0.8] }];
    expect(saveGuides(s, key(1), pts, lns, 1000)).toBe(true);
    expect(loadGuides(s, key(1))).toEqual({ pts, lns, hid: [] });
    expect(loadGuides(s, key(2))).toBeNull();
    const text = s.m.get(GUIDE_STORE_KEY)!;
    expect(JSON.parse(text)).toEqual({ v: 1, files: { [key(1)]: { t: 1000, p: pts, l: [[10, 20, 30, 0, 0.6, 0.8]] } } });
    // 열쇠가 지문 꼴이 아니면(이름·경로 등) 저장하지 않는다
    expect(saveGuides(s, 'C:/drawings/model.skp', pts, lns, 2000)).toBe(false);
    expect(s.m.get(GUIDE_STORE_KEY)).toBe(text);
    expect(saveGuides(null, key(1), pts, lns, 2000)).toBe(false);
  });

  it('안내를 모두 지우면 그 항목을 빼고, 하나도 없으면 열쇠도 지운다', () => {
    const s = store();
    saveGuides(s, key(1), [[1, 2, 3]], [], 1);
    saveGuides(s, key(2), [], [{ point: [0, 0, 0], dir: [1, 0, 0] }], 2);
    expect(Object.keys(readGuideFiles(s)).sort()).toEqual([key(1), key(2)]);
    expect(saveGuides(s, key(1), [], [], 3)).toBe(true);
    expect(Object.keys(readGuideFiles(s))).toEqual([key(2)]);
    saveGuides(s, key(2), [], [], 4);
    expect(s.m.has(GUIDE_STORE_KEY)).toBe(false);
    // 없는 항목을 비우는 것은 쓰지 않는다
    const w = s.writes;
    expect(saveGuides(s, key(3), [], [], 5)).toBe(true);
    expect(s.writes).toBe(w);
    // removeItem이 없는 저장소는 빈 글
    const plain = { m: new Map<string, string>(), getItem(k: string) { return this.m.get(k) ?? null; }, setItem(k: string, v: string) { this.m.set(k, v); } };
    saveGuides(plain, key(1), [[1, 2, 3]], [], 1);
    saveGuides(plain, key(1), [], [], 2);
    expect(plain.m.get(GUIDE_STORE_KEY)).toBe('');
    expect(readGuideFiles(plain)).toEqual({});
  });

  it(`파일 ${GUIDE_FILES_MAX}개까지 — 넘으면 오래 쓰지 않은 것부터 버린다(지금 파일은 남긴다)`, () => {
    const s = store();
    for (let i = 0; i < GUIDE_FILES_MAX + 5; i++) saveGuides(s, key(i), [[i, 0, 0]], [], 1000 + i);
    const files = readGuideFiles(s);
    expect(Object.keys(files)).toHaveLength(GUIDE_FILES_MAX);
    for (let i = 0; i < 5; i++) expect(files[key(i)]).toBeUndefined();
    expect(files[key(GUIDE_FILES_MAX + 4)]).toBeDefined();
    // 오래된 파일을 다시 쓰면 새것이 되어 남는다
    saveGuides(s, key(5), [[5, 5, 5]], [], 9999);
    saveGuides(s, key(100), [[1, 1, 1]], [], 10000);
    const after = readGuideFiles(s);
    expect(after[key(5)]).toBeDefined();
    expect(after[key(6)]).toBeUndefined();
    expect(after[key(100)]).toBeDefined();
    // 시각이 거꾸로 가도(시계를 되돌림) 지금 파일은 버리지 않는다
    saveGuides(s, key(200), [[2, 2, 2]], [], 0);
    expect(readGuideFiles(s)[key(200)]).toBeDefined();
  });

  it(`저장 글이 ${GUIDE_STORE_MAX_CHARS.toLocaleString('en-US')}글자를 넘으면 오래된 것부터 버린다`, () => {
    const s = store();
    // 한 파일에 점 300개(긴 소수) — 파일 몇 개면 한도를 넘는다
    const many = Array.from({ length: 300 }, (_, i): [number, number, number] => [i + 0.123456789012345, -i - 0.987654321098765, Math.PI * i]);
    for (let i = 0; i < 30; i++) saveGuides(s, key(i), many, [], i);
    const text = s.m.get(GUIDE_STORE_KEY)!;
    expect(text.length).toBeLessThanOrEqual(GUIDE_STORE_MAX_CHARS);
    const files = readGuideFiles(s);
    expect(files[key(29)]).toBeDefined();
    expect(files[key(0)]).toBeUndefined();
    expect(Object.keys(files).length).toBeLessThan(30);
  });

  it('저장 공간이 모자라면 오래된 절반을 버리고 한 번 더, 저장이 막히면 false(던지지 않는다)', () => {
    const s = store();
    for (let i = 0; i < 10; i++) saveGuides(s, key(i), [[i, i, i]], [], i);
    const len = s.m.get(GUIDE_STORE_KEY)!.length;
    // 지금 글보다 조금 긴 것만 받는 저장소로 옮겨 새 파일을 더한다
    const tight = store(len + 20);
    tight.m.set(GUIDE_STORE_KEY, s.m.get(GUIDE_STORE_KEY)!);
    expect(saveGuides(tight, key(50), [[50, 50, 50], [51, 51, 51]], [], 50)).toBe(true);
    const files = readGuideFiles(tight);
    expect(files[key(50)]).toBeDefined();
    expect(files[key(9)]).toBeDefined();
    expect(files[key(0)]).toBeUndefined();
    // 막힌 저장소(사생활 보호 창 등): 읽기·쓰기가 던져도 조용히
    const blocked: GuideStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveGuides(blocked, key(1), [[1, 2, 3]], [], 1)).toBe(false);
    expect(loadGuides(blocked, key(1))).toBeNull();
    expect(readGuideFiles(blocked)).toEqual({});
  });

  it('모양이 다른 저장 글은 버리고, 수가 아닌 좌표·길이 0 방향은 빼며 한도까지만 되살린다', () => {
    const s = store();
    for (const bad of ['{', 'null', '[]', '{"v":2,"files":{}}', '{"v":1,"files":5}']) {
      s.m.set(GUIDE_STORE_KEY, bad);
      expect(readGuideFiles(s)).toEqual({});
    }
    s.m.set(
      GUIDE_STORE_KEY,
      JSON.stringify({
        v: 1,
        files: {
          'not-a-key': { t: 1, p: [[1, 2, 3]], l: [] },
          [key(1)]: { t: 'x', p: [], l: [] },
          [key(2)]: {
            t: 5,
            p: [[1, 2, 3], [1, 2], ['a', 2, 3], [null, 1, 1], [4, 5, 6]],
            l: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 2, 0, 0], [1, 2, 3, 4, 5], [1, 1, 1, 0, 0, 1e300]],
          },
          [key(3)]: { t: 6, p: [[1, 1, 1, 1]], l: [] },
        },
      }),
    );
    expect(Object.keys(readGuideFiles(s)).sort()).toEqual([key(2), key(3)]);
    expect(loadGuides(s, key(2))).toEqual({
      pts: [[1, 2, 3], [4, 5, 6]],
      lns: [
        { point: [0, 0, 0], dir: [1, 0, 0] },
        { point: [1, 1, 1], dir: [0, 0, 1] },
      ],
      hid: [],
    });
    // 남은 것이 없으면 null
    expect(loadGuides(s, key(3))).toBeNull();
    // 한도(새것 쪽)
    saveGuides(s, key(4), Array.from({ length: 70 }, (_, i): [number, number, number] => [i, 0, 0]), [], 7);
    const g = loadGuides(s, key(4), 50, 50)!;
    expect(g.pts).toHaveLength(50);
    expect(g.pts[0]![0]).toBe(20);
  });

  it('숨긴 안내(25차 Edit › Hide)는 번호로 두어 숨긴 채 되살린다 — 숨긴 것이 없으면 꼴이 예전과 같고, 예전 항목은 모두 보인다', () => {
    const s = store();
    const pts: [number, number, number][] = [[1, 0, 0], [2, 0, 0], [3, 0, 0]];
    const lns: GuideLine[] = [{ point: [0, 0, 0], dir: [1, 0, 0] }, { point: [0, 5, 0], dir: [0, 0, 1] }];
    expect(saveGuides(s, key(1), pts, lns, 10, new Set<unknown>([pts[1], lns[0], [9, 9, 9]]))).toBe(true);
    const e = JSON.parse(s.m.get(GUIDE_STORE_KEY)!).files[key(1)];
    expect(e.hp).toEqual([1]);
    expect(e.hl).toEqual([0]);
    const g = loadGuides(s, key(1))!;
    expect(g.hid).toHaveLength(2);
    expect(g.hid[0]).toBe(g.pts[1]);
    expect(g.hid[1]).toBe(g.lns[0]);
    // 숨긴 것이 없거나 빈 모음이면 hp·hl 칸을 두지 않는다(예전 꼴 그대로)
    saveGuides(s, key(2), pts, lns, 11, new Set());
    saveGuides(s, key(3), pts, lns, 12, new Set<unknown>([[1, 0, 0]]));
    const files = JSON.parse(s.m.get(GUIDE_STORE_KEY)!).files;
    for (const k of [key(2), key(3)]) expect(Object.keys(files[k]).sort()).toEqual(['l', 'p', 't']);
    // 예전 항목(hp·hl 없음)·모양이 다른 번호는 모두 보이는 것으로, 한도로 버린 안내의 숨김은 함께 버린다
    s.m.set(GUIDE_STORE_KEY, JSON.stringify({ v: 1, files: { [key(4)]: { t: 1, p: pts, l: [], hp: ['x'] }, [key(5)]: { t: 2, p: pts, l: [], hp: [0, 2] } } }));
    expect(loadGuides(s, key(4))!.hid).toEqual([]);
    const cut = loadGuides(s, key(5), 2, 50)!;
    expect(cut.pts).toEqual([[2, 0, 0], [3, 0, 0]]);
    expect(cut.hid).toEqual([[3, 0, 0]]);
    expect(cut.hid[0]).toBe(cut.pts[1]);
  });
});
