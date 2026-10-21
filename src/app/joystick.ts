/**
 * 휴대폰 걷기용 화면 조이스틱(코어 setWalkInput): 원판 위에서 손잡이를 끌면 위·아래 = 앞·뒤, 왼쪽·오른쪽 = 옆으로 걷는다.
 * 떼거나 취소되면 멈춘다. 둘러보기(한 손가락 끌기)와 두 손가락 몸짓은 3D 보기가 그대로 받는다(조이스틱 밖).
 */
import { h } from './dom';

/** 가운데 둘레 이 비율 안은 멈춤(손가락 떨림) */
export const STICK_DEADZONE = 0.12;

/**
 * 손잡이 자리(가운데에서 dx·dy 화소, 아래가 +) → 걷기 입력(−1~1). 반지름 밖은 원 위로 자르고, 데드존 안은 0,
 * 데드존 밖은 0부터 다시 늘려 살짝 밀어도 천천히 움직이게
 */
export function stickInput(dx: number, dy: number, radius: number): { forward: number; right: number } {
  const r = Math.max(1, radius);
  let x = dx / r;
  let y = dy / r;
  const l = Math.hypot(x, y);
  if (!(l > STICK_DEADZONE) || !Number.isFinite(l)) return { forward: 0, right: 0 };
  const k = Math.min(1, (l - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / l;
  x *= k;
  y *= k;
  return { forward: -y || 0, right: x || 0 };
}

export class WalkStick {
  readonly el: HTMLElement;
  private readonly knob: HTMLElement;
  private active: number | null = null;

  constructor(private readonly onInput: (i: { forward: number; right: number }) => void) {
    this.knob = h('div', { class: 'stick-knob' });
    this.el = h('div', { class: 'walk-stick', role: 'application', 'aria-label': '걷기 조이스틱: 위로 끌면 앞으로, 옆으로 끌면 옆으로 걷습니다', hidden: true }, this.knob);
    const move = (e: PointerEvent): void => {
      const r = this.el.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = e.clientX - (r.left + radius);
      let dy = e.clientY - (r.top + radius);
      const l = Math.hypot(dx, dy);
      if (l > radius) {
        dx *= radius / l;
        dy *= radius / l;
      }
      this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      this.onInput(stickInput(dx, dy, radius));
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (this.active !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.active = e.pointerId;
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        /* 붙잡지 못해도 움직임은 받는다 */
      }
      this.el.classList.add('on');
      move(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.active) move(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.active) return;
      this.release();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('lostpointercapture', end);
  }

  /** 손잡이를 가운데로 돌리고 멈춘다 */
  release(): void {
    this.active = null;
    this.el.classList.remove('on');
    this.knob.style.transform = '';
    this.onInput({ forward: 0, right: 0 });
  }

  setVisible(on: boolean): void {
    if (!on && this.active !== null) this.release();
    this.el.hidden = !on;
  }
}
