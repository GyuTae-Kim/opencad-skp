/**
 * 측정값 칸(VCB — SketchUp 오른쪽 아래 "측정값" 상자): 줄자에서 지금 길이를 보이고, 길이를 쳐서 Enter로 넣는다.
 *
 * 이 뷰어는 모형을 고치지 않으므로, SketchUp 줄자에서 길이를 쳐 안내점을 찍는 쓰임만 옮겼다(measure.ts applyLength):
 *   - 시작점을 찍고 커서를 잴 방향(끝점·모서리·축 고정)으로 둔 채 숫자를 치면 이 칸에 들어가고, Enter로 시작점에서 그 길이에 안내점을 찍는다.
 *   - 두 점을 다 잰 뒤 길이를 치면 그 결과의 방향으로 시작점에서 그 길이에 안내점을 찍는다(커서가 없는 손가락 기기는 이쪽 — 칸을 누르면 숫자 자판).
 *   안내점은 보기 전용 표시(모형에 넣지 않음)이고 끝점처럼 붙으므로, "이 벽 모서리에서 900 mm 떨어진 곳"에서 다시 잴 수 있다.
 * 글은 모형 단위로 읽는다(units.ts parseLength — 단위를 붙여도 된다). 십진·공학 단위는 숫자 자판(inputmode decimal),
 * 건축·분수 인치는 ' " / 가 필요해 글 자판을 띄운다. 휴대폰 자판이 화면을 확대하지 않게 손가락 기기의 글 크기는 16px(CSS).
 * 칸 안의 Esc는 입력만 그만두고(측정 점은 그대로), Enter·Esc 뒤에는 부른 쪽이 정한 곳으로 초점을 돌려준다.
 */
import { h, icon } from './dom';
import { DEFAULT_UNITS, decimalKeypadFits, parseLength, type UnitsDisplay } from './units';

export interface VcbOptions {
  /** 친 길이(mm, 음수면 반대쪽) → 못 넣었으면 알릴 글, 넣었으면 null */
  onSubmit: (mm: number) => string | null;
  /** 안내점 지우기 단추 */
  onClearGuides: () => void;
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
  private units: UnitsDisplay = DEFAULT_UNITS;
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
      title: '길이를 치고 Enter: 시작점에서 그 길이에 안내점을 찍습니다',
    });
    this.msg = h('span', { id: `${id}-msg`, class: 'vcb-msg', role: 'status', 'aria-live': 'polite', hidden: true });
    const go = h('button', { class: 'vcb-btn', type: 'submit', title: '길이 넣기', 'aria-label': '길이 넣기', html: icon('enter', 16) });
    this.clearBtn = h('button', { class: 'vcb-btn vcb-clear', type: 'button', hidden: true, html: icon('close', 14) });
    this.clearBtn.addEventListener('click', () => {
      this.opts.onClearGuides();
      this.setGuides(0);
    });
    this.el = h(
      'form',
      { class: 'vcb', role: 'group', 'aria-label': '측정값', hidden: true, novalidate: true },
      h('label', { class: 'vcb-label', for: id }, '길이'),
      this.input,
      go,
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
      // 지금 길이가 들어 있으면 통째로 골라 두어, 치면 바뀐다(SketchUp 측정값 칸처럼)
      this.input.select();
    });
    this.input.addEventListener('input', () => this.setMessage(null));
    this.input.addEventListener('blur', () => {
      // 아무것도 바꾸지 않고 나가면 다시 지금 길이를 보인다
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

  /** 입력 중인지(친 글이 있어 지금 길이로 덮지 않는다) */
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

  /** 모형 단위(숫자 자판으로 충분한지 정한다) */
  setUnits(u: UnitsDisplay): void {
    this.units = u;
    this.input.inputMode = decimalKeypadFits(u) ? 'decimal' : 'text';
  }

  /** 지금 길이 글(입력 중이 아니면 칸에 보인다) */
  setLive(text: string): void {
    this.live = text;
    if (!this.editingValue) this.input.value = text;
  }

  /** 안내점 수(있으면 지우기 단추) */
  setGuides(n: number): void {
    this.clearBtn.hidden = !(n > 0);
    const t = `안내점 ${n}개 지우기`;
    this.clearBtn.title = t;
    this.clearBtn.setAttribute('aria-label', t);
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

  /** 친 길이 넣기(Enter·넣기 단추) */
  submit(): void {
    const text = this.input.value.trim();
    if (!text || (text === this.live && !this.editingValue)) {
      this.setMessage('길이를 치세요');
      return;
    }
    const mm = parseLength(text, this.units);
    if (mm === null) {
      this.setMessage('길이를 읽지 못했습니다');
      return;
    }
    const err = this.opts.onSubmit(mm);
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
