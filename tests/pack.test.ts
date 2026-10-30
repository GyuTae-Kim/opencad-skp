/**
 * 큰 모형의 법선·무늬 좌표 줄이기(src/worker/pack.ts — 28차, 코어 0.26.0)와 문맥 복구 때 같은 꼴로 다시 주기(src/worker/restore.ts):
 * 큰 모형만 줄이고, 법선은 Int8 정점 4값, 무늬 좌표는 Int16과 변환(다시 편 오차가 무늬 화소로 한도를 넘으면 Float32), 같은 배열은 한 번만,
 * 다시 푼 같은 파일을 같은 꼴·같은 변환으로 다시 줄이고 변환이 다르면 주지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { unpackValue } from 'opencad-viewer3d/attribs';
import { TEXTURE_LIMIT } from 'opencad-viewer3d/texture';
import type { Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import { skpFileToScene } from '../src/index';
import { INCREMENTAL_ITEMS, type ArraysWant } from '../src/app/protocol';
import {
  UV_PACK_MAX_TEXEL,
  packBigScene,
  packMeshNormals,
  packMeshUvs,
  packSceneAttribs,
  packUvsChecked,
  restoreUvs,
  sameUvTransform,
  textureTexels,
} from '../src/worker/pack';
import { pickRestoreMeshes } from '../src/worker/restore';

/** 정점 n개 격자(u·v 범위 0~span) — 위치·법선·무늬 좌표 */
function grid(id: string, n: number, span: number, extra: Partial<Mesh3d> = {}): Mesh3d {
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    positions.set([i, (i * 7) % 13, 0], i * 3);
    const a = t * Math.PI;
    normals.set([Math.cos(a), Math.sin(a), 0.3], i * 3);
    uvs.set([t * span, ((i * 37) % n) / n * span * 0.5], i * 2);
  }
  return { id, positions, normals, uvs, color: [1, 1, 1, 1], texture: 't', ...extra };
}

/** 줄인 무늬 좌표를 변환으로 펴서 원래 값과의 가장 큰 차(uv 단위) */
function uvError(orig: Float32Array, packed: Int16Array, t: readonly number[]): number {
  let e = 0;
  for (let i = 0; i < orig.length; i++) {
    const s = unpackValue(packed[i]!, 'short');
    const back = i % 2 === 0 ? t[0]! * s + t[2]! : t[1]! * s + t[3]!;
    e = Math.max(e, Math.abs(back - orig[i]!));
  }
  return e;
}

