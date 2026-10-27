/**
 * 모형 단위로 길이·면적·부피·각도 글 만들기(순수 함수). SketchUp의 모형 정보 › 단위 규칙을 따른다.
 *   - decimal: 길이 단위로 소수 precision자리, architectural: 피트 + 인치 + 분수(precision n = 1/2^n 인치),
 *     fractional: 인치 + 분수, engineering: 소수 피트.
 *   - 반올림된 값은 SketchUp처럼 앞에 "~ "를 붙인다. 장면 좌표가 float32라 정확한 길이도 2368.800012 mm처럼 오므로
 *     값의 상대 1e-6(또는 부른 쪽의 절대 허용치)보다 크게 다를 때만 반올림으로 본다.
 *   - 미터계 기호는 한 칸 띄우고("12 mm"), 피트·인치 기호는 붙인다(1' 2 3/8").
 *   - suppressUnits(단위 숨김)는 decimal 형식에서만 기호를 숨긴다(SketchUp도 다른 형식에서는 무시한다).
 * 규칙은 비공개 참조 뷰어의 단위 표기 코드에서 옮겼다. 입력은 mm, mm², mm³, 도.
 */

import type { SkpUnitsMeta } from '../meta';

/**
 * 모형 표시 단위(해석기 meta.units와 같은 꼴). lengthPrecision은 decimal·engineering이면 소수 자리,
 * architectural·fractional이면 분모 2^n. 면적·부피 단위가 없으면 미터계는 m²·m³, 아니면 ft²·ft³.
 */
export type UnitsDisplay = SkpUnitsMeta;
export type LengthUnitName = SkpUnitsMeta['lengthUnit'];
export type LengthFormat = SkpUnitsMeta['lengthFormat'];

export interface FormatOptions {
  /** 반올림 표시(~)를 할지(기본 true) */
  approx?: boolean;
  /** 반올림으로 보지 않을 절대 허용치(mm, mm², mm³, 도) */
  tolerance?: number;
}

const MM_PER: Record<LengthUnitName, number> = { inch: 25.4, feet: 304.8, yard: 914.4, mm: 1, cm: 10, m: 1000 };
const LENGTH_SYMBOL: Record<LengthUnitName, string> = { inch: '"', feet: "'", yard: 'yd', mm: 'mm', cm: 'cm', m: 'm' };
/** 기호를 붙여 쓰는 단위(12" · 3') */
const ATTACHED = new Set<LengthUnitName>(['inch', 'feet']);
const METRIC = new Set<LengthUnitName>(['mm', 'cm', 'm']);

const ALIASES: Record<string, LengthUnitName> = {
  in: 'inch',
  inch: 'inch',
  inches: 'inch',
  '"': 'inch',
  ft: 'feet',
  foot: 'feet',
  feet: 'feet',
  "'": 'feet',
  yd: 'yard',
  yard: 'yard',
  yards: 'yard',
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  millimetre: 'mm',
  cm: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
};

const VOLUME_EXTRA: Record<string, { per: number; symbol: string }> = {
  liter: { per: 1e6, symbol: 'L' },
  l: { per: 1e6, symbol: 'L' },
  us_gallon: { per: 3785411.784, symbol: 'gal' },
  gallon: { per: 3785411.784, symbol: 'gal' },
};

/** 파일에 단위 설정이 없을 때 */
export const DEFAULT_UNITS: UnitsDisplay = Object.freeze({
  lengthUnit: 'mm',
  lengthFormat: 'decimal',
  lengthPrecision: 0,
  anglePrecision: 1,
  areaUnit: null,
  areaPrecision: null,
  volumeUnit: null,
  volumePrecision: null,
  suppressUnits: false,
}) as UnitsDisplay;

/** 장면 좌표 한 단위가 몇 mm인지(Scene3d.units) */
export function mmPerSceneUnit(units: string | undefined): number {
  return units === 'inch' ? 25.4 : units === 'm' ? 1000 : 1;
}

export function lengthUnitOf(name: unknown): LengthUnitName {
  if (typeof name !== 'string') return 'mm';
  return ALIASES[name.trim().toLowerCase()] ?? 'mm';
}

