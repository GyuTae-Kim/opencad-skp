/**
 * 파일을 통째로 들지 않고 열기(src/range.ts, skpFileToScene): 필요한 자리만 읽어도 파일 전체 바이트로
 * readSkpImages → skpToSceneAsync(releaseBytes)를 부른 것(예전 앱 워커)과 같은 장면·그림·경고가 나와야 한다.
 * 그림·재질·스타일·장면 미리보기가 든 꾸러미, 중앙 목록이 끝 레코드 꼬리보다 큰 꾸러미, 끝이 잘린 파일, 깨진 지역 머리, 깨진 압축,
 * 조각으로 읽을 수 없는 model.dat, 2020 이하, SketchUp 아님. 그리고 파일 내용 지문(sourceSha256).
 */
import { createHash, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sceneDigest } from '../scripts/sweep/probe';
import { readSkpImages, skpFileToScene, skpToSceneAsync, type SkpFileRead, type SkpImages, type SkpModelRead } from '../src/index';
import { READ_BLOCK, streamModelDat } from '../src/modelstream';
import { readModelDat } from '../src/model';
import { AHEAD_BYTES, AHEAD_READS, blobSource, bytesSource, HEAD_BYTES, readSourceDirectory, SourceItems, sourceSha256, WINDOW, type SkpSource } from '../src/range';
import { findSkpZipItems, readZipDirectory, readZipItem, ZIP_END_SEARCH } from '../src/zip';
import { readSkpHeader } from '../src/header';
import { zipImageReads } from '../src/images';
import { concat, edge, entities, face, IDENTITY13, instance, materialXml, modelDat, pngRgb, skpFile, styleXml, vertex, zip } from './build';
import { mfcFile, squareEntities } from './mfcwrite';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

/** 읽은 자리를 적는 SkpSource */
function counted(bytes: Uint8Array): { src: SkpSource; reads: [number, number][] } {
  const inner = bytesSource(bytes);
  const reads: [number, number][] = [];
  return {
    reads,
    src: {
      size: inner.size,
      read: (a, b) => {
        reads.push([a, b]);
        return inner.read(a, b);
      },
    },
  };
}

/** 정사각형 판(정점 id0.., 모서리 id0+10.., 면 id0+20) */
function plate(id0: number, x: number, material?: number): { vertices: Uint8Array[]; edges: Uint8Array[]; faces: Uint8Array[] } {
  const v = [0, 1, 2, 3].map((k) => id0 + k);
  const e = [0, 1, 2, 3].map((k) => id0 + 10 + k);
  return {
    vertices: [vertex(v[0]!, x, 0, 0), vertex(v[1]!, x + 10, 0, 0), vertex(v[2]!, x + 10, 10, 0), vertex(v[3]!, x, 10, 0)],
    edges: [edge(e[0]!, v[0]!, v[1]!), edge(e[1]!, v[1]!, v[2]!), edge(e[2]!, v[2]!, v[3]!), edge(e[3]!, v[3]!, v[0]!)],
    faces: [face(id0 + 20, [0, 0, 1, 0], [e.map((x) => [x, false] as [number, boolean])], material !== undefined ? { material } : {})],
  };
}

/** 정의 n개(무늬 재질 판)·글꼴이 든 model.dat */
function model(n = 12): Uint8Array {
  const defs = Array.from({ length: n }, (_, k) => ({ name: `판 ${k}`, entities: entities(100 + k, plate(1000 + 100 * k, 20 * k, k % 2 ? 2 : 3)) }));
  return modelDat({
    materials: [
      [2, '무늬A'],
      [3, '색'],
    ],
    fonts: [{ id: 7, face: 'Arial' }],
    definitions: defs,
    root: entities(undefined, { ...plate(10, -30), components: defs.map((_, k) => instance(200 + k, 100 + k, k ? IDENTITY13 : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 50, 0, 1])) }),
  });
}

const png = (c: number): Uint8Array => pngRgb(2, 2, (x, y) => [x * 100 + c, y * 100, 50]);

