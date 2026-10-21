// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEASURE_LOG_LIMIT, measureLine, pushMeasure } from '../../src/app/doc';
import { copyText } from '../../src/app/clipboard';
import { protractorResult, tapeResult } from '../../src/app/measure';
import { DEFAULT_UNITS } from '../../src/app/units';

afterEach(() => vi.unstubAllGlobals());

describe('최근 측정', () => {
  const mm = { ...DEFAULT_UNITS, lengthUnit: 'mm' as const, lengthPrecision: 0 };
  it('새것을 앞에, 바로 앞과 같은 결과는 다시 넣지 않고 한도까지', () => {
    const a = tapeResult([0, 0, 0], [1000, 0, 0]);
    const b = tapeResult([0, 0, 0], [0, 500, 0]);
    let log = pushMeasure([], a);
    log = pushMeasure(log, a);
    expect(log).toHaveLength(1);
    log = pushMeasure(log, b);
    expect(log.map((m) => (m.kind === 'tape' ? m.distance : 0))).toEqual([500, 1000]);
    expect(pushMeasure(log, null)).toEqual(log);
    for (let i = 0; i < 20; i++) log = pushMeasure(log, tapeResult([0, 0, 0], [i + 1, 0, 0]));
    expect(log).toHaveLength(MEASURE_LOG_LIMIT);
  });

  it('복사 글: 거리와 축 성분, 각도', () => {
    expect(measureLine(tapeResult([0, 0, 0], [300, 400, 0]), mm, 1)).toBe('거리 500 mm (dx 300 mm · dy 400 mm · dz 0 mm)');
    expect(measureLine(protractorResult([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), mm, 1)).toMatch(/^각도 90/);
  });

  it('클립보드 API가 있으면 쓰고, 없으면 숨긴 글 칸으로 복사한다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('a')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('a');
    vi.stubGlobal('navigator', {});
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText('b')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });
});
