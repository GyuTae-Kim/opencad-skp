/**
 * SketchUp 2021 이후 꾸러미의 materials/<이름>/material.xml에서 재질 색·무늬를 읽는다.
 * 관찰한 꼴: <mat:material name="…" type="0|1|2" colorRed=".." colorGreen=".." colorBlue=".." colorizeType="0|1" trans=".." useTrans="0|1" hasTexture="0|1" …>
 *   무늬 재질은 안에 <mat:texture textureFilename="…" xScale="…" yScale="…" avgColor="…"><mat:images><mat:image path="./a.png" file_name="a.png"/>…
 * 무늬(텍스처) 재질도 colorRed/Green/Blue를 갖고 있어(무늬 평균색으로 보임) 그 색을 쓴다.
 * type 2(색을 바꾼 무늬)는 colorRed…가 바꾼 색이고 avgColor가 원래 그림 평균색이다(화면이 그림 화소의 색을 바꿔 칠한다 — colorize.ts).
 * 워커에서도 돌게 DOMParser 없이 시작 꼬리표의 속성만 정규식으로 읽는다.
 *
 * 재질 속성 사전: <mat:material> 끝에 <n0:AttributeDictionaries count><n0:AttributeDictionary name count><n0:Attribute key type>값</n0:Attribute>…
 * (n0 = http://sketchup.google.com/schemas/1.0/types). type은 2020 이하 형 있는 값과 같은 꼴 번호다 — 관찰한 꼴(실제 파일 31개·표준 파일):
 * 10 글(CDATA), 4 정수, 6 실수, 7 참·거짓(0·1), 11 배열(count + <value type>…). 그 밖의 꼴은 적힌 글 그대로 둔다.
 */

import type { SkpAttr, SkpAttrDicts } from './model';
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
  /** 재질 속성 사전(2021+ material.xml의 n0:AttributeDictionaries, 2020 이하 CMaterial 앞머리) — 있을 때만 */
  attrs?: SkpAttrDicts;
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

/** 속성 사전 블록의 요소(이름 공간 앞붙이를 뗀 이름, 글 = CDATA·글을 이은 것) */
interface XmlEl {
  name: string;
  attrs: Map<string, string>;
  text: string;
  kids: XmlEl[];
}

/** CDATA · 주석 · 처리 지시 · 꼬리표(1 닫음, 2 이름, 3 속성, 4 빈 요소) · 글(5) */
const XML_TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)(?:[\w.-]+:)?([\w.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|</g;
/** 배열 안 배열 깊이 한도(2020 이하 형 있는 값과 같게) */
const MAX_ATTR_DEPTH = 32;

/** __proto__ 같은 열쇠도 보통 칸으로 */
function put<T>(o: Record<string, T>, k: string, v: T): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** xml의 from에서 시작하는 요소 하나를 나무로(닫히지 않으면 끝까지 읽은 데까지) */
function xmlElement(xml: string, from: number): XmlEl | undefined {
  const top: XmlEl = { name: '', attrs: new Map(), text: '', kids: [] };
  const stack = [top];
  const re = new RegExp(XML_TOKEN.source, 'g');
  re.lastIndex = from;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const cur = stack[stack.length - 1]!;
    if (m[1] !== undefined) cur.text += m[1];
    else if (m[3] !== undefined) {
      if (m[2]) {
        // 닫는 꼬리표: 같은 이름의 열린 요소까지 닫는다(어긋난 닫음은 건너뛴다)
        let i = stack.length - 1;
        while (i > 0 && stack[i]!.name !== m[3]) i--;
        if (i > 0) stack.length = i;
      } else {
        const el: XmlEl = { name: m[3], attrs: new Map(), text: '', kids: [] };
        for (const a of m[4]!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs.set(a[1]!, unescapeXml(a[2] ?? a[3] ?? ''));
        cur.kids.push(el);
        if (!m[5]) stack.push(el);
      }
      if (stack.length === 1) break;
    } else if (m[6] !== undefined) cur.text += unescapeXml(m[6]);
  }
  return top.kids[0];
}

/** n0:Attribute·value 하나의 값(꼴 번호는 2020 이하 형 있는 값과 같다 — 모르는 꼴·맞지 않는 글은 글 그대로) */
function attrValue(el: XmlEl, depth: number): SkpAttr {
  const s = el.text;
  const v = s.trim();
  switch (el.attrs.get('type')) {
    case '4':
      return /^[-+]?\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : s;
    case '6':
      return v && Number.isFinite(Number(v)) ? Number(v) : s;
    case '7':
      return v === '1' ? true : v === '0' ? false : s;
    case '11':
      return depth >= MAX_ATTR_DEPTH ? [] : el.kids.filter((k) => k.name === 'value').map((k) => attrValue(k, depth + 1));
    default:
      return s;
  }
}

/** material.xml 글 → 재질 속성 사전(사전 이름 → 열쇠 → 값, 같은 이름은 뒤 것이 이긴다). 없으면 undefined */
export function parseMaterialAttrs(xml: string): SkpAttrDicts | undefined {
  const at = xml.search(/<(?:[\w.-]+:)?AttributeDictionaries\b/);
  const block = at >= 0 ? xmlElement(xml, at) : undefined;
  let out: SkpAttrDicts | undefined;
  for (const d of block?.kids ?? []) {
    if (d.name !== 'AttributeDictionary') continue;
    const entries: Record<string, SkpAttr> = {};
    for (const a of d.kids) {
      const key = a.attrs.get('key');
      if (a.name === 'Attribute' && key !== undefined) put(entries, key, attrValue(a, 0));
    }
    put((out ??= {}), d.attrs.get('name') ?? '', entries);
  }
  return out;
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
  const dicts = parseMaterialAttrs(xml);
  if (dicts) info.attrs = dicts;
  return info;
}