/** 그림(모형·장면·컴포넌트 미리보기, 폴더에 그림 둘)·재질·스타일이 든 2021+ 파일 */
function richFile(dat = model(), extra: { name: string; data: Uint8Array; deflate?: boolean }[] = []): Uint8Array {
  return skpFile(dat, {
    materials: [
      ['무늬A', materialXml('무늬A', [120, 100, 80], 1, 0, true, { file: 'a.png', width: 10, height: 20, average: [120, 100, 80] })],
      ['색', materialXml('색', [200, 10, 10])],
    ],
    extra: [
      { name: 'meta/model_thumbnail.png', data: png(1) },
      { name: 'materials/무늬A/aaa_normal.png', data: png(2) },
      { name: 'materials/무늬A/a.png', data: png(3) },
      { name: 'thumbnails/판 1.png', data: png(4) },
      { name: 'scene_thumbnails/장면 1.png', data: png(5), deflate: true },
      { name: 'styles/기본/style.xml', data: new TextEncoder().encode(styleXml([[0, 1, '0']], '기본')), deflate: true },
      ...extra,
    ],
  });
}

const imagesKey = (i: SkpImages | undefined): string | undefined =>
  i &&
  JSON.stringify({
    model: i.model && [i.model.path, i.model.name, i.model.mime, sha(i.model.bytes)],
    materials: i.materials.map((m) => [m.folder, m.path, m.name, m.mime, sha(m.bytes)]),
    components: i.components.map((m) => [m.path, m.name, m.mime, sha(m.bytes)]),
    scenes: i.scenes.map((m) => [m.path, m.name, m.mime, sha(m.bytes)]),
    skipped: i.skipped,
    warnings: i.warnings,
  });

const OPTS = { name: 'm.skp', outline: true, extras: true, smooth: true } as const;

/** 예전 앱 워커 길: 파일 전체 → readSkpImages → skpToSceneAsync(releaseBytes) */
async function wholeWay(bytes: Uint8Array, streamMin?: number) {
  const copy = bytes.slice();
  let images: SkpImages | undefined;
  try {
    images = readSkpImages(copy);
  } catch {
    /* 그림은 없어도 된다 */
  }
  const how: SkpModelRead[] = [];
  const o: Parameters<typeof skpToSceneAsync>[1] = { ...OPTS, textures: images?.materials, releaseBytes: true, onModelRead: (h) => how.push(h) };
  if (streamMin !== undefined) o.streamMin = streamMin;
  const scene = await skpToSceneAsync(copy, o);
  return { digest: sceneDigest(scene), warnings: scene.warnings, images: imagesKey(images), how };
}

/** 새 길: 필요한 자리만 읽기 */
async function partsWay(src: SkpSource | Blob, streamMin?: number) {
  const how: SkpModelRead[] = [];
  const file: SkpFileRead[] = [];
  const o: Parameters<typeof skpFileToScene>[1] = { ...OPTS, onModelRead: (h) => how.push(h), onFileRead: (h) => file.push(h) };
  if (streamMin !== undefined) o.streamMin = streamMin;
  const r = await skpFileToScene(src, o);
  return { digest: sceneDigest(r.scene), warnings: r.scene.warnings, images: imagesKey(r.images), how, file };
}

async function expectSame(bytes: Uint8Array, file: SkpFileRead, streamMin?: number): Promise<Awaited<ReturnType<typeof partsWay>>> {
  const want = await wholeWay(bytes, streamMin);
  const got = await partsWay(bytesSource(bytes), streamMin);
  expect(got.file).toEqual([file]);
  expect(got.digest).toBe(want.digest);
  expect(got.warnings).toEqual(want.warnings);
  expect(got.images).toBe(want.images);
  expect(got.how).toEqual(want.how);
  return got;
}

