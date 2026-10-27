/**
 * 요소 묶음(1388) 안 곡선·주석 읽기: 곡선·호(1396·1397), 문자(1398), 선형 치수(1399), 반지름·지름 치수(139a),
 * 보조선·보조점(1391·1392), 단면 평면(1393 + 활성 1394). 좌표는 그 묶음의 로컬 인치다.
 * 뜻은 2026-10 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의 형식 지식을 옮긴 것이다(docs/formats/skp.md).
 * 항목 하나를 읽는 함수는 깨진 곳에서 예외를 던질 수 있다 — 부르는 쪽(model.ts)이 항목 단위로 감싼다.
 */

import type { SkpEdges } from './entities';
import type { SkpCurve, SkpDimension, SkpFont, SkpGuide, SkpSectionPlane, SkpText, Vec3 } from './model';
import type { TlvNode, TlvReader } from './tlv';
import { add3, apply4, arrowName, cross3, leaderName, readBase, scale3, sub3, textAlignmentName, unit3, type Warn } from './vffcommon';
import { TAG } from './vfftags';

// ── 붙은 점(치수 점 0x5208) ─────────────────────────────────────────

/** 정점(2)·모서리 가운데(4)에 붙은 점의 연결 */
export interface DimLink {
  kind: 2 | 4;
  /** 정점·모서리 영구 번호 */
  target: number;
  /** 인스턴스 경로(바깥 것부터, 영구 번호) */
  path: number[];
}

interface DimPointRaw {
  stored?: Vec3;
  /** 0x5209 종류(0 화면 글, 1 자유 점, 2 정점, 4 모서리 가운데) */
  kind?: number;
  link?: DimLink;
}

/** holder 안 첫 0x5208 */
function dimPoint(r: TlvReader, holder: TlvNode | undefined, warn: Warn): DimPointRaw | undefined {
  const p = holder && r.firstSafe(holder, TAG.DIM_POINT);
  if (!p) return undefined;
  const out: DimPointRaw = {};
  const stored = r.vec3(r.firstSafe(p, TAG.DIM_POINT_POS));
  if (stored) out.stored = stored;
  const kind = r.i32Exact(r.firstSafe(p, TAG.DIM_POINT_KIND));
  if (kind !== undefined) out.kind = kind;
  const conn = r.firstSafe(p, TAG.DIM_POINT_LINK);
  if ((kind !== 2 && kind !== 4) || !conn) return out;
  let done = false;
  r.eachSafe(conn.start, conn.end, (tag, s, e, clipped) => {
    if (done || clipped || tag !== TAG.DIM_LINK) return;
    const c = { tag, start: s, end: e };
    const ref = r.firstSafe(c, TAG.DIM_LINK_REF);
    if (!ref) return;
    done = true;
    const target = r.uint(ref);
    const path = r.packedIds(r.firstSafe(c, TAG.DIM_LINK_PATH));
    if (target === undefined || !path.ok || path.unsafe) {
      warn('붙은 치수 점의 연결을 풀지 못해 저장된 위치를 씁니다');
      return;
    }
    out.link = { kind, target, path: path.ids };
  });
  return out;
}

/** 붙은 점을 모형 전체에서 풀 때 쓰는 찾기(영구 번호 → 값) */
export interface PointLookups {
  vertex: (pid: number) => Vec3 | undefined;
  edgeMiddle: (pid: number) => Vec3 | undefined;
  instance: (pid: number) => ArrayLike<number> | undefined;
}

/** 붙은 점 위치: 대상 위치를 안쪽 인스턴스부터 경로를 거슬러 옮긴다. 하나라도 못 찾으면 undefined(저장값을 쓴다) */
export function resolveLink(link: DimLink, look: PointLookups): Vec3 | undefined {
  let pos = link.kind === 2 ? look.vertex(link.target) : look.edgeMiddle(link.target);
  if (!pos) return undefined;
  for (let i = link.path.length - 1; i >= 0; i--) {
    const m = look.instance(link.path[i]!);
    if (!m) return undefined;
    pos = apply4(m, pos);
  }
  return pos;
}