/** meta.units(모르는 꼴이어도 안전하게) → 표시 단위. lengthLabel은 옛 meta.lengthUnit('mm'·'cm'·'m'·'ft'·'inch') */
export function readUnits(v: unknown, lengthLabel?: string | null): UnitsDisplay {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
  const fmt = o.lengthFormat;
  const lengthFormat: LengthFormat = fmt === 'architectural' || fmt === 'engineering' || fmt === 'fractional' ? fmt : 'decimal';
  const unit = str(o.lengthUnit) ?? lengthLabel ?? null;
  const lengthUnit = unit ? lengthUnitOf(unit) : DEFAULT_UNITS.lengthUnit;
  return {
    lengthUnit,
    lengthFormat,
    lengthPrecision: num(o.lengthPrecision) ?? (METRIC.has(lengthUnit) ? 0 : lengthFormat === 'decimal' || lengthFormat === 'engineering' ? 2 : 3),
    anglePrecision: num(o.anglePrecision) ?? 1,
    areaUnit: str(o.areaUnit),
    areaPrecision: num(o.areaPrecision),
    volumeUnit: str(o.volumeUnit),
    volumePrecision: num(o.volumePrecision),
    suppressUnits: o.suppressUnits === true,
  };
}

function precisionOf(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 6) : fallback;
}

