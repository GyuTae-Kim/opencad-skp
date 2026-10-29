/**
 * SketchUp(.skp) 해석기. 형식 지식은 공개 표본 바이트로 추론한 것에 비공개 참조 해석기(SketchUp C API를 비교 기준으로 맞춘 해석기)의
 * 형식 지식을 옮겨 더했다(docs/formats/skp.md).
 *
 * 지원: SketchUp 2021~2026(머리 뒤 "VFF" 블록 + ZIP 꾸러미, 안의 model.dat가 TLV)과
 * SketchUp 6·7·8·2013~2020(머리 뒤 MFC 객체 직렬화, src/mfcmodel.ts). 두 해석기가 같은 중간 모형(SkpModel)을 내서 장면 출력은 하나다.
 * 면(구멍 포함)·모서리·재질 색·그룹/컴포넌트/그림 인스턴스 변환·태그(보임·색·폴더·선 종류)·문자·치수·보조선·단면 평면·속성 사전·
 * 단위·카메라·장면(페이지)·스타일(style.xml 또는 옛 스타일 기록 + 렌더링 설정)을 읽는다. 부드러운 음영(매끈한 모서리)은 smooth 선택으로 낸다.
 * 무늬(텍스처)는 그림(readSkpImages)을 textures로 넘기면 면 무늬 좌표를 읽어 입힌다(2021+ 꾸러미의 무늬 그림·위치, 2020 이하의 CTexture·CFaceTextureCoords —
 *   넘기지 않으면 재질 색 = 무늬 평균색).
 * SketchUp 3~5(옛 MFC 스키마)는 읽지 않고 까닭을 적은 경고와 빈 장면(meta.unsupported)을 돌려준다.
 */

import type { Scene3d, Texture3d } from 'opencad-viewer3d/types';
import { imageInfo } from 'opencad-viewer3d/texture';
import { readSkpHeader } from './header';
import { readSkpImages, zipImageReads, type SkpImageOptions, type SkpImages } from './images';
import { parseMaterialXml, type SkpMaterialInfo } from './materials';
import type { SkpMetaExtras } from './meta';
import { MfcRefused, readMfcModel, rememberMfcImages, takeMfcResult } from './mfcmodel';
import { readModelDat, type SkpModel } from './model';
import { inflateNative, STREAM_MIN_BYTES, streamModelDat, type InflateInput } from './modelstream';
import { buildSceneParts, type SceneTexture } from './scene';
import { axesMeta, cameraMeta, edgeColoringFor, locationMeta, pagesMeta, shadowMeta, styleFor, unitsFor } from './scene-meta';
import { parseStyleXml } from './styles';
import { blobSource, HEAD_BYTES, readSourceDirectory, SourceItems, type SkpSource } from './range';
import { findSkpZipItems, readZipItem, readZipItemPartial, runZipReads, runZipReadsAsync, zipItemData, type ZipItem, type ZipReads } from './zip';

export { readSkpHeader, type SkpHeader } from './header';
export { readModelDat, type SkpModel } from './model';
export { STREAM_MIN_BYTES } from './modelstream';
export { blobSource, bytesSource, sourceSha256, type SkpSource } from './range';
export {
  EDGE_UNKNOWN,
  edgeAt,
  edgeList,
  edgesFrom,
  faceAt,
  faceCorners,
  faceList,
  facesFrom,
  loopEdgesKnown,
  textureMapAt,
  type SkpEdges,
  type SkpFaces,
  type SkpTextureMaps,
} from './entities';
export { readSkpImages, type SkpImage, type SkpImages, type SkpImageOptions } from './images';
export { parseMaterialXml, type SkpMaterialInfo, type SkpMaterialTexture } from './materials';
export { colorizeRgba, rgbToHls, hlsToRgb, type ColorizeSpec } from './colorize';
export type { SkpExtraItems, SkpMaterialStat, SkpOutlineEntry, SkpTagStat, SkpTree } from './scene';
export { TREE_HIDDEN, TREE_MORE } from './scene';
export type * from './meta';
export { cameraMeta, pagesMeta, unitsFor } from './scene-meta';

/** 읽는 가장 낮은 판(SketchUp 6). 3~5는 MFC 스키마가 달라 읽지 않는다 */
export const SKP_MIN_SUPPORTED_MAJOR = 6;
/** 2021+ 형식(VFF + ZIP)이 시작하는 판. 이보다 낮으면 MFC 객체 직렬화다 */
export const SKP_ZIP_MIN_MAJOR = 21;
/** 표본으로 확인한 가장 높은 판 */
export const SKP_MAX_CHECKED_MAJOR = 26;
/** 꾸러미 style.xml 한 파일 크기 한도 */
const MAX_STYLE_XML_BYTES = 16 * 1024 * 1024;