describe('파일을 통째로 들지 않고 열기: 예전 길과 같은 결과', () => {
  it('그림·재질·스타일이 든 꾸러미 — 풀면서 읽기(정의 하나씩)·통째로 읽기 둘 다', async () => {
    const bytes = richFile();
    const streamed = await expectSame(bytes, 'parts', 1);
    expect(streamed.how).toEqual(['stream']);
    const small = await expectSame(bytes, 'parts');
    expect(small.how).toEqual(['whole']);
    expect(small.digest).toBe(streamed.digest);
    // 무늬가 실제로 입혀졌고(그림 둘 있는 폴더는 material.xml이 가리키는 그림), 미리보기들을 꺼냈다
    const r = await skpFileToScene(bytesSource(bytes), { ...OPTS, streamMin: 1 });
    expect(r.scene.textures?.length).toBe(1);
    expect(r.images?.materials.map((m) => m.path)).toEqual(['materials/무늬A/a.png']);
    expect(r.images?.model?.path).toBe('meta/model_thumbnail.png');
    expect(r.images?.scenes.map((m) => m.name)).toEqual(['장면 1']);
    expect(r.images?.components.map((m) => m.name)).toEqual(['판 1']);
  });

  it('Blob(File)으로 줘도 같다', async () => {
    const bytes = richFile();
    const want = await wholeWay(bytes, 1);
    const got = await partsWay(new Blob([bytes as BlobPart]), 1);
    expect(got.file).toEqual(['parts']);
    expect(got.digest).toBe(want.digest);
    expect(got.images).toBe(want.images);
    const b = blobSource(new Blob([bytes as BlobPart]));
    expect(b.size).toBe(bytes.length);
    expect([...(await b.read(3, 9))]).toEqual([...bytes.subarray(3, 9)]);
    expect((await b.read(bytes.length - 2, bytes.length + 50)).length).toBe(2);
    expect((await b.read(-5, 0)).length).toBe(0);
  });

  it('파일을 통째로 읽지 않는다: 머리·끝 꼬리·목록·항목 덩이와 model.dat 덩이만', async () => {
    // 쓰지 않는 큰 항목(700 KB)이 그림과 model.dat 사이에 있는 파일
    const bytes = richFile(model(40), [{ name: 'meta/big.bin', data: new Uint8Array(randomBytes(700_000)) }]);
    const { src, reads } = counted(bytes);
    const want = await wholeWay(bytes, 1);
    const got = await skpFileToScene(src, { ...OPTS, streamMin: 1 });
    expect(sceneDigest(got.scene)).toBe(want.digest);
    // 파일 전체를 한 번에 읽은 적이 없고(모든 읽기가 머리·끝 꼬리·덩이·model.dat 덩이 크기 안), 쓰지 않는 항목은 거의 읽지 않는다
    const biggest = Math.max(...reads.map(([a, b]) => b - a));
    expect(biggest).toBeLessThanOrEqual(Math.max(HEAD_BYTES, ZIP_END_SEARCH, WINDOW, READ_BLOCK));
    expect(reads[0]).toEqual([0, HEAD_BYTES]);
    const total = reads.reduce((n, [a, b]) => n + Math.min(b, bytes.length) - a, 0);
    expect(total).toBeLessThan(bytes.length - 300_000);
    // 작은 항목(xml·작은 그림)은 덩이 하나로 이어 읽는다 — 항목 수보다 훨씬 적게 읽는다
    expect(reads.length).toBeLessThan(10);
  });

  it('중앙 목록이 끝 꼬리(64 KiB)보다 크면 목록 자리부터 한 번 더 읽어 같은 목록을 낸다', async () => {
    const many = Array.from({ length: 900 }, (_, k) => ({ name: `thumbnails/${'긴이름'.repeat(12)}-${k}.txt`, data: new Uint8Array([k & 0xff]) }));
    const bytes = richFile(model(), many);
    const whole = findSkpZipItems(bytes, readSkpHeader(bytes)!.bodyOffset);
    expect(whole.salvaged).toBe(false);
    const { src, reads } = counted(bytes);
    const dir = await readSourceDirectory(src);
    expect(dir).toEqual(whole.items);
    expect(reads.length).toBe(2);
    expect(reads[1]![0]).toBeLessThan(bytes.length - ZIP_END_SEARCH);
    expect(readZipDirectory(bytes)).toEqual(dir);
    await expectSame(bytes, 'parts', 1);
  });

  it('끝이 잘린 파일·SketchUp 아님·2020 이하는 파일 전체로(예전 길 그대로)', async () => {
    const bytes = richFile();
    // 끝 목록이 없으면 앞에서부터 항목을 찾는다(잘린 model.dat — damaged)
    await expectSame(bytes.subarray(0, bytes.length - 40), 'whole', 1);
    await expectSame(bytes.subarray(0, Math.floor(bytes.length * 0.8)), 'whole');
    await expectSame(new Uint8Array(randomBytes(5000)), 'whole');
    await expectSame(new Uint8Array(0), 'whole');
    await expectSame(bytes.subarray(0, 20), 'whole');
    const old = await expectSame(mfcFile({ schemas: 'v17', root: squareEntities() }), 'whole');
    expect(old.how).toEqual([]);
  });

  it('깨진 지역 머리(그림·model.dat)와 깨진 압축은 예전과 같은 경고·결과', async () => {
    const bytes = richFile();
    const dir = readZipDirectory(bytes)!;
    const at = (name: string): number => dir.find((d) => d.name === name)!.localOffset;
    // 그림 하나의 지역 머리 표지가 깨짐 → 그 그림만 건너뜀
    const img = bytes.slice();
    img[at('thumbnails/판 1.png')] = 0;
    const r1 = await expectSame(img, 'parts', 1);
    expect(r1.images).toContain('"skipped":1');
    // material.xml의 지역 머리가 깨짐 → 재질 경고
    const xml = bytes.slice();
    xml[at('materials/색/material.xml') + 1] = 0;
    await expectSame(xml, 'parts', 1);
    // model.dat 지역 머리가 깨짐 → 읽지 못했다는 빈 장면(풀면서 읽기 전에 통째로 길로)
    const head = bytes.slice();
    head[at('model.dat')] = 0;
    const r2 = await expectSame(head, 'parts', 1);
    expect(r2.how).toEqual(['whole']);
    expect((r2.warnings ?? []).join(' ')).toContain('ZIP 지역 머리가 깨졌습니다');
    // model.dat 압축 가운데가 깨짐 → 내장 풀기 실패 → 직접 풀기(앞부분만, damaged)
    const item = dir.find((d) => d.name === 'model.dat')!;
    const flate = bytes.slice();
    const start = item.localOffset + 30 + 'model.dat'.length;
    for (let k = 0; k < 24; k++) flate[start + Math.floor(item.compressedSize / 2) + k] = 0xff;
    const r3 = await expectSame(flate, 'parts', 1);
    expect(r3.how).toEqual(['inflate']);
  });

  it('조각으로 읽을 수 없는 model.dat(뿌리 꼬리표가 다름)는 통째로 다시 — 같은 결과', async () => {
    const dat = model();
    const bad = dat.slice();
    bad[0] = 0x00;
    const r = await expectSame(richFile(bad), 'parts', 1);
    expect(r.how).toEqual(['shape']);
  });

  it('model.dat를 READ_BLOCK보다 크게 압축하지 않은 파일: 덩이씩(많아야 둘을 미리) 읽어도 한 버퍼와 같은 모형', async () => {
    const dat = model(6000);
    const stored = new Uint8Array(deflateRawSync(dat, { level: 0 }));
    expect(stored.length).toBeGreaterThan(2 * READ_BLOCK);
    const reads: [number, number][] = [];
    let open = 0;
    let most = 0;
    const reader = {
      length: stored.length,
      read: async (a: number, b: number) => {
        reads.push([a, b]);
        open++;
        most = Math.max(most, open);
        await new Promise((r) => setTimeout(r, 1));
        open--;
        return stored.slice(a, b);
      },
    };
    const got = await streamModelDat(reader, dat.length);
    const want = await streamModelDat(stored, dat.length);
    expect(typeof got).toBe('object');
    expect(typeof want).toBe('object');
    if (typeof got === 'string' || typeof want === 'string') return;
    expect(got.model.definitions.size).toBe(6000);
    expect(got.model.definitions.size).toBe(want.model.definitions.size);
    expect(got.model.warnings).toEqual(readModelDat(dat).warnings);
    expect(reads.length).toBe(Math.ceil(stored.length / READ_BLOCK));
    expect(reads.every(([a, b]) => b - a <= READ_BLOCK)).toBe(true);
    expect(most).toBeLessThanOrEqual(2);
    // 파일이 중간에 짧아지면(읽은 길이 0) 풀기가 실패한 것으로 알린다
    const short = { length: stored.length, read: async (a: number, b: number) => (a >= READ_BLOCK ? new Uint8Array(0) : stored.slice(a, b)) };
    expect(await streamModelDat(short, dat.length)).toBe('inflate');
  });

  it('SourceItems: 항목 바이트는 readZipItem(파일 전체)와 같고, 작은 항목은 덩이 하나에서', async () => {
    const bytes = richFile();
    const dir = readZipDirectory(bytes)!;
    const { src, reads } = counted(bytes);
    const items = new SourceItems(src);
    for (const d of dir) expect(await items.content(d), d.name).toEqual(readZipItem(bytes, d));
    expect(reads.length).toBe(1);
    expect(items.reads).toBe(1);
    // 압축된 내용 읽기: 머리를 검사하고 파일 끝을 넘으면 같은 글로 실패
    const md = dir.find((d) => d.name === 'model.dat')!;
    const r = await items.data(md);
    expect(r.length).toBe(md.compressedSize);
    await expect(items.data({ ...md, compressedSize: bytes.length })).rejects.toThrow('ZIP 항목이 잘렸습니다');
    await expect(items.data({ ...md, localOffset: md.localOffset + 1 })).rejects.toThrow('ZIP 지역 머리가 깨졌습니다');
  });
});

