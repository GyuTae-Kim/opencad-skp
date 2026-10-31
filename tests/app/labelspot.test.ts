/**
 * 결과 글 자리를 코어 한 번으로(30차 — 코어 0.28.0 placeLabelAmong의 fallback 'topRight'): 29차까지의 앱 계산(가운데가 막힐 때만 코어 0.25.0 차례로 옮기고,
 * 옮긴 자리도 막히면 가운데 그대로)을 이 시험에 그대로 두고, 같은 무작위 입력에서 지금 labelSpot(코어 한 번)과 자리가 모두 같은지 본다.
 * 입력은 측정 도구가 실제로 주는 꼴(settleLabels): 정밀 조준 원·손가락 네모, 툴팁, 3D 보기 위에 뜬 것(측정 띠·장면 탭·뷰 큐브·측정값 칸),
 * 보기 안이면 가장자리 띠와 먼저 놓인 글상자(모형 글·치수 라벨·앞서 놓은 결과 글 0~29개), 결과 글의 화면 선분과 측정 점 표식(soft)이다.
 */
import { describe, expect, it } from 'vitest';
import { LABEL_POINT_R, hitsAvoid, placeLabelAmong, placeMeasureLabel, rectsOverlap, type LabelAvoidAreas, type LabelCircle, type MeasureLabelRect } from 'opencad-viewer3d/measurelabel';
import { edgeBands, labelSpot } from '../../src/app/measure';

type Seg = [number[], number[]] | null;

/** 29차까지의 labelSpot(앱 사본 — 견줄 기준으로만 둔다) */
function labelSpotR29(
  x: number,
  y: number,
  width: number,
  height: number,
  view: { width: number; height: number },
  avoid: LabelAvoidAreas,
  seg?: Seg,
  soft?: readonly LabelCircle[],
  placed: readonly MeasureLabelRect[] = [],
): { x: number; y: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const c = { x: x - width / 2, y: y - height / 2, width, height };
  const hit = hitsAvoid(c, avoid);
  if (!hit && !placed.some((p) => rectsOverlap(c, p))) return null;
  const a = soft?.length ? { ...avoid, soft } : avoid;
  const r = placed.length ? placeLabelAmong([x, y], { width, height }, view, a, placed, seg) : placeMeasureLabel([x, y], { width, height }, view, a, seg);
  if (hitsAvoid(r, avoid) || (!hit && placed.some((p) => rectsOverlap(r, p)))) return null;
  return { x: r.x, y: r.y };
}

/** 같은 씨앗이면 같은 차례(시험이 흔들리지 않게) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Case {
  x: number;
  y: number;
  w: number;
  h: number;
  view: { width: number; height: number };
  avoid: LabelAvoidAreas;
  seg: Seg;
  soft: LabelCircle[];
  placed: MeasureLabelRect[];
}

/** 측정 도구 settleLabels가 주는 꼴의 무작위 입력 하나 */
function makeCase(r: () => number): Case {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const between = (a: number, b: number): number => a + (b - a) * r();
  const view = pick([
    { width: 375, height: 693 },
    { width: 390, height: 664 },
    { width: 1280, height: 708 },
    { width: 960, height: 600 },
  ]);
  const phone = view.width < 500;
  // 결과 글 가운데: 대개 보기 안, 가끔 가장자리에 걸치거나 밖
  const x = r() < 0.85 ? between(0, view.width) : between(-120, view.width + 120);
  const y = r() < 0.85 ? between(0, view.height) : between(-80, view.height + 80);
  const w = Math.round(between(phone ? 44 : 52, phone ? 150 : 190) * 10) / 10;
  const h = pick([17, 18, 19.5, 20, 34]);
  const rects: MeasureLabelRect[] = [];
  const circles: LabelCircle[] = [];
  // 정밀 조준(손가락 기기): 십자선 둘레 원과 손가락 네모(십자선 아래 AIM_OFFSET쯤)
  if (r() < (phone ? 0.5 : 0.1)) {
    const cx = x + between(-90, 90), cy = y + between(-70, 70);
    circles.push({ x: cx, y: cy, r: 24 });
    rects.push({ x: cx + between(-6, 6) - 22, y: cy + between(50, 80) - 22, width: 44, height: 44 });
  }
  // 커서 옆 툴팁
  if (r() < 0.6) rects.push({ x: x + between(-40, 120), y: y + between(-40, 60), width: between(80, 260), height: between(20, 44) });
  // 3D 보기 위에 뜬 것: 아래 측정 띠, 위 장면 탭, 오른쪽 위 뷰 큐브, 측정값 칸
  if (r() < 0.7) rects.push({ x: between(0, 40), y: view.height - between(44, 120), width: view.width - between(0, 80), height: between(40, 56) });
  if (r() < 0.5) rects.push({ x: 8, y: 8, width: between(120, view.width * 0.7), height: 36 });
  if (r() < 0.6) rects.push({ x: view.width - 84, y: 8, width: 76, height: 76 });
  if (r() < 0.3) rects.push({ x: view.width - between(150, 260), y: view.height - between(100, 170), width: between(140, 250), height: 36 });
  // 가끔 보기 거의 전부를 덮는 것(펼친 메뉴·큰 카드) — 비킬 곳이 없는 경우
  if (r() < 0.04) rects.push({ x: between(-20, 20), y: between(-20, 20), width: view.width + 10, height: view.height + 10 });
  const inView = x + w / 2 > 0 && y + h / 2 > 0 && x - w / 2 < view.width && y - h / 2 < view.height;
  // 결과 글의 화면 선분(줄자 두 점·각도기 팔)과 측정 점 표식
  let seg: Seg = null;
  const soft: LabelCircle[] = [];
  if (r() < 0.8) {
    const len = between(4, phone ? 320 : 700), ang = between(0, Math.PI * 2);
    const a = [x - (Math.cos(ang) * len) / 2, y - (Math.sin(ang) * len) / 2];
    const b = [x + (Math.cos(ang) * len) / 2, y + (Math.sin(ang) * len) / 2];
    seg = [a, b];
    if (r() < 0.85) soft.push({ x: a[0]!, y: a[1]!, r: LABEL_POINT_R }, { x: b[0]!, y: b[1]!, r: LABEL_POINT_R });
  }
  // 먼저 놓인 글상자(모형 글·치수 라벨·앞서 놓은 결과 글): 보기 안일 때만, 0~29개
  const placed: MeasureLabelRect[] = [];
  if (inView && r() < 0.6) {
    const n = Math.floor(r() * 30);
    for (let k = 0; k < n; k++) {
      const near = r() < 0.7;
      placed.push({
        x: near ? x + between(-160, 120) : between(0, view.width - 40),
        y: near ? y + between(-60, 50) : between(0, view.height - 16),
        width: between(30, 160),
        height: pick([14, 16, 18, 20]),
      });
    }
    // 가끔 먼저 놓인 글상자가 보기를 빽빽이 덮음 — 먼저 놓인 것만 막고 비킬 곳이 없는 경우
    if (r() < 0.05) placed.push({ x: -10, y: -10, width: view.width + 20, height: view.height + 20 });
  }
  const avoid: LabelAvoidAreas = { rects: inView ? [...rects, ...edgeBands(view.width, view.height)] : rects, circles };
  return { x, y, w, h, view, avoid, seg, soft, placed };
}

