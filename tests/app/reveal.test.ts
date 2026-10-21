import { describe, expect, it } from 'vitest';
import { createDoc, itemVisible, revealGhostRanges, revealNodesFor } from '../../src/app/doc';
import { nextSlide, pagePlan, readPage, slideDurationMs, slideshowOrder } from '../../src/app/pages';
import { skpToScene } from '../../src/index';
import { ID13, mfcFile, move13, squareEntities, type MfcSpec } from '../mfcwrite';

/** 정사각형 판 정의를 둘 놓고 둘째는 모형에서 숨긴다(멀리). 장면 A는 숨긴 개체를 기억하며 아무것도 숨기지 않고, B는 둘째를 숨긴다 */
const spec = (): MfcSpec => ({
  schemas: 'v20',
  definitions: [{ name: '판', entities: squareEntities() }],
  root: { instances: [{ def: 0, xform: ID13, name: '보이는 판' }, { def: 0, xform: move13(100, 0, 0), name: '숨긴 판', hidden: true, pid: 77 }] },
  pages: [
    { name: 'A', flags: 0x1 | 0x10, camera: { eye: [0, -50, 10], target: [0, 0, 0], up: [0, 0, 1] }, include: false },
    { name: 'B', flags: 0x1 | 0x10, camera: { eye: [0, -50, 10], target: [0, 0, 0], up: [0, 0, 1] }, hidden: [{ kind: 'instance', index: 1 }], delay: 3 },
  ],
});

describe('장면이 다시 보이는 숨긴 개체', () => {
  it('해석기: 숨긴 인스턴스를 숨기지 않는 장면이 있으면 그 노드 몫으로 보통 색 그림을 따로 둔다(범위에는 넣지 않음)', () => {
    const s = skpToScene(mfcFile(spec()), { outline: true, extras: true });
    const meta = s.meta as Record<string, any>;
    expect(meta.revealItems).toHaveLength(1);
    const { node, ids } = meta.revealItems[0];
    expect(meta.tree.names[node]).toBe('숨긴 판');
    const mesh = s.meshes.find((m) => ids.includes(m.id))!;
    expect(mesh.color[3]).toBe(1);
    expect(mesh.id).toMatch(/^skp-reveal-/);
    // 장면 범위는 보이는 판만(0~10인치)
    expect(s.bounds!.max[0]).toBeCloseTo(10);
    expect(meta.pages[0].hiddenNodes).toEqual([]);
    expect(meta.pages[1].hiddenNodes).toEqual([node]);
    // 재생에서 뺀 장면
    expect(meta.pages[0].includeInAnimation).toBe(false);
    expect(meta.pages[1].includeInAnimation).toBeUndefined();
    // extras를 끄면(숨긴 형상을 읽지 않으면) 따로 그리지 않는다
    expect((skpToScene(mfcFile(spec()), { outline: true }).meta as Record<string, any>).revealItems).toBeUndefined();
  });

  it('화면: 처음엔 숨기고, 그 노드를 숨기지 않는 장면을 고르면 보인다(숨기는 장면이면 다시 숨김)', () => {
    const d = createDoc('숨김.skp', 1, { scene: skpToScene(mfcFile(spec()), { outline: true, extras: true }), ms: 1 });
    const [id] = [...d.revealOf.keys()];
    const item = d.scene.meshes.findIndex((m) => m.id === id);
    expect(itemVisible(d, item)).toBe(false);
    const a = pagePlan(d.pages[0]!);
    d.revealNodes = revealNodesFor(d, a.hiddenNodes)!;
    expect(itemVisible(d, item)).toBe(true);
    // 보기에서 그 노드를 숨기면 숨는다
    const node = d.revealOf.get(id!)!;
    d.hiddenNodes.add(node);
    expect(itemVisible(d, item)).toBe(false);
    d.hiddenNodes.clear();
    const b = pagePlan(d.pages[1]!);
    d.revealNodes = revealNodesFor(d, b.hiddenNodes)!;
    expect(itemVisible(d, item)).toBe(false);
    // 숨긴 개체를 기억하지 않는 장면은 그대로
    expect(revealNodesFor(d, null)).toBeNull();
    // 숨긴 형상 보기를 켜면 다시 보인 노드의 반투명 그림은 구간으로 숨긴다
    d.revealNodes = new Set([node]);
    d.showHidden = true;
    expect(revealGhostRanges(d).size).toBeGreaterThan(0);
    d.showHidden = false;
    expect(revealGhostRanges(d).size).toBe(0);
  });
});

describe('장면 재생', () => {
  it('재생 차례는 "장면 재생에 넣기"를 끈 장면을 빼고(모두 껐으면 모두), 끝에서 되풀이하거나 멈춘다', () => {
    const pages = [readPage({ name: 'A', includeInAnimation: false }, 0), readPage({ name: 'B' }, 1), readPage({ name: 'C' }, 2)];
    expect(pages[0]!.includeInAnimation).toBe(false);
    const order = slideshowOrder(pages);
    expect(order).toEqual([1, 2]);
    expect(slideshowOrder([readPage({ includeInAnimation: false }, 0)])).toEqual([0]);
    expect(nextSlide(order, null, true)).toBe(1);
    expect(nextSlide(order, 0, true)).toBe(1);
    expect(nextSlide(order, 1, true)).toBe(2);
    expect(nextSlide(order, 2, true, 3)).toBe(1);
    expect(nextSlide(order, 2, false, 3)).toBeNull();
    // 마지막 장면에서 시작하면 처음부터
    expect(nextSlide(order, 2, false, 0)).toBe(1);
    expect(nextSlide([], 0, true)).toBeNull();
  });

  it('한 장면 시간 = 전환(4초에서 자름) + 지연(없으면 1초)', () => {
    expect(slideDurationMs({ delay: 3 }, 2)).toBe(5000);
    expect(slideDurationMs({}, 10)).toBe(5000);
    expect(slideDurationMs({ delay: 0 }, 0)).toBe(0);
  });
});
