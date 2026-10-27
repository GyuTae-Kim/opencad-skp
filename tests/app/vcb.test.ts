// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vcb, vcbStartKey } from '../../src/app/vcb';
import { DEFAULT_UNITS, decimalKeypadFits, parseLength, usesDecimalComma, type UnitsDisplay } from '../../src/app/units';

const ARCH: UnitsDisplay = { ...DEFAULT_UNITS, lengthUnit: 'inch', lengthFormat: 'architectural', lengthPrecision: 3 };
const CM: UnitsDisplay = { ...DEFAULT_UNITS, lengthUnit: 'cm' };
const ENG: UnitsDisplay = { ...DEFAULT_UNITS, lengthUnit: 'feet', lengthFormat: 'engineering', lengthPrecision: 2 };

afterEach(() => {
  document.body.replaceChildren();
});

describe('측정값 칸 글 읽기(parseLength → mm)', () => {
  it('단위가 없으면 모형 단위: 십진은 길이 단위, 건축·분수는 인치, 공학은 피트', () => {
    expect(parseLength('1200')).toBe(1200);
    expect(parseLength('120', CM)).toBe(1200);
    expect(parseLength('10', ARCH)).toBeCloseTo(254, 9);
    expect(parseLength('2', ENG)).toBeCloseTo(609.6, 9);
  });

  it('단위를 붙여도 되고, 소수 쉼표·앞의 빼기(반대쪽)를 읽는다', () => {
    expect(parseLength('1200mm', ARCH)).toBe(1200);
    expect(parseLength('1.2 m')).toBe(1200);
    expect(parseLength('120 cm')).toBe(1200);
    expect(parseLength('1,5 m')).toBe(1500);
    expect(parseLength('-300')).toBe(-300);
    expect(parseLength('48in')).toBeCloseTo(1219.2, 9);
    expect(parseLength('4ft')).toBeCloseTo(1219.2, 9);
  });

  it('피트·인치·분수(건축 단위 꼴)', () => {
    expect(parseLength("5'")).toBeCloseTo(1524, 9);
    expect(parseLength('5\'6"')).toBeCloseTo(1676.4, 9);
    expect(parseLength('5\' 6 1/2"')).toBeCloseTo(1689.1, 9);
    expect(parseLength('5\'-6"')).toBeCloseTo(1676.4, 9);
    expect(parseLength('6 1/2"')).toBeCloseTo(165.1, 9);
    expect(parseLength('3/4', ARCH)).toBeCloseTo(19.05, 9);
  });

  it('쉼표: 세 자리 묶음은 천 단위 구분, 그 밖은 소수 쉼표 — 소수 쉼표 언어는 늘 소수점', () => {
    expect(parseLength('1,500')).toBe(1500);
    expect(parseLength('1,500 mm')).toBe(1500);
    expect(parseLength('12,345.5')).toBe(12345.5);
    expect(parseLength('1,234,567')).toBe(1234567);
    expect(parseLength('1,5')).toBe(1.5);
    expect(parseLength('12,3456')).toBe(12.3456);
    expect(parseLength('-1,500')).toBe(-1500);
    expect(parseLength('1,500', DEFAULT_UNITS, true)).toBe(1.5);
    expect(parseLength('1,5 m', DEFAULT_UNITS, true)).toBe(1500);
    expect(usesDecimalComma('de')).toBe(true);
    for (const l of ['ko', 'en', 'ja', 'zh-CN', '', null]) expect(usesDecimalComma(l), String(l)).toBe(false);
  });

  it('칸에 보이던 반올림 표시(~)는 건너뛴다', () => {
    expect(parseLength('~ 2852 mm')).toBe(2852);
    expect(parseLength('~1.5 m')).toBe(1500);
  });

  it('못 읽는 글은 null', () => {
    for (const t of ['', ' ', 'abc', '.', '1/0', '12 xyz', '--3', '1..2', '1,500,5', '~']) expect(parseLength(t), t).toBeNull();
  });

  it('숫자 자판(소수점만)으로 충분한 단위인지', () => {
    expect(decimalKeypadFits(DEFAULT_UNITS)).toBe(true);
    expect(decimalKeypadFits(ENG)).toBe(true);
    expect(decimalKeypadFits(ARCH)).toBe(false);
  });
});