describe('결과 글 자리를 코어 한 번으로(30차 — 코어 0.28.0 placeLabelAmong fallback)', () => {
  it('무작위 입력 4,000가지에서 29차 계산과 자리가 모두 같다(옮긴 것·가운데 그대로·먼저 놓인 글상자 때문에 옮긴 것 모두 든다)', () => {
    const r = rng(30);
    const diffs: unknown[] = [];
    const tally = { kept: 0, moved: 0, movedForPlaced: 0, movedWithSoft: 0, blockedKept: 0 };
    for (let i = 0; i < 4000; i++) {
      const c = makeCase(r);
      const want = labelSpotR29(c.x, c.y, c.w, c.h, c.view, c.avoid, c.seg, c.soft, c.placed);
      const got = labelSpot(c.x, c.y, c.w, c.h, c.view, c.avoid, c.seg, c.soft, c.placed);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        if (diffs.length < 3) diffs.push({ i, c, want, got });
        continue;
      }
      const center = { x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h };
      const blocked = hitsAvoid(center, c.avoid) || c.placed.some((p) => rectsOverlap(center, p));
      if (!got) {
        tally.kept++;
        if (blocked) tally.blockedKept++;
        continue;
      }
      tally.moved++;
      if (!hitsAvoid(center, c.avoid)) tally.movedForPlaced++;
      if (c.soft.length) tally.movedWithSoft++;
    }
    expect(diffs).toEqual([]);
    // 고른 입력이 두 길을 모두 지나는지(가운데 그대로·옮김, 먼저 놓인 글상자만 막은 경우, 막혔지만 비킬 곳이 없어 가운데 그대로)
    expect(tally.moved).toBeGreaterThan(800);
    expect(tally.kept).toBeGreaterThan(800);
    expect(tally.movedForPlaced).toBeGreaterThan(100);
    expect(tally.movedWithSoft).toBeGreaterThan(300);
    expect(tally.blockedKept).toBeGreaterThan(100);
  });

  it('크기를 모르면(0) 가운데 그대로(null), 피할 것이 없으면 가운데 그대로', () => {
    const view = { width: 400, height: 300 };
    expect(labelSpot(200, 100, 0, 18, view, { rects: [{ x: 0, y: 0, width: 400, height: 300 }] })).toBeNull();
    expect(labelSpot(200, 100, 60, 0, view, { rects: [] }, null, [], [{ x: 180, y: 95, width: 40, height: 14 }])).toBeNull();
    expect(labelSpot(200, 100, 60, 18, view, {})).toBeNull();
  });
});
