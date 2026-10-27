/**
 * 훑기 도구가 파일 하나를 해석하는 길(probe). 앱 워커(src/worker/parse.worker.ts)와 같은 차례·같은 선택으로 부른다:
 * 큰 2021+ 파일은 model.dat를 내장 풀기(DecompressionStream)로 먼저 풀고(inflated) → 그림을 꺼내고(readSkpImages) →
 * 같은 선택으로 skpToScene. 무늬 그림 손질(createImageBitmap)과 화면으로 넘기기는 브라우저 일이라 하지 않는다.
 * 워커의 선택이 바뀌면 여기도 같이 바꾼다(tests/sweep.test.ts가 두 파일의 호출 글자를 견준다).
 *
 * 단계와 시간: inflate(워커의 내장 풀기) · images(그림 꺼내기 — 2020 이하는 여기서 모형을 다 읽는다) ·
 * unpack(꾸러미 목록·재질·내장 풀기를 못 했을 때 직접 풀기) · parse(모형 요소 읽기) · scene(삼각화·인스턴스 펼치기·장면 정보).
 * unpack·parse·scene은 skpToScene의 진행 알림 비율로 가른다(2021+ 0.4 앞 = unpack, 0.65 앞 = parse, 그 뒤 = scene).
 * mem을 켜면 진행 알림마다 heap·external·rss를 재 단계별 최대값을 남기고, 단계가 끝날 때 gc()로 그때 살아 있는 크기를 잰다
 * (gc 시간은 단계 시간에서 뺀다 — 그래도 mem을 켠 시간은 보통 시간과 견주지 않는다). 단계 끝 external에는 V8이 뒤에서 아직 치우지 못한
 * ArrayBuffer가 섞일 수 있어, 해석을 마친 뒤에는 잠깐 쉬었다가 다시 gc()해 워커가 화면으로 넘기기 직전에 붙든 크기(retained)를 따로 잰다.
 * 이 파일은 scripts/sweep/sweep.mjs가 Vite로 묶어 Node 자식 프로세스에서 부른다. 파일 경로는 받지 않는다.
 */
import { readSkpHeader, readSkpImages, skpToScene, type SkpImages } from '../../src/index';
import { NATIVE_INFLATE_MIN_BYTES, preinflateSkp } from '../../src/worker/unzip';
import { findSkpZipItems } from '../../src/zip';

export type ProbeStage = 'inflate' | 'images' | 'unpack' | 'parse' | 'scene';
export const PROBE_STAGES: readonly ProbeStage[] = ['inflate', 'images', 'unpack', 'parse', 'scene'];

export interface ProbeOptions {
  /** 장면 이름(워커처럼 파일 이름만) */
  name?: string;
  /** 단계별 메모리 재기(느리다 — gc()를 단계마다 부른다) */
  mem?: boolean;
  /** --expose-gc의 gc. 없으면 단계 끝 크기(end*)는 gc 없이 잰 값 */
  gc?: () => void;
  /** 내장 풀기 문턱(기본은 워커와 같은 NATIVE_INFLATE_MIN_BYTES) — 시험에서 작은 파일로 그 길을 타려고 */
  inflateMin?: number;
}

/** 단계 하나의 메모리(MB = 10^6 바이트) */
export interface StageMemory {
  ms: number;
  /** 단계 안 진행 알림마다 잰 최대값 */
  peakHeapMB: number;
  peakExternalMB: number;
  peakRssMB: number;
  /** 단계가 끝날 때 gc 뒤 크기(그때 살아 있는 것) */
  endHeapMB: number;
  endExternalMB: number;
  endRssMB: number;
}

/** 해석을 마치고 화면으로 넘기기 직전(장면·그림·파일 바이트가 살아 있다) 크기 */
export interface RetainedMemory {
  heapMB: number;
  externalMB: number;
  rssMB: number;
}