export interface SkpOptions {
  /** 장면 이름(보통 파일 이름) */
  name?: string;
  /**
   * 모형 바로 아래 그룹·컴포넌트마다 그물·모서리를 따로 나누고 meta.outline에 목록을 적는다(화면에서 하나씩 고르기용).
   * 기본 false(나누지 않으면 그리기 호출이 적다). 윗단계 인스턴스가 너무 많으면 나누지 않고 meta.outlineSkipped에 수를 적는다.
   */
  outline?: boolean;
  /**
   * 부드러운·매끈한 모서리와 숨긴 형상(숨긴 면·모서리·인스턴스)을 따로 묶어 장면에 더 넣는다(화면에서 켜고 끄기용).
   * 항목 id는 meta.extraItems에 적는다. 기본 false(예전처럼 그리지 않는다). 장면 범위(bounds)에는 넣지 않는다.
   */
  extras?: boolean;
  /** 매끈한 모서리로 이어진 면을 부드럽게 칠할 꼭짓점 법선(Mesh3d.normals)을 낸다. 기본 false(예전처럼 평면 음영) */
  smooth?: boolean;
  /** 진행 알림(0~1, 단계 글). 해석은 동기라 단계 안에서도 몇천 항목마다 부른다 */
  onProgress?: (fraction: number, stage: string) => void;
  /**
   * 무늬 그림(readSkpImages(bytes).materials). 주면 무늬 재질 면의 무늬 투영을 읽어 그물에 무늬 좌표(uvs)·무늬 id(texture)를 두고
   * 쓰인 그림을 scene.textures에 넣는다(바이트는 복사하지 않고 같은 배열을 쓴다). 그림 정보·색 바꾸기는 meta.textures.
   * 주지 않으면 예전처럼 무늬 평균색만 칠한다. 2020 이하는 재질 열쇠가 폴더다(readSkpImages가 같은 열쇠로 꺼낸다).
   */
  textures?: SkpImages['materials'];
  /** 무늬를 입힐 재질 수 한도(기본 MAX_SKP_TEXTURES — 넘는 재질은 평균색) */
  maxTextures?: number;
  /** 무늬 좌표를 다는 정점 수 한도(기본 scene.ts MAX_UV_VERTICES) */
  maxUvVertices?: number;
  /**
   * 미리 푼 꾸러미 항목(이름 → 풀린 바이트, 지금은 'model.dat'만 본다). 따로 푼 것을 넘기면 해석기가 다시 풀지 않는다
   * (길이가 목록의 원래 크기와 같을 때만 — 다르면 예전처럼 직접 푼다). 2021+ 파일만. 큰 파일은 skpToSceneAsync가 풀면서 읽어 더 적게 잡는다.
   * 해석기는 'model.dat' 항목을 꺼낸 뒤 이 Map에서 지운다: 모형 요소를 다 읽으면 풀린 바이트(큰 모형은 수백 MB)가
   * 장면을 만드는 동안 남지 않게 한다(부르는 쪽도 그 바이트를 따로 붙들지 않아야 놓인다)
   */
  inflated?: Map<string, Uint8Array>;
  /**
   * 파일 바이트를 다 쓰면(2021+는 꾸러미의 재질·스타일을 읽고 model.dat를 꺼낸 뒤 — 풀면서 읽으면 model.dat를 다 읽은 뒤, 2020 이하는 모형을 읽은 뒤) 그 버퍼를 떼어 놓는다
   * (ArrayBuffer.prototype.transfer(0) — 넘긴 bytes는 길이 0이 된다). 파일 바이트를 더 쓰지 않는 쪽(앱 워커)이 모형 요소를 읽고
   * 장면을 만드는 동안 파일 크기만큼 덜 잡게 켠다. bytes가 버퍼 전체를 보지 않거나 떼어 놓을 수 없으면 그대로 둔다. 켜면 그 뒤에
   * 같은 bytes로 readSkpImages를 부를 수 없다(그림은 먼저 꺼낸다). 기본 false
   */
  releaseBytes?: boolean;
}

type Transfer = (this: ArrayBuffer, newByteLength?: number) => ArrayBuffer;

/** 파일 버퍼를 떼어 놓는다(releaseBytes). 버퍼 전체를 보는 바이트만, transfer가 없거나 떼어 놓을 수 없으면 그대로 */
function releaseFile(bytes: Uint8Array): void {
  const buf = bytes.buffer;
  const transfer = (buf as unknown as { transfer?: Transfer }).transfer;
  if (typeof transfer !== 'function' || !(buf instanceof ArrayBuffer) || bytes.byteOffset !== 0 || bytes.byteLength !== buf.byteLength) return;
  try {
    transfer.call(buf, 0);
  } catch {
    /* 떼어 놓을 수 없는 버퍼는 그대로 둔다 */
  }
}

/** 무늬를 입힐 재질 수 기본 한도 */
export const MAX_SKP_TEXTURES = 256;

/** 무늬 그림 정보(meta.textures) — 화면(워커)이 그림을 풀어 알파를 재거나 색을 바꿀 때 쓴다 */
export interface SkpTextureInfo {
  /** Scene3d.textures의 id */
  id: string;
  /** 재질 표시 이름 */
  material: string;
  /** 재질 폴더(= model.dat 재질 이름) */
  folder: string;
  /** 꾸러미 안 그림 경로 */
  path: string;
  /** 무늬 한 장 크기(인치) */
  tile: [number, number];
  /** 투명 화소를 담을 수 있는 꼴(PNG 알파 등) — 실제로 쓰는지는 풀어 봐야 안다 */
  alphaPossible: boolean;
  /** 색을 바꾼 무늬(재질 type 2): 방식·재질 색(0~255)·원래 평균색 */
  colorize?: { type: 'shift' | 'tint'; color: [number, number, number]; average?: [number, number, number] };
}

type TexImage = SkpImages['materials'][number];

function emptyScene(name: string, warnings: string[], meta: Record<string, unknown>): Scene3d {
  return { name, units: 'unknown', meshes: [], lines: [], warnings, meta };
}

/** 해석 시작: 머리를 읽고 장면 이름·meta·경고·진행 알림을 둔다. SketchUp 파일이 아니면 빈 장면 */
interface Start {
  name: string;
  header: NonNullable<ReturnType<typeof readSkpHeader>>;
  meta: Record<string, unknown>;
  warnings: string[];
  progress: (f: number, stage: string) => void;
}

