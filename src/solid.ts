/**
 * 정의(요소 묶음) 하나가 닫힌 입체인지와 그 부피(SketchUp 엔티티 정보의 "입체 그룹·입체 컴포넌트"와 부피).
 *
 * 면 고리는 모서리 쓰임(EdgeUse) 차례 그대로라(해석기가 뒤집힘이면 모서리 끝 정점부터 적는다) 고리 k번째 쓰임은
 * loop[k] → loop[k + 1] 방향이다. 그래서
 *   - 닫힌 껍질: 면 고리가 쓰는 모서리마다 쓰임이 꼭 둘(구멍·열린 가장자리·세 면이 만나는 모서리가 없다)
 *   - 방향이 맞음: 그 두 쓰임이 서로 반대 방향(면 앞뒤가 모두 바깥 또는 모두 안쪽)
 * 부피는 발산 정리로 V = |Σ면 (Σ고리 Σ p_k × p_{k+1}) · q_f| / 6(q_f는 그 면 위 한 점, 좌표는 첫 정점 기준으로 빼서 큰 좌표에서도 정밀하게).
 * 방향이 맞을 때만 뜻이 있다.
 */
import { FLAG_HIDDEN, type SkpEntities } from './model';

export interface SolidInfo {
  /**
   * 단면 채우기용 닫힘: 면이 넷 이상이고 숨긴 면이 없으며 면 고리가 쓰는 모서리마다 쓰임이 꼭 둘(방향은 따지지 않는다 —
   * 채우기는 홀짝으로 세므로 뒤집힌 면이 섞여도 된다)
   */
  closed: boolean;
  /**
   * SketchUp 입체(닫힘 + 모든 쓰임의 방향이 맞음 + 면이 없는 떠 있는 모서리·안쪽 그룹·컴포넌트가 없음)면 부피(로컬 단위³, 모형은 인치³).
   * 아니면 없다. 숨긴 면도 입체의 면으로 센다(SketchUp과 같게)
   */
  volume?: number;
}

const NOT_CLOSED: SolidInfo = { closed: false };

/** 요소 묶음 → 닫힘·부피. 고리의 모서리 번호(loopEdges)가 없으면 정점 쌍으로 모서리를 가린다 */
export function solidInfo(ents: SkpEntities): SolidInfo {
  const faces = ents.faces;
  if (faces.length < 4) return NOT_CLOSED;
  const p = ents.points;
  const nPts = p.length / 3;
  const edges = ents.edges;
  // 모서리마다 쓰임 수와 방향 합(+1 = a → b, −1 = b → a)
  const useCount = new Uint8Array(edges.length);
  const dirSum = new Int8Array(edges.length);
  // 고리의 모서리 번호가 없으면 정점 쌍 열쇠(작은 번호 × 정점 수 + 큰 번호)
  let pairs: Map<number, { n: number; d: number }> | null = null;
  let hidden = false;
  const use = (a: number, b: number, ei: number | undefined): boolean => {
    if (a === b || !(a >= 0 && a < nPts && b >= 0 && b < nPts)) return false;
    if (ei !== undefined) {
      const e = edges[ei];
      if (!e) return false;
      const fwd = e.a === a && e.b === b;
      if (!fwd && !(e.a === b && e.b === a)) return false;
      if (useCount[ei]! >= 2) return false;
      useCount[ei]!++;
      dirSum[ei]! += fwd ? 1 : -1;
      return true;
    }
    pairs ??= new Map();
    const key = a < b ? a * nPts + b : b * nPts + a;
    let r = pairs.get(key);
    if (!r) pairs.set(key, (r = { n: 0, d: 0 }));
    if (r.n >= 2) return false;
    r.n++;
    r.d += a < b ? 1 : -1;
    return true;
  };
  for (const f of faces) {
    if (f.flags & FLAG_HIDDEN) hidden = true;
    const le = f.loopEdges && f.loopEdges.length === f.loops.length ? f.loopEdges : null;
    for (let li = 0; li < f.loops.length; li++) {
      const loop = f.loops[li]!;
      const via = le && le[li]!.length === loop.length ? le[li]! : null;
      if (loop.length < 3) return NOT_CLOSED;
      for (let k = 0; k < loop.length; k++) if (!use(loop[k]!, loop[(k + 1) % loop.length]!, via ? via[k] : undefined)) return NOT_CLOSED;
    }
  }
  // 쓰인 모서리는 모두 쓰임이 둘이어야 한다
  let consistent = true;
  let stray = false;
  const pairMap = pairs as Map<number, { n: number; d: number }> | null;
  for (let i = 0; i < edges.length; i++) {
    const n = useCount[i]!;
    if (n === 0) {
      // 고리의 모서리 번호가 없는 면이 쓴 모서리는 정점 쌍으로 센다
      const e = edges[i]!;
      if (!pairMap?.has(e.a < e.b ? e.a * nPts + e.b : e.b * nPts + e.a)) stray = true;
      continue;
    }
    if (n !== 2) return NOT_CLOSED;
    if (dirSum[i] !== 0) consistent = false;
  }
  if (pairMap)
    for (const r of pairMap.values()) {
      if (r.n !== 2) return NOT_CLOSED;
      if (r.d !== 0) consistent = false;
    }
  const out: SolidInfo = { closed: !hidden };
  if (!consistent || stray || ents.instances.length) return out;
  const ox = p[0]!;
  const oy = p[1]!;
  const oz = p[2]!;
  let v = 0;
  for (const f of faces) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const loop of f.loops) {
      for (let k = 0; k < loop.length; k++) {
        const i = 3 * loop[k]!;
        const j = 3 * loop[(k + 1) % loop.length]!;
        const px = p[i]! - ox;
        const py = p[i + 1]! - oy;
        const pz = p[i + 2]! - oz;
        const qx = p[j]! - ox;
        const qy = p[j + 1]! - oy;
        const qz = p[j + 2]! - oz;
        ax += py * qz - pz * qy;
        ay += pz * qx - px * qz;
        az += px * qy - py * qx;
      }
    }
    const q = 3 * f.loops[0]![0]!;
    v += ax * (p[q]! - ox) + ay * (p[q + 1]! - oy) + az * (p[q + 2]! - oz);
  }
  const volume = Math.abs(v) / 6;
  if (Number.isFinite(volume)) out.volume = volume;
  return out;
}
