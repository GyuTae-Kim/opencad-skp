/**
 * 큰 모형의 법선·무늬 좌표 줄이기(28차 — 코어 0.26.0 작은 정점 속성 배열, 해석 워커에서 장면을 넘기기 전에).
 *
 * 나눠 올리는 큰 모형(app/protocol.ts isBigScene — 화면이 나눠 올리고 27차 놓기를 쓰는 기준과 같다)이면
 *   - 그물 법선(Float32 정점 3값, 12바이트)을 Int8 정점 4값(4바이트 — packNormals, 방향 오차 0.4° 안)으로,
 *   - 앞·뒷면 무늬 좌표(Float32 정점 2값, 8바이트)를 Int16(4바이트)과 축척·이동(packUvs → uvTransform·backUvTransform)으로 줄인다.
 * 옮기는 버퍼·화면 JS 메모리·GPU 버퍼가 모두 작아진다. 작은 모형은 줄이지 않는다(0.25.0과 같은 Float32 배열).
 *
 * 무늬 좌표는 그물마다 u·v 범위에 맞춰 65,535단계로 나누므로 범위가 넓은 그물(넓은 땅에 작은 무늬를 수백 번 되풀이 등)은 단계가 거칠다.
 * 그래서 줄인 값을 다시 펴서(코어 셰이더와 같은 계산) 원래 값과 견주고, 가장 큰 차가 그 무늬를 올리는 크기(긴 변 TEXTURE_LIMIT 안 — 기기 한도로 더
 * 줄면 오차 화소는 더 작다)의 화소로 UV_PACK_MAX_TEXEL을 넘으면 Float32 그대로 둔다(그 그물에는 uvTransform을 달지 않는다).
 *
 * 29차: 화면은 줄인 배열을 놓지 않고 장면에 둔다(app/release.ts — 그래픽 문맥을 되찾으면 코어가 그대로 다시 올린다. 27·28차는 놓았다가 파일을 다시 풀어 같은 꼴로 줬다).
 */
import { packNormals, packUvs, unpackValue } from 'opencad-viewer3d/attribs';
import { TEXTURE_LIMIT, fitSize } from 'opencad-viewer3d/texture';
import type { Mesh3d, Scene3d, Texture3d, UvTransform } from 'opencad-viewer3d/types';
import { isBigScene } from '../app/protocol';

/** 무늬 좌표를 Int16으로 줄였을 때 다시 편 값의 가장 큰 차(무늬 화소)가 이보다 크면 Float32로 둔다 */
export const UV_PACK_MAX_TEXEL = 1 / 16;

/** 줄인 결과(ParseResult.packed — 화면이 문맥 복구 때 같은 꼴로 다시 받으려고 본다) */
export interface PackStats {
  /** Int8로 줄인 법선 배열 수 */
  normals: number;
  /** Int16으로 줄인 무늬 좌표 배열 수(앞·뒷면) */
  uvs: number;
  /** 오차가 커서 Float32로 둔 무늬 좌표 배열 수 */
  floatUvs: number;
  /** 법선·무늬 좌표 바이트(줄이기 전 → 뒤) */
  before: number;
  after: number;
  /** 걸린 시간(ms) */
  ms: number;
}

/** 무늬 한 장을 GPU에 올리는 크기의 위 한도(긴 변 TEXTURE_LIMIT 안, 크기를 모르면 한도) */
export function textureTexels(t: Pick<Texture3d, 'width' | 'height'> | undefined): [number, number] {
  const w = t?.width ?? 0, h = t?.height ?? 0;
  if (!(w > 0 && h > 0)) return [TEXTURE_LIMIT, TEXTURE_LIMIT];
  const f = fitSize(w, h, TEXTURE_LIMIT);
  return f ? [f.width, f.height] : [w, h];
}

/** 정점마다 무늬 좌표 값 수(원근 무늬 3, 아니면 2 — 코어와 같이 길이로 가린다) */
const uvStride = (a: ArrayLike<number>, nv: number): 2 | 3 => (nv > 0 && a.length >= nv * 3 ? 3 : 2);

/**
 * 무늬 좌표를 Int16과 변환으로 줄이고, 줄인 값을 코어 셰이더처럼 다시 펴서 원래 u·v(원근 무늬는 q로 나눈 값)와의 가장 큰 차를 무늬 화소(size)로 잰다.
 * 원래 값이 수가 아닌 정점은 견주지 않는다. 다시 편 값이 수가 아니면(원근 무늬의 q가 0으로 줄어듦) 오차는 Infinity
 */
