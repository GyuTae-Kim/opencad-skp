import { describe, expect, it } from 'vitest';
import { defaultCamera, type CameraState } from 'opencad-viewer3d/camera';
import { HISTORY_SETTLE_MS, ViewHistory } from '../../src/app/history';

const cam = (yaw: number): CameraState => ({ ...defaultCamera(), yaw });

describe('보기 기록', () => {
  it('멈춘 카메라만 한 칸으로 적고, 이전·다음으로 오간다', () => {
    const h = new ViewHistory();
    h.reset(cam(0));
    h.observe(cam(0.1), 0);
    h.observe(cam(0.2), 10);
    expect(h.settle(10 + HISTORY_SETTLE_MS - 1)).toBe(false);
    expect(h.settle(10 + HISTORY_SETTLE_MS)).toBe(true);
    expect(h.size).toBe(2);
    expect(h.canBack()).toBe(true);
    expect(h.back(1000)?.yaw).toBe(0);
    // 옮기는 동안의 카메라 변화는 적지 않는다
    h.observe(cam(0.05), 1001);
    h.done();
    expect(h.canForward()).toBe(true);
    expect(h.forward()?.yaw).toBe(0.2);
    h.done();
    expect(h.canForward()).toBe(false);
  });

  it('이전으로 간 뒤 새로 움직이면 앞쪽 기록을 버리고, 한도를 넘으면 오래된 것부터 버린다', () => {
    const h = new ViewHistory(3);
    h.reset(cam(0));
    for (let i = 1; i <= 2; i++) {
      h.observe(cam(i), i * 1000);
      h.settle(i * 1000 + HISTORY_SETTLE_MS);
    }
    h.back(5000);
    h.done();
    h.observe(cam(9), 6000);
    h.settle(6000 + HISTORY_SETTLE_MS);
    expect(h.size).toBe(3);
    expect(h.canForward()).toBe(false);
    for (let i = 10; i < 14; i++) {
      h.observe(cam(i), i * 1000);
      h.settle(i * 1000 + HISTORY_SETTLE_MS);
    }
    expect(h.size).toBe(3);
    // 같은 카메라는 두 번 적지 않는다
    h.observe(cam(13), 20000);
    expect(h.settle(20000 + HISTORY_SETTLE_MS)).toBe(false);
  });

  it('적지 않은 움직임이 있으면 이전은 그 움직임 앞 칸으로 간다', () => {
    const h = new ViewHistory();
    h.reset(cam(0));
    h.observe(cam(1), 0);
    expect(h.canBack()).toBe(true);
    expect(h.back(10)?.yaw).toBe(0);
  });

  it('칸마다 꼬리표를 두고, 같은 꼬리표면 시야각만 바뀐 카메라는 새 칸으로 적지 않는다', () => {
    type Tag = { base: number; scale: number };
    const h = new ViewHistory<Tag>(50, (a, b) => !!a && !!b && a.base === b.base);
    const portrait: Tag = { base: 35, scale: 3 };
    h.reset(cam(0), null);
    h.observe({ ...cam(1), fovY: 1.5 }, 0, portrait);
    h.settle(HISTORY_SETTLE_MS);
    // 휴대폰을 돌려 시야각만 다시 맞춤(같은 장면 맞춤)
    h.observe({ ...cam(1), fovY: 0.6 }, 1000, { base: 35, scale: 1 });
    expect(h.settle(1000 + HISTORY_SETTLE_MS)).toBe(false);
    expect(h.size).toBe(2);
    // 꼬리표가 없으면(맞춤 아님) 시야각이 다르면 다른 칸
    h.observe({ ...cam(1), fovY: 0.6 }, 2000, null);
    expect(h.settle(2000 + HISTORY_SETTLE_MS)).toBe(true);
    expect(h.back(3000)?.fovY).toBe(1.5);
    expect(h.tag).toEqual(portrait);
    h.done();
    expect(h.back(4000)?.yaw).toBe(0);
    expect(h.tag).toBeNull();
  });
});
