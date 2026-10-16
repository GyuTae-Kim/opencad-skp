import { describe, expect, it } from 'vitest';
import { DEFAULT_UNITS, formatAngle, formatArea, formatLength, formatVolume, mmPerSceneUnit, readUnits, unitsLabel, withLengthUnit, type UnitsDisplay } from '../../src/app/units';

const u = (o: Partial<UnitsDisplay>): UnitsDisplay => ({ ...DEFAULT_UNITS, ...o });

describe('모형 단위 길이 글', () => {
  it('십진: 미터계는 띄우고, 반올림되면 ~를 붙인다', () => {
    expect(formatLength(1200, u({ lengthUnit: 'mm', lengthPrecision: 0 }))).toBe('1200 mm');
    expect(formatLength(1234.4, u({ lengthUnit: 'cm', lengthPrecision: 1 }))).toBe('~ 123.4 cm');
    expect(formatLength(1500, u({ lengthUnit: 'm', lengthPrecision: 2 }))).toBe('1.50 m');
    // float32 떨림은 반올림으로 보지 않는다
    expect(formatLength(2368.800012, u({ lengthUnit: 'mm', lengthPrecision: 1 }))).toBe('2368.8 mm');
    expect(formatLength(-0.01, u({ lengthUnit: 'mm', lengthPrecision: 0 }))).toBe('~ 0 mm');
  });

  it('인치·피트는 기호를 붙이고, 단위 숨김은 십진에서만', () => {
    expect(formatLength(25.4 * 12, u({ lengthUnit: 'inch', lengthPrecision: 0 }))).toBe('12"');
    expect(formatLength(304.8 * 3, u({ lengthUnit: 'feet', lengthPrecision: 1 }))).toBe("3.0'");
    expect(formatLength(1200, u({ lengthUnit: 'mm', suppressUnits: true }))).toBe('1200');
    expect(withLengthUnit('1200', u({ lengthUnit: 'mm', suppressUnits: true }))).toBe('1200 mm');
  });

  it('건축·분수·공학 형식', () => {
    const arch = u({ lengthFormat: 'architectural', lengthUnit: 'inch', lengthPrecision: 3 });
    expect(formatLength(25.4 * (14 + 3 / 8), arch)).toBe('1\' 2 3/8"');
    expect(formatLength(25.4 * 36, arch)).toBe("3'");
    expect(formatLength(25.4 * 0.5, arch)).toBe('1/2"');
    expect(formatLength(25.4 * 0.3, arch)).toBe('~ 1/4"');
    expect(formatLength(25.4 * 2.25, u({ lengthFormat: 'fractional', lengthPrecision: 2 }))).toBe('2 1/4"');
    expect(formatLength(304.8 * 1.5, u({ lengthFormat: 'engineering', lengthPrecision: 2 }))).toBe("1.50'");
  });
});

describe('면적·부피·각도', () => {
  it('단위가 없으면 미터계는 m², 아니면 ft²', () => {
    expect(formatArea(2e6, u({ lengthUnit: 'mm' }))).toBe('2.00 m²');
    expect(formatArea(304.8 ** 2 * 3, u({ lengthUnit: 'inch' }))).toBe('3.00 ft²');
    expect(formatArea(2e6, u({ areaUnit: 'square_millimeter', areaPrecision: 0 }))).toBe('2000000 mm²');
    expect(formatVolume(2e6, u({ volumeUnit: 'liter', volumePrecision: 1 }))).toBe('2.0 L');
    expect(formatAngle(45.04, u({ anglePrecision: 1 }))).toBe('~ 45.0°');
  });
});

describe('meta.units 읽기', () => {
  it('모르는 꼴이면 옛 lengthUnit 이름으로 채운다', () => {
    expect(readUnits(undefined, 'cm').lengthUnit).toBe('cm');
    expect(readUnits(undefined, 'ft').lengthUnit).toBe('feet');
    expect(readUnits({ lengthUnit: 'm', lengthFormat: 'decimal', lengthPrecision: 3, suppressUnits: true })).toMatchObject({ lengthUnit: 'm', lengthPrecision: 3, suppressUnits: true });
    expect(readUnits({ lengthFormat: 'bogus' }).lengthFormat).toBe('decimal');
    expect(mmPerSceneUnit('inch')).toBe(25.4);
    expect(mmPerSceneUnit('m')).toBe(1000);
    expect(unitsLabel(u({ lengthUnit: 'cm', lengthPrecision: 1 }))).toBe('cm · 십진 · 소수 1자리');
  });
});
