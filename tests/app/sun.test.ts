import { describe, expect, it } from 'vitest';
import { DEFAULT_LATITUDE, defaultShadowTime, fogFor, lightingForShadow, shadowOrDefault, sunDirection, sunForShadow, sunPosition, usesSun } from '../../src/app/sun';
import { readShadow } from '../../src/app/pages';

const utc = (y: number, mo: number, d: number, h: number, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi) / 1000;

describe('해 위치(NOAA)', () => {
  it('서울 하지 남중: 고도 ≈ 90 − 위도 + 23.44°, 남쪽', () => {
    // 12:34 KST = 03:34 UTC(경도 127°라 남중이 30분쯤 늦다)
    const p = sunPosition(utc(2026, 6, 21, 3, 34), 37.5665, 126.978);
    expect(p.elevation).toBeCloseTo(90 - 37.5665 + 23.44, 0);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(10);
  });

  it('그리니치 춘분 정오: 고도 ≈ 90 − 위도, 해 뜰 무렵은 지평선 근처 북동', () => {
    const noon = sunPosition(utc(2026, 3, 20, 12, 7), 51.4769, 0);
    expect(noon.elevation).toBeCloseTo(90 - 51.4769, 0);
    // 서울 하지 해돋이 05:11 KST = 20:11 UTC(전날)
    const rise = sunPosition(utc(2026, 6, 20, 20, 11), 37.5665, 126.978);
    expect(rise.elevation).toBeGreaterThan(-2);
    expect(rise.elevation).toBeLessThan(0.5);
    expect(rise.azimuth).toBeGreaterThan(55);
    expect(rise.azimuth).toBeLessThan(65);
  });

  it('고도·방위 → 모형 방향: 북쪽 0이면 +Y가 북쪽, +X가 동쪽 — 북쪽을 돌리면 함께', () => {
    const close = (a: number[], b: number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12));
    close(sunDirection(0, 0), [0, 1, 0]);
    close(sunDirection(0, 90), [1, 0, 0]);
    close(sunDirection(90, 123), [0, 0, 1]);
    // 북쪽이 +X(북쪽 각 90°)면 동쪽은 −Y
    close(sunDirection(0, 0, [1, 0, 0]), [1, 0, 0]);
    close(sunDirection(0, 90, [2, 0, 0]), [0, -1, 0]);
    close(sunDirection(0, 0, [0, 0, 1]), [0, 1, 0]);
  });
});

describe('그림자 설정 → 코어 조명', () => {
  const seoul = { time: utc(2026, 6, 21, 12, 34), tz: 9, latitude: 37.5665, longitude: 126.978, light: 80, dark: 45, display: true, onFaces: true };

  it('그곳 시각에서 시간대를 빼 해를 구하고, 밝음·어둠을 해 세기·주변광으로', () => {
    const s = sunForShadow(seoul)!;
    expect(s.elevation).toBeCloseTo(75.9, 0);
    const l = lightingForShadow(seoul, true)!;
    expect(l.sun.intensity).toBeCloseTo(0.8, 12);
    expect(l.ambient).toBeCloseTo(0.45, 12);
    expect(l.shadows).toBe(true);
    expect(l.sun.direction[2]).toBeGreaterThan(0.9);
    // 그림자를 끈 채 해로 음영만
    expect(lightingForShadow(seoul, false)!.shadows).toBe(false);
  });

  it('해가 지면 해 빛·그림자 없이 주변광만, 시각이 없으면 null', () => {
    const night = lightingForShadow({ ...seoul, time: utc(2026, 6, 21, 23, 0) }, true)!;
    expect(night.sun.intensity).toBe(0);
    expect(night.shadows).toBe(false);
    expect(lightingForShadow({ latitude: 1 }, true)).toBeNull();
    expect(sunForShadow(null)).toBeNull();
  });

  it('파일이 해를 쓰는지(그림자 보이기·해로 음영), 설정이 없으면 SketchUp 기본 시각·볼더', () => {
    expect(usesSun(seoul)).toBe(true);
    expect(usesSun({ ...seoul, display: false })).toBe(false);
    expect(usesSun({ ...seoul, display: false, useSun: true })).toBe(true);
    expect(usesSun(null)).toBe(false);
    const d = shadowOrDefault(null);
    expect(d.time).toBe(defaultShadowTime());
    expect(new Date(d.time! * 1000).getUTCMonth()).toBe(10);
    expect(shadowOrDefault(seoul)).toBe(seoul);
    // 위경도 없음 → 볼더(위도 40°) 정오 무렵 해
    const boulder = sunForShadow({ time: utc(2026, 11, 8, 13, 30) })!.elevation;
    expect(boulder).toBeGreaterThan(20);
    expect(boulder).toBeLessThan(90 - DEFAULT_LATITUDE - 16.6);
  });

  it('장면 그림자 설정 읽기: 수·참거짓·북쪽만', () => {
    expect(readShadow({ time: 5, tz: 9, north: [0, 1, 0], display: true, city: '서울', bad: 'x', light: 'no' })).toEqual({ time: 5, tz: 9, north: [0, 1, 0], display: true, city: '서울' });
    expect(readShadow(null)).toBeNull();
  });
});

describe('안개', () => {
  const box = { min: [0, 0, 0] as [number, number, number], max: [3000, 4000, 0] as [number, number, number] };
  it('스타일 거리가 있으면 그것, 없으면(−1) 장면 대각선으로, 색은 배경 색을 쓰지 않을 때만', () => {
    expect(fogFor({ fogStart: 100, fogEnd: 900, fogUseBackground: true, fogColor: [1, 0, 0] }, box)).toEqual({ start: 100, end: 900 });
    expect(fogFor({ fogStart: -1, fogEnd: -1 }, box)).toEqual({ start: 1250, end: 10000 });
    expect(fogFor({ fogStart: 500, fogEnd: 100, fogUseBackground: false, fogColor: [1, 0, 0] }, null)).toEqual({ start: 250, end: 2000, color: [1, 0, 0, 1] });
    expect(fogFor(null, box)).toEqual({ start: 1250, end: 10000 });
  });
});