export function packUvsChecked(uvs: ArrayLike<number>, nv: number, size: readonly [number, number]): { uvs: Int16Array; transform: UvTransform; errTexel: number } {
  const p = packUvs(uvs, nv, 'int16');
  const out = p.uvs as Int16Array;
  const [su, sv, ou, ov] = p.transform;
  const k = uvStride(uvs, nv);
  let err = 0;
  for (let i = 0; i < nv; i++) {
    const q = k === 3 ? uvs[i * 3 + 2]! : 1;
    const qn = k === 3 ? unpackValue(out[i * 3 + 2]!, 'short') : 1;
    for (let c = 0; c < 2; c++) {
      const u = uvs[i * k + c]! / q;
      if (!Number.isFinite(u)) continue;
      const s = unpackValue(out[i * k + c]!, 'short');
      const back = c === 0 ? (su * s + ou * qn) / qn : (sv * s + ov * qn) / qn;
      const d = Number.isFinite(back) ? Math.abs(back - u) * size[c]! : Infinity;
      if (d > err) err = d;
    }
  }
  return { uvs: out, transform: p.transform, errTexel: err };
}

/** 무늬 좌표 하나를 줄일지: 다시 편 오차가 한도 안이면 줄인 배열과 변환, 아니면 null(Float32로 둔다) */
export function packMeshUvs(uvs: ArrayLike<number>, nv: number, size: readonly [number, number], maxTexel = UV_PACK_MAX_TEXEL): { uvs: Int16Array; transform: UvTransform } | null {
  const p = packUvsChecked(uvs, nv, size);
  return p.errTexel <= maxTexel ? { uvs: p.uvs, transform: p.transform } : null;
}

/** 법선을 Int8 정점 4값으로(코어 README가 권하는 꼴 — 한 정점 4바이트라 GPU 백엔드가 줄을 다시 맞추지 않는다) */
export function packMeshNormals(n: ArrayLike<number>): Int8Array {
  return packNormals(n, 'int8', 4) as Int8Array;
}

const isFloat = (a: unknown): a is Float32Array => a instanceof Float32Array || Object.prototype.toString.call(a) === '[object Float32Array]';

/**
 * 장면의 그물 법선·무늬 좌표를 줄인다(제자리 — 그물 객체의 배열을 바꾸고 줄인 무늬 좌표에는 uvTransform·backUvTransform을 단다).
 * Float32 배열만 줄이고, 같은 배열을 여러 그물이 함께 쓰면 한 번만 줄여 함께 쓴다(변환도 같다). 무늬 크기는 그물이 쓰는 무늬(앞 texture·뒤 backTexture)
 */
export function packSceneAttribs(scene: Pick<Scene3d, 'meshes' | 'textures'>, maxTexel = UV_PACK_MAX_TEXEL): PackStats {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const st: PackStats = { normals: 0, uvs: 0, floatUvs: 0, before: 0, after: 0, ms: 0 };
  const tex = new Map((scene.textures ?? []).map((t) => [t.id, t] as const));
  const normalsDone = new Map<Float32Array, Int8Array>();
  const uvsDone = new Map<Float32Array, { uvs: Int16Array; transform: UvTransform } | null>();
  const uvsOf = (a: Float32Array, nv: number, texture: string | undefined): { uvs: Int16Array; transform: UvTransform } | null => {
    if (uvsDone.has(a)) return uvsDone.get(a)!;
    const p = packMeshUvs(a, nv, textureTexels(texture !== undefined ? tex.get(texture) : undefined), maxTexel);
    uvsDone.set(a, p);
    st.before += a.byteLength;
    if (p) {
      st.uvs++;
      st.after += p.uvs.byteLength;
    } else {
      st.floatUvs++;
      st.after += a.byteLength;
    }
    return p;
  };
  for (const m of scene.meshes as Mesh3d[]) {
    const nv = m.positions.length / 3;
    if (!(nv > 0)) continue;
    const n = m.normals;
    if (isFloat(n) && n.length >= nv * 3) {
      let p = normalsDone.get(n);
      if (!p) {
        p = packMeshNormals(n);
        normalsDone.set(n, p);
        st.normals++;
        st.before += n.byteLength;
        st.after += p.byteLength;
      }
      m.normals = p;
    }
    if (isFloat(m.uvs) && !m.uvTransform) {
      const p = uvsOf(m.uvs, nv, m.texture);
      if (p) {
        m.uvs = p.uvs;
        m.uvTransform = p.transform;
      }
    }
    if (isFloat(m.backUvs) && !m.backUvTransform) {
      const p = uvsOf(m.backUvs, nv, m.backTexture ?? m.texture);
      if (p) {
        m.backUvs = p.uvs;
        m.backUvTransform = p.transform;
      }
    }
  }
  st.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return st;
}

/** 워커가 장면을 넘기기 전에: 큰 모형(isBigScene — 화면이 나눠 올리는 기준)이면 줄이고 그 셈, 아니면 그대로 두고 undefined */
export function packBigScene(scene: Pick<Scene3d, 'meshes' | 'lines' | 'textures'>): PackStats | undefined {
  return isBigScene({ scene }) ? packSceneAttribs(scene) : undefined;
}