describe('법선·무늬 좌표 줄이기(pack.ts)', () => {
  it('무늬 크기: 긴 변 TEXTURE_LIMIT 안으로, 모르면 한도', () => {
    expect(textureTexels(undefined)).toEqual([TEXTURE_LIMIT, TEXTURE_LIMIT]);
    expect(textureTexels({ width: 300, height: 200 })).toEqual([300, 200]);
    expect(textureTexels({ width: 8192, height: 2048 })).toEqual([TEXTURE_LIMIT, TEXTURE_LIMIT / 4]);
  });

  it('법선은 Int8 정점 4값(단위 길이로 맞춰 반올림 — 방향 오차 0.4° 안)', () => {
    const m = grid('a', 50, 1);
    const p = packMeshNormals(m.normals as Float32Array);
    expect(p).toBeInstanceOf(Int8Array);
    expect(p.length).toBe(50 * 4);
    const n = m.normals as Float32Array;
    for (let i = 0; i < 50; i++) {
      const a = [n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!];
      const b = [p[i * 4]! / 127, p[i * 4 + 1]! / 127, p[i * 4 + 2]! / 127];
      const cos = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (Math.hypot(...a) * Math.hypot(...b));
      expect((Math.acos(Math.min(1, cos)) * 180) / Math.PI).toBeLessThan(0.4);
      expect(p[i * 4 + 3]).toBe(0);
    }
  });

  it('무늬 좌표: 다시 편 오차를 무늬 화소로 재어 한도 안이면 Int16과 변환, 넘으면 Float32로 둔다', () => {
    const size: [number, number] = [1024, 1024];
    // 0~4 되풀이: 반올림 오차 4 ÷ 131,068 × 1024 ≈ 0.03화소 — 줄인다
    const small = grid('s', 400, 4).uvs as Float32Array;
    const ps = packUvsChecked(small, 400, size);
    expect(ps.errTexel).toBeLessThan(UV_PACK_MAX_TEXEL);
    expect(ps.errTexel).toBeCloseTo(uvError(small, ps.uvs, ps.transform) * 1024, 6);
    const kept = packMeshUvs(small, 400, size)!;
    expect(kept.uvs).toBeInstanceOf(Int16Array);
    expect(uvError(small, kept.uvs, kept.transform) * 1024).toBeLessThan(UV_PACK_MAX_TEXEL);
    // 0~400 되풀이(넓은 땅에 작은 무늬): 3화소 남짓 — Float32로 둔다
    const wide = grid('w', 400, 400).uvs as Float32Array;
    expect(packUvsChecked(wide, 400, size).errTexel).toBeGreaterThan(1);
    expect(packMeshUvs(wide, 400, size)).toBeNull();
    // 무늬가 작으면(64화소) 같은 범위도 화소 오차가 작다
    expect(packMeshUvs(wide, 400, [64, 64], 1)).not.toBeNull();
  });

  it('원근 무늬(정점 3값)도 q로 나눈 u·v로 오차를 재고, q가 0으로 줄면 Float32', () => {
    const nv = 3;
    const persp = new Float32Array([0, 0, 1, 2, 0, 2, 0, 1.5, 0.5]);
    const p = packUvsChecked(persp, nv, [512, 512]);
    expect(p.uvs.length).toBe(9);
    expect(p.errTexel).toBeLessThan(UV_PACK_MAX_TEXEL);
    // q 범위가 아주 넓어 작은 q가 0으로 반올림되면 다시 펼 수 없다
    const bad = new Float32Array([0, 0, 1e-7, 1, 1, 1, 0.5, 0.5, 1]);
    expect(packUvsChecked(bad, nv, [512, 512]).errTexel).toBe(Infinity);
    expect(packMeshUvs(bad, nv, [512, 512])).toBeNull();
  });

  it('장면: Float32 법선·무늬 좌표만 줄이고 변환을 단다, 같은 배열은 한 번만, 넓은 무늬 좌표는 그대로, 바이트를 센다', () => {
    const shared = grid('x', 60, 2);
    const a = grid('a', 60, 2, { normals: shared.normals, uvs: shared.uvs });
    const b = grid('b', 60, 2, { normals: shared.normals, uvs: shared.uvs });
    const wide = grid('w', 60, 3000);
    const back = grid('k', 60, 3, { backTexture: 't2' });
    back.backUvs = (grid('kb', 60, 5).uvs as Float32Array).slice();
    const plain: Mesh3d = { id: 'p', positions: new Float32Array(9), color: [1, 1, 1, 1] };
    const done: Mesh3d = { id: 'd', positions: new Float32Array(9), normals: new Int8Array(12), color: [1, 1, 1, 1] };
    const scene: Pick<Scene3d, 'meshes' | 'textures'> = {
      meshes: [a, b, wide, back, plain, done],
      textures: [
        { id: 't', width: 512, height: 512 },
        { id: 't2', width: 256, height: 128 },
      ],
    };
    const wideUvs = wide.uvs;
    const before = [a, wide, back].reduce((s, m) => s + m.normals!.byteLength, 0) + a.uvs!.byteLength + wide.uvs!.byteLength + back.uvs!.byteLength + back.backUvs!.byteLength;
    const st = packSceneAttribs(scene);
    expect(a.normals).toBeInstanceOf(Int8Array);
    expect(b.normals).toBe(a.normals);
    expect(a.uvs).toBeInstanceOf(Int16Array);
    expect(b.uvs).toBe(a.uvs);
    expect(b.uvTransform).toEqual(a.uvTransform);
    expect(wide.normals).toBeInstanceOf(Int8Array);
    expect(wide.uvs).toBe(wideUvs);
    expect(wide.uvTransform).toBeUndefined();
    expect(back.backUvs).toBeInstanceOf(Int16Array);
    expect(back.backUvTransform).toHaveLength(4);
    expect(plain.normals).toBeUndefined();
    expect(done.normals).toBeInstanceOf(Int8Array);
    expect(st).toMatchObject({ normals: 3, uvs: 3, floatUvs: 1, before });
    expect(st.after).toBe(3 * 60 * 4 + 3 * 60 * 2 * 2 + wideUvs!.byteLength);
    // 두 번 불러도 바꾸지 않는다(이미 줄인 배열)
    const again = packSceneAttribs(scene);
    expect(again).toMatchObject({ normals: 0, uvs: 0, before: wideUvs!.byteLength, after: wideUvs!.byteLength });
  });

  it('큰 모형(나눠 올리는 기준)만 줄인다', () => {
    const small: Pick<Scene3d, 'meshes' | 'lines' | 'textures'> = { meshes: [grid('a', 30, 2)], lines: [] };
    expect(packBigScene(small)).toBeUndefined();
    expect(small.meshes[0]!.normals).toBeInstanceOf(Float32Array);
    const many: Mesh3d[] = Array.from({ length: INCREMENTAL_ITEMS }, (_, i) => grid(`m${i}`, 3, 1));
    const big: Pick<Scene3d, 'meshes' | 'lines' | 'textures'> = { meshes: many, lines: [] };
    expect(packBigScene(big)?.normals).toBe(INCREMENTAL_ITEMS);
    expect(many.every((m) => m.normals instanceof Int8Array && m.uvs instanceof Int16Array && m.uvTransform)).toBe(true);
  });
});