export interface ProbeMemory {
  /** 파일 바이트를 읽은 뒤 gc 한 출발점 */
  baseHeapMB: number;
  baseExternalMB: number;
  baseRssMB: number;
  stages: Partial<Record<ProbeStage, StageMemory>>;
  retained: RetainedMemory;
  /** 단계 최대값 가운데 가장 큰 것 */
  peakHeapMB: number;
  peakExternalMB: number;
  peakRssMB: number;
  /** model.dat 풀린 크기(2021+ 꾸러미에서 찾았을 때) */
  modelDatMB?: number;
  /** 장면 결과의 형식 배열 바이트(종류별, MB) — 화면으로 넘기는 크기 */
  sceneBuffersMB: Record<string, number>;
  /** 장면 형식 배열이 붙든 바탕 ArrayBuffer 합(MB) — 배열 크기보다 크면 큰 버퍼의 일부를 보는 배열이 있다 */
  sceneBackingMB: number;
  /** 장면이 파일 바이트·미리 푼 model.dat 버퍼를 붙들고 있는지(그러면 그 버퍼가 장면과 함께 산다) */
  sceneHoldsFile: boolean;
  sceneHoldsModelDat?: boolean;
  /** 꺼낸 그림 바이트 합(MB) */
  imagesMB: number;
}

export interface ProbeMetrics {
  meshes: number;
  lines: number;
  points: number;
  tri: number;
  seg: number;
  faces: number;
  edges: number;
  defs: number;
  inst: number;
  mats: number;
  tex: number;
  tags: number;
  tree: number;
  pages: number;
  texts: number;
  dims: number;
  sections: number;
  units: string;
  bounds: number[] | null;
}

export interface ProbeResult {
  header: { version: string; major: number; container: string; sub?: number } | null;
  /** 워커처럼 내장 풀기로 먼저 푼 model.dat를 넘겼는지 */
  inflated: boolean;
  ms: Partial<Record<ProbeStage, number>> & { total: number };
  images?: { model: boolean; materials: number; components: number; scenes: number; skipped: number };
  imageError?: string;
  metrics: ProbeMetrics;
  warnings: string[];
  /** meta.damaged·limited·unsupported */
  flags: string[];
  /** 장면 결과 형식 배열 합(MB) */
  sceneMB: number;
  /** 해석 직후(gc 없이) heap 증가와 프로세스 rss — 대강의 값. 정확한 값은 mem */
  heapMB: number;
  rssMB: number;
  mem?: ProbeMemory;
}

/** 머리 판 정보(SketchUp 파일이 아니면 null) — 자식 프로세스가 해석 전에 부모에게 먼저 알린다(멈추거나 죽어도 판은 남게) */
export function headerInfo(bytes: Uint8Array): ProbeResult['header'] {
  const h = readSkpHeader(bytes);
  return h ? { version: h.version, major: h.major, container: h.container, ...(h.subVersion !== undefined ? { sub: h.subVersion } : {}) } : null;
}

const MB = (n: number): number => Math.round(n / 1e5) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

interface Acc {
  ms: number;
  peakHeap: number;
  peakExt: number;
  peakRss: number;
  endHeap: number;
  endExt: number;
  endRss: number;
}

/** 단계 시간·메모리 재기 */
class Meter {
  private stage: ProbeStage | null = null;
  private t = 0;
  readonly acc = new Map<ProbeStage, Acc>();
  constructor(
    private readonly mem: boolean,
    private readonly gc?: () => void,
  ) {}

  private get(s: ProbeStage): Acc {
    let a = this.acc.get(s);
    if (!a) {
      a = { ms: 0, peakHeap: 0, peakExt: 0, peakRss: 0, endHeap: 0, endExt: 0, endRss: 0 };
      this.acc.set(s, a);
    }
    return a;
  }

  enter(s: ProbeStage): void {
    if (this.stage === s) {
      this.sample();
      return;
    }
    this.close();
    this.stage = s;
    this.get(s);
    this.t = performance.now();
    this.sample();
  }

  sample(): void {
    if (!this.mem || !this.stage) return;
    const m = process.memoryUsage();
    const a = this.get(this.stage);
    if (m.heapUsed > a.peakHeap) a.peakHeap = m.heapUsed;
    if (m.external > a.peakExt) a.peakExt = m.external;
    if (m.rss > a.peakRss) a.peakRss = m.rss;
  }

  close(): void {
    if (!this.stage) return;
    const a = this.get(this.stage);
    a.ms += performance.now() - this.t;
    if (this.mem) {
      this.sample();
      // 한 번으로는 이미 돌던 표시 단계가 끝날 뿐 방금 버린 것을 다 치우지 못할 때가 있다(큰 모형에서 1 GB 차이)
      this.gc?.();
      this.gc?.();
      const m = process.memoryUsage();
      a.endHeap = m.heapUsed;
      a.endExt = m.external;
      a.endRss = m.rss;
    }
    this.stage = null;
  }
}

