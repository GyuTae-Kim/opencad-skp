/**
 * 측정 띠 알림(복사했습니다, 안내 두기 켬 등): 잠깐 보이고 사라진다.
 * 종류(kind)를 붙여 띄운 알림은 그 종류로만 거둘 수 있다(다른 알림은 그대로 둔다 — 21차까지는 잠글 방향이 없다는 알림을
 * 잠금이 걸리면 거뒀다. 22차부터 그때는 측정 띠 위에 잠글 방향 고르기 줄을 연다).
 */
export class FlashNote {
  private readonly el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private kind: string | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** 글을 ms 동안 보인다(떠 있던 알림은 바꾼다) */
  show(text: string, ms = 1600, kind: string | null = null): void {
    this.el.textContent = text;
    this.el.hidden = false;
    this.kind = kind;
    this.stopTimer();
    this.timer = setTimeout(() => this.hide(), ms);
  }

  /** 그 종류 알림이 떠 있으면 거둔다 */
  drop(kind: string): void {
    if (this.kind === kind && !this.el.hidden) this.hide();
  }

  private hide(): void {
    this.stopTimer();
    this.el.hidden = true;
    this.kind = null;
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