function startScene(bytes: Uint8Array, opts: SkpOptions): Start | Scene3d {
  const name = opts.name ?? 'SketchUp 모형';
  const progress = (f: number, stage: string): void => {
    try {
      opts.onProgress?.(f, stage);
    } catch {
      /* 알림 쪽 오류는 해석을 멈추지 않는다 */
    }
  };
  progress(0.02, '파일 머리 읽는 중');
  const header = readSkpHeader(bytes);
  if (!header) return emptyScene(name, ['SketchUp 파일이 아닙니다(머리 표지 "SketchUp Model"이 없습니다)'], { format: 'SketchUp' });
  const meta: Record<string, unknown> = { format: 'SketchUp', version: header.version, container: header.container };
  const warnings: string[] = [];
  if (header.container !== 'mfc') {
    if (header.major > SKP_MAX_CHECKED_MAJOR)
      warnings.push(`표본으로 확인하지 않은 SketchUp 버전 ${header.version}입니다. 2021~2026 형식으로 읽어 봅니다.`);
    else if (!(header.major >= SKP_ZIP_MIN_MAJOR)) warnings.push(`2021 이후 꼴(VFF + ZIP)인데 판이 ${header.version}입니다. 2021~2026 형식으로 읽어 봅니다.`);
  }
  return { name, header, meta, warnings, progress };
}

