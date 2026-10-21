/**
 * 해 위치와 SketchUp 그림자 설정 → 코어 조명(순수 함수, DOM 없음).
 *
 * - 해 위치: NOAA 태양 계산(Solar Calculator 스프레드시트의 식 — 적위·균시차·시각각으로 고도·방위각, 대기 굴절은 뺀다). 오차는 1° 안쪽.
 * - SketchUp 그림자 시각(ShadowTime)은 그곳 시각을 UTC 초처럼 적은 값이라 시간대(tz)를 빼서 실제 UTC로 쓴다.
 *   위경도가 없으면 SketchUp 기본 위치(미국 콜로라도 볼더, 시간대 −7)를 쓴다.
 * - 모형 방향: 북쪽은 그림자 설정의 north(모형 축에서의 북쪽, (0, 1, 0) = 북쪽 각 0), 동쪽은 북쪽을 Z축 둘레로 시계 방향 90°.
 * - 밝음·어둠(0~100, 기본 80·45)은 코어 해 세기·주변광으로 0~1. 해가 지평선 아래면 해 빛을 끄고(주변광만) 그림자도 그리지 않는다.
 */
import type { SkpShadowMeta } from '../meta';

export type V3 = [number, number, number];

/** SketchUp 기본 위치(볼더) */
export const DEFAULT_LATITUDE = 40.01779;
export const DEFAULT_LONGITUDE = -105.27744;
export const DEFAULT_TZ = -7;
/** SketchUp 밝음·어둠 기본값(0~100) */
export const DEFAULT_LIGHT = 80;
export const DEFAULT_DARK = 45;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** UTC 초(유닉스 시각)·위도·경도(동쪽 +) → 해 고도·방위각(도, 방위는 북쪽에서 동쪽으로 0~360) */
export function sunPosition(utcSeconds: number, latitude: number, longitude: number): { elevation: number; azimuth: number } {
  const jd = utcSeconds / 86400 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c = Math.sin(m * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * jc) + Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  const dayMinutes = ((((utcSeconds / 60) % 1440) + 1440) % 1440);
  const tst = (((dayMinutes + eqTime + 4 * longitude) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const lat = latitude * RAD;
  const cosZ = Math.min(1, Math.max(-1, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha * RAD)));
  const zen = Math.acos(cosZ);
  const elevation = 90 - zen * DEG;
  const den = Math.cos(lat) * Math.sin(zen);
  let azimuth: number;
  if (Math.abs(den) < 1e-12) azimuth = latitude > 0 ? 180 : 0;
  else {
    const a = Math.acos(Math.min(1, Math.max(-1, (Math.sin(lat) * Math.cos(zen) - Math.sin(decl)) / den))) * DEG;
    azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { elevation, azimuth };
}

/** 고도·방위각(도)과 모형 북쪽 → 해 쪽 세계 방향(단위 벡터) */
export function sunDirection(elevation: number, azimuth: number, north: readonly number[] = [0, 1, 0]): V3 {
  let nx = isNum(north[0]) ? north[0] : 0;
  let ny = isNum(north[1]) ? north[1] : 1;
  const l = Math.hypot(nx, ny);
  if (l > 1e-12) {
    nx /= l;
    ny /= l;
  } else {
    nx = 0;
    ny = 1;
  }
  // 동쪽 = 북쪽을 위에서 보아 시계 방향 90°
  const ex = ny;
  const ey = -nx;
  const ce = Math.cos(elevation * RAD);
  const e = Math.sin(azimuth * RAD) * ce;
  const n = Math.cos(azimuth * RAD) * ce;
  return [ex * e + nx * n, ey * e + ny * n, Math.sin(elevation * RAD)];
}

/** 그림자 설정의 해: 시각(없으면 null)·위경도·시간대·북쪽 → 고도·방위각·방향 */
export function sunForShadow(s: SkpShadowMeta | null | undefined): { elevation: number; azimuth: number; direction: V3 } | null {
  if (!s || !isNum(s.time)) return null;
  const lat = isNum(s.latitude) ? s.latitude : DEFAULT_LATITUDE;
  const lon = isNum(s.longitude) ? s.longitude : DEFAULT_LONGITUDE;
  const tz = isNum(s.tz) ? s.tz : isNum(s.longitude) ? Math.round(lon / 15) : DEFAULT_TZ;
  const p = sunPosition(s.time - tz * 3600, lat, lon);
  return { ...p, direction: sunDirection(p.elevation, p.azimuth, s.north) };
}

/** 코어 setLighting 꼴(앱이 그대로 넘긴다) */
export interface SunLighting {
  sun: { direction: V3; intensity: number };
  ambient: number;
  shadows: boolean;
}

/**
 * 그림자 설정 → 코어 조명. 그림자를 보이거나(display) 해로 음영을 칠하게(useSun) 한 파일만 조명을 켠다(아니면 null — 예전 고정 조명).
 * shadows: 앱이 그림자를 켰는지(처음엔 파일의 display). 해가 지평선 아래면 해 빛 0·그림자 없음
 */
export function lightingForShadow(s: SkpShadowMeta | null | undefined, shadows: boolean): SunLighting | null {
  const sun = sunForShadow(s);
  if (!s || !sun) return null;
  const light = (isNum(s.light) ? s.light : DEFAULT_LIGHT) / 100;
  const dark = (isNum(s.dark) ? s.dark : DEFAULT_DARK) / 100;
  const up = sun.elevation > 0;
  return {
    sun: { direction: sun.direction, intensity: up ? Math.min(1.5, Math.max(0, light)) : 0 },
    ambient: Math.min(1, Math.max(0, dark)),
    shadows: shadows && up && s.onFaces !== false,
  };
}

/** 파일이 해 조명을 쓰는지(그림자 보이기 또는 해로 음영) */
export function usesSun(s: SkpShadowMeta | null | undefined): boolean {
  return !!s && isNum(s.time) && (s.display === true || s.useSun === true);
}
