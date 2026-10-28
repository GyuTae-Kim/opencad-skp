/**
 * 측정값 칸(VCB — SketchUp 오른쪽 아래 "측정값" 상자): 줄자에서 지금 길이, 각도기에서 지금 각도를 보이고, 값을 쳐서 Enter로 넣는다.
 *
 * 이 뷰어는 모형을 고치지 않으므로, SketchUp 줄자·각도기에서 값을 쳐 안내(안내점·안내선)를 두는 쓰임만 옮겼다(measure.ts applyLength·applyAngle):
 *   - 줄자: 시작점을 찍고 커서를 잴 방향(끝점·모서리·축 고정)으로 둔 채 숫자를 치면 이 칸에 들어가고, Enter로 시작점에서 그 길이에 안내점을 찍는다.
 *     시작점이 모서리 위(끝점·중간점이 아닌 곳)면 안내점 대신 그 모서리와 나란한 안내선을 커서 쪽으로 그 거리만큼 띄워 둔다.
 *   - 각도기: 중심과 기준 방향을 찍고 커서를 돌릴 쪽에 둔 채 각도(도, 경사 1:6)를 치면 중심을 지나 기준 방향에서 그만큼 돈 안내선을 둔다.
 *   - 다 잰 뒤 값을 치면 그 결과의 방향으로 넣는다(커서가 없는 손가락 기기는 이쪽 — 칸을 누르면 숫자 자판).
 *   안내는 보기 전용 표시(모형에 넣지 않음)이고 안내점은 끝점처럼, 안내선은 모서리처럼 붙으므로, "이 벽 모서리에서 900 mm 떨어진 곳"에서 다시 잴 수 있다.
 *   안내 수와 모두 지우기(✕), 고른 안내가 있으면 그 하나를 지우는 단추(휴지통 — 키보드는 Delete)도 이 칸에 둔다.
 * 길이는 모형 단위로 읽는다(units.ts parseLength — 단위를 붙여도 되고, 쉼표는 화면 언어를 따른다). 십진·공학 단위는 숫자 자판(inputmode decimal),
 * 건축·분수 인치는 ' " / 가 필요해 글 자판을 띄운다. 각도(parseAngle)는 숫자 자판. 휴대폰 자판이 화면을 확대하지 않게 손가락 기기의 글 크기는 16px(CSS).
 * 칸 안의 Esc는 입력만 그만두고(측정 점은 그대로), Enter·Esc 뒤에는 부른 쪽이 정한 곳으로 초점을 돌려준다.
 */
import { h, icon } from './dom';
import { DEFAULT_UNITS, decimalKeypadFits, parseAngle, parseLength, usesDecimalComma, type UnitsDisplay } from './units';

/** 칸이 받는 값: 줄자 길이 · 각도기 각도 */
export type VcbKind = 'length' | 'angle';

/** 칸 종류별 글 */
const KIND_TEXT: Readonly<Record<VcbKind, { label: string; title: string; go: string; empty: string; bad: string }>> = {
  length: { label: '길이', title: '길이를 치고 Enter: 시작점에서 그 길이에 안내점을 찍습니다', go: '길이 넣기', empty: '길이를 치세요', bad: '길이를 읽지 못했습니다' },
  angle: { label: '각도', title: '각도(도, 경사 1:6)를 치고 Enter: 중심을 지나 그 각도로 돈 안내선을 둡니다', go: '각도 넣기', empty: '각도를 치세요', bad: '각도를 읽지 못했습니다' },
};

export interface VcbOptions {
  /** 친 값(길이는 mm, 각도는 도 — 음수면 반대쪽) → 못 넣었으면 알릴 글, 넣었으면 null */
  onSubmit: (value: number, kind: VcbKind) => string | null;
  /** 안내점 지우기 단추 */
  onClearGuides: () => void;
  /** 고른 안내 하나 지우기 단추(고른 안내가 있을 때만 보인다) */
  onDeleteGuide?: () => void;
  /** 입력을 마친 뒤(Enter로 넣음·Esc) 초점을 둘 곳 — 없으면 칸에서 초점만 뺀다 */
  returnFocus?: () => void;
}