/** 주석 읽기에 쓰는 것(묶음 하나) */
export interface AnnotEnv {
  r: TlvReader;
  warn: Warn;
  fonts: Map<number, SkpFont>;
  /** 같은 묶음 안 찾기(경로 없는 붙은 점) */
  local: PointLookups;
  /** 같은 묶음 안 모서리 번호 → 호(반지름 치수) */
  localArc: (edgePid: number) => SkpCurve | undefined;
  /** 같은 묶음에서 풀지 못한 붙은 점: 모형 전체를 읽은 뒤 set으로 바꾼다 */
  defer: (link: DimLink, set: (p: Vec3) => void) => void;
  /** 같은 묶음에서 찾지 못한 반지름 치수의 모서리: 모형 전체에서 찾아 make로 채운다(못 찾으면 치수를 뺀다) */
  deferArc: (edgePid: number, dim: SkpDimension, make: (arc: SkpCurve) => boolean) => void;
}

/** 점 하나: 저장값(없으면 원점)을 두고, 붙은 점이면 지금 풀거나 나중에 풀게 맡긴다 */
function placePoint(env: AnnotEnv, raw: DimPointRaw | undefined, set: (p: Vec3) => void): void {
  set(raw?.stored ?? [0, 0, 0]);
  const link = raw?.link;
  if (!link) return;
  const now = link.path.length === 0 ? resolveLink(link, env.local) : undefined;
  if (now) set(now);
  else env.defer(link, set);
}

// ── 공통 바탕 ─────────────────────────────────────────────────────

interface Common {
  pid?: number;
  layer?: number;
  material?: number;
  flags: number;
}

function common(r: TlvReader, holder: TlvNode): Common {
  const b = readBase(r, holder);
  const out: Common = { flags: b.flags };
  if (b.id !== undefined) out.pid = b.id;
  if (b.layer !== undefined) out.layer = b.layer;
  if (b.material !== undefined) out.material = b.material;
  return out;
}

function fontRef(env: AnnotEnv, n: TlvNode | undefined): number | undefined {
  const id = env.r.uint(n);
  return id !== undefined && env.fonts.has(id) ? id : undefined;
}

// ── 문자 ────────────────────────────────────────────────────────

/** 문자 0x55f0 */
export function readText(env: AnnotEnv, n: TlvNode): SkpText {
  const r = env.r;
  const t: SkpText = { ...common(r, n), text: r.str(r.first(n, TAG.TEXT_STRING)) ?? '' };
  const lt = leaderName(r.i32Exact(r.first(n, TAG.TEXT_LEADER_TYPE)) ?? 0);
  if (lt) t.leaderType = lt;
  const raw = dimPoint(r, r.first(n, TAG.TEXT_POINT), env.warn);
  // 점 종류 0 = 화면 글(붙는 점이 없다)
  if (raw?.kind !== 0) placePoint(env, raw, (p) => (t.point = p));
  if (lt === 'view_based' || lt === 'pushpin') {
    const v = r.vec3(r.first(n, TAG.TEXT_LEADER));
    if (v) t.leader = v;
  } else {
    const x = r.f64Exact(r.first(n, TAG.TEXT_SCREEN_X));
    const y = r.f64Exact(r.first(n, TAG.TEXT_SCREEN_Y));
    if (x !== undefined && y !== undefined) t.screen = [x, y];
  }
  const font = fontRef(env, r.first(n, TAG.TEXT_FONT));
  if (font !== undefined) t.font = font;
  const arrow = arrowName(r.i32Exact(r.first(n, TAG.TEXT_ARROW)));
  if (arrow) t.arrow = arrow;
  return t;
}

// ── 치수 ────────────────────────────────────────────────────────

