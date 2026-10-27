/**
 * SketchUp(.skp) 해석기. 형식 지식은 공개 표본 바이트로 추론한 것에 PRISME 엔진(SketchUp C API를 비교 기준으로 맞춘 해석기)의
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
import type { SkpImages } from './images';
import { parseMaterialXml, type SkpMaterialInfo } from './materials';
import type { SkpMetaExtras } from './meta';
import { MfcRefused, readMfcModel, rememberMfcImages, takeMfcResult } from './mfcmodel';
import { readModelDat, type SkpModel } from './model';
import { buildSceneParts, type SceneTexture } from './scene';
import { axesMeta, cameraMeta, locationMeta, pagesMeta, shadowMeta, styleFor, unitsFor } from './scene-meta';
import { parseStyleXml } from './styles';
import { findSkpZipItems, readZipItem, readZipItemPartial } from './zip';

export { readSkpHeader, type SkpHeader } from './header';
export { readModelDat, type SkpModel } from './model';
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
   * 미리 푼 꾸러미 항목(이름 → 풀린 바이트, 지금은 'model.dat'만 본다). 워커가 브라우저 내장 풀기로 먼저 푼 것을 넘기면
   * 해석기가 다시 풀지 않는다(길이가 목록의 원래 크기와 같을 때만 — 다르면 예전처럼 직접 푼다). 2021+ 파일만
   */
  inflated?: ReadonlyMap<string, Uint8Array>;
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

/** SKP 바이트 → 장면. 읽지 못하는 판·깨진 파일은 경고와 함께 빈(또는 일부) 장면 */
export function skpToScene(bytes: Uint8Array, opts: SkpOptions = {}): Scene3d {
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
  let read: Package | Scene3d;
  if (header.container === 'mfc') {
    // SketchUp 2020 이하: 객체 직렬화 하나(꾸러미·압축 없음). 무늬 그림을 먼저 꺼냈으면(readSkpImages) 그때 읽은 모형을 쓴다
    try {
      let res = takeMfcResult(bytes);
      if (!res) {
        progress(0.05, '옛 형식(2020 이하) 모형 읽는 중');
        res = readMfcModel(bytes, header, (f) => progress(0.05 + 0.59 * f, '모형 요소 읽는 중'));
        rememberMfcImages(bytes, res.images);
      }
      read = { model: res.model, materials: res.materials, styles: res.styles, damaged: false, texImages: textureImages(res.materials, opts, warnings) };
    } catch (e) {
      if (e instanceof MfcRefused) {
        // 화면이 "아직 못 읽는 판" 안내를 띄우는 표시
        meta.unsupported = true;
        return emptyScene(name, [e.message], meta);
      }
      return emptyScene(name, [`SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
    }
  } else {
    if (header.major > SKP_MAX_CHECKED_MAJOR)
      warnings.push(`표본으로 확인하지 않은 SketchUp 버전 ${header.version}입니다. 2021~2026 형식으로 읽어 봅니다.`);
    else if (!(header.major >= SKP_ZIP_MIN_MAJOR)) warnings.push(`2021 이후 꼴(VFF + ZIP)인데 판이 ${header.version}입니다. 2021~2026 형식으로 읽어 봅니다.`);
    read = readZipPackage(bytes, header.bodyOffset, name, meta, warnings, progress, opts);
  }
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
      onProgress: (f) => progress(0.65 + 0.3 * f, '면 삼각화·인스턴스 펼치는 중'),
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

/** 2021+ 꾸러미(ZIP): material.xml·style.xml과 model.dat. 꾸러미를 찾지 못하면 경고와 빈 장면 */
function readZipPackage(
  bytes: Uint8Array,
  bodyOffset: number,
  name: string,
  meta: Record<string, unknown>,
  warnings: string[],
  progress: (f: number, stage: string) => void,
  opts: Pick<SkpOptions, 'textures' | 'maxTextures' | 'inflated'> = {},
): Package | Scene3d {
  let model: SkpModel;
  const materials = new Map<string, SkpMaterialInfo>();
  /** 무늬를 입힐 재질 폴더 → 그림 */
  const texImages = new Map<string, TexImage>();
  /** 꾸러미의 styles/<폴더>/style.xml(폴더 이름 = 스타일 이름) */
  const styles = new Map<string, Map<number, string>>();
  let damaged = false;
  try {
    progress(0.05, '꾸러미(ZIP) 목록 읽는 중');
    const found = findSkpZipItems(bytes, bodyOffset);
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
      const st = /^styles\/(.+)\/style\.xml$/.exec(item.name);
      if (st) {
        // 한 파일 16 MiB까지(엔진과 같은 한도 — 스타일 글은 보통 수십 KB)
        if (item.size > MAX_STYLE_XML_BYTES) {
          warnings.push(`스타일 파일이 너무 커서 건너뛰었습니다: ${item.name}`);
          continue;
        }
        try {
          styles.set(st[1]!, parseStyleXml(text.decode(readZipItem(bytes, item))));
        } catch {
          warnings.push(`스타일 파일을 읽지 못했습니다: ${item.name}`);
        }
        continue;
      }
      const m = /^materials\/(.+)\/material\.xml$/.exec(item.name);
      if (!m) continue;
      try {
        const info = parseMaterialXml(text.decode(readZipItem(bytes, item)));
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
    progress(0.2, 'model.dat 푸는 중');
    const unpacking = (f: number): void => progress(0.2 + 0.19 * f, 'model.dat 푸는 중');
    let dat: Uint8Array;
    if (found.salvaged || modelItem.truncated) {
      const part = readZipItemPartial(bytes, modelItem, unpacking);
      dat = part.data;
      if (!part.complete) {
        damaged = true;
        warnings.push('model.dat가 잘렸거나 압축이 깨져 앞부분만 읽었습니다 — 일부 형상이 빠졌을 수 있습니다');
      }
    } else {
      const pre = opts.inflated?.get('model.dat');
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
    progress(0.4, '모형 요소 읽는 중');
    model = readModelDat(dat, (f) => progress(0.4 + 0.24 * f, '모형 요소 읽는 중'), { textured: texImages.keys() });
  } catch (e) {
    return emptyScene(name, [...warnings, `SketchUp 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`], meta);
  }
  return { model, materials, styles, damaged, texImages };
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
  if (parts.attributes) out.attributes = parts.attributes;
  if (parts.modelAttrs !== undefined) out.modelAttrs = parts.modelAttrs;
  if (parts.treeInfo) out.treeInfo = parts.treeInfo;
  return out;
}
