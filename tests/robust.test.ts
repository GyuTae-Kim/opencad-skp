import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { skpToScene } from '../src/index';
import { inflateRaw, inflateRawPartial } from '../src/inflate';
import { readModelDat } from '../src/model';
import { buildSceneParts } from '../src/scene';
import { readZipDirectory, scanZipLocal } from '../src/zip';
import { IDENTITY13, base, concat, edge, entities, face, instance, modelDat, skpFile, tlv, u16, u32, vertex } from './build';

/** 정사각형 n×n개를 모형에 바로 놓은 모형(model.dat를 크게) */
function gridModel(n: number): Uint8Array {
  const vertices: Uint8Array[] = [];
  const edges: Uint8Array[] = [];
  const faces: Uint8Array[] = [];
  let id = 10;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = [id, id + 1, id + 2, id + 3];
      vertices.push(vertex(v[0]!, i, j, 0), vertex(v[1]!, i + 0.8, j, 0), vertex(v[2]!, i + 0.8, j + 0.8, 0), vertex(v[3]!, i, j + 0.8, 0));
      const e = [id + 4, id + 5, id + 6, id + 7];
      for (let k = 0; k < 4; k++) edges.push(edge(e[k]!, v[k]!, v[(k + 1) % 4]!));
      faces.push(
        face(
          id + 8,
          [0, 0, 1, 0],
          [
            [
              [e[0]!, false],
              [e[1]!, false],
              [e[2]!, false],
              [e[3]!, false],
            ],
          ],
        ),
      );
      id += 9;
    }
  return modelDat({ root: entities(undefined, { vertices, edges, faces }) });
}

const triCount = (s: ReturnType<typeof skpToScene>): number => s.meshes.reduce((a, m) => a + (m.indices?.length ?? 0) / 3, 0);

describe('잘린 파일', () => {
  it('어디서 잘려도 멈추지 않고, model.dat 안에서 잘리면 읽은 앞부분(모서리·면)을 살리며 경고한다', () => {
    const file = skpFile(gridModel(30)); // 면 900개, model.dat는 DEFLATE
    const full = triCount(skpToScene(file));
    expect(full).toBe(1800);
    const dir = readZipDirectory(file)!;
    const local = dir.find((d) => d.name === 'model.dat')!.localOffset;
    let withGeometry = 0;
    let withFaces = 0;
    const t0 = performance.now();
    for (let k = 1; k <= 40; k++) {
      const cut = Math.floor((file.length * k) / 41);
      const s = skpToScene(file.subarray(0, cut));
      expect(s.warnings!.length).toBeGreaterThan(0);
      const tris = triCount(s);
      const segs = s.lines.reduce((a, l) => a + l.positions.length / 6, 0);
      expect(tris).toBeLessThanOrEqual(full);
      if (tris + segs > 0) {
        withGeometry++;
        expect(s.meta?.damaged).toBe(true);
        expect(cut).toBeGreaterThan(local);
      }
      if (tris > 0) withFaces++;
    }
    // 요소 묶음 안 차례가 정점 → 모서리 → 면이라, 정점 목록 뒤에서 잘리면 모서리가, 면 목록에서 잘리면 면도 보인다
    expect(withGeometry).toBeGreaterThan(15);
    expect(withFaces).toBeGreaterThan(5);
    expect(performance.now() - t0).toBeLessThan(20_000);
  });

  it('저장(무압축) model.dat가 면 목록에서 잘려도 앞부분 면을 살린다', () => {
    const file = skpFile(gridModel(20), { deflate: false });
    const s = skpToScene(file.subarray(0, Math.floor(file.length * 0.85)));
    const tris = triCount(s);
    expect(tris).toBeGreaterThan(50);
    expect(tris).toBeLessThan(800);
    expect(s.warnings!.some((w) => w.includes('잘렸'))).toBe(true);
  });

  it('지역 머리 따라가기: 데이터 서술자 없이 이어진 항목과 잘린 마지막 항목', () => {
    const file = skpFile(gridModel(5));
    const scan = scanZipLocal(file, 0);
    expect(scan.items.map((i) => i.name)).toEqual(['meta/meta.dat', 'model.dat']);
    expect(scan.truncated).toBe(false);
    const cut = scanZipLocal(file.subarray(0, file.length - 400), 0);
    expect(cut.items.at(-1)!.truncated).toBe(true);
    expect(cut.truncated).toBe(true);
    expect(scanZipLocal(new Uint8Array(100), 0).items).toEqual([]);
  });
});

