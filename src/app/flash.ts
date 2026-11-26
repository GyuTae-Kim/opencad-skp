/**
 * 측정 띠 알림(복사했습니다, 안내 두기 켬 등): 잠깐 보이고 사라진다.
 * 종류(kind)를 붙여 띄운 알림은 그 종류로만 거둘 수 있다(다른 알림은 그대로 둔다 — 21차까지는 잠글 방향이 없다는 알림을
 * 잠금이 걸리면 거뒀다. 22차부터 그때는 측정 띠 위에 잠글 방향 고르기 줄을 연다).
 * 166차(WCAG 2.2.1 — 연장): 마우스·펜을 알림 위에 올린 동안은 사라지지 않고, 떠나면 그 시간을 처음부터 다시 잰다
 * (측정 띠 화면의 복사 결과는 다시 볼 곳이 없다). 알림에는 초점을 받는 칸이 없어 초점 길은 없다
 */
export class FlashNote {
  private readonly el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private kind: string | null = null;
  /** 보이는 시간(떠나면 다시 이만큼)과 포인터가 알림 위에 있는지(166차) */
  private ms = 0;
  private held = false;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerenter', () => {
      this.held = true;
      this.stopTimer();
    });
    el.addEventListener('pointerleave', () => {
      this.held = false;
      if (!el.hidden) this.arm();
    });
  }

  /** 글을 ms 동안 보인다(떠 있던 알림은 바꾼다 — 포인터가 위에 있으면 떠날 때까지) */
  show(text: string, ms = 1600, kind: string | null = null): void {
    this.el.textContent = text;
    this.el.hidden = false;
    this.kind = kind;
    this.ms = ms;
    this.stopTimer();
    if (!this.held) this.arm();
  }

  private arm(): void {
    this.stopTimer();
    this.timer = setTimeout(() => this.hide(), this.ms);
  }

  /** 그 종류 알림이 떠 있으면 거둔다 */
  drop(kind: string): void {
    if (this.kind === kind && !this.el.hidden) this.hide();
  }

  private hide(): void {
    this.stopTimer();
    this.el.hidden = true;
    this.kind = null;
    // 올린 채 거둬도 숨은 칸에는 떠남이 오지 않을 수 있다 — 다음 알림은 다시 시간을 잰다
    this.held = false;
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
 * 떠 있는 경고·오류(해석 경고·열기 오류 등 — 다시 열기 전에는 다시 볼 수 없는 글)를 덮어쓰면 잃으므로 두고, 그때 복사 결과는 띄우지 않는다.
 * 159차: 앱 showNotice가 모든 가벼운 글(복사 결과·2점 투시 거절·문맥 잃음·되찾는 중 안내)에 이 판정을 쓴다 — own은 「떠 있는 글이 가벼운 글」
 */
export const noticeFree = (box: HTMLElement, kind: string | undefined, own: boolean): boolean => !!box.hidden || own || kind === 'info';
