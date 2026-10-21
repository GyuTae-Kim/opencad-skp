import { describe, expect, it } from 'vitest';
import { STICK_DEADZONE, stickInput } from '../../src/app/joystick';

describe('걷기 조이스틱', () => {
  it('위 = 앞, 오른쪽 = 오른쪽, 반지름에서 1, 데드존 안은 0', () => {
    expect(stickInput(0, -50, 50)).toEqual({ forward: 1, right: 0 });
    expect(stickInput(50, 0, 50)).toEqual({ forward: 0, right: 1 });
    expect(stickInput(0, 80, 50)).toEqual({ forward: -1, right: 0 });
    expect(stickInput(2, -2, 50)).toEqual({ forward: 0, right: 0 });
    const half = stickInput(0, -25, 50);
    expect(half.forward).toBeCloseTo((0.5 - STICK_DEADZONE) / (1 - STICK_DEADZONE), 12);
    expect(stickInput(Number.NaN, 0, 50)).toEqual({ forward: 0, right: 0 });
  });
});
