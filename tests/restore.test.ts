/**
 * 문맥 복구 때 다시 줄 것 고르기(src/worker/restore.ts — 해석 워커의 arrays 요청, 27차): 같은 파일을 처음 열 때와 같은 선택으로 다시 풀면
 * 그물 id·정점 수·법선·무늬 좌표가 같아 코어가 놓은 배열을 그대로 다시 줄 수 있고, 바란 것만 고르며, 정점 수가 다른 그물(파일이 바뀜)은 주지 않는다.
 * 손질할 무늬를 고르는 only(prepareSceneTextures)도 본다.
 */
import { describe, expect, it } from 'vitest';
import type { Mesh3d, Scene3d } from 'opencad-viewer3d/types';
import { skpFileToScene, type SkpTextureInfo } from '../src/index';
import type { ArraysWant } from '../src/app/protocol';
import { pickRestoreMeshes, pickRestoreTextures } from '../src/worker/restore';
import { prepareSceneTextures } from '../src/worker/textures';

/** 워커와 같은 선택(parse.worker.ts readScene) */
const OPTS = { name: 'x', outline: true, extras: true, smooth: true, images: {} };

const wantOf = (m: Mesh3d): ArraysWant => ({ id: m.id, nv: m.positions.length / 3, normals: !!m.normals, uvs: !!m.uvs, backUvs: !!m.backUvs });
const list = (a: Float32Array | undefined): number[] | null => (a ? [...a] : null);

describe('문맥 복구 때 다시 줄 그물 배열', () => {
  it('같은 파일을 다시 풀면 놓은 법선·무늬 좌표가 같은 그물 id에 같은 값으로 나온다', async () => {
    const { sampleSkpBytes } = await import('../src/app/sample');
    const file = new Blob([sampleSkpBytes() as BlobPart]);
    const a = (await skpFileToScene(file, OPTS)).scene;
    const b = (await skpFileToScene(file, OPTS)).scene;
    const want = a.meshes.filter((m) => m.normals || m.uvs || m.backUvs).map(wantOf);
    expect(want.some((w) => w.uvs)).toBe(true);
    expect(want.some((w) => w.normals)).toBe(true);
    const got = pickRestoreMeshes(b, want);
    expect(got.map((g) => g.id)).toEqual(want.map((w) => w.id));
    for (const g of got) {
      const m = a.meshes.find((x) => x.id === g.id)!;
      expect(list(g.normals)).toEqual(list(m.normals));
      expect(list(g.uvs)).toEqual(list(m.uvs));
      expect(list(g.backUvs)).toEqual(list(m.backUvs));
    }
  });

  it('바란 배열만 주고, 정점 수가 다르거나 없는 그물·줄 배열이 없는 그물은 뺀다', () => {
    const f = (n: number): Float32Array => new Float32Array(n);
    const scene: Pick<Scene3d, 'meshes'> = {
      meshes: [
        { id: 'a', positions: f(9), normals: f(9), uvs: f(6), color: [1, 1, 1, 1] },
        { id: 'b', positions: f(9), normals: f(9), color: [1, 1, 1, 1] },
        { id: 'c', positions: f(18), uvs: f(12), backUvs: f(12), color: [1, 1, 1, 1] },
      ],
    };
    const got = pickRestoreMeshes(scene, [
      { id: 'a', nv: 3, normals: false, uvs: true, backUvs: false },
      { id: 'b', nv: 4, normals: true, uvs: false, backUvs: false },
      { id: 'c', nv: 6, normals: true, uvs: false, backUvs: true },
      { id: 'z', nv: 3, normals: true, uvs: true, backUvs: true },
    ]);
    expect(got.map((g) => [g.id, !!g.normals, !!g.uvs, !!g.backUvs])).toEqual([
      ['a', false, true, false],
      ['c', false, false, true],
    ]);
    expect(got[0]!.uvs).toBe(scene.meshes[0]!.uvs);
    // 바란 것이 그물에 하나도 없으면 뺀다
    expect(pickRestoreMeshes(scene, [{ id: 'b', nv: 3, normals: false, uvs: true, backUvs: false }])).toEqual([]);
  });
});

describe('문맥 복구 때 다시 줄 무늬', () => {
  it('바란 무늬만: 손질한 그림이면 그림과 크기, 아니면 그림 바이트', () => {
    const bmp = { width: 4, height: 2, close: () => undefined } as unknown as ImageBitmap;
    const data = new Uint8Array([1, 2, 3]);
    const got = pickRestoreTextures(
      {
        textures: [
          { id: 't1', bitmap: bmp, data: new Uint8Array([9]) },
          { id: 't2', data, mime: 'image/png', width: 8, height: 8 },
          { id: 't3', data: new Uint8Array([7]) },
        ],
      },
      ['t1', 't2', 'zz'],
    );
    expect(got).toEqual([
      { id: 't1', bitmap: bmp, width: 4, height: 2 },
      { id: 't2', data, mime: 'image/png', width: 8, height: 8 },
    ]);
  });

  it('prepareSceneTextures의 only: 고른 무늬만 손질한다(고르지 않은 색 바꾼 무늬는 풀 수 없는 곳에서도 그대로)', async () => {
    const info = (id: string, colorize: boolean): SkpTextureInfo => ({
      id,
      material: id,
      folder: id,
      path: `${id}.png`,
      tile: [1, 1],
      alphaPossible: false,
      ...(colorize ? { colorize: { type: 'shift' as const, color: [1, 2, 3] as [number, number, number] } } : {}),
    });
    const scene = (): Scene3d => ({
      name: 's',
      units: 'mm',
      meshes: [],
      lines: [],
      textures: [
        { id: 'c1', data: new Uint8Array([1]) },
        { id: 'c2', data: new Uint8Array([2]) },
      ],
      meta: { textures: [info('c1', true), info('c2', true)] },
    });
    // Node에는 그림 풀기가 없어 손질하려던 색 바꾼 무늬는 평균색으로 뺀다 — only에 든 것만
    const s = scene();
    const r = await prepareSceneTextures(s, 1024, undefined, new Set(['c2']));
    expect(r.dropped).toBe(1);
    expect(s.textures!.map((t) => t.id)).toEqual(['c1']);
    const all = scene();
    expect((await prepareSceneTextures(all, 1024)).dropped).toBe(2);
  });
});
