// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vcb, vcbStartKey, type VcbKind } from '../../src/app/vcb';
import { DEFAULT_UNITS, parseAngle, parseLength, usesDecimalComma, type UnitsDisplay } from '../../src/app/units';

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
});

describe('측정값 칸(Vcb)', () => {
  const make = (onSubmit = vi.fn((_value: number, _kind: VcbKind): string | null => null)) => {
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
    expect(vcb.input.inputMode).toBe('');
    vcb.begin('9');
    expect(document.activeElement).toBe(vcb.input);
    expect(vcb.input.value).toBe('9');
    vcb.input.value = '90';
    // 입력 중에는 지금 길이로 덮지 않는다
    vcb.setLive('61 cm');
    expect(vcb.input.value).toBe('90');
    vcb.el.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith(900, 'length');
    expect(returnFocus).toHaveBeenCalledTimes(1);
    expect(vcb.editing).toBe(false);
    expect(vcb.input.value).toBe('61 cm');
  });

  it('단위·종류와 상관없이 글 자판(inputmode 없음): 소수 자판에 없을 수 있는 앞의 −(반대쪽)·경사 1:6·단위 글자를 친다', () => {
    const { vcb, onSubmit } = make();
    for (const u of [DEFAULT_UNITS, CM, ENG, ARCH]) {
      vcb.setUnits(u);
      for (const kind of ['length', 'angle'] as const) {
        vcb.setKind(kind);
        expect(vcb.input.getAttribute('inputmode'), `${u.lengthFormat} ${u.lengthUnit} ${kind}`).toBeNull();
        expect(vcb.input.inputMode).toBe('');
      }
    }
    // 손가락 기기는 커서가 없어 다 잰 결과의 방향으로 넣으므로, 반대쪽은 앞의 −로만 친다
    vcb.setUnits(DEFAULT_UNITS);
    vcb.setKind('length');
    vcb.begin('-');
    vcb.input.value = '-300';
    vcb.submit();
    expect(onSubmit).toHaveBeenLastCalledWith(-300, 'length');
    vcb.begin('1');
    vcb.input.value = '1.2 m';
    vcb.submit();
    expect(onSubmit).toHaveBeenLastCalledWith(1200, 'length');
    vcb.setKind('angle');
    vcb.begin('-');
    vcb.input.value = '-1:12';
    vcb.submit();
    expect(onSubmit.mock.lastCall?.[0]).toBeCloseTo((-Math.atan2(1, 12) * 180) / Math.PI, 12);
    expect(onSubmit.mock.lastCall?.[1]).toBe('angle');
    vcb.begin('1');
    vcb.input.value = '1:6';
    vcb.submit();
    expect(onSubmit.mock.lastCall?.[0]).toBeCloseTo((Math.atan2(1, 6) * 180) / Math.PI, 12);
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
      expect(onSubmit).toHaveBeenLastCalledWith(1500, 'length');
      document.documentElement.lang = 'de';
      vcb.begin('1');
      vcb.input.value = '1,500';
      vcb.submit();
      expect(onSubmit).toHaveBeenLastCalledWith(1.5, 'length');
      // 각도도 같은 쉼표 규칙(독일어 22,5 = 22.5°)
      vcb.setKind('angle');
      vcb.begin('2');
      vcb.input.value = '22,5';
      vcb.submit();
      expect(onSubmit).toHaveBeenLastCalledWith(22.5, 'angle');
    } finally {
      document.documentElement.lang = lang;
    }
  });

  it('건축·분수 단위도 같은 글 자판, 안내점이 있으면 지우기 단추', () => {
    const { vcb, onClearGuides } = make();
    vcb.setUnits(ARCH);
    expect(vcb.input.inputMode).toBe('');
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

  it('안내선이 있으면 그 수, 안내점과 함께면 모두 지우기', () => {
    const { vcb } = make();
    const clear = vcb.el.querySelector<HTMLButtonElement>('.vcb-clear')!;
    vcb.setGuides(0, 2);
    expect(clear.hidden).toBe(false);
    expect(clear.textContent).toBe('안내선 2');
    expect(clear.getAttribute('aria-label')).toBe('안내선 2개 지우기');
    vcb.setGuides(1, 2);
    expect(clear.textContent).toBe('안내 3');
    expect(clear.getAttribute('aria-label')).toBe('안내점 1개와 안내선 2개 지우기');
    vcb.setGuides(0, 0);
    expect(clear.hidden).toBe(true);
  });

  it('고른 안내가 있으면 그 하나를 지우는 단추(없으면 숨김 — 휴대폰 검사는 보이는 단추만 잰다)', () => {
    const onDeleteGuide = vi.fn();
    const vcb = new Vcb({ onSubmit: () => null, onClearGuides: vi.fn(), onDeleteGuide });
    document.body.append(vcb.el);
    vcb.show(true);
    const del = vcb.el.querySelector<HTMLButtonElement>('.vcb-del')!;
    expect(del.hidden).toBe(true);
    expect(vcb.selectedShown).toBe(false);
    vcb.setSelected('line');
    expect(del.hidden).toBe(false);
    expect(del.getAttribute('aria-label')).toBe('고른 안내선 지우기');
    expect(del.title).toBe('고른 안내선 지우기 (Delete)');
    vcb.setSelected('point');
    expect(del.getAttribute('aria-label')).toBe('고른 안내점 지우기');
    del.click();
    expect(onDeleteGuide).toHaveBeenCalledTimes(1);
    expect(del.hidden).toBe(true);
    vcb.setSelected(null);
    expect(vcb.selectedShown).toBe(false);
  });

  it('키보드로 누른 안내 수 ✕·휴지통이 숨으면 초점을 측정 띠 안은 되돌리기(반대 동작)로, 밖은 3D 보기로(150차 — 문서로 빠지지 않게)', () => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    const onClearGuides = vi.fn();
    const onDeleteGuide = vi.fn();
    const vcb = new Vcb({ onSubmit: () => null, onClearGuides, onDeleteGuide, view: () => canvas });
    // 측정 도구 조각이 붙이는 되돌리기(mountUndo 꼴 — 휴지통 앞, 지운 뒤에는 되돌릴 것이 있어 보임. 띠 밖에서는 CSS로 숨음)
    const undo = document.createElement('button');
    undo.className = 'vcb-btn vcb-undo';
    vcb.el.insertBefore(undo, vcb.el.querySelector('.vcb-del'));
    const clear = vcb.el.querySelector<HTMLButtonElement>('.vcb-clear')!;
    const del = vcb.el.querySelector<HTMLButtonElement>('.vcb-del')!;
    document.body.append(canvas, vcb.el);
    vcb.show(true);
    // 넓은 화면(칸이 3D 보기 오른쪽 아래 — 띠 밖): 안내 수 ✕·휴지통 → 3D 보기(jsdom은 focus fixup을 하지 않아 고치기 전에는 숨은 버튼에 초점이 남는다)
    vcb.setGuides(3);
    clear.focus();
    clear.click();
    expect(onClearGuides).toHaveBeenCalledTimes(1);
    expect(clear.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
    vcb.setSelected('point');
    del.focus();
    del.click();
    expect(onDeleteGuide).toHaveBeenCalledTimes(1);
    expect(del.hidden).toBe(true);
    expect(document.activeElement).toBe(canvas);
    // 측정 띠 안(휴대폰·좁은 창): 지운 안내를 되살리는 되돌리기로
    const bar = document.createElement('div');
    bar.className = 'measure-bar';
    document.body.append(bar);
    bar.append(vcb.el);
    vcb.setGuides(2, 1);
    clear.focus();
    clear.click();
    expect(document.activeElement).toBe(undo);
    vcb.setSelected('line');
    del.focus();
    del.click();
    expect(document.activeElement).toBe(undo);
    // 되돌리기가 숨었으면 3D 보기로(그 버튼에서 친 키로 숨어도 — 숨기는 줄에서 본다)
    undo.hidden = true;
    vcb.setSelected('line');
    del.focus();
    vcb.setSelected(null);
    expect(document.activeElement).toBe(canvas);
    // 초점이 그 버튼에 없으면(입력 칸·문서) 그대로
    vcb.setGuides(1);
    vcb.input.focus();
    vcb.setGuides(0);
    expect(document.activeElement).toBe(vcb.input);
    vcb.input.blur();
    vcb.setSelected('point');
    vcb.setSelected(null);
    expect(document.activeElement).toBe(document.body);
  });

  it('각도기: 라벨·안내가 각도로 바뀌고, 도·경사(1:6)를 읽어 넘긴다(글 자판 그대로)', () => {
    const { vcb, onSubmit } = make();
    vcb.setUnits(ARCH);
    expect(vcb.input.inputMode).toBe('');
    vcb.setLive('120 mm');
    vcb.setKind('angle');
    expect(vcb.kind).toBe('angle');
    expect(vcb.el.querySelector('.vcb-label')?.textContent).toBe('각도');
    expect(vcb.el.querySelector('.vcb-btn')?.getAttribute('aria-label')).toBe('각도 넣기');
    // 각도도 글 자판(경사 1:6의 :·앞의 −), 앞 도구의 길이 글은 지운다
    expect(vcb.input.inputMode).toBe('');
    expect(vcb.input.value).toBe('');
    vcb.setLive('45.0°');
    vcb.input.dispatchEvent(new Event('focus'));
    vcb.submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(vcb.el.querySelector<HTMLElement>('.vcb-msg')!.textContent).toBe('각도를 치세요');
    vcb.input.value = '30';
    vcb.submit();
    expect(onSubmit).toHaveBeenLastCalledWith(30, 'angle');
    vcb.begin('1');
    vcb.input.value = '1:6';
    vcb.submit();
    expect(onSubmit.mock.lastCall?.[0]).toBeCloseTo((Math.atan(1 / 6) * 180) / Math.PI, 12);
    vcb.begin('x');
    vcb.submit();
    expect(vcb.el.querySelector<HTMLElement>('.vcb-msg')!.textContent).toBe('각도를 읽지 못했습니다');
    // 줄자로 돌아오면 길이 칸(자판은 그대로 글 자판)
    vcb.setKind('length');
    expect(vcb.el.querySelector('.vcb-label')?.textContent).toBe('길이');
    expect(vcb.input.inputMode).toBe('');
    expect(vcb.el.querySelector<HTMLElement>('.vcb-msg')!.hidden).toBe(true);
  });
});