describe('문맥 복구 때 같은 꼴로 다시 주기(restore.ts)', () => {
  it('무늬 좌표: 변환이 없으면 Float32 그대로, 같으면 다시 줄인 배열, 다르면 주지 않는다', () => {
    const uvs = grid('a', 40, 3).uvs as Float32Array;
    expect(restoreUvs(uvs, 40, null)).toBe(uvs);
    const p = packMeshUvs(uvs, 40, [512, 512])!;
    const again = restoreUvs(uvs.slice(), 40, p.transform);
    expect(again).toBeInstanceOf(Int16Array);
    expect([...(again as Int16Array)]).toEqual([...p.uvs]);
    expect(restoreUvs(uvs, 40, [p.transform[0] * 2, p.transform[1], p.transform[2], p.transform[3]])).toBeNull();
    expect(restoreUvs(p.uvs, 40, p.transform)).toBeNull();
    expect(sameUvTransform(p.transform, [...p.transform])).toBe(true);
    expect(sameUvTransform(p.transform, null)).toBe(false);
  });

  it('예제 파일을 다시 풀어 같은 꼴로 줄이면 처음 줄인 법선·무늬 좌표·변환과 같다(Float32로 둔 그물은 Float32)', async () => {
    const { sampleSkpBytes } = await import('../src/app/sample');
    const file = new Blob([sampleSkpBytes() as BlobPart]);
    const opts = { name: 'x', outline: true, extras: true, smooth: true, images: {} };
    const a = (await skpFileToScene(file, opts)).scene;
    const b = (await skpFileToScene(file, opts)).scene;
    // 처음 열 때 줄인 장면(무늬 한 그물은 한도를 아주 작게 해 Float32로 둔 것처럼)
    const orig = new Map(a.meshes.map((m) => [m.id, { normals: m.normals, uvs: m.uvs }] as const));
    const st = packSceneAttribs(a);
    expect(st.normals).toBeGreaterThan(0);
    expect(st.uvs).toBeGreaterThan(0);
    const floatOne = a.meshes.find((m) => m.uvTransform)!;
    floatOne.uvs = orig.get(floatOne.id)!.uvs;
    delete floatOne.uvTransform;
    const want: ArraysWant[] = a.meshes
      .filter((m) => m.normals || m.uvs || m.backUvs)
      .map((m) => ({ id: m.id, nv: m.positions.length / 3, normals: !!m.normals, uvs: !!m.uvs, backUvs: !!m.backUvs, uvT: m.uvTransform ?? null, backUvT: m.backUvTransform ?? null }));
    const got = pickRestoreMeshes(b, want, true);
    expect(got.map((g) => g.id)).toEqual(want.map((w) => w.id));
    for (const g of got) {
      const m = a.meshes.find((x) => x.id === g.id)!;
      expect(g.normals ? Object.prototype.toString.call(g.normals) : null).toBe(m.normals ? '[object Int8Array]' : null);
      expect(g.normals ? [...g.normals] : null).toEqual(m.normals ? [...m.normals] : null);
      expect(g.uvs ? Object.prototype.toString.call(g.uvs) : null).toBe(m.uvs ? Object.prototype.toString.call(m.uvs) : null);
      expect(g.uvs ? [...g.uvs] : null).toEqual(m.uvs ? [...m.uvs] : null);
      expect(g.backUvs ? [...g.backUvs] : null).toEqual(m.backUvs ? [...m.backUvs] : null);
    }
    // 줄이지 않은 모형(pack 없음)은 다시 푼 Float32 그대로(27차와 같다)
    const plain = pickRestoreMeshes(b, want.map((w) => ({ ...w, uvT: null, backUvT: null })), false);
    expect(plain.every((g) => (!g.normals || g.normals instanceof Float32Array) && (!g.uvs || g.uvs instanceof Float32Array))).toBe(true);
  });
});
