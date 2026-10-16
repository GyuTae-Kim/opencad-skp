/**
 * 무늬 그림 메모리 한도(순수 함수): 기기에 따라 무늬 한 장의 긴 변과 전체 GPU 예산을 정한다.
 * 뷰어 코어(textureLimit·textureBudget)와 해석 워커(색 바꾸기·알파 재기로 푸는 그림 크기)에 같은 값을 넘긴다.
 */

export interface TextureLimits {
  /** 한 장 긴 변(화소) */
  limit: number;
  /** 전체 GPU 예산(바이트, RGBA·밉맵 어림) */
  budget: number;
}

export interface DeviceHints {
  /** navigator.deviceMemory(GB, 크롬 계열만 — 없으면 모름) */
  deviceMemory?: number | undefined;
  /** 손가락 입력이 주인 기기(pointer: coarse) */
  coarse?: boolean;
  /** 좁은 화면 */
  narrow?: boolean;
}

const MB = 1024 * 1024;

export function textureLimitsFor(d: DeviceHints): TextureLimits {
  const mem = d.deviceMemory;
  if (mem !== undefined && mem > 0 && mem <= 2) return { limit: 512, budget: 48 * MB };
  if ((mem !== undefined && mem > 0 && mem <= 4) || (d.coarse && d.narrow)) return { limit: 1024, budget: 96 * MB };
  return { limit: 2048, budget: 256 * MB };
}

/** 이 브라우저의 기기 힌트 */
export function deviceHints(): DeviceHints {
  const out: DeviceHints = {};
  try {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof mem === 'number') out.deviceMemory = mem;
    if (typeof matchMedia === 'function') {
      out.coarse = matchMedia('(pointer: coarse)').matches;
      out.narrow = matchMedia('(max-width: 760px)').matches;
    }
  } catch {
    /* 모름 */
  }
  return out;
}