/** SketchUp 2020 이하: 객체 직렬화 하나(꾸러미·압축 없음). 무늬 그림을 먼저 꺼냈으면(readSkpImages) 그때 읽은 모형을 쓴다 */
function readMfcPackage(bytes: Uint8Array, st: Start, opts: SkpOptions): Package | Scene3d {
  const { name, header, meta, warnings, progress } = st;
  try {
    let res = takeMfcResult(bytes);
    if (!res) {
      progress(0.05, '옛 형식(2020 이하) 모형 읽는 중');
      res = readMfcModel(bytes, header, (f) => progress(0.05 + 0.59 * f, '모형 요소 읽는 중'));
      rememberMfcImages(bytes, res.images);
    }
    if (opts.releaseBytes) releaseFile(bytes);
    return { model: res.model, materials: res.materials, styles: res.styles, damaged: false, texImages: textureImages(res.materials, opts, warnings) };
  } catch (e) {
    if (e instanceof MfcRefused) {
      // 화면이 "아직 못 읽는 판" 안내를 띄우는 표시
      meta.unsupported = true;
      return emptyScene(name, [e.message], meta);
    }
    return emptyScene(name, [`SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
  }
}

/**
 * 2021+ model.dat를 어떻게 읽었는지(skpToSceneAsync onModelRead): stream 풀면서 정의를 하나씩, held 풀면서 읽었지만 정의 절은 통째로
 * 들고(재질·글꼴 절이 정의 절보다 뒤에 오거나 없음), whole 처음부터 통째로(작거나 압축이 아니거나 잘렸거나 내장 풀기가 없음),
 * shape 조각으로 읽을 수 없는 꼴(깨진 뿌리 등)이라 통째로 다시, inflate 내장 풀기가 실패해 직접 풀기
 */
export type SkpModelRead = 'stream' | 'held' | 'whole' | 'shape' | 'inflate';

/** skpToSceneAsync 선택 */
export interface SkpAsyncOptions extends SkpOptions {
  /** 압축된 model.dat가 이만큼(바이트) 이상이면 풀면서 읽는다(기본 STREAM_MIN_BYTES = 1 MiB, 0이면 압축된 모든 2021+ 파일) */
  streamMin?: number;
  /** model.dat를 어떻게 읽었는지 알린다(진단·훑기 도구용) */
  onModelRead?: (how: SkpModelRead) => void;
}

/** SKP 바이트 → 장면. 읽지 못하는 판·깨진 파일은 경고와 함께 빈(또는 일부) 장면 */
export function skpToScene(bytes: Uint8Array, opts: SkpOptions = {}): Scene3d {
  const st = startScene(bytes, opts);
  if (!('header' in st)) return st;
  let read: Package | Scene3d;
  if (st.header.container === 'mfc') read = readMfcPackage(bytes, st, opts);
  else {
    const pkg = openZipPackage(bytes, st, opts);
    read = 'modelItem' in pkg ? readPackageModel(bytes, pkg, st, opts) : pkg;
  }
  return sceneFrom(read, st, opts);
}

/**
 * skpToScene과 같은 장면을 내되, 압축된 model.dat가 opts.streamMin(기본 1 MiB) 이상인 2021+ 파일은 내장 풀기(DecompressionStream)로
 * 조각조각 풀면서 읽는다(src/modelstream.ts) — 풀린 model.dat 전체(큰 모형은 수백 MB)를 들지 않는다. 내장 풀기가 없거나 실패하면
 * skpToScene처럼 통째로 푼다. releaseBytes면 파일 바이트는 압축된 model.dat를 다 읽은 뒤 놓는다
 */
export async function skpToSceneAsync(bytes: Uint8Array, opts: SkpAsyncOptions = {}): Promise<Scene3d> {
  const st = startScene(bytes, opts);
  if (!('header' in st)) return st;
  let read: Package | Scene3d;
  if (st.header.container === 'mfc') read = readMfcPackage(bytes, st, opts);
  else {
    const pkg = openZipPackage(bytes, st, opts);
    read = 'modelItem' in pkg ? await streamPackageModel(wholeModelBytes(bytes, opts.releaseBytes), pkg, st, opts) : pkg;
  }
  return sceneFrom(read, st, opts);
}

/** skpFileToScene 선택(장면은 skpToSceneAsync와 같다 — 무늬 그림은 직접 꺼내 넘긴다) */
export interface SkpFileOptions extends Omit<SkpAsyncOptions, 'textures' | 'inflated' | 'releaseBytes'> {
  /** 그림 꺼내기 선택(readSkpImages와 같다) */
  images?: SkpImageOptions;
  /**
   * 파일을 어떻게 읽었는지 알린다(진단·훑기 도구용): parts 2021+ 꾸러미에서 필요한 자리만, whole 파일 전체
   * (2020 이하 객체 직렬화·끝 목록이 없거나 깨진 꾸러미·SketchUp 파일이 아님)
   */
  onFileRead?: (how: SkpFileRead) => void;
}

export type SkpFileRead = 'parts' | 'whole';

/** skpFileToScene 결과 */
export interface SkpFileResult {
  scene: Scene3d;
  /** 꾸러미 안 그림(readSkpImages와 같다 — 못 꺼냈으면 없음) */
  images?: SkpImages;
  /** 그림을 꺼내다 난 예외 글(장면은 그림 없이 만든다) */
  imageError?: string;
}

/**
 * 파일(Blob·File 또는 SkpSource)을 앱 워커 차례로 해석한다: 그림을 꺼내고(readSkpImages) 그 무늬 그림으로 장면(skpToSceneAsync)을 만든다.
 * 2021+ 꾸러미는 파일 전체를 들지 않는다 — 머리·끝 레코드·중앙 목록과 필요한 항목만 읽고, 압축된 model.dat는 덩이씩 읽으며 푼다(src/range.ts).
 * 결과는 파일 전체 바이트로 readSkpImages → skpToSceneAsync(같은 선택, textures = 꺼낸 무늬 그림, releaseBytes)를 부른 것과 같다.
 * 2020 이하(꾸러미 없는 객체 직렬화 — 모형을 읽으며 그림 자리를 찾는다), 끝 목록이 없거나 깨진 꾸러미(앞에서부터 항목을 찾는다),
 * SketchUp 파일이 아닌 것은 파일 전체를 읽어 그 길로 간다
 */
export async function skpFileToScene(file: Blob | SkpSource, opts: SkpFileOptions = {}): Promise<SkpFileResult> {
  const { images: imageOpts, onFileRead, ...sceneOpts } = opts;
  const src = typeof Blob !== 'undefined' && file instanceof Blob ? blobSource(file) : (file as SkpSource);
  const told = (how: SkpFileRead): void => {
    try {
      onFileRead?.(how);
    } catch {
      /* 알림 쪽 오류는 해석을 멈추지 않는다 */
    }
  };
  const head = await src.read(0, Math.min(src.size, HEAD_BYTES));
  const header = readSkpHeader(head);
  // 머리를 다 본 것이 확실할 때만(머리 문자열·VFF 블록이 읽은 바이트 안) — 아니면 파일 전체로 같은 판정을 한다
  let dir: ZipItem[] | null = null;
  if (header?.container === 'zip' && (head.length === src.size || header.bodyOffset + 16 <= head.length))
    try {
      dir = await readSourceDirectory(src);
    } catch {
      /* 깨진 끝 목록은 파일 전체로(앞에서부터 항목 찾기) */
    }
  const out = (scene: Scene3d, images: SkpImages | undefined, imageError: string | undefined): SkpFileResult => {
    const r: SkpFileResult = { scene };
    if (images) r.images = images;
    if (imageError !== undefined) r.imageError = imageError;
    return r;
  };
  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);
  let images: SkpImages | undefined;
  let imageError: string | undefined;
  if (!header || !dir || !dir.some((d) => d.name === 'model.dat')) {
    told('whole');
    const bytes = await src.read(0, src.size);
    try {
      images = readSkpImages(bytes, imageOpts);
    } catch (e) {
      imageError = errText(e);
    }
    const scene = await skpToSceneAsync(bytes, { ...sceneOpts, textures: images?.materials, releaseBytes: true });
    return out(scene, images, imageError);
  }
  told('parts');
  const items = new SourceItems(src);
  const read = (item: ZipItem): Promise<Uint8Array> => items.content(item);
  try {
    images = await runZipReadsAsync(zipImageReads(dir, imageOpts), read);
  } catch (e) {
    imageError = errText(e);
  }
  const o: SkpAsyncOptions = { ...sceneOpts, textures: images?.materials };
  const st = startScene(head, o);
  if (!('header' in st)) return out(st, images, imageError);
  st.progress(0.05, '꾸러미(ZIP) 목록 읽는 중');
  const pkg = await runZipReadsAsync(packageReads({ items: dir, salvaged: false, truncated: false }, st, o), read);
  const model: ModelBytes = {
    region: async (item) => ({ ...(await items.region(item)), release: true }),
    data: (item) => items.data(item),
    done: () => undefined,
  };
  const got = 'modelItem' in pkg ? await streamPackageModel(model, pkg, st, o) : pkg;
  return out(sceneFrom(got, st, o), images, imageError);
}

/** 중간 모형 → 장면(두 판의 해석기가 같은 중간 모형을 내서 여기는 하나다) */
function sceneFrom(read: Package | Scene3d, st: Start, opts: SkpOptions): Scene3d {
  const { name, meta, warnings, progress } = st;
  if (!('model' in read)) return read;
  const { model, materials, styles, damaged, texImages } = read;
  warnings.push(...model.warnings);

  const u = unitsFor(model.lengthUnit);
  // 무늬 재질: model.dat 재질 번호 → 무늬 id·한 장 크기
  const sceneTex = new Map<number, SceneTexture>();
  const texByMat = new Map<number, { folder: string; info: SkpMaterialInfo; img: TexImage }>();
  for (const [id, folder] of model.materials) {
    const img = texImages.get(folder);
    const info = materials.get(folder);
    if (!img || !info?.texture) continue;
    sceneTex.set(id, { id: `skp-tex-${id}`, w: info.texture.width, h: info.texture.height });
    texByMat.set(id, { folder, info, img });
  }
  // 모형 스타일(렌더링 설정 + 그 스타일의 style.xml): 재질 없는 면은 스타일 앞면 색으로 칠한다(SketchUp 기본 화면처럼)
  let style: ReturnType<typeof styleFor>;
  try {
    style = styleFor(model.rendering, styles, u.scale);
  } catch {
    warnings.push('모형 스타일을 풀지 못했습니다');
  }
  const front = style?.front;
  const back = style?.back;
  const edge = style?.edgeColor;
  // 모서리 색 "재질별·축별"(모형 스타일, 아니면 스타일을 쓰는 장면): 모서리 묶음에 정점 색을 단다
  let edgeColoring: ReturnType<typeof edgeColoringFor>;
  try {
    edgeColoring = edgeColoringFor(model, style, styles, u.scale);
  } catch {
    edgeColoring = undefined;
  }
  const axes = model.axes;
  let parts: ReturnType<typeof buildSceneParts>;
  try {
    progress(0.65, '면 삼각화·인스턴스 펼치는 중');
    const build: Parameters<typeof buildSceneParts>[3] = {
      outline: !!opts.outline,
      extras: !!opts.extras,
      smooth: !!opts.smooth,
      ...(front && front.every(Number.isFinite) ? { defaultFaceColor: [front[0], front[1], front[2], 1] as const } : {}),
      // 앞·뒤 재질이 다른 면은 뒷면 색·무늬를 따로(재질 없는 뒷면은 스타일 뒷면 색)
      ...(back && back.every(Number.isFinite) ? { defaultBackColor: [back[0], back[1], back[2], 1] as const } : {}),
      // 모형 스타일의 모서리 색(SketchUp 기본은 검정, 회색 모서리 스타일도 있다)
      ...(edge && edge.every(Number.isFinite) ? { edgeColor: [edge[0], edge[1], edge[2], 1] as const } : {}),
      ...(edgeColoring ? { edgeColoring, ...(axes ? { axes: [axes.x, axes.y, axes.z] } : {}) } : {}),
      onProgress: (f) => progress(0.65 + 0.3 * f, '면 삼각화·인스턴스 펼치는 중'),
      // 중간 모형은 여기서만 쓴다(장면 정보는 표를 읽지 않는다) — 다 놓은 정의의 표를 펼치는 동안 놓는다
      releaseModel: true,
    };
    if (sceneTex.size) build.textures = sceneTex;
    if (opts.maxUvVertices !== undefined) build.maxUvVertices = opts.maxUvVertices;
    parts = buildSceneParts(model, materials, u.scale, build);
  } catch (e) {
    return emptyScene(name, [...warnings, `장면을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
  }
  warnings.push(...parts.warnings);
  Object.assign(meta, {
    lengthUnit: u.label,
    definitions: model.definitions.size,
    instances: model.counts.instances,
    faces: model.counts.faces,
    edges: model.counts.edges,
    materials: model.materials.size,
    tags: [...model.layers.values()],
    triangles: parts.stats.triangles,
    segments: parts.stats.segments,
    tagStats: parts.tags,
    materialStats: parts.materials,
  });
  if (parts.outline) meta.outline = parts.outline;
  if (parts.outlineSkipped) meta.outlineSkipped = parts.outlineSkipped;
  if (parts.tree) meta.tree = parts.tree;
  if (parts.extras) meta.extraItems = parts.extras;
  // 면·곡선 고르기(화면의 면 넓이·곡선 길이): 그물마다 면 경계, 모서리 묶음마다 선분의 곡선 번호
  meta.faceRuns = parts.faceRuns;
  if (parts.segmentCurves) meta.segmentCurves = parts.segmentCurves;
  if (parts.edgeColoring) meta.edgeColoring = parts.edgeColoring;
  Object.assign(meta, extrasMeta(model, u.scale, styles, style, parts, warnings));
  // 화면이 알림을 띄울지 가리는 표시: 깨지거나 잘린 곳(damaged), 출력 한도(limited)
  if (damaged || model.damaged) meta.damaged = true;
  if (parts.limited) meta.limited = true;
  const scene: Scene3d = { name, units: u.units, meshes: parts.meshes, lines: parts.lines, warnings, meta };
  if (parts.points.length) scene.points = parts.points;
  if (parts.bounds) scene.bounds = parts.bounds;
  // 그물이 쓰는 무늬만 장면에 넣는다
  if (sceneTex.size) {
    const used = new Set<string>();
    for (const m of scene.meshes) {
      if (m.texture) used.add(m.texture);
      if (m.backTexture) used.add(m.backTexture);
    }
    const textures: Texture3d[] = [];
    const infos: SkpTextureInfo[] = [];
    for (const [id, t] of sceneTex) {
      if (!used.has(t.id)) continue;
      const { folder, info, img } = texByMat.get(id)!;
      const head = imageInfo(img.bytes);
      const tex: Texture3d = { id: t.id, data: img.bytes, mime: img.mime };
      if (head?.width && head.height) {
        tex.width = head.width;
        tex.height = head.height;
      }
      textures.push(tex);
      const ti: SkpTextureInfo = { id: t.id, material: info.name, folder, path: img.path, tile: [t.w, t.h], alphaPossible: head?.alpha ?? true };
      if (info.colorize) {
        const c = info.color;
        ti.colorize = { type: info.colorize, color: [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)] };
        if (info.texture?.average) ti.colorize.average = info.texture.average;
      }
      infos.push(ti);
    }
    if (textures.length) {
      scene.textures = textures;
      meta.textures = infos;
    }
  }
  return scene;
}

/** 해석기 하나가 낸 것: 중간 모형, 재질 이름 → 색, 스타일 이름 → 항목, 꾸러미·압축이 깨졌는지 */
interface Package {
  model: SkpModel;
  materials: Map<string, SkpMaterialInfo>;
  styles: Map<string, Map<number, string>>;
  damaged: boolean;
  /** 무늬를 입힐 재질 폴더 → 그림(2021+ 꾸러미에서 textures를 받았을 때) */
  texImages: Map<string, TexImage>;
}

/** 2021+ 꾸러미를 열어 재질·스타일·무늬 그림까지 읽은 것(model.dat는 아직 꺼내지 않았다) */
interface OpenPackage {
  modelItem: ZipItem;
  /** 끝 목록이 없거나 깨져 앞에서부터 항목을 찾았다 */
  salvaged: boolean;
  materials: Map<string, SkpMaterialInfo>;
  styles: Map<string, Map<number, string>>;
  damaged: boolean;
  texImages: Map<string, TexImage>;
}

/** 2021+ 꾸러미(ZIP): 목록과 material.xml·style.xml·무늬 그림. 꾸러미나 model.dat를 찾지 못하면 경고와 빈 장면 */
function openZipPackage(bytes: Uint8Array, st: Start, opts: Pick<SkpOptions, 'textures' | 'maxTextures'>): OpenPackage | Scene3d {
  let found: FoundZip;
  try {
    st.progress(0.05, '꾸러미(ZIP) 목록 읽는 중');
    found = findSkpZipItems(bytes, st.header.bodyOffset);
  } catch (e) {
    return emptyScene(st.name, [...st.warnings, `SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], st.meta);
  }
  return runZipReads(packageReads(found, st, opts), bytes);
}

type FoundZip = ReturnType<typeof findSkpZipItems>;

/** 꾸러미 목록(found)에서 재질·스타일을 읽는다(openZipPackage의 목록 뒤 — 항목 내용은 내어 받는다: runZipReads·range.ts) */
function* packageReads(found: FoundZip, st: Start, opts: Pick<SkpOptions, 'textures' | 'maxTextures'>): ZipReads<OpenPackage | Scene3d> {
  const { name, meta, warnings, progress } = st;
  const materials = new Map<string, SkpMaterialInfo>();
  /** 무늬를 입힐 재질 폴더 → 그림 */
  const texImages = new Map<string, TexImage>();
  /** 꾸러미의 styles/<폴더>/style.xml(폴더 이름 = 스타일 이름) */
  const styles = new Map<string, Map<number, string>>();
  let damaged = false;
  try {
    const dir = found.items;
    if (!dir) return emptyScene(name, [found.error ? `SketchUp 꾸러미(ZIP)가 깨졌습니다: ${found.error}` : 'SketchUp 꾸러미(ZIP)를 찾지 못했습니다 — 파일이 잘렸거나(끝까지 받지 못함) 깨졌을 수 있습니다'], meta);
    const modelItem = dir.find((d) => d.name === 'model.dat');
    if (!modelItem)
      return emptyScene(
        name,
        [found.salvaged || found.truncated ? '파일이 잘렸거나 깨져 model.dat를 찾지 못했습니다(파일을 끝까지 받았는지 확인해 주세요)' : '꾸러미에 model.dat가 없습니다'],
        meta,
      );
    if (found.salvaged) {
      damaged = true;
      warnings.push('파일 끝의 꾸러미(ZIP) 목록이 없거나 깨져, 앞에서부터 항목을 찾아 읽었습니다 — 파일이 잘렸을 수 있습니다');
    }
    const text = new TextDecoder('utf-8');
    progress(0.1, '재질 읽는 중');
    for (const item of dir) {
      const sm = /^styles\/(.+)\/style\.xml$/.exec(item.name);
      if (sm) {
        // 한 파일 16 MiB까지(참조 해석기와 같은 한도 — 스타일 글은 보통 수십 KB)
        if (item.size > MAX_STYLE_XML_BYTES) {
          warnings.push(`스타일 파일이 너무 커서 건너뛰었습니다: ${item.name}`);
          continue;
        }
        try {
          styles.set(sm[1]!, parseStyleXml(text.decode(yield item)));
        } catch {
          warnings.push(`스타일 파일을 읽지 못했습니다: ${item.name}`);
        }
        continue;
      }
      const m = /^materials\/(.+)\/material\.xml$/.exec(item.name);
      if (!m) continue;
      try {
        const info = parseMaterialXml(text.decode(yield item));
        if (!info) continue;
        // model.dat의 재질 이름은 폴더 이름과 같고(예: '<Black>' → '_Black_'), XML의 name은 원래 이름이다 → 둘 다로 찾는다
        materials.set(m[1]!, info);
        if (!materials.has(info.name)) materials.set(info.name, info);
      } catch {
        warnings.push(`재질 파일을 읽지 못했습니다: ${item.name}`);
      }
    }
    // 무늬: 그림이 있는 무늬 재질만(재질 폴더 = model.dat 재질 이름). 한도를 넘는 재질은 평균색
    const folders: string[] = [];
    for (const item of dir) {
      const m = /^materials\/(.+)\/material\.xml$/.exec(item.name);
      if (m) folders.push(m[1]!);
    }
    for (const [k, v] of textureImages(materials, opts, warnings, folders)) texImages.set(k, v);
    return { modelItem, salvaged: found.salvaged, materials, styles, damaged, texImages };
  } catch (e) {
    return emptyScene(name, [...warnings, `SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
  }
}

/** model.dat를 통째로 꺼내(미리 푼 것, 아니면 직접 풀기·깨졌으면 앞부분) 모형으로 */
function readPackageModel(bytes: Uint8Array, pkg: OpenPackage, st: Start, opts: Pick<SkpOptions, 'inflated' | 'releaseBytes'>): Package | Scene3d {
  const { name, meta, warnings, progress } = st;
  const { modelItem, materials, styles, texImages } = pkg;
  let damaged = pkg.damaged;
  let model: SkpModel;
  try {
    progress(0.2, 'model.dat 푸는 중');
    const unpacking = (f: number): void => progress(0.2 + 0.19 * f, 'model.dat 푸는 중');
    // 미리 푼 바이트는 꺼내고 Map에서 지운다(쓰지 않는 길이여도) — 이 함수가 끝나면 장면을 만드는 동안 붙드는 곳이 없다
    const pre = opts.inflated?.get('model.dat');
    opts.inflated?.delete('model.dat');
    let dat: Uint8Array;
    if (pkg.salvaged || modelItem.truncated) {
      const part = readZipItemPartial(bytes, modelItem, unpacking);
      dat = part.data;
      if (!part.complete) {
        damaged = true;
        warnings.push('model.dat가 잘렸거나 압축이 깨져 앞부분만 읽었습니다 — 일부 형상이 빠졌을 수 있습니다');
      }
    } else {
      try {
        dat = pre && pre.length === modelItem.size ? pre : readZipItem(bytes, modelItem, unpacking);
      } catch (e) {
        // 압축이 중간에 깨졌으면 앞부분이라도
        const part = readZipItemPartial(bytes, modelItem);
        if (part.data.length < 6) throw e;
        dat = part.data;
        damaged = true;
        warnings.push(`model.dat를 끝까지 풀지 못해 앞부분만 읽었습니다(${e instanceof Error ? e.message : String(e)})`);
      }
    }
    // 파일 바이트는 여기까지 쓴다(꺼낸 model.dat·재질·스타일은 사본이다)
    if (opts.releaseBytes) releaseFile(bytes);
    progress(0.4, '모형 요소 읽는 중');
    model = readModelDat(dat, (f) => progress(0.4 + 0.24 * f, '모형 요소 읽는 중'), { textured: texImages.keys() });
  } catch (e) {
    return emptyScene(name, [...warnings, `SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
  }
  return { model, materials, styles, damaged, texImages };
}

/**
 * 2021+ model.dat를 읽을 바이트를 주는 곳: 파일 전체 바이트(wholeModelBytes — skpToSceneAsync), 또는 필요한 자리만 파일에서 읽는 곳
 * (src/range.ts — skpFileToScene)
 */
interface ModelBytes {
  /** 항목의 지역 머리부터 내용 끝까지 바이트와 그 안 위치로 고친 항목(파일 전체 바이트면 파일과 항목 그대로), 다 쓰면 떼어 놓을지 */
  region(item: ZipItem): Promise<{ bytes: Uint8Array; item: ZipItem; release: boolean }>;
  /** 압축된 내용(풀면서 읽기). 지역 머리가 깨졌거나 내용이 파일 끝을 넘으면 Error(zipItemData와 같다) */
  data(item: ZipItem): Promise<InflateInput>;
  /** 풀면서 읽기로 압축된 model.dat를 다 읽었다(파일 바이트를 더 쓰지 않는다) */
  done(): void;
}

/** 파일 전체 바이트로 ModelBytes(releaseBytes면 다 쓴 뒤 그 버퍼를 떼어 놓는다) */
function wholeModelBytes(bytes: Uint8Array, releaseBytes: boolean | undefined): ModelBytes {
  return {
    region: async (item) => ({ bytes, item, release: !!releaseBytes }),
    data: async (item) => zipItemData(bytes, item),
    done: () => {
      if (releaseBytes) releaseFile(bytes);
    },
  };
}

/**
 * model.dat를 내장 풀기로 풀면서 읽는다(skpToSceneAsync·skpFileToScene). 압축이 아니거나 작거나 잘렸거나 미리 푼 바이트를 받았거나 내장 풀기가 없으면
 * readPackageModel. 풀기가 실패하면 예전에 미리 풀기가 실패했을 때처럼 직접 풀고, 조각으로 읽을 수 없는 꼴이면 통째로 풀어 읽는다(같은 결과)
 */
async function streamPackageModel(
  src: ModelBytes,
  pkg: OpenPackage,
  st: Start,
  opts: Pick<SkpAsyncOptions, 'inflated' | 'streamMin' | 'onModelRead'>,
): Promise<Package | Scene3d> {
  const told = (how: SkpModelRead): void => {
    try {
      opts.onModelRead?.(how);
    } catch {
      /* 알림 쪽 오류는 해석을 멈추지 않는다 */
    }
  };
  const item = pkg.modelItem;
  /** 통째로 읽기(readPackageModel) — 항목 바이트를 받아 */
  const whole = async (inflated: Map<string, Uint8Array> | undefined): Promise<Package | Scene3d> => {
    const r = await src.region(item);
    return readPackageModel(r.bytes, { ...pkg, modelItem: r.item }, st, { inflated, releaseBytes: r.release });
  };
  let data: InflateInput | undefined;
  if (
    !pkg.salvaged &&
    !item.truncated &&
    item.method === 8 &&
    item.compressedSize >= (opts.streamMin ?? STREAM_MIN_BYTES) &&
    !opts.inflated?.has('model.dat') &&
    typeof DecompressionStream !== 'undefined'
  )
    try {
      data = await src.data(item);
    } catch {
      /* 지역 머리가 깨졌으면 예전 길 */
    }
  if (!data) {
    told('whole');
    return whole(opts.inflated);
  }
  const { name, meta, warnings, progress } = st;
  progress(0.4, '모형 요소 읽는 중');
  let res: Awaited<ReturnType<typeof streamModelDat>>;
  try {
    res = await streamModelDat(data, item.size, { textured: pkg.texImages.keys() }, (f) => progress(0.4 + 0.24 * f, '모형 요소 읽는 중'));
  } catch (e) {
    return emptyScene(name, [...warnings, `SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
  }
  told(typeof res === 'string' ? res : res.held ? 'held' : 'stream');
  data = undefined;
  if (typeof res !== 'string') {
    // 파일 바이트(압축된 model.dat)는 다 읽었다
    src.done();
    return { model: res.model, materials: pkg.materials, styles: pkg.styles, damaged: pkg.damaged, texImages: pkg.texImages };
  }
  if (res === 'inflate') return whole(undefined);
  // 조각으로 읽을 수 없는 꼴: 내장 풀기로 통째로 풀어 한 버퍼로
  const r = await src.region(item);
  const pre = await inflateNative(zipItemData(r.bytes, r.item), item.size);
  return readPackageModel(r.bytes, { ...pkg, modelItem: r.item }, st, { inflated: pre ? new Map([['model.dat', pre]]) : undefined, releaseBytes: r.release });
}

/**
 * 무늬를 입힐 재질 폴더 → 그림. 무늬 정보(크기)가 있고 그림을 받은 재질만, 폴더 차례(2021+는 꾸러미 차례, 2020 이하는 재질 차례)대로
 * maxTextures개까지(넘는 재질은 평균색으로 그리고 경고). 2020 이하의 폴더는 재질 열쇠(readSkpImages가 같은 열쇠로 그림을 꺼낸다)
 */
function textureImages(
  materials: ReadonlyMap<string, SkpMaterialInfo>,
  opts: Pick<SkpOptions, 'textures' | 'maxTextures'>,
  warnings: string[],
  folders: Iterable<string> = materials.keys(),
): Map<string, TexImage> {
  const out = new Map<string, TexImage>();
  if (!opts.textures?.length) return out;
  const byFolder = new Map(opts.textures.map((t) => [t.folder, t] as const));
  const max = opts.maxTextures ?? MAX_SKP_TEXTURES;
  let skipped = 0;
  for (const folder of folders) {
    const img = byFolder.get(folder);
    if (!materials.get(folder)?.texture || !img || out.has(folder)) continue;
    if (out.size >= max) skipped++;
    else out.set(folder, img);
  }
  if (skipped) warnings.push(`무늬 재질이 너무 많아(${max}개 한도) ${skipped}개는 평균색으로 그렸습니다`);
  return out;
}

/** 뿌리 절·주석·나무 정보 → meta에 더할 칸(src/meta.ts SkpMetaExtras). 없거나 풀지 못한 칸은 빠진다 */
function extrasMeta(
  model: SkpModel,
  scale: number,
  styles: Map<string, Map<number, string>>,
  style: SkpMetaExtras['style'],
  parts: ReturnType<typeof buildSceneParts>,
  warnings: string[],
): SkpMetaExtras {
  const out: SkpMetaExtras = {};
  if (model.units) out.units = model.units;
  const cam = cameraMeta(model.camera, scale);
  if (cam) out.camera = cam;
  if (style) out.style = style;
  try {
    if (model.pages?.length) {
      const p = pagesMeta(model, scale, { styles, nodePids: parts.nodePids, sectionPids: parts.sectionPids });
      out.pages = p.pages;
      if (p.activePage !== undefined) out.activePage = p.activePage;
    }
  } catch (e) {
    warnings.push(`장면 목록을 풀지 못했습니다(${e instanceof Error ? e.message : String(e)})`);
  }
  if (model.animation?.loop !== undefined) out.animation = { loop: model.animation.loop };
  try {
    const loc = locationMeta(model);
    if (loc) out.location = loc;
    if (model.shadowInfo) out.shadow = shadowMeta(model.shadowInfo);
    const ax = axesMeta(model.axes, scale);
    if (ax) out.axes = ax;
  } catch {
    warnings.push('위치·그림자·그리기 축을 풀지 못했습니다');
  }
  if (parts.revealItems?.length) out.revealItems = parts.revealItems;
  if (model.tagFolders?.length) out.tagFolders = model.tagFolders.map((f) => ({ name: f.name, visible: f.visible !== false, parent: f.parent }));
  if (model.name) out.modelName = model.name;
  if (model.description) out.modelDescription = model.description;
  if (parts.texts) out.texts = parts.texts;
  if (parts.dimensions) out.dimensions = parts.dimensions;
  if (parts.sectionPlanes) out.sectionPlanes = parts.sectionPlanes;
  if (parts.annotationItems) out.annotationItems = parts.annotationItems;
  if (parts.annotationRuns) out.annotationRuns = parts.annotationRuns;
  if (parts.annotationMarks) out.annotationMarks = parts.annotationMarks;
  if (parts.attributes) out.attributes = parts.attributes;
  if (parts.modelAttrs !== undefined) out.modelAttrs = parts.modelAttrs;
  if (parts.treeInfo) out.treeInfo = parts.treeInfo;
  return out;
}
