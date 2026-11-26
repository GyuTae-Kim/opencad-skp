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

/**
 * 측정 띠(그 안의 잠깐 알림)가 지금 보이는지(154차): 띠가 켜져 있고(hidden 아님 — 측정 중) 띠를 쓰는 화면(app.ts bandQuery —
 * styles.css .measure-bar와 같은 미디어 질의: 좁은 화면·손가락 기기)일 때만. 넓은 마우스 화면은 스타일시트가 띠를 늘 display: none으로 두어
 * 띠 잠깐 알림이 보이지도 읽히지도 않는다. matchMedia가 없으면(null) 보이지 않는 것으로 본다
 */
export const barShown = (bar: HTMLElement, band: MediaQueryList | null): boolean => !bar.hidden && !!band?.matches;

/**
 * 알림 상자에 복사 결과를 띄워도 되는지(154차): 비었거나 안내(info)거나 앞 복사 결과(own)일 때만. 알림 상자는 한 칸이라
 * 떠 있는 경고·오류(해석 경고·열기 오류 등 — 다시 열기 전에는 다시 볼 수 없는 글)를 덮어쓰면 잃으므로 두고, 그때 복사 결과는 띄우지 않는다
 */
export const noticeFree = (box: HTMLElement, kind: string | undefined, own: boolean): boolean => !!box.hidden || own || kind === 'info';