/** 측정값 칸에 넣기 시작하는 키(수정 키 없이): 숫자·소수점·쉼표·빼기 */
export function vcbStartKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return /^[0-9.,-]$/.test(e.key);
}

let vcbSeq = 0;

export class Vcb {
  readonly el: HTMLFormElement;
  readonly input: HTMLInputElement;
  private readonly msg: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly delBtn: HTMLButtonElement;
  private readonly guideCount: HTMLElement;
  private readonly label: HTMLLabelElement;
  private readonly goBtn: HTMLButtonElement;
  private units: UnitsDisplay = DEFAULT_UNITS;
  private kindValue: VcbKind = 'length';
  private live = '';
  private editingValue = false;

  constructor(private readonly opts: VcbOptions) {
    const id = `vcb-${++vcbSeq}`;
    this.input = h('input', {
      id,
      class: 'vcb-input',
      type: 'text',
      inputmode: 'decimal',
      enterkeyhint: 'done',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-describedby': `${id}-msg`,
      title: KIND_TEXT.length.title,
    });
    this.msg = h('span', { id: `${id}-msg`, class: 'vcb-msg', role: 'status', 'aria-live': 'polite', hidden: true });
    const go = h('button', { class: 'vcb-btn', type: 'submit', title: KIND_TEXT.length.go, 'aria-label': KIND_TEXT.length.go, html: icon('enter', 16) });
    this.goBtn = go;
    this.label = h('label', { class: 'vcb-label', for: id }, KIND_TEXT.length.label);
    // 안내점 지우기: 수를 함께 보여 측정 끝내기(✕)와 헷갈리지 않게
    this.guideCount = h('span', { class: 'vcb-gn' });
    this.clearBtn = h('button', { class: 'vcb-btn vcb-clear', type: 'button', hidden: true }, this.guideCount);
    this.clearBtn.insertAdjacentHTML('beforeend', icon('close', 12));
    this.clearBtn.addEventListener('click', () => {
      this.opts.onClearGuides();
      this.setGuides(0);
    });
    // 고른 안내 하나 지우기(휴대폰은 Delete가 없어 이 단추로 — 고른 안내가 있을 때만)
    this.delBtn = h('button', { class: 'vcb-btn vcb-del', type: 'button', hidden: true, html: icon('trash', 16) });
    this.delBtn.addEventListener('click', () => {
      this.opts.onDeleteGuide?.();
      this.setSelected(null);
    });
    this.el = h(
      'form',
      { class: 'vcb', role: 'group', 'aria-label': '측정값', hidden: true, novalidate: true },
      this.label,
      this.input,
      go,
      this.delBtn,
      this.clearBtn,
      this.msg,
    );
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('focus', () => {
      if (this.editingValue) return;
      this.editingValue = true;
      // 지금 값이 들어 있으면 통째로 골라 두어, 치면 바뀐다(SketchUp 측정값 칸처럼)
      this.input.select();
    });
    this.input.addEventListener('input', () => this.setMessage(null));
    this.input.addEventListener('blur', () => {
      // 아무것도 바꾸지 않고 나가면 다시 지금 값을 보인다
      if (this.input.value === this.live || !this.input.value.trim()) this.stopEditing();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // 측정 점은 그대로 두고 입력만 그만둔다(창의 Esc 차례로 가지 않게)
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    });
  }

