// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFrame, type CameraState, type ViewFrame } from 'opencad-viewer3d/camera';
import { AnnotationMarks, KIND_CLOSED, KIND_DOT, KIND_OPEN, KIND_OVERSHOOT, KIND_SLASH, MARK_PX, markPath, screenMark, type MarkVisibility } from '../../src/app/dimmarks';
import { readAnnotationMarks } from '../../src/app/doc';
import type { SkpAnnotationMarks } from '../../src/meta';

const W = 200;
const FOV = (40 * Math.PI) / 180;
/** 위에서 본 평행 투영: 화면 1화소 = 세계 1(distance로 배율을 바꾼다), 화면 (100 + X, 100 − Y) */
const top = (zoom = 1): ViewFrame => {
  const c: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2) / zoom, yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };
  return computeFrame(c, W, W, { center: [0, 0, 0], radius: 1000 });
};

/** 치수 하나: A(−40,0)·B(40,0) 닫힌 화살 둘(바깥쪽), 연장선 넘침 둘(−Y로) */
const DIM = (node = -1): SkpAnnotationMarks => ({
  geom: Float64Array.from([
    -40, 0, 0, 0, -1, 0, 0, 1, 0,
    40, 0, 0, 0, -1, 0, 0, 1, 0,
    -40, 0, 0, -1, 0, 0, 0, 1, 0,
    40, 0, 0, 1, 0, 0, 0, 1, 0,
  ]),
  kind: Uint8Array.from([KIND_OVERSHOOT, KIND_OVERSHOOT, KIND_CLOSED, KIND_CLOSED]),
  span: Float64Array.from([80, 80, 80, 80]),
  node: Int32Array.from([node, node, node, node]),
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('끝 표시를 화면 크기로(순수 함수)', () => {
  it('확대·축소해도 표시는 같은 화소 크기, 짧게 보이는 선은 줄인다', () => {
    const a = screenMark(top(1), KIND_CLOSED, [40, 0, 0], [1, 0, 0], [0, 1, 0], 80)!;
    const b = screenMark(top(4), KIND_CLOSED, [20, 0, 0], [1, 0, 0], [0, 1, 0], 80)!;
    expect(a.size).toBe(MARK_PX);
    expect(b.size).toBe(MARK_PX);
    expect(a.x).toBeCloseTo(140, 6);
    expect(b.x).toBeCloseTo(180, 6);
    // 화면 1화소 = 세계 1: 20화소짜리 치수는 3화소, 8화소면 그리지 않는다(1.5화소 문턱)
    expect(screenMark(top(1), KIND_CLOSED, [10, 0, 0], [1, 0, 0], [0, 1, 0], 20)!.size).toBeCloseTo(3, 9);
    expect(screenMark(top(1), KIND_CLOSED, [5, 0, 0], [1, 0, 0], [0, 1, 0], 8)).toBeNull();
    // 화면 밖·선이 눈 쪽이면 없다
    expect(screenMark(top(1), KIND_CLOSED, [400, 0, 0], [1, 0, 0], [0, 1, 0], 80)).toBeNull();
    expect(screenMark(top(1), KIND_CLOSED, [0, 0, 0], [0, 0, 1], [0, 1, 0], 80)).toBeNull();
  });

  it('바깥 방향·기울 쪽은 화면에 비친 방향(화면 y는 아래로)', () => {
    const m = screenMark(top(), KIND_SLASH, [40, 0, 0], [1, 0, 0], [0, 1, 0], 80)!;
    expect(m.dx).toBeCloseTo(1, 9);
    expect(m.dy).toBeCloseTo(0, 9);
    expect(m.nx).toBeCloseTo(0, 9);
    expect(m.ny).toBeCloseTo(-1, 9);
  });

  it('꼴마다 경로: 닫힌 화살·점은 채움, 열린 화살·빗금·넘침은 선', () => {
    const base = { x: 100, y: 100, dx: 1, dy: 0, nx: 0, ny: -1, size: 9 };
    const closed = markPath({ ...base, kind: KIND_CLOSED });
    expect(closed.stroke).toBe('');
    expect(closed.fill).toMatch(/^M100 100L90\.\d+ 96\.\d+L90\.\d+ 103\.\d+Z$/);
    expect(markPath({ ...base, kind: KIND_OPEN }).stroke).toMatch(/^M90\.\d+ 96\.\d+L100 100L90\.\d+ 103\.\d+$/);
    expect(markPath({ ...base, kind: KIND_DOT }).fill).toContain('a2.3 2.3');
    // 빗금은 선과 45°("/"): 오른쪽 위로
    expect(markPath({ ...base, kind: KIND_SLASH }).stroke).toBe('M96.8 103.2L103.2 96.8');
    // 넘침은 바깥 방향으로 표시 크기의 0.6
    expect(markPath({ ...base, kind: KIND_OVERSHOOT }).stroke).toBe('M100 100L105.4 100');
  });
});

describe('끝 표시 덧그림(AnnotationMarks)', () => {
  const rig = (vis: Partial<MarkVisibility> = {}) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(svg);
    const painters = new Map<string, ((f: ViewFrame) => void) | null>();
    const host = { svg, set: (k: string, p: ((f: ViewFrame) => void) | null) => painters.set(k, p), invalidate: vi.fn() };
    const marks = new AnnotationMarks(host as never);
    marks.setData({ 'skp-dims-0': DIM(), 'skp-dims-1': DIM(3) });
    const v: MarkVisibility = { lineVisible: () => true, nodeHidden: () => false, color: () => 'rgb(10, 20, 30)', sections: [], ...vis };
    marks.setVisibility(v);
    return { svg, marks, host };
  };

  it('보이는 묶음의 표시를 색마다 경로로 그린다(그림 저장이 합치는 덧그림 SVG 맨 아래)', () => {
    const { svg, marks } = rig();
    expect(marks.size).toBe(8);
    marks.paint(top());
    expect(marks.drawnCount).toBe(8);
    const g = svg.querySelector('g.anno-marks')!;
    expect(svg.firstChild).toBe(g);
    const paths = [...g.querySelectorAll('path')];
    expect(paths.map((p) => p.getAttribute('fill') === 'none')).toEqual([true, false]);
    expect(paths[0]!.getAttribute('stroke')).toBe('rgb(10, 20, 30)');
  });

  it('숨긴 묶음·숨긴 노드·단면에 잘린 쪽(그 묶음을 자르는 단면만)은 그리지 않는다', () => {
    const a = rig({ lineVisible: (id) => id !== 'skp-dims-0' });
    a.marks.paint(top());
    expect(a.marks.drawnCount).toBe(4);
    a.marks.setVisibility({ lineVisible: () => true, nodeHidden: (n) => n === 3, color: () => '#000', sections: [] });
    a.marks.paint(top());
    expect(a.marks.drawnCount).toBe(4);
    // x > 0 쪽을 자르는 단면: 모든 묶음이면 B 쪽 표시(넘침·화살) 둘씩 빠진다, 한 묶음만 자르면 그 묶음만
    a.marks.setVisibility({ lineVisible: () => true, nodeHidden: () => false, color: () => '#000', sections: [{ normal: [1, 0, 0], offset: 0 }] });
    a.marks.paint(top());
    expect(a.marks.drawnCount).toBe(4);
    a.marks.setVisibility({ lineVisible: () => true, nodeHidden: () => false, color: () => '#000', sections: [{ normal: [1, 0, 0], offset: 0, items: ['skp-dims-1'] }] });
    a.marks.paint(top());
    expect(a.marks.drawnCount).toBe(6);
  });

  it('카메라가 멈추면 가림 판정으로 형상 뒤 표시를 숨긴다', async () => {
    vi.useFakeTimers();
    try {
      const { marks } = rig();
      const test = vi.fn((p: readonly number[]) => p[0]! > 0);
      marks.setOcclusion(test);
      const f = top();
      marks.paint(f);
      expect(marks.drawnCount).toBe(8);
      await vi.advanceTimersByTimeAsync(400);
      expect(test).toHaveBeenCalled();
      marks.paint(f);
      expect(marks.occludedCount).toBe(4);
      expect(marks.drawnCount).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('데이터·보기 상태가 없으면 비우고, dispose하면 층에서 뺀다', () => {
    const { svg, marks, host } = rig();
    marks.paint(top());
    marks.setVisibility(null);
    marks.paint(top());
    expect(svg.querySelector('g.anno-marks')!.childElementCount).toBe(0);
    marks.dispose();
    expect(svg.querySelector('g.anno-marks')).toBeNull();
    expect(host.invalidate).toHaveBeenCalled();
  });
});

describe('meta.annotationMarks 읽기', () => {
  it('치수·지시선 묶음이고 배열 꼴·길이가 맞는 칸만', () => {
    const kinds = new Map([
      ['skp-dims-0', 'dimensions' as const],
      ['skp-leaders-1', 'leaders' as const],
      ['skp-guides-2', 'guides' as const],
    ]);
    const bad = { ...DIM(), span: new Float64Array(3) };
    const out = readAnnotationMarks({ 'skp-dims-0': DIM(), 'skp-leaders-1': bad, 'skp-guides-2': DIM(), other: DIM() }, kinds);
    expect(Object.keys(out)).toEqual(['skp-dims-0']);
    expect(readAnnotationMarks(null, kinds)).toEqual({});
    expect(readAnnotationMarks({ 'skp-dims-0': { geom: [1, 2, 3] } }, kinds)).toEqual({});
  });
});
