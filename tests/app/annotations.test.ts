// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOV, type CameraState } from 'opencad-viewer3d/camera';
import {
  ANNOTATIONS_KEY,
  AnnotationLabels,
  DEFAULT_FILTER,
  LEADER_GAP_PX,
  OCCLUSION_SETTLE_MS,
  annotationCandidates,
  frameKey,
  occludedBy,
  viewDepthOf,
  annotationColor,
  dimensionText,
  estimateEm,
  fontFamilyCss,
  isLightInk,
  layoutAnnotations,
  prepareDimensions,
  prepareTexts,
  readableAngle,
  type AnnotationFilter,
} from '../../src/app/annotations';
import { frameFor } from '../../src/app/overlay';
import { DEFAULT_UNITS, type UnitsDisplay } from '../../src/app/units';

const u = (o: Partial<UnitsDisplay>): UnitsDisplay => ({ ...DEFAULT_UNITS, ...o });
const filter = (o: Partial<AnnotationFilter> = {}): AnnotationFilter => ({ ...DEFAULT_FILTER, ...o });

/** 위에서 본 평행 투영, 800 × 600 화면에서 세계 1 = 1화소: 세계 (x, y) → 화면 (400 + x, 300 − y) */
const TOP: CameraState = { target: [0, 0, 0], distance: 300 / Math.tan(DEFAULT_FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: DEFAULT_FOV };
const top = frameFor(TOP, 800, 600);

const text = (o: Record<string, unknown>) => ({ text: '글', leaderType: 'none', tag: '', hidden: false, node: -1, ...o });
const dim = (o: Record<string, unknown>) => ({ kind: 'linear', text: '', value: 1200, textPoint: [0, 0, 0], tag: '', hidden: false, node: -1, ...o });

describe('치수 글', () => {
  it('비었거나 <>가 있으면 잰 값을 모형 단위로 채운다', () => {
    const mm = u({ lengthUnit: 'mm', lengthPrecision: 0 });
    expect(dimensionText({ text: '', value: 1200 }, mm)).toBe('1200 mm');
    expect(dimensionText({ text: '<> (마감)', value: 1200 }, mm)).toBe('1200 mm (마감)');
    expect(dimensionText({ text: '고정 글', value: 1200 }, mm)).toBe('고정 글');
    expect(dimensionText({ kind: 'radial', text: '', value: 50 }, mm)).toBe('R50 mm');
    // 장면 단위가 인치면 mm로 바꿔 쓴다
    expect(dimensionText({ text: '<>', value: 10 }, u({ lengthUnit: 'cm', lengthPrecision: 1 }), 25.4)).toBe('25.4 cm');
    expect(dimensionText({ text: '', value: Number.NaN }, mm)).toBe('');
  });
});

describe('글꼴·색', () => {
  it('글꼴 이름은 깨끗이 해 앱 글꼴 앞에, 색은 0~255로', () => {
    expect(fontFamilyCss('Tahoma')).toBe('"Tahoma", var(--font)');
    expect(fontFamilyCss('a"b;}c')).toBe('"abc", var(--font)');
    expect(fontFamilyCss('')).toBe('');
    expect(annotationColor([1, 0.5, 0])).toBe('rgb(255, 128, 0)');
    expect(annotationColor(null)).toBe('');
    expect(isLightInk([1, 1, 1])).toBe(true);
    expect(isLightInk([0, 0, 0])).toBe(false);
  });

  it('어림 크기: 넓은 글자는 1em, 줄 수만큼 높이', () => {
    const [w1] = estimateEm('가나다');
    const [w2, h2] = estimateEm('abc\nd');
    expect(w1).toBe(3);
    expect(w2).toBeCloseTo(1.65, 9);
    expect(h2).toBeCloseTo(2.4, 9);
  });

  it('선 방향 글은 아래·오른쪽에서 읽힌다', () => {
    expect(readableAngle(0, 0, 10, 0)).toBe(0);
    expect(readableAngle(10, 0, 0, 0)).toBeCloseTo(0, 9);
    expect(readableAngle(0, 10, 0, 0)).toBe(-90);
    expect(readableAngle(0, 0, 0, 10)).toBe(-90);
  });
});

describe('라벨 준비', () => {
  it('화면 고정 글·지시선 글·지시선 없는 글, 빈 글은 뺀다', () => {
    const items = prepareTexts([
      text({ text: '제목', screen: [0.1, 0.2], font: { face: 'Arial', pointSize: 18, bold: true, italic: false } }),
      text({ text: '창문', point: [0, 0, 0], textPoint: [50, 0, 0], leaderType: 'view_based', color: [0, 0, 1] }),
      text({ text: '메모', point: [10, 10, 0], font: { face: '', bold: false, italic: true, worldHeight: 20 } }),
      text({ text: '   ', point: [0, 0, 0] }),
      text({ text: '자리 없음' }),
      'broken',
    ]);
    expect(items.map((i) => i.kind)).toEqual(['screen', 'text', 'text']);
    expect(items[0]!).toMatchObject({ screen: [0.1, 0.2], px: 24, bold: true, family: '"Arial", var(--font)' });
    expect(items[1]!).toMatchObject({ at: [50, 0, 0], anchor: [0, 0, 0], color: 'rgb(0, 0, 255)', px: null });
    expect(items[2]!).toMatchObject({ at: [10, 10, 0], anchor: null, worldHeight: 20, italic: true, px: 16 });
  });

  it('치수: 글 자리가 없으면 빼고, 선에 맞춘 글은 방향을 단위로', () => {
    const items = prepareDimensions([dim({}), dim({ textPoint: undefined }), dim({ alignedText: true, direction: [0, 2, 0] })], u({ lengthPrecision: 0 }), 1);
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toBe('1200 mm');
    expect(items[0]!.dir).toBeNull();
    expect(items[1]!.dir).toEqual([0, 1, 0]);
  });
});

describe('거르기', () => {
  const items = [
    ...prepareTexts([
      text({ text: 'a', point: [0, 0, 0], tag: '벽' }),
      text({ text: 'b', point: [0, 0, 0], node: 5 }),
      text({ text: 'c', point: [0, 0, 0], hidden: true }),
      text({ text: 'd', point: [0, 0, 100] }),
      text({ text: 'e', screen: [0, 0] }),
    ]),
    ...prepareDimensions([dim({})]),
  ];

  it('종류·태그·노드·숨긴 형상·단면, 차례는 화면 고정 글 → 치수 → 문자', () => {
    const names = (f: AnnotationFilter): string[] => annotationCandidates(items, f).map((i) => items[i]!.text);
    expect(names(filter())).toEqual(['e', '1200 mm', 'a', 'b', 'd']);
    expect(names(filter({ texts: false }))).toEqual(['1200 mm']);
    expect(names(filter({ dimensions: false, showHidden: true }))).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(names(filter({ hiddenTags: new Set(['벽']) }))).toEqual(['e', '1200 mm', 'b', 'd']);
    const isNodeHidden = vi.fn((n: number) => n === 5);
    expect(names(filter({ isNodeHidden }))).toEqual(['e', '1200 mm', 'a', 'd']);
    // 같은 노드는 한 번만 묻는다
    expect(isNodeHidden.mock.calls.map((c) => c[0]).sort()).toEqual([-1, 5]);
    // z > 50 쪽을 잘라 낸다
    expect(names(filter({ section: { normal: [0, 0, 1], offset: 50 } }))).toEqual(['e', '1200 mm', 'a', 'b']);
  });
});

describe('배치', () => {
  const place = (raw: Record<string, unknown>[], o = {}) => {
    const items = prepareTexts(raw);
    return { items, list: layoutAnnotations(items, annotationCandidates(items, filter()), top, o) };
  };

  it('세계 점을 화면에 투영하고, 화면 밖은 놓지 않는다', () => {
    const { list } = place([text({ text: 'A', point: [100, 50, 0] }), text({ text: 'B', point: [1000, 0, 0] })]);
    expect(list).toHaveLength(1);
    expect(list[0]!.x).toBeCloseTo(500, 6);
    expect(list[0]!.y).toBeCloseTo(250, 6);
    expect(list[0]!.align).toBe('center');
  });

  it('눈 뒤(원근)는 놓지 않는다', () => {
    const persp: CameraState = { target: [0, 0, 0], distance: 100, yaw: 0, pitch: 0, projection: 'perspective', fovY: DEFAULT_FOV };
    const f = frameFor(persp, 800, 600);
    const items = prepareTexts([text({ text: '앞', point: [0, 0, 0] }), text({ text: '뒤', point: [0, -200, 0] })]);
    const list = layoutAnnotations(items, annotationCandidates(items, filter()), f);
    expect(list.map((p) => items[p.item]!.text)).toEqual(['앞']);
  });

  it('지시선 글은 붙는 점의 반대쪽 옆에 둔다', () => {
    const { list } = place([
      text({ text: '오른쪽', point: [0, 0, 0], textPoint: [100, 0, 0], leaderType: 'view_based' }),
      text({ text: '왼쪽', point: [0, 100, 0], textPoint: [-100, 100, 0], leaderType: 'pushpin' }),
      text({ text: '위', point: [0, -200, 0], textPoint: [0, -150, 0], leaderType: 'view_based' }),
    ]);
    expect(list.map((p) => p.align)).toEqual(['right', 'left', 'above']);
    expect(list[0]!.x).toBeCloseTo(500 + LEADER_GAP_PX, 6);
    expect(list[1]!.x).toBeCloseTo(300 - LEADER_GAP_PX, 6);
    expect(list[2]!.y).toBeCloseTo(450 - LEADER_GAP_PX, 6);
  });

  it('화면 고정 글은 화면 비율 자리(왼쪽 위 기준)', () => {
    const { list } = place([text({ text: '제목', screen: [0.25, 0.5] })]);
    expect(list[0]).toMatchObject({ x: 200, y: 300, align: 'topLeft' });
  });

  it('세계 크기 글은 깊이에서 화소로, 너무 작으면 숨기고 크면 자른다', () => {
    const { list } = place([
      text({ text: '큰', point: [0, 0, 0], font: { face: '', bold: false, italic: false, worldHeight: 30 } }),
      text({ text: '작은', point: [100, 100, 0], font: { face: '', bold: false, italic: false, worldHeight: 1 } }),
      text({ text: '아주 큰', point: [-200, -200, 0], font: { face: '', bold: false, italic: false, worldHeight: 5000 } }),
    ], { crowd: 'off' });
    expect(list.map((p) => p.px)).toEqual([30, 512]);
  });

  it('선에 맞춘 치수 글은 화면에서 선 방향으로 돌린다', () => {
    const items = prepareDimensions([dim({ alignedText: true, direction: [0, 1, 0] }), dim({ textPoint: [0, 200, 0] })]);
    const list = layoutAnnotations(items, annotationCandidates(items, filter()), top);
    expect(list[0]!.angle).toBeCloseTo(-90, 6);
    expect(list[1]!.angle).toBe(0);
  });

  it('겹치면 먼저 놓인 것을 남긴다(숨김·흐림·끔), 한도에서 멈춘다', () => {
    const raw = [text({ text: '첫째', point: [0, 0, 0] }), text({ text: '둘째', point: [2, 1, 0] }), text({ text: '멀리', point: [200, 200, 0] })];
    expect(place(raw).list.map((p) => p.item)).toEqual([0, 2]);
    const fade = place(raw, { crowd: 'fade' }).list;
    expect(fade.map((p) => [p.item, p.crowded])).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(place(raw, { crowd: 'off' }).list).toHaveLength(3);
    expect(place(raw, { crowd: 'off', limit: 2 }).list).toHaveLength(2);
  });

  it('겹친 후보가 아주 많아도 한 번 놓은 자리만 남는다', () => {
    const many = Array.from({ length: 20000 }, (_, i) => text({ text: `겹친 글 ${i}`, point: [(i % 3) * 0.5, 0, 0] }));
    expect(place(many).list).toHaveLength(1);
  });

  it('상자는 화면 가장자리 안에 둔다', () => {
    const { list } = place([text({ text: '가장자리 글', point: [399, 0, 0] })]);
    const b = list[0]!.box;
    expect(b.x + b.w).toBeLessThanOrEqual(800 - 2 + 1e-9);
    expect(list[0]!.x).toBeLessThan(799);
  });
});

describe('AnnotationLabels(DOM)', () => {
  const host = () => {
    const labels = document.createElement('div');
    return { labels, set: vi.fn(), invalidate: vi.fn() };
  };

  it('덧그림 층에 두고, 라벨 요소를 다시 쓰며, 닫으면 뺀다', () => {
    const h = host();
    const a = new AnnotationLabels(h);
    expect(h.set).toHaveBeenCalledWith(ANNOTATIONS_KEY, a.painter);
    a.setData(
      [text({ text: '창문', point: [100, 0, 0], color: [1, 1, 1], font: { face: 'Tahoma', pointSize: 9, bold: true, italic: true } })],
      [dim({ text: '<>', value: 1500, textPoint: [0, 100, 0] })],
      'mm',
      u({ lengthPrecision: 0 }),
    );
    expect(h.invalidate).toHaveBeenCalled();
    a.painter(top);
    const els = [...a.el.children] as HTMLDivElement[];
    expect(els).toHaveLength(2);
    // 치수가 먼저(우선순위)
    expect(els[0]!.textContent).toBe('1500 mm');
    expect(els[0]!.className).toBe('anno-label anno-dim');
    expect(els[1]!.textContent).toBe('창문');
    expect(els[1]!.className).toBe('anno-label anno-text is-light');
    expect(els[1]!.style.fontSize).toBe('12px');
    expect(els[1]!.style.fontWeight).toBe('700');
    expect(els[1]!.style.fontStyle).toBe('italic');
    expect(els[1]!.style.transform).toBe('translate(500px, 300px) translate(-50%, -50%)');
    expect(els[0]!.style.pointerEvents).toBe('none');
    // 글을 끄면 남는 요소는 숨기고, 다시 켜면 같은 요소를 쓴다
    a.setFilter({ texts: false });
    a.paint(top);
    expect(a.el.children).toHaveLength(2);
    expect(els[1]!.style.display).toBe('none');
    a.setFilter({ texts: true });
    a.paint(top);
    expect(a.el.children[1]).toBe(els[1]);
    expect(els[1]!.style.display).toBe('');
    expect(a.placements).toHaveLength(2);
    expect(h.labels.contains(a.el)).toBe(true);
    a.dispose();
    expect(h.set).toHaveBeenLastCalledWith(ANNOTATIONS_KEY, null);
    expect(h.labels.contains(a.el)).toBe(false);
  });

  it('라벨이 아주 많아도 한도까지만 요소를 만든다', () => {
    const h = host();
    const a = new AnnotationLabels(h, { crowd: 'off', limit: 50 });
    a.setData(
      Array.from({ length: 2000 }, (_, i) => text({ text: `글 ${i}`, point: [(i % 40) * 10 - 200, Math.floor(i / 40) * 5 - 150, 0] })),
      [],
      'mm',
    );
    a.paint(top);
    expect(a.size).toBe(2000);
    expect(a.el.children).toHaveLength(50);
  });

  it('형상 가림: 카메라가 멈추면 판정해 가린 라벨을 숨기고, 보기 상태가 바뀌면 다시 판정한다', () => {
    vi.useFakeTimers();
    try {
      const h = host();
      const a = new AnnotationLabels(h);
      a.setData([text({ text: '앞', point: [100, 0, 0] }), text({ text: '뒤', point: [-100, 0, 0] }), text({ text: '화면', screen: [0.1, 0.1] })], [], 'mm');
      // 왼쪽(x < 400 화소) 글만 가린다고 판정
      const test = vi.fn((_p: readonly number[], x: number) => x < 400);
      a.setOcclusion(test);
      a.paint(top);
      // 멈추기 전에는 모두 보인다
      expect(a.placements.length).toBe(3);
      vi.advanceTimersByTime(OCCLUSION_SETTLE_MS + 5);
      // 화면 고정 글은 판정하지 않는다
      expect(test).toHaveBeenCalledTimes(2);
      expect(a.occludedCount).toBe(1);
      a.paint(top);
      expect(a.placements.map((p) => (a.el.children[a.placements.indexOf(p)] as HTMLElement).textContent).sort()).toEqual(['앞', '화면']);
      // 같은 카메라로 다시 그려도 다시 판정하지 않는다
      a.paint(top);
      vi.advanceTimersByTime(OCCLUSION_SETTLE_MS + 5);
      expect(test).toHaveBeenCalledTimes(2);
      // 태그 숨김 등 보기 상태가 바뀌면 지우고 다시 판정
      a.setFilter({ texts: true });
      expect(a.occludedCount).toBe(0);
      a.paint(top);
      vi.advanceTimersByTime(OCCLUSION_SETTLE_MS + 5);
      expect(test).toHaveBeenCalledTimes(4);
      // 끄면 가리지 않는다
      a.setOcclusion(null);
      a.paint(top);
      expect(a.placements.length).toBe(3);
      a.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('가림 셈', () => {
  it('시선 방향 깊이로 고른 점이 기준점보다 앞이면 가렸다(깊이 0.5 % 또는 주어진 거리 안은 같은 면)', () => {
    // 위에서 본 평행 투영: 눈은 +z 쪽, 깊이는 z가 작을수록 크다
    const dTop = viewDepthOf(top, [0, 0, 0]);
    expect(viewDepthOf(top, [0, 0, -10])).toBeCloseTo(dTop + 10);
    expect(occludedBy(top, [0, 0, -10], [0, 0, 0])).toBe(true);
    expect(occludedBy(top, [0, 0, 0], [0, 0, -10])).toBe(false);
    // 같은 면 위의 점(아주 조금 앞)
    expect(occludedBy(top, [0, 0, -10], [0, 0, -9.999])).toBe(false);
    expect(occludedBy(top, [0, 0, -10], [0, 0, -5], 6)).toBe(false);
    expect(frameKey(top)).toBe(frameKey(frameFor(TOP, 800, 600)));
    expect(frameKey(top)).not.toBe(frameKey(frameFor({ ...TOP, yaw: 0.1 }, 800, 600)));
  });
});
