import { describe, expect, it } from 'vitest';
import { computeFrame, type CameraState } from 'opencad-viewer3d/camera';
import { latLonText, readAxes, readLocation, shadowTimeText, tzText } from '../../src/app/doc';
import { axisLock, axisOf } from '../../src/app/snap';
import { protractorPlane } from '../../src/app/measure';

describe('위치 글', () => {
  it('위경도·시간대·그림자 시각(그곳 시각)', () => {
    expect(latLonText(37.5665, 126.978)).toBe('37.5665° N, 126.9780° E');
    expect(latLonText(-33.9, -70.65)).toBe('33.9000° S, 70.6500° W');
    expect(tzText(9)).toBe('UTC+9');
    expect(tzText(-3.5)).toBe('UTC−3:30');
    // 2026-06-21 13:30을 UTC 초처럼 적은 값
    expect(shadowTimeText(Date.UTC(2026, 5, 21, 13, 30) / 1000)).toBe('2026-06-21 13:30');
    expect(shadowTimeText(NaN)).toBe('');
  });

  it('meta 꼴 검사', () => {
    expect(readLocation({ city: '서울', latitude: 37.5, georeferenced: true, tz: 'x' })).toEqual({ georeferenced: true, city: '서울', latitude: 37.5 });
    expect(readLocation(null)).toBeNull();
    expect(readAxes({ origin: [0, 0, 0], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] })).not.toBeNull();
    expect(readAxes({ origin: [0, 0], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] })).toBeNull();
  });
});

describe('옮긴 그리기 축', () => {
  const W = 200;
  const FOV = (40 * Math.PI) / 180;
  const TOP: CameraState = { target: [0, 0, 0], distance: W / 2 / Math.tan(FOV / 2), yaw: 0, pitch: Math.PI / 2, projection: 'orthographic', fovY: FOV };
  const f = computeFrame(TOP, W, W, { center: [0, 0, 0], radius: 1000 });
  /** z 둘레로 45° 돌린 축 */
  const r = Math.SQRT1_2;
  const axes = { x: [r, r, 0] as [number, number, number], y: [-r, r, 0] as [number, number, number], z: [0, 0, 1] as [number, number, number] };

  it('축 고정은 그 축 방향(세계 축 방향으로 가면 고정하지 않는다)', () => {
    // 화면에서 오른쪽 위 45°(세계 +X+Y) = 돌린 빨강 축
    const lock = axisLock(f, [0, 0, 0], 150, 50, { axes })!;
    expect(lock.axis).toBe('x');
    expect(lock.point[0]).toBeCloseTo(lock.point[1]);
    // 세계 +X 방향(화면 오른쪽)은 돌린 축과 45° 어긋나 고정하지 않는다
    expect(axisLock(f, [0, 0, 0], 170, 100, { axes })).toBeNull();
    expect(axisLock(f, [0, 0, 0], 170, 100)!.axis).toBe('x');
  });

  it('각도기 기본 평면·축 이름도 그 축으로', () => {
    expect(axisOf([r, r, 0], axes)).toBe('x');
    expect(axisOf([r, r, 0])).toBeNull();
    const p = protractorPlane(null, [0, 0, -1], axes);
    expect(p).toEqual({ normal: [0, 0, 1], axis: 'z' });
    const side = protractorPlane(null, [r, r, 0], axes);
    expect(side.axis).toBe('x');
  });
});