describe('측정값 칸 각도 읽기(parseAngle → 도)', () => {
  it('도(기호를 붙여도 된다)·경사 높이:밑변·앞의 빼기·반올림 표시', () => {
    expect(parseAngle('34.1')).toBeCloseTo(34.1, 12);
    expect(parseAngle('34.1°')).toBeCloseTo(34.1, 12);
    expect(parseAngle(' 90 deg ')).toBe(90);
    expect(parseAngle('~ 45.0°')).toBe(45);
    expect(parseAngle('-30')).toBe(-30);
    expect(parseAngle('−30')).toBe(-30);
    expect(parseAngle('1:6')).toBeCloseTo((Math.atan2(1, 6) * 180) / Math.PI, 12);
    expect(parseAngle('6:12')).toBeCloseTo(26.565051177, 8);
    expect(parseAngle('1:0')).toBe(90);
    expect(parseAngle('-1:1')).toBeCloseTo(-45, 12);
  });

  it('쉼표: 소수 쉼표 언어는 소수점, 아니면 세 자리 묶음만 천 단위(점이 없으면 소수점)', () => {
    expect(parseAngle('22,5')).toBe(22.5);
    expect(parseAngle('22,5', true)).toBe(22.5);
    expect(parseAngle('1,080')).toBe(1080);
    expect(parseAngle('1,080', true)).toBeCloseTo(1.08, 12);
    expect(parseAngle('1,5:6', true)).toBeCloseTo((Math.atan2(1.5, 6) * 180) / Math.PI, 12);
  });

  it('못 읽는 글은 null', () => {
    for (const t of ['', 'abc', '0:0', '1:2:3', '12 mm', '1/2', ':6', '--5']) expect(parseAngle(t), t).toBeNull();
  });
});