/** 치수 바탕 0x59d8: 글·글꼴·글 정렬·끝 표시와 07d0 */
function dimBase(env: AnnotEnv, holder: TlvNode, kind: SkpDimension['kind']): SkpDimension {
  const r = env.r;
  const base = r.first(holder, TAG.DIM);
  if (!base) return { flags: 0, kind, text: '' };
  const d: SkpDimension = { ...common(r, base), kind, text: r.str(r.first(base, TAG.DIM_TEXT)) ?? '' };
  const font = fontRef(env, r.first(base, TAG.DIM_FONT));
  if (font !== undefined) d.font = font;
  const aligned = r.flag(r.first(base, TAG.DIM_ALIGNED));
  if (aligned !== undefined) d.alignedText = aligned;
  const arrow = arrowName(r.i32Exact(r.first(base, TAG.DIM_ARROW)));
  if (arrow) d.arrow = arrow;
  return d;
}

/**
 * 선형 치수의 잰 축과 띄움(참조 해석기와 같다): 정렬 0(또는 없음) = 두 점 방향, 1 = x축, 2 = 법선×x축, 그 밖 = 모름.
 * 띄움 = unit(법선 × 축) · 거리(인치).
 */
export function linearLayout(start: Vec3, end: Vec3, normal: Vec3 | undefined, xaxis: Vec3 | undefined, alignment: number | undefined, distance: number | undefined): { axis?: Vec3; offset?: Vec3 } {
  const n = unit3(normal);
  let axis: Vec3 | undefined;
  if (alignment === 1 && xaxis) axis = unit3(xaxis);
  else if (alignment === 2 && xaxis && n) axis = unit3(cross3(n, xaxis));
  else if (alignment === undefined || alignment === 0) axis = unit3(sub3(end, start));
  const out: { axis?: Vec3; offset?: Vec3 } = {};
  if (axis) out.axis = axis;
  if (!axis || !n || distance === undefined || !Number.isFinite(distance)) return out;
  const side = unit3(cross3(n, axis));
  if (side) out.offset = scale3(side, distance);
  return out;
}

/** 선형 치수 0x5bcc */
export function readLinearDim(env: AnnotEnv, n: TlvNode): SkpDimension {
  const r = env.r;
  const d = dimBase(env, n, 'linear');
  const normal = r.vec3(r.first(n, TAG.LINEAR_NORMAL));
  const nu = unit3(normal);
  if (nu) d.normal = nu;
  const xaxis = r.vec3(r.first(n, TAG.LINEAR_XAXIS));
  const alignment = r.i32Exact(r.first(n, TAG.LINEAR_ALIGNMENT));
  const distance = r.f64Exact(r.first(n, TAG.LINEAR_OFFSET));
  const layout = (): void => {
    const l = linearLayout(d.start!, d.end!, normal, xaxis, alignment, distance);
    if (l.axis) d.measureAxis = l.axis;
    else delete d.measureAxis;
    if (l.offset) d.offset = l.offset;
    else delete d.offset;
  };
  placePoint(env, dimPoint(r, r.first(n, TAG.LINEAR_START), env.warn), (p) => {
    d.start = p;
    if (d.end) layout();
  });
  placePoint(env, dimPoint(r, r.first(n, TAG.LINEAR_END), env.warn), (p) => {
    d.end = p;
    layout();
  });
  const pos = textAlignmentName(r.i32Exact(r.first(n, TAG.LINEAR_TEXT_POS)));
  if (pos) d.textAlignment = pos;
  return d;
}

/** 반지름·지름 치수를 호로 채운다(호의 중심·x축·법선이 없으면 false) */
function fillRadial(d: SkpDimension, arc: SkpCurve, angle: number, leader: number | undefined): boolean {
  if (!arc.center || !arc.xaxis || !arc.normal) return false;
  const c = arc.center;
  const xl = Math.hypot(...arc.xaxis);
  const radius = arc.radius || xl;
  const xu = scale3(arc.xaxis, 1 / (xl || 1));
  const yu = cross3(arc.normal, xu);
  const dir = add3(scale3(xu, Math.cos(angle)), scale3(yu, Math.sin(angle)));
  d.center = c;
  d.arcPoint = add3(c, scale3(dir, radius));
  d.attach = add3(c, scale3(dir, radius * (leader ?? 1)));
  const nu = unit3(arc.normal);
  if (nu) d.normal = nu;
  return true;
}

