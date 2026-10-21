import { describe, expect, it } from 'vitest';
import {
  RECENT_MAX,
  RECENT_MAX_BYTES,
  RecentStore,
  canKeepRecent,
  overflowIds,
  recentId,
  recentTimeText,
  sortRecent,
  type RecentBackend,
  type RecentEntry,
} from '../../src/app/recent';

/** 메모리 바탕(IndexedDB 대신) — 바이트를 읽었는지 센다 */
function memory(): RecentBackend & { rows: Map<string, RecentEntry>; bytes: Map<string, ArrayBuffer>; dataReads: number } {
  const rows = new Map<string, RecentEntry>();
  const bytes = new Map<string, ArrayBuffer>();
  const m = {
    rows,
    bytes,
    dataReads: 0,
    entries: async () => [...rows.values()].map((e) => ({ ...e })),
    put: async (e: RecentEntry, d: ArrayBuffer) => {
      rows.set(e.id, { ...e });
      bytes.set(e.id, d);
    },
    touch: async (e: RecentEntry) => {
      rows.set(e.id, { ...e });
    },
    data: async (id: string) => {
      m.dataReads++;
      return bytes.get(id) ?? null;
    },
    remove: async (ids: readonly string[]) => {
      for (const id of ids) {
        rows.delete(id);
        bytes.delete(id);
      }
    },
    clear: async () => {
      rows.clear();
      bytes.clear();
    },
  };
  return m;
}

const buf = (n: number): ArrayBuffer => new ArrayBuffer(n);

describe('최근 문서 규칙', () => {
  it('새것부터, 같은 시각은 이름 차례로 늘어놓고 모양이 이상한 항목은 뺀다', () => {
    const list = sortRecent([
      { id: 'a:1', name: 'a', size: 1, time: 10 },
      { id: 'c:1', name: 'c', size: 1, time: 30 },
      { id: 'b:1', name: 'b', size: 1, time: 30 },
      { id: 'x', name: 'x', size: Number.NaN, time: 40 } as RecentEntry,
    ]);
    expect(list.map((e) => e.name)).toEqual(['b', 'c', 'a']);
  });

  it('8개를 넘으면 오래된 것부터 지울 id를 낸다', () => {
    const list = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, name: `f${i}`, size: 1, time: i }));
    expect(overflowIds(list)).toEqual(['f2', 'f1', 'f0']);
    expect(overflowIds(list.slice(0, RECENT_MAX))).toEqual([]);
  });

  it('빈 파일과 60 MB보다 큰 파일은 저장하지 않는다', () => {
    expect(canKeepRecent(0)).toBe(false);
    expect(canKeepRecent(1)).toBe(true);
    expect(canKeepRecent(RECENT_MAX_BYTES)).toBe(true);
    expect(canKeepRecent(RECENT_MAX_BYTES + 1)).toBe(false);
    expect(canKeepRecent(Number.NaN)).toBe(false);
  });

  it('시각 글: 방금 · n분 전 · n시간 전 · 날짜', () => {
    const now = new Date(2026, 9, 21, 15, 0).getTime();
    expect(recentTimeText(now - 5_000, now)).toBe('방금');
    expect(recentTimeText(now - 3 * 60_000, now)).toBe('3분 전');
    expect(recentTimeText(now - 5 * 3_600_000, now)).toBe('5시간 전');
    expect(recentTimeText(new Date(2026, 8, 3, 9, 0).getTime(), now)).toBe('2026-09-03');
  });
});

describe('RecentStore', () => {
  it('저장한 순서와 상관없이 새것부터 8개까지만 남기고 바이트도 함께 지운다', async () => {
    const m = memory();
    const s = new RecentStore(m);
    for (let i = 0; i < 10; i++) expect(await s.add(`m${i}.skp`, buf(10 + i), 1000 + i)).toBe(true);
    const list = await s.list();
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]!.name).toBe('m9.skp');
    expect(list.at(-1)!.name).toBe('m2.skp');
    expect(m.bytes.size).toBe(RECENT_MAX);
    expect(m.bytes.has(recentId('m0.skp', 10))).toBe(false);
    // 목록은 바이트를 읽지 않는다
    expect(m.dataReads).toBe(0);
  });

  it('같은 이름·크기는 한 항목이고, 다시 열면 맨 앞으로 온다', async () => {
    const m = memory();
    const s = new RecentStore(m);
    await s.add('집.skp', buf(100), 1);
    await s.add('창고.skp', buf(200), 2);
    await s.add('집.skp', buf(100), 3);
    expect((await s.list()).map((e) => e.name)).toEqual(['집.skp', '창고.skp']);
    const got = await s.open(recentId('창고.skp', 200), 10);
    expect(got?.entry.name).toBe('창고.skp');
    expect(got?.data.byteLength).toBe(200);
    expect((await s.list()).map((e) => e.name)).toEqual(['창고.skp', '집.skp']);
    expect(await s.open('없는:1')).toBeNull();
  });

  it('크기 한도 밖은 저장하지 않는다', async () => {
    const m = memory();
    const s = new RecentStore(m);
    expect(await s.add('빈.skp', buf(0))).toBe(false);
    expect(await s.add('큰.skp', { byteLength: RECENT_MAX_BYTES + 1 } as ArrayBuffer)).toBe(false);
    expect(m.rows.size).toBe(0);
  });

  it('하나 지우기와 모두 지우기', async () => {
    const m = memory();
    const s = new RecentStore(m);
    await s.add('a.skp', buf(1), 1);
    await s.add('b.skp', buf(2), 2);
    await s.remove(recentId('a.skp', 1));
    expect((await s.list()).map((e) => e.name)).toEqual(['b.skp']);
    await s.clear();
    expect(await s.list()).toEqual([]);
    expect(m.bytes.size).toBe(0);
  });

  it('저장소를 못 쓰면(비공개 창·IndexedDB 없음) 조용히 빈 목록', async () => {
    const fail = async (): Promise<never> => {
      throw new Error('blocked');
    };
    const broken: RecentBackend = { entries: fail, put: fail, touch: fail, data: fail, remove: fail, clear: fail };
    const s = new RecentStore(broken);
    expect(await s.list()).toEqual([]);
    expect(await s.add('a.skp', buf(1))).toBe(false);
    expect(await s.open('a.skp:1')).toBeNull();
    await expect(s.remove('a.skp:1')).resolves.toBeUndefined();
    await expect(s.clear()).resolves.toBeUndefined();
    const none = new RecentStore(null);
    expect(await none.list()).toEqual([]);
    expect(await none.add('a.skp', buf(1))).toBe(false);
  });
});
