/**
 * 보기 기록(이전·다음 보기, 순수): SketchUp의 카메라 › 이전/다음처럼 카메라 상태를 차례로 남긴다.
 * 끌기·휠·맞춰 보기 한 번이 한 칸이 되도록, 카메라가 settleMs 동안 멈췄을 때만 적는다(부른 쪽이 now를 넘긴다).
 * 이전으로 간 뒤 새로 움직이면 앞쪽 기록은 버린다. 칸 수는 limit까지.
 * 칸마다 꼬리표(tag)를 함께 둘 수 있다 — 앱은 장면 맞춤(세로 화면에서 넓힌 시야각)을 적어, 되돌릴 때 지금 화면 방향에 다시 맞춘다.
 * 같은 칸인지는 sameTag가 참이면 시야각을 빼고 본다(화면을 돌려 시야각만 다시 맞춘 것은 새 칸이 아니다).
 */
import type { CameraState } from 'opencad-viewer3d/camera';

export const HISTORY_LIMIT = 50;
/** 카메라가 이만큼 멈춰야 한 칸으로 적는다(ms) */
export const HISTORY_SETTLE_MS = 350;

function same(a: CameraState, b: CameraState, fov = true): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(a.distance));
  return (
    a.projection === b.projection &&
    Math.abs(a.distance - b.distance) <= eps &&
    Math.abs(a.yaw - b.yaw) < 1e-9 &&
    Math.abs(a.pitch - b.pitch) < 1e-9 &&
    (!fov || Math.abs(a.fovY - b.fovY) < 1e-9) &&
    Math.abs(a.target[0] - b.target[0]) <= eps &&
    Math.abs(a.target[1] - b.target[1]) <= eps &&
    Math.abs(a.target[2] - b.target[2]) <= eps
  );
}

const copy = (c: CameraState): CameraState => ({ ...c, target: [c.target[0], c.target[1], c.target[2]] });

interface Entry<T> {
  cam: CameraState;
  tag: T | null;
}

export class ViewHistory<T = never> {
  private list: Entry<T>[] = [];
  private at = -1;
  /** 아직 적지 않은 마지막 카메라와 그 시각 */
  private pending: (Entry<T> & { t: number }) | null = null;
  /** 이전·다음으로 옮기는 중이면 그 카메라 변화는 적지 않는다 */
  private moving = false;

  constructor(
    private readonly limit = HISTORY_LIMIT,
    private readonly sameTag: (a: T | null, b: T | null) => boolean = () => false,
  ) {}

  /** 새 문서: 처음 카메라만 남긴다 */
  reset(cam: CameraState | null, tag: T | null = null): void {
    this.list = cam ? [{ cam: copy(cam), tag }] : [];
    this.at = this.list.length - 1;
    this.pending = null;
    this.moving = false;
  }

  /** 카메라가 바뀔 때마다 부른다(tag = 그때의 꼬리표) */
  observe(cam: CameraState, now: number, tag: T | null = null): void {
    if (this.moving) return;
    this.pending = { cam: copy(cam), tag, t: now };
  }

  /** 주기적으로(또는 다음 조작 전에) 부른다: 멈춘 카메라를 한 칸으로 적는다. 적었으면 true */
  settle(now: number, force = false): boolean {
    const p = this.pending;
    if (!p || (!force && now - p.t < HISTORY_SETTLE_MS)) return false;
    this.pending = null;
    const cur = this.list[this.at];
    if (cur && same(cur.cam, p.cam, !this.sameTag(cur.tag, p.tag))) return false;
    this.list.length = this.at + 1;
    this.list.push({ cam: p.cam, tag: p.tag });
    if (this.list.length > this.limit) this.list.splice(0, this.list.length - this.limit);
    this.at = this.list.length - 1;
    return true;
  }

  canBack(): boolean {
    return this.at > 0 || (!!this.pending && this.at >= 0);
  }

  canForward(): boolean {
    return !this.pending && this.at < this.list.length - 1;
  }

  /** 이전 보기(없으면 null). 옮기는 동안 적지 않게 done()을 부를 때까지 막는다 */
  back(now: number): CameraState | null {
    this.settle(now, true);
    if (this.at <= 0) return null;
    this.at--;
    this.moving = true;
    return copy(this.list[this.at]!.cam);
  }

  forward(): CameraState | null {
    if (this.pending || this.at >= this.list.length - 1) return null;
    this.at++;
    this.moving = true;
    return copy(this.list[this.at]!.cam);
  }

  /** 지금 칸의 꼬리표(이전·다음으로 옮긴 칸의 것) */
  get tag(): T | null {
    return this.list[this.at]?.tag ?? null;
  }

  /** 이전·다음으로 옮기기가 끝났다 */
  done(): void {
    this.moving = false;
    this.pending = null;
  }

  get size(): number {
    return this.list.length;
  }

  get index(): number {
    return this.at;
  }
}