/** 반지름·지름 치수 0x5dc0. 잰 호를 찾지 못하면 undefined(버린다) */
export function readRadialDim(env: AnnotEnv, n: TlvNode): SkpDimension | undefined {
  const r = env.r;
  const diameter = r.flag(r.first(n, TAG.RADIAL_DIAMETER)) ?? false;
  const d = dimBase(env, n, diameter ? 'diameter' : 'radial');
  const edge = r.uint(r.first(n, TAG.RADIAL_EDGE));
  if (edge === undefined) return undefined;
  const a = r.f64Exact(r.first(n, TAG.RADIAL_ANGLE));
  const angle = a !== undefined && Number.isFinite(a) ? a : 0;
  const l = r.f64Exact(r.first(n, TAG.RADIAL_LEADER));
  const leader = l !== undefined && Number.isFinite(l) ? l : undefined;
  const arc = env.localArc(edge);
  if (arc) return fillRadial(d, arc, angle, leader) ? d : undefined;
  env.deferArc(edge, d, (found) => fillRadial(d, found, angle, leader));
  return d;
}

// ── 보조선·보조점 ────────────────────────────────────────────────

/** 끝없는 보조선의 매개변수(저장값 ±1e30) */
const INFINITE = 1e29;

/** 보조선 0x4269. 자료(0x426a)가 64바이트가 아니면 undefined(건너뛴다) */
export function readGuideLine(env: AnnotEnv, n: TlvNode): SkpGuide | undefined {
  const r = env.r;
  const v = r.f64n(r.first(n, TAG.GUIDE_LINE_DATA), 8);
  if (!v || !v.every(Number.isFinite)) return undefined;
  const holder = r.first(n, TAG.GUIDE_BASE) ?? n;
  const c = common(r, holder);
  const p: Vec3 = [v[0]!, v[1]!, v[2]!];
  const dir: Vec3 = [v[3]!, v[4]!, v[5]!];
  const g: SkpGuide = { flags: c.flags, kind: 'line', point: p, direction: dir };
  if (c.pid !== undefined) g.pid = c.pid;
  if (c.layer !== undefined) g.layer = c.layer;
  if (Math.abs(v[6]!) < INFINITE && Math.abs(v[7]!) < INFINITE) {
    g.start = add3(p, scale3(dir, v[6]!));
    g.end = add3(p, scale3(dir, v[7]!));
    g.point = g.start;
  }
  return g;
}

/** 보조점 0x426c. 선으로 보이기(0x426f)면 start = 기준점(0x426e) */
export function readGuidePoint(env: AnnotEnv, n: TlvNode): SkpGuide {
  const r = env.r;
  const holder = r.first(n, TAG.GUIDE_BASE) ?? n;
  const c = common(r, holder);
  const g: SkpGuide = { flags: c.flags, kind: 'point', point: r.vec3(r.first(n, TAG.GUIDE_POINT_POS)) ?? [0, 0, 0] };
  if (c.pid !== undefined) g.pid = c.pid;
  if (c.layer !== undefined) g.layer = c.layer;
  if (r.flag(r.first(n, TAG.GUIDE_POINT_AS_LINE))) {
    const a = r.vec3(r.first(n, TAG.GUIDE_POINT_ANCHOR));
    if (a) g.start = a;
  }
  return g;
}

// ── 단면 평면 ────────────────────────────────────────────────────

/** 단면 평면 0x445c. 평면이 32바이트가 아니면 (0, 0, 1, 0) */
export function readSection(env: AnnotEnv, n: TlvNode, activeId: number | undefined): SkpSectionPlane {
  const r = env.r;
  const c = common(r, n);
  const v = r.f64n(r.first(n, TAG.SECTION_PLANE), 4);
  const s: SkpSectionPlane = {
    flags: c.flags,
    plane: v && v.every(Number.isFinite) ? [v[0]!, v[1]!, v[2]!, v[3]!] : [0, 0, 1, 0],
    name: r.str(r.first(n, TAG.SECTION_NAME)) ?? '',
    symbol: r.str(r.first(n, TAG.SECTION_SYMBOL)) ?? '',
    active: activeId !== undefined && activeId === c.pid,
  };
  if (c.pid !== undefined) s.pid = c.pid;
  if (c.layer !== undefined) s.layer = c.layer;
  return s;
}

