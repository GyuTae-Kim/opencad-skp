/**
 * SketchUp 2021 이후 꾸러미의 materials/<이름>/material.xml에서 재질 색·무늬를 읽는다.
 * 관찰한 꼴: <mat:material name="…" type="0|1|2" colorRed=".." colorGreen=".." colorBlue=".." colorizeType="0|1" trans=".." useTrans="0|1" hasTexture="0|1" …>
 *   무늬 재질은 안에 <mat:texture textureFilename="…" xScale="…" yScale="…" avgColor="…"><mat:images><mat:image path="./a.png" file_name="a.png"/>…
 * 무늬(텍스처) 재질도 colorRed/Green/Blue를 갖고 있어(무늬 평균색으로 보임) 그 색을 쓴다.
 * type 2(색을 바꾼 무늬)는 colorRed…가 바꾼 색이고 avgColor가 원래 그림 평균색이다(화면이 그림 화소의 색을 바꿔 칠한다 — colorize.ts).
 * 워커에서도 돌게 DOMParser 없이 시작 꼬리표의 속성만 정규식으로 읽는다.
 */

import type { Rgba } from 'opencad-viewer3d/types';

/** 재질 무늬(material.xml의 texture 꼬리표) */
export interface SkpMaterialTexture {
  /** 무늬 한 장의 가로·세로(인치, xScale·yScale) — 면 위에서 이 길이마다 되풀이한다 */
  width: number;
  height: number;
  /** 꾸러미 안 그림 파일 이름(image path 또는 file_name, 재질 폴더 기준). 없으면 폴더의 첫 그림 */
  file?: string;
  /** 원래 그림 평균색(avgColor, 0~255) */
  average?: [number, number, number];
}

export interface SkpMaterialInfo {
  name: string;
  color: Rgba;
  textured: boolean;
  /** 무늬 정보(hasTexture가 0이 아니고 texture 꼬리표가 있을 때) */
  texture?: SkpMaterialTexture;
  /** 색을 바꾼 무늬(type 2)면 바꾸는 방식: shift(colorizeType 0, 기본) · tint(1) */
  colorize?: 'shift' | 'tint';
}

const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENT[e] ?? m;
  });
}

/** 시작 꼬리표 하나의 속성(이름 공간 앞붙이는 꼬리표 이름에서만 뗀다) */
function tagAttrs(xml: string, tag: string): Map<string, string> | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)>`).exec(xml);
  if (!m) return null;
  const attrs = new Map<string, string>();
  for (const a of m[1]!.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs.set(a[1]!, unescapeXml(a[2]!));
  return attrs;
}

/** ABGR 정수(avgColor, 부호 있게 적힌 것도) → rgb 0~255 */
export function abgrColor(v: string | undefined): [number, number, number] | undefined {
  if (v === undefined || !/^\s*-?\d+\s*$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < -(2 ** 31) || n >= 2 ** 32) return undefined;
  const u = n >>> 0;
  return [u & 255, (u >>> 8) & 255, (u >>> 16) & 255];
}

/** 무늬 그림 경로 → 재질 폴더 안 파일 이름('./a.png' → 'a.png', 'materials/폴더/a.png' → 'a.png') */
function imageFile(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const p = path.replace(/\\/g, '/');
  const f = p.startsWith('./') ? p.slice(2) : p.slice(p.lastIndexOf('/') + 1);
  return f || undefined;
}

/** material.xml 글 → 재질 정보(없으면 null) */
export function parseMaterialXml(xml: string): SkpMaterialInfo | null {
  const attrs = tagAttrs(xml, 'material');
  if (!attrs) return null;
  const name = attrs.get('name');
  if (name === undefined) return null;
  const ch = (k: string): number => {
    const v = Number(attrs.get(k));
    return Number.isFinite(v) ? Math.min(255, Math.max(0, v)) / 255 : 0.8;
  };
  // 불투명도: useTrans=1이고 0<trans<1일 때만 trans를 알파로 쓴다.
  // (trans=0·useTrans=1인 재질이 미리보기 그림에서 불투명하게 보여, 0은 불투명으로 둔다 — 확실하지 않음)
  let alpha = 1;
  const trans = Number(attrs.get('trans'));
  if (attrs.get('useTrans') === '1' && Number.isFinite(trans) && trans > 0 && trans < 1) alpha = Math.max(0.15, trans);
  // 무늬: hasTexture가 0이 아니면 texture 꼬리표를 본다(그 뒤의 첫 image가 무늬 그림 — PBR 그림 꼬리표는 그 뒤에 온다)
  const at = attrs.get('hasTexture') !== '0' ? xml.search(/<(?:[\w-]+:)?texture\b/) : -1;
  const tex = at >= 0 ? tagAttrs(xml.slice(at), 'texture') : null;
  const info: SkpMaterialInfo = {
    name,
    color: [ch('colorRed'), ch('colorGreen'), ch('colorBlue'), alpha],
    textured: attrs.get('hasTexture') === '1' || (!attrs.has('hasTexture') && !!tex),
  };
  if (tex) {
    const size = (k: string): number => {
      const v = Number(tex.get(k));
      return Number.isFinite(v) && v > 0 ? v : 1;
    };
    const t: SkpMaterialTexture = { width: size('xScale'), height: size('yScale') };
    const img = tagAttrs(xml.slice(at), 'image');
    const file = imageFile(img?.get('path')) ?? imageFile(img?.get('file_name')) ?? imageFile(tex.get('textureFilename'));
    if (file) t.file = file;
    const avg = abgrColor(tex.get('avgColor'));
    if (avg) t.average = avg;
    info.texture = t;
    if (attrs.get('type') === '2') info.colorize = attrs.get('colorizeType') === '1' ? 'tint' : 'shift';
  }
  return info;
}