/** 장면의 형식 배열 바이트(같은 배열은 한 번) — 묶음 종류.열쇠별, 그리고 그 배열들의 바탕 버퍼 */
export function sceneBuffers(scene: ReturnType<typeof skpToScene>): { byKey: Record<string, number>; backing: Set<ArrayBufferLike> } {
  const seen = new Set<ArrayBufferView>();
  const backing = new Set<ArrayBufferLike>();
  const out: Record<string, number> = {};
  const add = (key: string, v: unknown): void => {
    if (!ArrayBuffer.isView(v) || seen.has(v)) return;
    seen.add(v);
    backing.add(v.buffer);
    out[key] = (out[key] ?? 0) + v.byteLength;
  };
  const walk = (prefix: string, v: unknown, depth: number): void => {
    if (ArrayBuffer.isView(v)) return add(prefix, v);
    if (depth <= 0 || v === null || typeof v !== 'object') return;
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(prefix, x, depth - 1);
  };
  for (const m of scene.meshes) for (const [k, v] of Object.entries(m)) add(`mesh.${k}`, v);
  for (const l of scene.lines) for (const [k, v] of Object.entries(l)) add(`lines.${k}`, v);
  for (const p of scene.points ?? []) for (const [k, v] of Object.entries(p)) add(`points.${k}`, v);
  for (const t of scene.textures ?? []) add('textures', t.data);
  for (const [k, v] of Object.entries(scene.meta ?? {})) walk(`meta.${k}`, v, 3);
  return { byKey: out, backing };
}