// ── 곡선·호 ─────────────────────────────────────────────────────

const ARC_DOUBLES = 16;

interface CurveRaw {
  pid?: number;
  polygon: boolean;
  first?: number;
  last?: number;
  arc?: number[];
}

function readCurveRaw(r: TlvReader, n: TlvNode, arcData: TlvNode | undefined): CurveRaw | undefined {
  const firstN = r.first(n, TAG.CURVE_FIRST);
  const lastN = r.first(n, TAG.CURVE_LAST);
  if ((firstN && firstN.end - firstN.start > 8) || (lastN && lastN.end - lastN.start > 8)) return undefined;
  let arc: number[] | undefined;
  if (arcData) {
    arc = r.f64n(arcData, ARC_DOUBLES);
    if (!arc) return undefined;
  }
  const poly = r.first(n, TAG.CURVE_POLYGON);
  const c: CurveRaw = { polygon: !!poly && poly.end > poly.start && r.b[poly.start] === 1 };
  const pid = r.uint(r.path(n, TAG.ID_BOX, TAG.ID));
  if (pid !== undefined) c.pid = pid;
  const first = r.uint(firstN);
  if (first !== undefined) c.first = first;
  const last = r.uint(lastN);
  if (last !== undefined) c.last = last;
  if (arc) c.arc = arc;
  return c;
}

/** 모서리 차례가 표 안인지(밖이면 객체 목록일 때처럼 그 곡선 읽기가 깨진다) */
function edgeIn(edges: Pick<SkpEdges, 'length'>, e: number): number {
  if (!(e >= 0 && e < edges.length)) throw new RangeError('모서리 번호가 표 밖입니다');
  return e;
}

/**
 * 곡선을 이은 차례(참조 해석기와 같다): 첫 모서리에서 출발해 이어지는 모서리를 하나씩 따라간다.
 * 끝 모서리(같은 묶음의 다른 모서리)가 첫 모서리의 끝 정점만 공유하면 시작 정점 쪽으로 떠난다(닫힌 곡선을 바른 방향으로).
 * 첫 모서리가 곡선의 것이 아니면 오름차순 그대로, 닿지 못한 모서리는 오름차순으로 뒤에 붙인다.
 */
export function chainEdges(members: number[], edges: Pick<SkpEdges, 'length' | 'a' | 'b'>, first: number | undefined, last: number | undefined): number[] {
  if (members.length <= 1) return members;
  if (first === undefined || !members.includes(first)) return members;
  const A = edges.a;
  const B = edges.b;
  const byVertex = new Map<number, number[]>();
  for (const e of members) {
    edgeIn(edges, e);
    (byVertex.get(A[e]!) ?? byVertex.set(A[e]!, []).get(A[e]!)!).push(e);
    (byVertex.get(B[e]!) ?? byVertex.set(B[e]!, []).get(B[e]!)!).push(e);
  }
  const ordered = [first];
  const used = new Set([first]);
  const fa = A[first]!;
  const fb = B[first]!;
  let tip = fb;
  if (last !== undefined && last !== first && last >= 0 && last < edges.length) {
    const touches = (v: number): boolean => A[last] === v || B[last] === v;
    if (touches(fb) && !touches(fa)) tip = fa;
  }
  if (!(byVertex.get(tip) ?? []).some((e) => !used.has(e))) tip = tip === fb ? fa : fb;
  const cursor = new Map<number, number>();
  while (ordered.length < members.length) {
    const cands = byVertex.get(tip) ?? [];
    let pos = cursor.get(tip) ?? 0;
    while (pos < cands.length && used.has(cands[pos]!)) pos++;
    cursor.set(tip, pos);
    if (pos === cands.length) break;
    const next = cands[pos]!;
    used.add(next);
    ordered.push(next);
    tip = A[next] === tip ? B[next]! : A[next]!;
  }
  if (ordered.length < members.length) for (const e of members) if (!used.has(e)) ordered.push(e);
  return ordered;
}