describe('측정값 칸(Vcb)', () => {
  const make = (onSubmit = vi.fn((_mm: number): string | null => null)) => {
    const onClearGuides = vi.fn();
    const returnFocus = vi.fn();
    const vcb = new Vcb({ onSubmit, onClearGuides, returnFocus });
    document.body.append(vcb.el);
    vcb.show(true);
    return { vcb, onSubmit, onClearGuides, returnFocus };
  };
  const key = (el: Element, k: string): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it('숫자·소수점·쉼표·빼기(수정 키 없이)만 칸을 연다', () => {
    for (const k of ['0', '7', '.', ',', '-']) expect(vcbStartKey({ key: k, ctrlKey: false, metaKey: false, altKey: false }), k).toBe(true);
    for (const k of ['a', 'Enter', 'F', 'Escape', '+']) expect(vcbStartKey({ key: k, ctrlKey: false, metaKey: false, altKey: false }), k).toBe(false);
    expect(vcbStartKey({ key: '1', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
  });

  it('지금 길이를 보이고, 친 첫 글자부터 입력해 Enter로 넣는다(모형 단위 → mm)', () => {
    const { vcb, onSubmit, returnFocus } = make();
    vcb.setUnits(CM);
    vcb.setLive('60 cm');
    expect(vcb.input.value).toBe('60 cm');
    expect(vcb.input.inputMode).toBe('decimal');
    vcb.begin('9');
    expect(document.activeElement).toBe(vcb.input);
    expect(vcb.input.value).toBe('9');
    vcb.input.value = '90';
    // 입력 중에는 지금 길이로 덮지 않는다
    vcb.setLive('61 cm');
    expect(vcb.input.value).toBe('90');
    vcb.el.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith(900);
    expect(returnFocus).toHaveBeenCalledTimes(1);
    expect(vcb.editing).toBe(false);
    expect(vcb.input.value).toBe('61 cm');
  });

  it('못 읽거나 넣지 못하면 알림(입력은 그대로), Esc는 입력만 그만둔다(창으로 보내지 않음)', () => {
    const { vcb, returnFocus } = make(vi.fn(() => '커서를 잴 방향으로 옮긴 뒤 치세요'));
    vcb.setLive('100 mm');
    vcb.begin('x');
    vcb.submit();
    const msg = vcb.el.querySelector<HTMLElement>('.vcb-msg')!;
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toBe('길이를 읽지 못했습니다');
    expect(vcb.input.hasAttribute('aria-invalid')).toBe(true);
    vcb.input.value = '250';
    vcb.submit();
    expect(msg.textContent).toBe('커서를 잴 방향으로 옮긴 뒤 치세요');
    expect(vcb.input.value).toBe('250');
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const e = key(vcb.input, 'Escape');
    window.removeEventListener('keydown', outside);
    expect(e.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
    expect(vcb.input.value).toBe('100 mm');
    expect(msg.hidden).toBe(true);
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });

  it('보이던 지금 길이를 그대로 넣으면(칸만 누르고 Enter) 넣지 않고 알린다', () => {
    const { vcb, onSubmit } = make();
    vcb.setLive('~ 3728 mm');
    vcb.input.dispatchEvent(new Event('focus'));
    expect(vcb.editing).toBe(true);
    vcb.submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(vcb.el.querySelector<HTMLElement>('.vcb-msg')!.textContent).toBe('길이를 치세요');
  });

  it('쉼표는 화면 언어를 따른다(한국어 1,500 = 천오백, 독일어 1,5 = 1.5)', () => {
    const { vcb, onSubmit } = make();
    const lang = document.documentElement.lang;
    try {
      document.documentElement.lang = 'ko';
      vcb.begin('1');
      vcb.input.value = '1,500';
      vcb.submit();
      expect(onSubmit).toHaveBeenLastCalledWith(1500);
      document.documentElement.lang = 'de';
      vcb.begin('1');
      vcb.input.value = '1,500';
      vcb.submit();
      expect(onSubmit).toHaveBeenLastCalledWith(1.5);
    } finally {
      document.documentElement.lang = lang;
    }
  });

  it('건축·분수 단위는 글 자판, 안내점이 있으면 지우기 단추', () => {
    const { vcb, onClearGuides } = make();
    vcb.setUnits(ARCH);
    expect(vcb.input.inputMode).toBe('text');
    const clear = vcb.el.querySelector<HTMLButtonElement>('.vcb-clear')!;
    expect(clear.hidden).toBe(true);
    vcb.setGuides(3);
    expect(clear.hidden).toBe(false);
    expect(clear.getAttribute('aria-label')).toBe('안내점 3개 지우기');
    clear.click();
    expect(onClearGuides).toHaveBeenCalledTimes(1);
    expect(clear.hidden).toBe(true);
    // 숨기면 입력을 그만두고 begin은 아무것도 하지 않는다
    vcb.show(false);
    vcb.begin('5');
    expect(document.activeElement).not.toBe(vcb.input);
  });
});
