/**
 * SketchUp 2020 이하(MFC)의 주석 기록: 문자(CText), 선형·반지름 치수(CDimensionLinear·CDimensionRadial),
 * 보조선·보조점(CConstructionLine·CConstructionPoint), 단면 평면(CSectionPlane). 좌표는 든 요소 묶음의 로컬 인치다.
 * 형식 지식은 2026-10 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의 legacy 부분에서 옮긴 것이다(docs/formats/skp.md).
 *
 * 붙는 점(치수 끝·문자 점): 8바이트, 점, 붙은 객체, 10바이트. 모서리에 붙은 점은 x에 모서리 매개변수(0~1)를 적고,
 * 정점에 붙은 점은 그 정점이다. 그 밖의 대상에 붙은 점은 저장된 점을 쓴다.
 * 값은 장면 숨긴 목록이 되가리킬 수 있게 (묶음, 차례)를 묶은 수다. 버린 기록은 -1.
 */

import { FLAG_HIDDEN, FLAG_LOCKED, type SkpDimension, type SkpGuide, type SkpLeaderType, type SkpSectionPlane, type SkpText, type Vec3 } from './model';
import { type MfcReadFn } from './mfcstream';
import { C, cidOf, indexOf, pack, type Collection, type Drawing, type MfcState, type Preamble } from './mfcstate';
import { linearLayout } from './vffannot';
import { add3, arrowName, cross3, scale3, textAlignmentName, unit3 } from './vffcommon';

const LEADERS: readonly SkpLeaderType[] = ['none', 'view_based', 'pushpin'];
/** 끝없는 보조선은 ±1e30을 끝 매개변수로 적는다 */
const UNBOUNDED = 1e20;

/** 숨김·잠김 깃발(SkpModel 꼴: 0x01 숨김, 0x20 잠김) */
export function elementFlags(f: Uint8Array): number {
  return (f[0] ? FLAG_HIDDEN : 0) | (f[5] ? FLAG_LOCKED : 0);
}

interface Common {
  pid?: number;
  layer?: number;
  material?: number;
  flags: number;
}

function common(pre: Preamble, d: Drawing): Common {
  const out: Common = { flags: elementFlags(d.flags) };
  if (pre.pid !== undefined) out.pid = pre.pid;
  if (d.layer >= 0) out.layer = d.layer;
  if (d.material >= 0) out.material = d.material;
  return out;
}

const finite3 = (v: Vec3): boolean => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

