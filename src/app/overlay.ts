/**
 * 3D 보기 위 덧그림 층(DOM): 코어(opencad-viewer3d v0.4)에 글·라벨을 그리는 기능이 없어,
 * 세계 점을 화면에 투영해 DOM 글과 SVG 선을 캔버스 위에 얹는다(문자·치수 라벨, 측정 도구 표시).
 *
 * 카메라가 바뀌거나 보기 크기가 바뀌면 다음 그림 틀(requestAnimationFrame)에서 등록한 그리기 함수를 한 번씩 부른다.
 * 그리기 함수는 화면 좌표(캔버스 왼쪽 위 기준 CSS 화소)를 받는 투영 프레임만 쓰고, 층의 요소를 직접 고친다.
 * 덧그림은 형상에 가려지지 않고(늘 위), PNG 저장(viewer.toBlob)에는 담기지 않는다 — 저장은 앱이 따로 합친다.
 */
import type { Viewer3d } from 'opencad-viewer3d';
import { computeFrame, projectToScreen, type CameraState, type ViewFrame } from 'opencad-viewer3d/camera';

export type Painter = (frame: ViewFrame) => void;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 카메라와 화면 크기(CSS 화소) → 투영 프레임. 화면 x·y는 가까운·먼 면과 상관없어 구는 대상점 둘레로 둔다 */
export function frameFor(c: CameraState, width: number, height: number): ViewFrame {
  return computeFrame(c, width, height, { center: c.target, radius: Math.max(c.distance, 1e-6) });
}

/** 세계 점 → 화면 [x, y]. 눈 뒤이거나 화면에서 margin 화소보다 멀리 벗어나면 null */
export function screenPoint(f: ViewFrame, p: readonly number[], margin = Infinity): [number, number] | null {
  const s = projectToScreen(f, p);
  if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) return null;
  if (s[0] < -margin || s[1] < -margin || s[0] > f.width + margin || s[1] > f.height + margin) return null;
  return [s[0], s[1]];
}

/**
 * 세계 선분 → 화면 선분. 원근에서 한쪽이 눈 뒤면 눈 앞 가까운 면(깊이 nearDepth)에서 자른다. 둘 다 뒤면 null.
 */
export function screenSegment(f: ViewFrame, a: readonly number[], b: readonly number[], nearDepth = 1e-6): [number, number, number, number] | null {
  if (f.projection === 'perspective') {
    const back = f.basis.back;
    const da = -((a[0]! - f.eye[0]) * back[0] + (a[1]! - f.eye[1]) * back[1] + (a[2]! - f.eye[2]) * back[2]);
    const db = -((b[0]! - f.eye[0]) * back[0] + (b[1]! - f.eye[1]) * back[1] + (b[2]! - f.eye[2]) * back[2]);
    if (da < nearDepth && db < nearDepth) return null;
    if (da < nearDepth || db < nearDepth) {
      const t = (nearDepth - da) / (db - da);
      const c = [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
      if (da < nearDepth) a = c;
      else b = c;
    }
  }
  const sa = projectToScreen(f, a);
  const sb = projectToScreen(f, b);
  if (!sa || !sb) return null;
  return [sa[0], sa[1], sb[0], sb[1]];
}

export class Overlay {
  /** 층 전체(캔버스 위, 누르기는 통과) */
  readonly el: HTMLDivElement;
  /** 선·도형(SVG) */
  readonly svg: SVGSVGElement;
  /** 글·표식(DOM) */
  readonly labels: HTMLDivElement;
  private readonly painters = new Map<string, Painter>();
  private viewer: Viewer3d | null = null;
  private offCamera: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'overlay-svg');
    this.labels = document.createElement('div');
    this.labels.className = 'overlay-labels';
    this.el.append(this.svg, this.labels);
    host.append(this.el);
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.invalidate());
      this.ro.observe(host);
    }
  }

  /** 뷰어를 잇는다(카메라가 바뀌면 다시 그린다) */
  attach(viewer: Viewer3d): void {
    this.offCamera?.();
    this.viewer = viewer;
    this.offCamera = viewer.onCameraChange(() => this.invalidate());
    this.invalidate();
  }

  /** 그리기 함수를 두거나(같은 열쇠는 바꾼다) null로 뺀다 */
  set(key: string, painter: Painter | null): void {
    if (painter) this.painters.set(key, painter);
    else this.painters.delete(key);
    this.invalidate();
  }

  /** 지금 카메라·크기의 투영 프레임(뷰어가 없거나 크기가 0이면 null) */
  frame(): ViewFrame | null {
    const v = this.viewer;
    if (!v) return null;
    const w = v.canvas.clientWidth;
    const h = v.canvas.clientHeight;
    if (!(w > 0 && h > 0)) return null;
    return frameFor(v.getCamera(), w, h);
  }

  /** 다음 그림 틀에 다시 그린다(여러 번 불러도 한 번) */
  invalidate(): void {
    if (this.raf || typeof requestAnimationFrame !== 'function') return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paintNow();
    });
  }

  /** 바로 다시 그린다 */
  paintNow(): void {
    const f = this.frame();
    if (!f) return;
    this.svg.setAttribute('viewBox', `0 0 ${f.width} ${f.height}`);
    this.svg.setAttribute('width', String(f.width));
    this.svg.setAttribute('height', String(f.height));
    for (const p of this.painters.values()) {
      try {
        p(f);
      } catch (e) {
        console.error('덧그림 오류', e);
      }
    }
  }

  dispose(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.offCamera?.();
    this.ro?.disconnect();
    this.painters.clear();
    this.el.remove();
  }
}

/** SVG 요소 만들기(덧그림용) */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