function decimalText(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

/** 장면 값의 상대 정밀도(float32 유효 24비트 ≈ 6e-8, 점에서 계산한 길이·면적은 몇 ulp를 더 잃는다) */
export const RELATIVE_TOLERANCE = 1e-6;

/** 보인 값이 반올림된 것이면 "~ " (tolerance는 보인 단위) */
function approxMark(value: number, shown: number, tolerance = 0): string {
  const limit = Math.max(1e-9, Math.abs(value) * RELATIVE_TOLERANCE, Number.isFinite(tolerance) ? tolerance : 0);
  return Math.abs(shown - value) > limit ? '~ ' : '';
}

interface FractionParts {
  sign: string;
  whole: number;
  numerator: number;
  den: number;
  shown: number;
}

function fractionParts(inches: number, precision: number): FractionParts {
  const denominator = 2 ** precisionOf(precision, 3);
  const units = Math.round(Math.abs(inches) * denominator);
  const whole = Math.floor(units / denominator);
  let numerator = units - whole * denominator;
  let den = denominator;
  while (numerator > 0 && numerator % 2 === 0) {
    numerator /= 2;
    den /= 2;
  }
  return { sign: inches < 0 && units > 0 ? '-' : '', whole, numerator, den, shown: (Math.sign(inches) * units) / denominator };
}

function fractionText(p: FractionParts): string {
  const fraction = p.numerator ? `${p.numerator}/${p.den}` : '';
  if (!fraction) return `${p.whole}`;
  if (p.whole === 0) return fraction;
  return `${p.whole} ${fraction}`;
}

/** 길이(mm) → 모형 단위 글 */
export function formatLength(mm: number, d: UnitsDisplay = DEFAULT_UNITS, o: FormatOptions = {}): string {
  if (!Number.isFinite(mm)) return '';
  const approx = o.approx !== false;
  const tolerance = Number(o.tolerance) || 0;
  if (d.lengthFormat === 'architectural' || d.lengthFormat === 'fractional') {
    const inches = mm / 25.4;
    const parts = fractionParts(inches, d.lengthPrecision);
    const mark = approx ? approxMark(inches, parts.shown, tolerance / 25.4) : '';
    if (d.lengthFormat === 'fractional') return `${mark}${parts.sign}${fractionText(parts)}"`;
    const feet = Math.floor(parts.whole / 12);
    const rest = { ...parts, whole: parts.whole - feet * 12 };
    if (feet === 0) return `${mark}${parts.sign}${fractionText(rest)}"`;
    if (rest.whole === 0 && rest.numerator === 0) return `${mark}${parts.sign}${feet}'`;
    return `${mark}${parts.sign}${feet}' ${fractionText(rest)}"`;
  }
  const unit: LengthUnitName = d.lengthFormat === 'engineering' ? 'feet' : d.lengthUnit;
  const value = mm / MM_PER[unit];
  const digits = precisionOf(d.lengthPrecision, METRIC.has(unit) ? 0 : 2);
  const text = decimalText(value, digits);
  const mark = approx ? approxMark(value, Number(text), tolerance / MM_PER[unit]) : '';
  if (d.suppressUnits && d.lengthFormat === 'decimal') return `${mark}${text}`;
  const symbol = LENGTH_SYMBOL[unit];
  return ATTACHED.has(unit) ? `${mark}${text}${symbol}` : `${mark}${text} ${symbol}`;
}

/** 단위를 숨긴 모형에서도 복사·도움말에는 단위를 붙인 글(decimal 숫자 글만 바꾼다) */
export function withLengthUnit(text: string, d: UnitsDisplay = DEFAULT_UNITS): string {
  const value = text.trim();
  if (d.lengthFormat !== 'decimal' || !/^(~ )?-?\d+([.,]\d+)?$/.test(value)) return value;
  const symbol = LENGTH_SYMBOL[d.lengthUnit];
  return ATTACHED.has(d.lengthUnit) ? `${value}${symbol}` : `${value} ${symbol}`;
}

function powerUnit(name: string | null, power: 2 | 3, lengthUnit: LengthUnitName): { per: number; symbol: string } {
  const raw = typeof name === 'string' ? name.trim().toLowerCase() : '';
  if (power === 3 && VOLUME_EXTRA[raw]) return VOLUME_EXTRA[raw]!;
  const stem = raw.replace(/^(square|sq|cubic|cu)[_\s-]*/, '').replace(/[23²³]$/, '');
  const base: LengthUnitName = ALIASES[stem] ?? (METRIC.has(lengthUnit) ? 'm' : 'feet');
  const symbols: Record<LengthUnitName, string> = { inch: 'in', feet: 'ft', yard: 'yd', mm: 'mm', cm: 'cm', m: 'm' };
  return { per: MM_PER[base] ** power, symbol: `${symbols[base]}${power === 2 ? '²' : '³'}` };
}

function formatPower(value: number, power: 2 | 3, d: UnitsDisplay, o: FormatOptions): string {
  if (!Number.isFinite(value)) return '';
  const unit = powerUnit(power === 2 ? d.areaUnit : d.volumeUnit, power, d.lengthUnit);
  const digits = precisionOf(power === 2 ? d.areaPrecision : d.volumePrecision, 2);
  const scaled = value / unit.per;
  const text = decimalText(scaled, digits);
  const mark = o.approx === false ? '' : approxMark(scaled, Number(text), (Number(o.tolerance) || 0) / unit.per);
  return `${mark}${text} ${unit.symbol}`;
}

/** 면적(mm²) → 모형 단위 글 */
export function formatArea(mm2: number, d: UnitsDisplay = DEFAULT_UNITS, o: FormatOptions = {}): string {
  return formatPower(mm2, 2, d, o);
}

/** 부피(mm³) → 모형 단위 글 */
export function formatVolume(mm3: number, d: UnitsDisplay = DEFAULT_UNITS, o: FormatOptions = {}): string {
  return formatPower(mm3, 3, d, o);
}

/** 각도(도) → 글 */
export function formatAngle(deg: number, d: UnitsDisplay = DEFAULT_UNITS, o: FormatOptions = {}): string {
  if (!Number.isFinite(deg)) return '';
  const digits = precisionOf(d.anglePrecision, 1);
  const text = decimalText(deg, digits);
  const mark = o.approx === false ? '' : approxMark(deg, Number(text), Number(o.tolerance) || 0);
  return `${mark}${text}°`;
}

/** 형식 이름(정보 탭용) */
export function unitsLabel(d: UnitsDisplay): string {
  const fmt = { decimal: '십진', architectural: '건축(피트·인치·분수)', engineering: '공학(소수 피트)', fractional: '분수 인치' }[d.lengthFormat];
  if (d.lengthFormat === 'decimal') {
    const name = { inch: '인치', feet: '피트', yard: '야드', mm: 'mm', cm: 'cm', m: 'm' }[d.lengthUnit];
    return `${name} · ${fmt} · 소수 ${precisionOf(d.lengthPrecision, 0)}자리`;
  }
  if (d.lengthFormat === 'engineering') return `${fmt} · 소수 ${precisionOf(d.lengthPrecision, 2)}자리`;
  return `${fmt} · 1/${2 ** precisionOf(d.lengthPrecision, 3)}"`;
}

/**
 * 측정값 칸(VCB)에 친 길이 글 → mm(못 읽으면 null). SketchUp 측정값 칸처럼 단위를 붙여 칠 수 있고, 단위가 없으면 모형 단위로 읽는다
 * (십진 → 길이 단위, 건축·분수 → 인치, 공학 → 피트). 받는 꼴: 1200 · 1200mm · 1.2 m · 120 cm · 1,5(소수 쉼표 — 점이 없을 때) ·
 * 5' · 5'6" · 5' 6 1/2" · 5'-6" · 6 1/2" · 3/4" · 48in · 4ft. 앞의 −는 반대 방향, 앞의 ~(칸에 보이던 반올림 표시)는 건너뛴다.
 * 쉼표: decimalComma(소수 쉼표를 쓰는 언어 — usesDecimalComma)면 소수점이다. 아니면 세 자리 묶음(1,500 · 12,345.5)은 천 단위 구분으로
 * 빼고(1,500을 1.5로 읽어 천 배 짧은 안내점을 찍지 않게), 그 밖의 쉼표(1,5)는 점이 없을 때 소수점으로 읽는다.
 */
export function parseLength(text: string, d: UnitsDisplay = DEFAULT_UNITS, decimalComma = false): number | null {
  let s = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[″“”]/g, '"')
    .replace(/[′‘’]/g, "'");
  if (!s) return null;
  let sign = 1;
  if (/^[-+−]/.test(s)) {
    if (s[0] !== '+') sign = -1;
    s = s.slice(1).trim();
  }
  s = s.replace(/^~\s*/, '');
  if (!decimalComma && /^\d{1,3}(?:,\d{3})+(?![\d,])/.test(s)) s = s.replace(/^[\d,]+/, (m) => m.replace(/,/g, ''));
  if (!s.includes('.')) s = s.replace(/,/g, '.');
  const NUM = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
  const FRAC = String.raw`(\d+)\s*/\s*(\d+)`;
  const frac = (n?: string, m?: string): number | null => {
    if (n === undefined || m === undefined) return 0;
    const den = Number(m);
    return den > 0 ? Number(n) / den : null;
  };
  let mm: number | null = null;
  const fi = new RegExp(`^(${NUM})\\s*(?:'|ft|feet|foot)\\s*(?:-\\s*)?(?:(${NUM})?\\s*(?:${FRAC})?\\s*(?:"|in|inch|inches)?)?$`).exec(s);
  if (fi) {
    const f = frac(fi[3], fi[4]);
    if (f === null) return null;
    mm = (Number(fi[1]) * 12 + (fi[2] ? Number(fi[2]) : 0) + f) * 25.4;
  } else {
    const nu = new RegExp(`^(${NUM})?\\s*(?:${FRAC})?\\s*([a-z]+|"|')?$`).exec(s);
    if (!nu || (nu[1] === undefined && nu[2] === undefined)) return null;
    const f = frac(nu[2], nu[3]);
    if (f === null) return null;
    let unit: LengthUnitName;
    if (nu[4]) {
      const u = ALIASES[nu[4]];
      if (!u) return null;
      unit = u;
    } else unit = d.lengthFormat === 'decimal' ? d.lengthUnit : d.lengthFormat === 'engineering' ? 'feet' : 'inch';
    mm = ((nu[1] !== undefined ? Number(nu[1]) : 0) + f) * MM_PER[unit];
  }
  return Number.isFinite(mm) && Math.abs(mm) < 1e15 ? sign * mm : null;
}