export function annotationReaders(st: MfcState): Record<string, MfcReadFn> {
  const s = st.s;

  const point = (c: Collection, i: number): Vec3 => [c.pos[3 * i]!, c.pos[3 * i + 1]!, c.pos[3 * i + 2]!];

  /** 붙는 점 */
  const anchor = (): Vec3 => {
    s.skip(8);
    const p = s.vec3();
    const target = s.readObject();
    const cls = s.lastClass;
    s.skip(10);
    const c = st.top;
    if (typeof target === 'number' && target >= 0 && cidOf(target) === c.cid) {
      const i = indexOf(target);
      if (cls === 'CEdge') {
        const e = c.edges[i];
        if (e && e.a >= 0 && e.b >= 0) {
          const a = point(c, e.a);
          const b = point(c, e.b);
          const t = p[0];
          return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
        }
      } else if (cls === 'CVertex' && 3 * i + 2 < c.pos.length) return point(c, i);
    }
    if (target !== null) st.note('붙은 주석 점의 대상을 찾지 못해 저장된 위치를 씁니다');
    return p;
  };

  /** 치수 머리(CDimension): 앞머리, 그리기 요소, 글, 글꼴, u8 글 정렬, u32 끝 표시 */
  const dimHead = (kind: SkpDimension['kind']): SkpDimension => {
    const pre = st.preamble();
    const d = st.drawing();
    const text = s.cstr();
    const font = s.readObject(C.FONT);
    const aligned = s.u8() !== 0;
    const arrow = arrowName(s.u32());
    const dim: SkpDimension = { ...common(pre, d), kind, text, alignedText: aligned };
    if (typeof font === 'number') dim.font = font;
    if (arrow) dim.arrow = arrow;
    return dim;
  };

  const push = <T>(list: (c: Collection) => T[], item: T): number => {
    const c = st.top;
    const l = list(c);
    l.push(item);
    return pack(c.cid, l.length - 1);
  };

  return {
    /** 보조선: 그리기 요소, 점, 방향, 시작·끝 매개변수, 4바이트 */
    CConstructionLine: () => {
      const pre = st.preamble();
      const d = st.drawing();
      const p = s.vec3();
      const dir = s.vec3();
      const a = s.f64();
      const b = s.f64();
      s.skip(4);
      if (!finite3(p) || !finite3(dir) || Number.isNaN(a) || Number.isNaN(b)) {
        st.note('자료가 깨진 보조선을 건너뛰었습니다');
        return -1;
      }
      const c = common(pre, d);
      const g: SkpGuide = { flags: c.flags, kind: 'line', point: p, direction: dir };
      if (c.pid !== undefined) g.pid = c.pid;
      if (c.layer !== undefined) g.layer = c.layer;
      if (Math.abs(a) < UNBOUNDED && Math.abs(b) < UNBOUNDED) {
        g.start = add3(p, scale3(dir, a));
        g.end = add3(p, scale3(dir, b));
        g.point = g.start;
      }
      return push((x) => x.guides, g);
    },

    /** 보조점: 그리기 요소, 점, 25바이트 */
    CConstructionPoint: () => {
      const pre = st.preamble();
      const d = st.drawing();
      const p = s.vec3();
      s.skip(25);
      const c = common(pre, d);
      const g: SkpGuide = { flags: c.flags, kind: 'point', point: p };
      if (c.pid !== undefined) g.pid = c.pid;
      if (c.layer !== undefined) g.layer = c.layer;
      return push((x) => x.guides, g);
    },

    /** 단면 평면: 그리기 요소, 평면 f64×4, (스키마 3 이상 = 2018+) 이름·기호 */
    CSectionPlane: (slot) => {
      const c = st.top;
      const packed = pack(c.cid, c.sections.length);
      s.values[slot] = packed;
      const pre = st.preamble();
      const d = st.drawing();
      const v = s.doubles(4);
      let name = '';
      let symbol = '';
      if (st.schema('CSectionPlane') >= 3) {
        name = s.cstr();
        symbol = s.cstr();
      }
      const co = common(pre, d);
      const sp: SkpSectionPlane = {
        flags: co.flags,
        plane: v.every(Number.isFinite) ? [v[0]!, v[1]!, v[2]!, v[3]!] : [0, 0, 1, 0],
        name,
        symbol,
        active: false,
      };
      if (co.pid !== undefined) sp.pid = co.pid;
      if (co.layer !== undefined) sp.layer = co.layer;
      c.sections.push(sp);
      return packed;
    },

    /** 문자: 그리기 요소(재질 = 글 색), 글꼴, 화면 x·y, 붙는 점, 지시선 벡터, 24바이트, u32 지시선 종류, 11바이트, 글, 5바이트 */
    CText: () => {
      const pre = st.preamble();
      const d = st.drawing();
      const font = s.readObject(C.FONT);
      const sx = s.f64();
      const sy = s.f64();
      const p = anchor();
      const leader = s.vec3();
      s.skip(24);
      const lt = LEADERS[s.u32()] ?? 'none';
      s.skip(11);
      const text = s.cstr();
      s.skip(5);
      const t: SkpText = { ...common(pre, d), text, leaderType: lt };
      if (typeof font === 'number') t.font = font;
      if (lt === 'none') {
        if (Number.isFinite(sx) && Number.isFinite(sy)) t.screen = [sx, sy];
      } else {
        t.point = p;
        if (finite3(leader)) t.leader = leader;
      }
      return push((x) => x.texts, t);
    },

    /** 선형 치수: 머리, 붙는 점 둘, 법선·x축 f64×3, i32 정렬, f64 위치 x·y(y = 치수선 거리), i32 글 자리(2021+ 23503..23508 차례) */
    CDimensionLinear: () => {
      const dim = dimHead('linear');
      const start = anchor();
      const end = anchor();
      const normal = s.vec3();
      const xaxis = s.vec3();
      const alignment = s.i32();
      s.f64();
      const distance = s.f64();
      const pos = textAlignmentName(s.i32());
      dim.start = start;
      dim.end = end;
      const n = unit3(normal);
      if (n) dim.normal = n;
      const l = linearLayout(start, end, normal, xaxis, alignment, distance);
      if (l.axis) dim.measureAxis = l.axis;
      if (l.offset) dim.offset = l.offset;
      if (pos) dim.textAlignment = pos;
      return push((x) => x.dimensions, dim);
    },

    /** 반지름·지름 치수: 머리, 잰 호(CArcCurve 또는 그 모서리), f64 지시선 각, f64 글 거리(반지름 배), u8 지름 */
    CDimensionRadial: () => {
      const dim = dimHead('radial');
      const target = s.readObject();
      const cls = s.lastClass;
      const angle = s.f64();
      const distance = s.f64();
      if (s.u8()) dim.kind = 'diameter';
      const c = st.top;
      let curve = -1;
      if (typeof target === 'number' && target >= 0 && cidOf(target) === c.cid) {
        if (cls === 'CArcCurve') curve = indexOf(target);
        else if (cls === 'CEdge') curve = c.edgeCurve[indexOf(target)] ?? -1;
      }
      const arc = c.curves[curve]?.arc;
      if (!arc || !Number.isFinite(angle)) {
        st.note('잰 호를 찾지 못한 반지름·지름 치수를 건너뛰었습니다');
        return -1;
      }
      // 호 위 점 = 중심 + cos·x축 + sin·(법선 × x축) — x축 길이가 반지름이다
      const yaxis = cross3(arc.normal, arc.xaxis);
      const dir = add3(scale3(arc.xaxis, Math.cos(angle)), scale3(yaxis, Math.sin(angle)));
      dim.center = arc.center;
      dim.arcPoint = add3(arc.center, dir);
      dim.attach = add3(arc.center, scale3(dir, Number.isFinite(distance) ? distance : 1));
      const n = unit3(arc.normal);
      if (n) dim.normal = n;
      return push((x) => x.dimensions, dim);
    },
  };
}