describe('깨진 ZIP·TLV 길이', () => {
  it('ZIP 중앙 목록이 깨지면 지역 머리로 찾아 읽는다', () => {
    const file = skpFile(gridModel(4)).slice();
    const eocd = file.length - 22;
    // 중앙 목록 위치를 엉뚱하게 → 앞붙이 길이가 음수
    new DataView(file.buffer).setUint32(eocd + 16, 0x7fffffff, true);
    const s = skpToScene(file);
    expect(triCount(s)).toBe(32);
    expect(s.warnings!.some((w) => w.includes('꾸러미(ZIP) 목록이 없거나 깨져'))).toBe(true);
    // 항목 수를 부풀려 중앙 목록을 넘겨 읽게 → 오류 대신 지역 머리로
    const f2 = skpFile(gridModel(4)).slice();
    new DataView(f2.buffer).setUint16(f2.length - 22 + 10, 900, true);
    expect(triCount(skpToScene(f2))).toBe(32);
  });

  it('모형 요소의 면 목록 길이가 깨지면 그 앞 면까지 읽고 경고한다', () => {
    const verts = [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)];
    const edges = [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)];
    const f = face(
      7,
      [0, 0, 1, 0],
      [
        [
          [4, false],
          [5, false],
          [6, false],
        ],
      ],
    );
    // 면 하나 + 길이가 목록을 넘는 가짜 면 머리
    const bogus = concat([u16(0x0dac), u32(1_000_000)]);
    const root = tlv(0x1388, base(undefined), tlv(0x1389, ...verts), tlv(0x138a, ...edges), tlv(0x138b, f, bogus));
    const s = skpToScene(skpFile(modelDat({ root })));
    expect(triCount(s)).toBe(1);
    expect(s.warnings!.some((w) => w.includes('면 목록이 깨져'))).toBe(true);
    expect(s.meta?.damaged).toBe(true);
  });

  it('DEFLATE를 망가뜨려도 예외 없이 끝난다', () => {
    const file = skpFile(gridModel(12));
    let seed = 11;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const t0 = performance.now();
    for (let k = 0; k < 150; k++) {
      const bad = file.slice();
      for (let j = 0; j < 3; j++) bad[80 + rnd(bad.length - 80)] = rnd(256);
      expect(() => skpToScene(bad)).not.toThrow();
    }
    expect(performance.now() - t0).toBeLessThan(30_000);
  });
});

describe('순환·불어나는 컴포넌트', () => {
  it('서로를 품는 정의(A→B→A)와 자기 자신을 품는 정의는 끊고 경고한다', () => {
    const tri = {
      vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
      edges: [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)],
      faces: [
        face(
          7,
          [0, 0, 1, 0],
          [
            [
              [4, false],
              [5, false],
              [6, false],
            ],
          ],
        ),
      ],
    };
    const a = entities(50, { ...tri, components: [instance(8, 60, IDENTITY13)] });
    const b = entities(60, { ...tri, components: [instance(9, 50, IDENTITY13), instance(10, 60, IDENTITY13)] });
    const model = modelDat({
      definitions: [
        { name: 'A', entities: a },
        { name: 'B', entities: b },
      ],
      root: entities(undefined, { components: [instance(11, 50, IDENTITY13)] }),
    });
    const s = skpToScene(skpFile(model), { outline: true });
    expect(triCount(s)).toBe(2);
    expect(s.warnings!.some((w) => w.includes('자기 자신을 품거나'))).toBe(true);
    expect((s.meta!.tree as { count: number }).count).toBe(2);
  });

  it('두 개씩 품는 정의가 깊게 이어져 배치가 기하급수로 불어나면 한도에서 멈춘다', () => {
    // D0 ⊃ 2×D1 ⊃ … ⊃ 2×D19(삼각형) → 배치 2^20 ≈ 100만
    const defs: { name: string; entities: Uint8Array }[] = [];
    const N = 20;
    for (let d = 0; d < N; d++) {
      const id = 100 + d;
      if (d === N - 1)
        defs.push({
          name: `D${d}`,
          entities: entities(id, {
            vertices: [vertex(1, 0, 0, 0), vertex(2, 1, 0, 0), vertex(3, 0, 1, 0)],
            edges: [edge(4, 1, 2), edge(5, 2, 3), edge(6, 3, 1)],
            faces: [
              face(
                7,
                [0, 0, 1, 0],
                [
                  [
                    [4, false],
                    [5, false],
                    [6, false],
                  ],
                ],
              ),
            ],
          }),
        });
      else defs.push({ name: `D${d}`, entities: entities(id, { components: [instance(8, id + 1, IDENTITY13), instance(9, id + 1, IDENTITY13)] }) });
    }
    const model = readModelDat(modelDat({ definitions: defs, root: entities(undefined, { components: [instance(10, 100, IDENTITY13)] }) }));
    const t0 = performance.now();
    const progress: number[] = [];
    const parts = buildSceneParts(model, new Map(), 1, { maxPlacements: 50_000, outline: true, onProgress: (f) => progress.push(f) });
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(parts.stats.placements).toBe(50_000);
    expect(parts.limited).toBe(true);
    expect(parts.warnings.some((w) => w.includes('인스턴스 배치가 너무 많아'))).toBe(true);
    // 나무는 노드 한도에서 단계 단위로 잘린다
    expect(parts.tree!.count).toBeLessThanOrEqual(50_000);
    expect(parts.tree!.unlisted).toBe(true);
    expect(progress.length).toBeGreaterThan(3);
  });
});

describe('DEFLATE 잘림', () => {
  const data = new Uint8Array(120_000);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 7)) & 0xff;
  const z = new Uint8Array(deflateRawSync(data, { level: 9 }));

  it('잘린 흐름은 끝없이 돌지 않고 바로 오류', () => {
    const t0 = performance.now();
    for (const f of [0.1, 0.5, 0.95]) expect(() => inflateRaw(z.subarray(0, Math.floor(z.length * f)), data.length)).toThrow();
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('앞부분만 풀기: 돌려준 부분은 원본 앞부분과 같다', () => {
    for (const f of [0.3, 0.7]) {
      const r = inflateRawPartial(z.subarray(0, Math.floor(z.length * f)), data.length);
      expect(r.complete).toBe(false);
      expect(r.data.length).toBeGreaterThan(0);
      expect(r.data).toEqual(data.subarray(0, r.data.length));
    }
    const whole = inflateRawPartial(z, data.length);
    expect(whole.complete).toBe(true);
    expect(whole.data).toEqual(data);
  });
});