describe('SourceItems.plan: 곧 읽을 항목을 알려 읽기를 겹친다(48차)', () => {
  /** 작은 material.xml(압축)과 그림 자리(작은 것·WINDOW_MAX보다 큰 것)가 번갈아 놓인 꾸러미 */
  const mixed = (n: number, big: number): Uint8Array =>
    zip(
      Array.from({ length: n }, (_, k) => [
        { name: `materials/m${k}/material.xml`, data: new TextEncoder().encode(`<m k="${k}">${'x'.repeat(k * 7)}</m>`), deflate: true },
        { name: `materials/m${k}/t.png`, data: new Uint8Array(k % 3 ? 2000 + k : big).fill(k) },
      ]).flat(),
    );

  /** Blob 읽기처럼 한 번마다 잠깐 기다리는 SkpSource: 읽은 자리, 함께 열린 읽기 수의 최대, 실패시킬 읽기 */
  function slow(bytes: Uint8Array, fail: (a: number, b: number, n: number) => boolean = () => false) {
    const inner = bytesSource(bytes);
    const log = { reads: [] as [number, number][], open: 0, most: 0 };
    const src: SkpSource = {
      size: inner.size,
      read: async (a, b) => {
        const n = log.reads.push([a, b]);
        log.open++;
        log.most = Math.max(log.most, log.open);
        await new Promise((r) => setTimeout(r, 2));
        log.open--;
        if (fail(a, b, n)) throw new Error(`읽기 실패 ${a}`);
        return inner.read(a, b);
      },
    };
    return { src, log };
  }

  it('계획대로 받아 가면 값·읽는 자리·횟수가 하나씩 읽을 때와 같고, 읽기를 AHEAD_READS까지 겹친다', async () => {
    const bytes = mixed(40, 200_000);
    const dir = readZipDirectory(bytes)!;
    const one = slow(bytes);
    const a = new SourceItems(one.src);
    const want: Uint8Array[] = [];
    for (const d of dir) want.push(await a.content(d));
    const two = slow(bytes);
    const b = new SourceItems(two.src);
    b.plan(dir);
    for (let k = 0; k < dir.length; k++) expect(await b.content(dir[k]!), dir[k]!.name).toEqual(want[k]);
    for (let k = 0; k < dir.length; k++) expect(want[k]).toEqual(readZipItem(bytes, dir[k]!));
    expect(two.log.reads).toEqual(one.log.reads);
    expect(b.reads).toBe(a.reads);
    expect(one.log.most).toBe(1);
    expect(two.log.most).toBeGreaterThan(1);
    expect(two.log.most).toBeLessThanOrEqual(AHEAD_READS);
    expect(b.mostOpen).toBe(two.log.most);
  });

  it('계획과 다르게 받아 가도(건너뜀·차례 바뀜·계획 밖·새 계획) 같은 값', async () => {
    const bytes = mixed(30, 120_000);
    const dir = readZipDirectory(bytes)!;
    const { src } = slow(bytes);
    const items = new SourceItems(src);
    items.plan(dir);
    const order = [...dir.filter((_, k) => k % 3 === 0), dir[1]!, dir[4]!, ...dir.filter((_, k) => k % 3 === 2).reverse()];
    for (const d of order) expect(await items.content(d), d.name).toEqual(readZipItem(bytes, d));
    // 새 계획(앞 계획에서 받아 가지 않은 것은 버린다)과 계획 밖 항목
    items.plan(dir.slice(10, 20));
    for (const d of [...dir.slice(12, 18), dir[2]!, dir[25]!]) expect(await items.content(d), d.name).toEqual(readZipItem(bytes, d));
    items.plan([]);
    expect(await items.content(dir[11]!)).toEqual(readZipItem(bytes, dir[11]!));
  });

  it('미리 읽기가 실패한 항목은 그때 다시 읽는다 — 다시 되면 같은 값, 계속 안 되면 하나씩 읽을 때와 같은 오류', async () => {
    const bytes = mixed(12, 100_000);
    const dir = readZipDirectory(bytes)!;
    const big = dir.find((d) => d.name === 'materials/m3/t.png')!;
    // 그 그림 자리 첫 읽기만 실패
    let tries = 0;
    const once = slow(bytes, (a) => a === big.localOffset && ++tries === 1);
    const items = new SourceItems(once.src);
    items.plan(dir);
    for (const d of dir) expect(await items.content(d), d.name).toEqual(readZipItem(bytes, d));
    expect(once.log.reads.filter(([a]) => a === big.localOffset).length).toBe(2);
    // 늘 실패
    const always = slow(bytes, (a) => a === big.localOffset);
    const plain = new SourceItems(always.src);
    const err = await plain.content(big).catch((e: Error) => e.message);
    const planned = new SourceItems(slow(bytes, (a) => a === big.localOffset).src);
    planned.plan(dir);
    for (const d of dir) {
      if (d === big) expect(await planned.content(d).catch((e: Error) => e.message)).toBe(err);
      else expect(await planned.content(d), d.name).toEqual(readZipItem(bytes, d));
    }
  });

  it('받아 가지 않은 미리 읽기는 AHEAD_BYTES(+ 한 읽기) 안에서만 보낸다', async () => {
    const each = 3 * 1024 * 1024;
    const bytes = zip(Array.from({ length: 12 }, (_, k) => ({ name: `thumbnails/t${k}.png`, data: new Uint8Array(each).fill(k + 1) })));
    const dir = readZipDirectory(bytes)!;
    const { src, log } = slow(bytes);
    const items = new SourceItems(src);
    items.plan(dir);
    let used = 0;
    let most = 0;
    for (const d of dir) {
      most = Math.max(most, log.reads.length - used);
      await items.content(d);
      used++;
    }
    expect(log.reads.length).toBe(dir.length);
    expect(most * each).toBeLessThanOrEqual(AHEAD_BYTES + each + 1024);
    expect(most).toBeGreaterThan(1);
  });

  it('그림 꺼내기·재질 읽기가 알린 차례는 실제로 내어 받은 차례와 같다(한도에 걸리는 그림 포함)', async () => {
    const bytes = richFile();
    const dir = readZipDirectory(bytes)!;
    for (const opts of [{}, { maxCount: 2 }, { maxTotalBytes: 200 }]) {
      const plans: string[] = [];
      const gen = zipImageReads(dir, opts, undefined, (l) => plans.push(...l.map((i) => i.name)));
      const asked: string[] = [];
      let r = gen.next();
      while (!r.done) {
        asked.push(r.value.name);
        r = gen.next(readZipItem(bytes, r.value));
      }
      expect(plans, JSON.stringify(opts)).toEqual(asked);
    }
    // 앱 워커 길(skpFileToScene)은 읽기가 늦게 와도(겹쳐 읽어도) 예전 길과 같은 장면·그림
    const want = await wholeWay(bytes, 1);
    const got = await partsWay(slow(bytes).src, 1);
    expect(got.digest).toBe(want.digest);
    expect(got.images).toBe(want.images);
    expect(got.warnings).toEqual(want.warnings);
  });
});

