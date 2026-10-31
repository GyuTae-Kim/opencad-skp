/**
 * 색을 바꾼 무늬(재질 type 2: 무늬를 고른 뒤 색을 바꾼 재질). 파일은 원래 그림과 새 색만 갖고 있고 SketchUp이 그릴 때 그림 색을 바꾼다.
 * 그 규칙(비공개 참조 뷰어의 기록 — SketchUp 재질 미리보기와 견주어 확인한 것)을 RGBA 화소에 적용한다.
 *
 * HLS(색상 0~360, 밝기·채도 0~1). C = 재질 색, A = 그림 평균색(material.xml avgColor, 없으면 화소 평균):
 * - shift(colorizeType 0, 기본): h' = h + (hC − hA),  tint(colorizeType 1): h' = hC
 * - l' = clamp(l + lC − lA)
 * - s' = sC < sA ? clamp(s · sC / sA) : clamp(s + sC − sA)(회색 재질 색이면 회색 화소)
 * - RGB는 반올림, 알파는 그대로. 평균 화소는 정확히 C가 된다.
 */

export interface ColorizeSpec {
  type: 'shift' | 'tint';
  /** 재질 색(0~255) */
  color: readonly number[];
  /** 원래 그림 평균색(0~255, 없으면 화소 평균) */
  average?: readonly number[] | undefined;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** r, g, b(0~255) → [h(0~360), l, s] */
export function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-12) return [0, l, 0];
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, l, s];
}

/** [h, l, s] → [r, g, b](0~255, 소수) */
export function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  let hp = (h % 360) / 60;
  if (hp < 0) hp += 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** RGBA 화소 평균색(알파 가중 — 완전히 투명한 화소는 세지 않는다) */
export function averageRgb(data: ArrayLike<number>): [number, number, number] {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    r += data[i]! * a;
    g += data[i + 1]! * a;
    b += data[i + 2]! * a;
    w += a;
  }
  return w > 0 ? [r / w, g / w, b / w] : [0, 0, 0];
}

/**
 * 바이트 화소의 색 바꾸기를 기억하는 칸 수(2의 거듭제곱 지수). 바꾼 색은 그 화소의 RGB로만 정해지고 무늬 그림은 같은 색 화소가 많아
 * (33차 — 실제 큰 모형에서 색 바꾼 무늬 3,700만 화소에 고유 색 15만) 한 번 바꾼 색을 다시 쓴다. 칸은 32K개(256 KB, 부를 때마다 새로)
 */
const MEMO_BITS = 15;

/** 이 실행 환경의 형식 배열이 리틀 엔디언인지(화소를 32비트 낱말로 볼 때 RGB가 아래 24비트) */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * RGBA 화소(Uint8ClampedArray 등)의 색을 그 자리에서 바꾼다.
 * 바이트 배열(Uint8ClampedArray·Uint8Array, 4바이트 자리에서 시작)은 RGB → 바꾼 RGB를 기억해 같은 색 화소는 계산하지 않는다(처음 바꾼 화소를
 * 배열에 적고 다시 읽은 값을 기억하므로 결과는 화소마다 계산한 것과 바이트까지 같다). 다른 배열은 화소마다 계산한다
 */
export function colorizeRgba<T extends { length: number; [i: number]: number }>(data: T, spec: ColorizeSpec): T {
  if (!data.length) return data;
  const avg = spec.average ?? averageRgb(data);
  const [hc, lc, sc] = rgbToHls(spec.color[0]!, spec.color[1]!, spec.color[2]!);
  const [ha, la, sa] = rgbToHls(avg[0]!, avg[1]!, avg[2]!);
  const tint = spec.type === 'tint';
  const dh = hc - ha, dl = lc - la, ds = sc - sa;
  const scaleS = sc < sa;
  const kS = scaleS ? sc / sa : 1;
  // 화소가 수백만 개라 rgbToHls·hlsToRgb를 배열 없이 풀어 쓴다(같은 식)
  const pixel = (i: number): void => {
    const R = data[i]! / 255, G = data[i + 1]! / 255, B = data[i + 2]! / 255;
    const max = R > G ? (R > B ? R : B) : G > B ? G : B;
    const min = R < G ? (R < B ? R : B) : G < B ? G : B;
    let l = (max + min) / 2;
    const d = max - min;
    let s = 0;
    let h = 0;
    if (d > 1e-12) {
      s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
      h = (max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4) * 60;
    }
    h = tint ? hc : h + dh;
    l = clamp01(l + dl);
    s = scaleS ? clamp01(s * kS) : clamp01(s + ds);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    let hp = (h % 360) / 60;
    if (hp < 0) hp += 6;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c / 2;
    let r: number, g: number, b: number;
    if (hp < 1) (r = c), (g = x), (b = 0);
    else if (hp < 2) (r = x), (g = c), (b = 0);
    else if (hp < 3) (r = 0), (g = c), (b = x);
    else if (hp < 4) (r = 0), (g = x), (b = c);
    else if (hp < 5) (r = x), (g = 0), (b = c);
    else (r = c), (g = 0), (b = x);
    data[i] = Math.round((r + m) * 255);
    data[i + 1] = Math.round((g + m) * 255);
    data[i + 2] = Math.round((b + m) * 255);
  };
  const n = data.length;
  if (!(data instanceof Uint8ClampedArray || data instanceof Uint8Array) || !LITTLE_ENDIAN || data.byteOffset % 4 !== 0) {
    for (let i = 0; i + 3 < n; i += 4) pixel(i);
    return data;
  }
  // 바이트 화소: 화소 하나를 32비트 낱말로 보고(리틀 엔디언 — 아래 24비트가 RGB, 위 8비트가 알파) RGB → 바꾼 RGB를 기억한다.
  // 칸은 열쇠의 곱셈 해시, 같은 색이 이어지면 바로 앞 것을 쓴다. 알파는 그 화소 것 그대로
  const words = new Uint32Array(data.buffer, data.byteOffset, n >> 2);
  const size = 1 << MEMO_BITS;
  const keys = new Int32Array(size).fill(-1);
  const vals = new Int32Array(size);
  let lastKey = -1;
  let lastVal = 0;
  for (let p = 0; p < words.length; p++) {
    const word = words[p]!;
    const key = word & 0xffffff;
    if (key !== lastKey) {
      const slot = Math.imul(key, 0x9e3779b1) >>> (32 - MEMO_BITS);
      lastKey = key;
      if (keys[slot] === key) lastVal = vals[slot]!;
      else {
        pixel(p * 4);
        lastVal = words[p]! & 0xffffff;
        keys[slot] = key;
        vals[slot] = lastVal;
        continue;
      }
    }
    words[p] = (word & 0xff000000) | lastVal;
  }
  return data;
}