/**
 * 측정값 칸(각도기)에 친 각도 글 → 도(못 읽으면 null). SketchUp 각도기처럼 도(34.1 · 34.1° · 34.1deg)나
 * 경사(높이:밑변 — 1:6은 atan(1/6) ≈ 9.46°)로 친다. 앞의 −는 반대쪽으로 돌기, 앞의 ~(칸에 보이던 반올림 표시)는 건너뛴다.
 * 쉼표는 parseLength와 같다: decimalComma면 소수점, 아니면 세 자리 묶음은 천 단위 구분, 그 밖의 쉼표는 점이 없을 때 소수점.
 */
export function parseAngle(text: string, decimalComma = false): number | null {
  let s = String(text ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  let sign = 1;
  if (/^[-+−]/.test(s)) {
    if (s[0] !== '+') sign = -1;
    s = s.slice(1).trim();
  }
  s = s.replace(/^~\s*/, '');
  const num = (t: string): number | null => {
    let v = t.trim();
    if (!decimalComma && /^\d{1,3}(?:,\d{3})+$/.test(v)) v = v.replace(/,/g, '');
    if (!v.includes('.')) v = v.replace(/,/g, '.');
    return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) ? Number(v) : null;
  };
  let deg: number | null;
  const slope = /^([^:]+):([^:]+)$/.exec(s);
  if (slope) {
    const rise = num(slope[1]!);
    const run = num(slope[2]!);
    if (rise === null || run === null || (rise === 0 && run === 0)) return null;
    deg = (Math.atan2(rise, run) * 180) / Math.PI;
  } else deg = num(s.replace(/\s*(?:°|º|deg|degrees?)$/, ''));
  return deg !== null && Number.isFinite(deg) && Math.abs(deg) < 1e9 ? sign * deg : null;
}

/** 측정값 칸이 숫자 자판(소수점만)으로 충분한지: 십진 미터계·인치·피트 소수 꼴. 건축·분수는 ' " / 가 필요하다 */
export function decimalKeypadFits(d: UnitsDisplay = DEFAULT_UNITS): boolean {
  return d.lengthFormat === 'decimal' || d.lengthFormat === 'engineering';
}

/** 이 언어가 소수점으로 쉼표를 쓰는지(독일어 등 — 측정값 칸이 1,5를 1.5로 읽는다) */
export function usesDecimalComma(lang: string | null | undefined): boolean {
  try {
    return new Intl.NumberFormat(lang || undefined).formatToParts(1.5).find((p) => p.type === 'decimal')?.value === ',';
  } catch {
    return false;
  }
}
