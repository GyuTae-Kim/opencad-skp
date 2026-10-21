// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MAX_EXPORT_RATIO, exportFileName, exportSizes, labelBoxOrigin, labelOps, unmatte } from '../../src/app/exportimage';
import { ExportDialog } from '../../src/app/exporter';
import type { AnnotationItem, Placement } from '../../src/app/annotations';

describe('그림 내보내기 셈', () => {
  it('크기: 화면(기기 비율, 2에서 자름)과 2배(화면이 2배보다 작을 때만)', () => {
    expect(exportSizes(800, 600, 1)).toEqual([
      { ratio: 1, width: 800, height: 600 },
      { ratio: 2, width: 1600, height: 1200 },
    ]);
    expect(exportSizes(400, 700, 3)).toEqual([{ ratio: MAX_EXPORT_RATIO, width: 800, height: 1400 }]);
    expect(exportSizes(801.4, 600.6, 1.5)[0]).toEqual({ ratio: 1.5, width: 1202, height: 902 });
    expect(exportSizes(10, 10, NaN)[0]!.ratio).toBe(1);
  });

  it('차이 매트: 두 장이 같으면 불투명, 검정·흰이면 투명, 반투명은 색을 되돌린다', () => {
    // 화소 셋: 불투명 빨강, 배경, 50 % 파랑(검정 위 0,0,128 / 흰 위 127,127,255)
    const black = Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 128, 255]);
    const white = Uint8ClampedArray.from([255, 0, 0, 255, 255, 255, 255, 255, 127, 127, 255, 255]);
    const out = new Uint8ClampedArray(12);
    unmatte(black, white, out);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(out[11]).toBe(128);
    expect(out[10]).toBe(255);
  });

  it('라벨 명령: 같은 자리·정렬·돌림, 글꼴(굵게·기울임·크기)·색·테두리, 흐린 라벨', () => {
    const item = (o: Partial<AnnotationItem>): AnnotationItem => ({
      kind: 'text',
      text: '글',
      at: [0, 0, 0],
      anchor: null,
      screen: null,
      dir: null,
      tag: '',
      hidden: false,
      node: -1,
      px: null,
      worldHeight: null,
      family: '',
      bold: false,
      italic: false,
      color: '',
      light: false,
      em: [1, 1.2],
      ...o,
    });
    const items = [item({ text: '첫 줄\n둘째 줄', bold: true, italic: true, family: 'Tahoma', color: '#ff0000' }), item({ light: true }), item({ text: '' })];
    const p = (i: number, o: Partial<Placement> = {}): Placement => ({ item: i, x: 10, y: 20, align: 'center', angle: 0, px: 12, box: { x: 0, y: 0, w: 1, h: 1 }, crowded: false, ...o });
    const ops = labelOps([p(0, { angle: 30 }), p(1, { crowded: true }), p(2)], items);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ lines: ['첫 줄', '둘째 줄'], x: 10, y: 20, angle: 30, font: 'italic 700 12px Tahoma', color: '#ff0000', halo: '#ffffff', alpha: 1 });
    expect(ops[1]).toMatchObject({ color: '#1d2530', halo: 'rgba(0,0,0,0.85)', alpha: 0.35 });
    expect(labelBoxOrigin('center', 10, 4)).toEqual([-5, -2]);
    expect(labelBoxOrigin('right', 10, 4)).toEqual([0, -2]);
    expect(labelBoxOrigin('left', 10, 4)).toEqual([-10, -2]);
    expect(labelBoxOrigin('above', 10, 4)).toEqual([-5, -4]);
    expect(labelBoxOrigin('below', 10, 4)).toEqual([-5, 0]);
    expect(labelBoxOrigin('topLeft', 10, 4)).toEqual([0, 0]);
  });

  it('파일 이름: 문서 이름에 2배·투명 표시', () => {
    expect(exportFileName('집.skp', false, false)).toBe('집.png');
    expect(exportFileName('집.skp', true, true)).toBe('집@2x-transparent.png');
    expect(exportFileName('', false, false)).toBe('model.png');
  });
});

describe('그림 저장 창', () => {
  it('크기 후보·투명 배경·글 넣기를 보이고 Esc·닫기로 닫는다', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 640 });
    Object.defineProperty(canvas, 'clientHeight', { value: 480 });
    const ctx = { viewer: { canvas }, overlay: null, labels: null, base: 'light', restoreTheme: vi.fn() };
    const x = new ExportDialog({ docName: () => '집.skp', context: () => ctx as never, notify: vi.fn(), track: vi.fn() }, parent);
    x.open();
    expect(x.isOpen).toBe(true);
    const el = parent.querySelector('.export-dialog')!;
    expect(el.getAttribute('role')).toBe('dialog');
    const sizes = [...el.querySelectorAll('.ex-opt small')].map((s) => s.textContent);
    expect(sizes[0]).toMatch(/× /);
    expect(el.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(x.isOpen).toBe(false);
    x.open();
    (parent.querySelector('.export-dialog .icon-btn') as HTMLButtonElement).click();
    expect(parent.querySelector('.export-dialog')).toBeNull();
    // 문서가 없으면 열지 않는다
    const none = new ExportDialog({ docName: () => '', context: () => null, notify: vi.fn(), track: vi.fn() }, parent);
    none.open();
    expect(none.isOpen).toBe(false);
  });
});
