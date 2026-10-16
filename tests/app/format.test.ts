import { describe, expect, it } from 'vitest';
import {
  SKP_ACCEPT,
  baseName,
  fileExtension,
  fmtCount,
  fmtNum,
  fmtPt,
  formatBytes,
  formatMs,
  isSkpName,
  rgbCss,
  stripExtension,
} from '../../src/app/format';

describe('크기·시간 글', () => {
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(11.6 * 1024)).toBe('11.6 KB');
    expect(formatBytes(150 * 1024)).toBe('150 KB');
    expect(formatBytes(5.25 * 1024 * 1024)).toBe('5.25 MB');
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 GB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('formatMs', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(7.4)).toBe('7 ms');
    expect(formatMs(999)).toBe('999 ms');
    expect(formatMs(1234)).toBe('1.23초');
    expect(formatMs(12_340)).toBe('12.3초');
    expect(formatMs(65_000)).toBe('1분 5초');
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('숫자 글', () => {
  it('fmtNum · fmtCount · fmtPt', () => {
    expect(fmtNum(1234.56789)).toBe('1,234.568');
    expect(fmtNum(1234.5, 1)).toBe('1,234.5');
    expect(fmtNum(2)).toBe('2');
    expect(fmtNum(-0.0001)).toBe('0');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtCount(1234567)).toBe('1,234,567');
    expect(fmtCount(null)).toBe('—');
    expect(fmtPt([1, 2.5, -3])).toBe('1, 2.5, -3');
    expect(fmtPt(null)).toBe('—');
  });

  it('rgbCss', () => {
    expect(rgbCss([1, 0.5, 0, 1])).toBe('rgb(255, 128, 0)');
    expect(rgbCss([2, -1, 0.2])).toBe('rgb(255, 0, 51)');
  });
});

describe('파일 이름', () => {
  it('확장자·이름', () => {
    expect(fileExtension('집.SKP')).toBe('skp');
    expect(fileExtension('C:\\모형\\a.b.skp')).toBe('skp');
    expect(fileExtension('README')).toBe('');
    expect(baseName('/a/b/집.skp')).toBe('집.skp');
    expect(stripExtension('/a/집 모형.skp')).toBe('집 모형');
    expect(stripExtension('.skp')).toBe('.skp');
    expect(isSkpName('x.Skp')).toBe(true);
    expect(isSkpName('x.dwg')).toBe(false);
  });

  it('열기 상자는 대소문자 확장자를 모두 받는다', () => {
    expect(SKP_ACCEPT.split(',')).toEqual(['.skp', '.SKP']);
  });
});