/** SKP 바이트 하나를 워커와 같은 길로 해석해 지표·시간(·메모리)을 낸다. 예외는 부르는 쪽이 잡는다 */
export async function probeSkp(bytes: Uint8Array, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const mem = !!opts.mem;
  const meter = new Meter(mem, opts.gc);
  let base: NodeJS.MemoryUsage | undefined;
  if (mem) {
    opts.gc?.();
    base = process.memoryUsage();
  }
  const heap0 = process.memoryUsage().heapUsed;
  const h = readSkpHeader(bytes);
  const name = opts.name ?? 'model.skp';
  const zipPath = h?.container === 'zip';
  const t0 = performance.now();

  // 워커: 큰 2021+ 모형의 model.dat는 브라우저 내장 풀기로 먼저 푼다
  let inflated: Map<string, Uint8Array> | undefined;
  const inflateMin = opts.inflateMin ?? NATIVE_INFLATE_MIN_BYTES;
  if (bytes.length >= inflateMin) {
    meter.enter('inflate');
    const timer = mem ? setInterval(() => meter.sample(), 5) : undefined;
    try {
      inflated = await preinflateSkp(bytes, inflateMin);
    } finally {
      if (timer) clearInterval(timer);
    }
  }
  const datBytes = inflated?.get('model.dat')?.length;
  // 진단만 하려고 붙들면 그 버퍼가 끝까지 살아 메모리를 잘못 잰다 — 약한 참조로. 약한 참조를 만든 작업(job)이 끝날 때까지는
  // 대상이 살아 있으므로(WeakRef KeepDuringJob) 해석 전에 한 번 쉰다 — 쉬지 않으면 model.dat가 장면 단계 끝까지 남아 보인다
  const datBuffer = mem && inflated ? new WeakRef(inflated.get('model.dat')!.buffer) : undefined;
  if (datBuffer) await new Promise((r) => setTimeout(r, 0));

  // 워커: 그림을 먼저 꺼낸다(2020 이하는 여기서 모형을 다 읽고 해석기가 이어 쓴다). 그림은 없어도 된다
  meter.enter('images');
  let images: SkpImages | undefined;
  let imageError: string | undefined;
  try {
    images = readSkpImages(bytes, { onProgress: () => meter.sample() });
  } catch (e) {
    imageError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }

  const progress = (fraction: number): void => {
    meter.enter(fraction >= 0.65 ? 'scene' : zipPath && fraction < 0.4 ? 'unpack' : 'parse');
  };
  const scene = skpToScene(bytes, { name, outline: true, extras: true, smooth: true, onProgress: progress, textures: images?.materials, inflated });
  inflated = undefined;
  meter.close();
  const total = performance.now() - t0;
  const after = process.memoryUsage();
  let retained: RetainedMemory | undefined;
  if (mem) {
    // 뒤에서 ArrayBuffer를 치울 틈을 주고 다시 gc
    await new Promise((r) => setTimeout(r, 100));
    opts.gc?.();
    opts.gc?.();
    await new Promise((r) => setTimeout(r, 100));
    const m = process.memoryUsage();
    retained = { heapMB: MB(m.heapUsed), externalMB: MB(m.external), rssMB: MB(m.rss) };
  }

  const m = (scene.meta ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  let tri = 0;
  for (const x of scene.meshes) tri += x.indices ? x.indices.length / 3 : x.positions.length / 9;
  let seg = 0;
  for (const x of scene.lines) seg += x.positions.length / 6;
  const tree = m.tree as { count?: number } | undefined;
  const metrics: ProbeMetrics = {
    meshes: scene.meshes.length,
    lines: scene.lines.length,
    points: scene.points?.length ?? 0,
    tri,
    seg,
    faces: num(m.faces),
    edges: num(m.edges),
    defs: num(m.definitions),
    inst: num(m.instances),
    mats: num(m.materials),
    tex: scene.textures?.length ?? 0,
    tags: len(m.tags),
    tree: num(tree?.count),
    pages: len(m.pages),
    texts: len(m.texts),
    dims: len(m.dimensions),
    sections: len(m.sectionPlanes),
    units: scene.units,
    bounds: scene.bounds ? [...scene.bounds.min, ...scene.bounds.max].map(r3) : null,
  };
  const { byKey: buffers, backing } = sceneBuffers(scene);
  let sceneBytes = 0;
  for (const v of Object.values(buffers)) sceneBytes += v;

  const ms: ProbeResult['ms'] = { total: Math.round(total) };
  for (const [s, a] of meter.acc) ms[s] = Math.round(a.ms);
  const result: ProbeResult = {
    header: headerInfo(bytes),
    inflated: datBytes !== undefined,
    ms,
    metrics,
    warnings: scene.warnings ?? [],
    flags: (['damaged', 'limited', 'unsupported'] as const).filter((k) => m[k]),
    sceneMB: MB(sceneBytes),
    heapMB: MB(after.heapUsed - heap0),
    rssMB: MB(after.rss),
  };
  if (images)
    result.images = {
      model: !!images.model,
      materials: images.materials.length,
      components: images.components.length,
      scenes: images.scenes.length,
      skipped: images.skipped,
    };
  if (imageError) result.imageError = imageError;

  if (mem && base && retained) {
    const stages: ProbeMemory['stages'] = {};
    let peakHeap = 0;
    let peakExt = 0;
    let peakRss = 0;
    for (const s of PROBE_STAGES) {
      const a = meter.acc.get(s);
      if (!a) continue;
      stages[s] = {
        ms: Math.round(a.ms),
        peakHeapMB: MB(a.peakHeap),
        peakExternalMB: MB(a.peakExt),
        peakRssMB: MB(a.peakRss),
        endHeapMB: MB(a.endHeap),
        endExternalMB: MB(a.endExt),
        endRssMB: MB(a.endRss),
      };
      peakHeap = Math.max(peakHeap, a.peakHeap);
      peakExt = Math.max(peakExt, a.peakExt);
      peakRss = Math.max(peakRss, a.peakRss);
    }
    const sceneBuffersMB: Record<string, number> = {};
    for (const [k, v] of Object.entries(buffers).sort((a, b) => b[1] - a[1])) sceneBuffersMB[k] = MB(v);
    let backingBytes = 0;
    for (const b of backing) backingBytes += b.byteLength;
    let imageBytes = 0;
    if (images) for (const im of [images.model, ...images.materials, ...images.components, ...images.scenes]) imageBytes += im?.bytes.length ?? 0;
    result.mem = {
      baseHeapMB: MB(base.heapUsed),
      baseExternalMB: MB(base.external),
      baseRssMB: MB(base.rss),
      stages,
      retained,
      peakHeapMB: MB(peakHeap),
      peakExternalMB: MB(peakExt),
      peakRssMB: MB(peakRss),
      sceneBuffersMB,
      sceneBackingMB: MB(backingBytes),
      sceneHoldsFile: backing.has(bytes.buffer),
      imagesMB: MB(imageBytes),
    };
    if (datBuffer) {
      const b = datBuffer.deref();
      result.mem.sceneHoldsModelDat = !!b && backing.has(b);
    }
    let dat = datBytes;
    if (dat === undefined && h && zipPath) {
      try {
        dat = findSkpZipItems(bytes, h.bodyOffset).items?.find((d) => d.name === 'model.dat')?.size;
      } catch {
        /* 꾸러미가 깨졌으면 모른다 */
      }
    }
    if (dat !== undefined) result.mem.modelDatMB = MB(dat);
  }
  return result;
}