/**
 * 곡선 목록(1396 → 4a38, 1397 → 4c2c → {4a38, 4c2d}) 읽기. 모서리의 곡선 번호(edgeCurve: 모서리 차례 → 곡선 영구 번호)로
 * 곡선마다 모서리를 모아 잇고, 모서리의 curve(곡선 차례)를 채운다. 깨진 곡선은 그것만 버린다.
 */
export function readCurves(
  r: TlvReader,
  lists: TlvNode[],
  edges: SkpEdges,
  edgeIndex: Map<number, number>,
  edgeCurve: Map<number, number>,
  warn: Warn,
  onItem: (start: number) => void,
): SkpCurve[] {
  const raws: CurveRaw[] = [];
  const item = (fn: () => void): void => {
    try {
      fn();
    } catch {
      warn('깨진 곡선을 건너뛰었습니다');
    }
  };
  for (const list of lists) {
    const ok = r.eachSafe(list.start, list.end, (tag, s, e, clipped) => {
      if (clipped) return;
      onItem(s);
      const n = { tag, start: s, end: e };
      item(() => {
        let raw: CurveRaw | undefined;
        if (list.tag === TAG.CURVES && tag === TAG.CURVE) raw = readCurveRaw(r, n, undefined);
        else if (list.tag === TAG.ARC_CURVES && tag === TAG.ARC) {
          const c = r.first(n, TAG.CURVE);
          if (!c) return;
          raw = readCurveRaw(r, c, r.first(n, TAG.ARC_DATA));
        } else return;
        if (raw) raws.push(raw);
        else warn('깨진 곡선을 건너뛰었습니다');
      });
    });
    if (!ok) warn('곡선 목록이 깨져 뒷부분을 읽지 못했습니다');
  }
  if (!raws.length && !edgeCurve.size) return [];
  const byPid = new Map<number, number>();
  raws.forEach((c, i) => {
    if (c.pid !== undefined && !byPid.has(c.pid)) byPid.set(c.pid, i);
  });
  const members = raws.map((): number[] => []);
  let dangling = 0;
  for (const [e, pid] of [...edgeCurve].sort((x, y) => x[0] - y[0])) {
    const c = byPid.get(pid);
    if (c === undefined) dangling++;
    else members[c]!.push(e);
  }
  if (dangling) warn('곡선을 찾지 못한 모서리가 있습니다(곡선 없이 둡니다)');
  return raws.map((raw, i) => {
    const firstEdge = raw.first !== undefined ? edgeIndex.get(raw.first) : undefined;
    const lastEdge = raw.last !== undefined ? edgeIndex.get(raw.last) : undefined;
    const list = chainEdges(members[i]!, edges, firstEdge, lastEdge);
    for (const e of list) edges.curve[edgeIn(edges, e)] = i;
    let kind: SkpCurve['kind'] = 'curve';
    if (raw.polygon) kind = 'polygon';
    else if (raw.arc) {
      const a = list[0]!;
      const z = list[list.length - 1]!;
      const A = edges.a;
      const B = edges.b;
      const closed = list.length >= 3 && (A[a] === A[z] || A[a] === B[z] || B[a] === A[z] || B[a] === B[z]);
      kind = closed ? 'circle' : 'arc';
    }
    const c: SkpCurve = { edges: list, kind };
    if (raw.pid !== undefined) c.pid = raw.pid;
    const v = raw.arc;
    if (v) {
      c.center = [v[0]!, v[1]!, v[2]!];
      c.normal = [v[3]!, v[4]!, v[5]!];
      c.xaxis = [v[7]!, v[8]!, v[9]!];
      c.radius = v[13]!;
      c.startAngle = v[14]!;
      c.endAngle = v[15]!;
    }
    return c;
  });
}