  /** 입력 중인지(친 글이 있어 지금 값으로 덮지 않는다) */
  get editing(): boolean {
    return this.editingValue;
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  show(on: boolean): void {
    if (this.el.hidden === !on) return;
    this.el.hidden = !on;
    if (!on) {
      this.stopEditing();
      this.setMessage(null);
    }
  }

  /** 받는 값(줄자 길이 · 각도기 각도) */
  get kind(): VcbKind {
    return this.kindValue;
  }

  /** 받는 값 바꾸기: 라벨·안내·자판을 바꾸고, 입력 중이던 글은 버린다 */
  setKind(kind: VcbKind): void {
    if (kind === this.kindValue) return;
    this.kindValue = kind;
    const t = KIND_TEXT[kind];
    this.label.textContent = t.label;
    this.input.title = t.title;
    this.goBtn.title = t.go;
    this.goBtn.setAttribute('aria-label', t.go);
    this.setKeypad();
    this.live = '';
    this.stopEditing();
    this.setMessage(null);
  }

  /** 모형 단위(숫자 자판으로 충분한지 정한다) */
  setUnits(u: UnitsDisplay): void {
    this.units = u;
    this.setKeypad();
  }

  /** 십진·공학 길이와 각도는 숫자 자판, 건축·분수 길이는 ' " / 가 필요해 글 자판 */
  private setKeypad(): void {
    this.input.inputMode = this.kindValue === 'angle' || decimalKeypadFits(this.units) ? 'decimal' : 'text';
  }

  /** 지금 값 글(입력 중이 아니면 칸에 보인다) */
  setLive(text: string): void {
    this.live = text;
    if (!this.editingValue) this.input.value = text;
  }

  /** 안내점·안내선 수(있으면 지우기 단추 — 한 가지만 있으면 그 이름, 둘 다 있으면 "안내 n") */
  setGuides(points: number, lines = 0): void {
    const p = Math.max(0, points | 0);
    const l = Math.max(0, lines | 0);
    const n = p + l;
    this.clearBtn.hidden = !(n > 0);
    this.guideCount.textContent = !n ? '' : !l ? `안내점 ${p}` : !p ? `안내선 ${l}` : `안내 ${n}`;
    const t = !l ? `안내점 ${p}개 지우기` : !p ? `안내선 ${l}개 지우기` : `안내점 ${p}개와 안내선 ${l}개 지우기`;
    this.clearBtn.title = t;
    this.clearBtn.setAttribute('aria-label', t);
  }

  /** 고른 안내(안내점·안내선, 없으면 null): 있으면 그 하나를 지우는 단추를 보인다 */
  setSelected(kind: 'point' | 'line' | null): void {
    this.delBtn.hidden = !kind;
    if (!kind) return;
    const t = kind === 'point' ? '고른 안내점 지우기' : '고른 안내선 지우기';
    this.delBtn.title = `${t} (Delete)`;
    this.delBtn.setAttribute('aria-label', t);
  }

  /** 고른 안내 지우기 단추가 보이는지 */
  get selectedShown(): boolean {
    return !this.delBtn.hidden;
  }

  /** 키보드로 친 첫 글자부터 입력을 시작한다(칸에 초점) */
  begin(first = ''): void {
    if (this.el.hidden) return;
    this.editingValue = true;
    this.setMessage(null);
    this.input.value = first;
    this.input.focus({ preventScroll: true });
    const n = this.input.value.length;
    try {
      this.input.setSelectionRange(n, n);
    } catch {
      /* 고르기를 못 하는 입력 칸 */
    }
  }

  /** 친 값 넣기(Enter·넣기 단추) */
  submit(): void {
    const text = this.input.value.trim();
    const t = KIND_TEXT[this.kindValue];
    // 보이던 지금 값을 그대로 넣으면(칸만 누르고 Enter) 친 것이 없다
    if (!text || text === this.live.trim()) {
      this.setMessage(t.empty);
      return;
    }
    // 쉼표는 화면 언어를 따른다(독일어는 소수 쉼표, 그 밖은 1,500 = 천오백)
    const comma = usesDecimalComma(document.documentElement.lang);
    const value = this.kindValue === 'angle' ? parseAngle(text, comma) : parseLength(text, this.units, comma);
    if (value === null) {
      this.setMessage(t.bad);
      return;
    }
    const err = this.opts.onSubmit(value, this.kindValue);
    if (err) {
      this.setMessage(err);
      return;
    }
    this.finish();
  }

  /** 입력 그만두기(Esc) */
  cancel(): void {
    this.setMessage(null);
    this.finish();
  }

  private finish(): void {
    this.stopEditing();
    if (this.opts.returnFocus) this.opts.returnFocus();
    else this.input.blur();
  }

  private stopEditing(): void {
    this.editingValue = false;
    this.input.value = this.live;
  }

  private setMessage(text: string | null): void {
    this.msg.textContent = text ?? '';
    this.msg.hidden = !text;
    this.input.toggleAttribute('aria-invalid', !!text);
  }
}