describe('sourceSha256: 파일 전체로 구한 SHA-256과 같다', () => {
  const ref = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
  const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

  it('작은 파일(내장)·큰 파일(덩이씩)·문턱을 0으로 둔 작은 파일(덩이씩)', async () => {
    for (const n of [0, 1, 64, 65, 100_000]) {
      const b = new Uint8Array(randomBytes(n));
      expect(hex(await sourceSha256(bytesSource(b))), `내장 ${n}`).toBe(ref(b));
      expect(hex(await sourceSha256(bytesSource(b), 0)), `덩이 ${n}`).toBe(ref(b));
    }
    const big = new Uint8Array(randomBytes(9 * 1024 * 1024 + 5));
    const { src, reads } = counted(big);
    expect(hex(await sourceSha256(src))).toBe(ref(big));
    // 내장 문턱(8 MiB)보다 크면 4 MiB 덩이씩
    expect(reads.length).toBe(3);
    expect(Math.max(...reads.map(([a, b]) => b - a))).toBe(4 * 1024 * 1024);
    expect(hex(await sourceSha256(blobSource(new Blob([big as BlobPart]))))).toBe(ref(big));
  });

  it('다 읽은 덩이는 GC를 기다리지 않고 곧바로 놓는다(41차 — 받은 배열이 떼어져 길이 0), 지문은 같다', async () => {
    const big = new Uint8Array(randomBytes(9 * 1024 * 1024 + 5));
    const inner = bytesSource(big);
    const got: Uint8Array[] = [];
    const src: SkpSource = {
      size: inner.size,
      read: async (a, b) => {
        const x = await inner.read(a, b);
        got.push(x);
        return x;
      },
    };
    expect(hex(await sourceSha256(src))).toBe(ref(big));
    expect(got.map((x) => x.byteLength)).toEqual([0, 0, 0]);
    // 파일 바이트(읽어 준 곳의 것)는 그대로
    expect(big.byteLength).toBe(9 * 1024 * 1024 + 5);
  });

  it('파일이 중간에 짧아지면 실패(잘못된 지문을 내지 않는다)', async () => {
    const b = new Uint8Array(randomBytes(10_000));
    const short: SkpSource = { size: b.length, read: async (a, e) => (a >= 4000 ? new Uint8Array(0) : b.slice(a, Math.min(e, 4000))) };
    await expect(sourceSha256(short, 0)).rejects.toThrow();
  });
});

describe('꾸러미 목록을 꼬리만으로', () => {
  it('readZipDirectory(꼬리, 위치) = readZipDirectory(파일 전체)', () => {
    const bytes = concat([new Uint8Array(1000), zip([{ name: 'a', data: new Uint8Array([1]) }, { name: 'b', data: new Uint8Array(3000), deflate: true }])]);
    const whole = readZipDirectory(bytes)!;
    const at = bytes.length - 200;
    expect(readZipDirectory(bytes.subarray(at), at)).toEqual(whole);
    expect(whole[1]!.localOffset).toBeGreaterThan(1000);
    // 목록이 준 바이트 밖이면 알린다
    expect(() => readZipDirectory(bytes.subarray(bytes.length - 30), bytes.length - 30)).toThrow();
  });
});
