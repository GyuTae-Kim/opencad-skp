/**
 * 시험용 가짜 DOM(브라우저 없이 Viewer3d를 만든다): 요소·스타일·이벤트 듣기, 캔버스(webgl2 → FakeGL, 2d → fake2d),
 * getComputedStyle·ResizeObserver·matchMedia·requestAnimationFrame. 그리기는 시험이 renderNow()로 부른다(requestAnimationFrame은 쌓아 두기만).
 * 3D 뷰어 코어(opencad-viewer3d, MIT) 시험 도우미 tests/fakedom.ts를 이 앱이 고정한 코어 판(972d344)에서 그대로 옮겼다(55차 — fakegl.ts와 함께).
 */
import { FakeGL, fake2d } from './fakegl';

type Listener = (e: unknown) => void;

export class FakeElement {
  tagName: string;
  className = '';
  tabIndex = -1;
  title = '';
  textContent = '';
  width = 300;
  height = 150;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attrs = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  style: Record<string, string> & { setProperty(k: string, v: string): void; cssText: string };
  gl: FakeGL | null = null;
  rect = { left: 0, top: 0, width: 800, height: 600 };
  ownerDocument: FakeDocument;

  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    const st: Record<string, string> = { cssText: '' };
    this.style = Object.assign(st, { setProperty: (k: string, v: string) => void (st[k] = v) }) as FakeElement['style'];
  }
  append(...c: FakeElement[]): void {
    for (const x of c) {
      x.parent = this;
      this.children.push(x);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  hasAttribute(k: string): boolean {
    return this.attrs.has(k);
  }
  addEventListener(type: string, fn: Listener): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  /** 듣는 함수들에 사건 객체를 넘긴다 */
  fire(type: string, e: Record<string, unknown>): void {
    const ev = { preventDefault() {}, stopPropagation() {}, target: this, currentTarget: this, ...e };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number; x: number; y: number } {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  getContext(type: string): unknown {
    if (type === 'webgl2') return (this.gl ??= new FakeGL(this));
    if (type === '2d') return fake2d();
    return null;
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  blur(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  querySelector(sel: string): FakeElement | null {
    const cls = sel.split('.').pop()!;
    const walk = (e: FakeElement): FakeElement | null => {
      for (const c of e.children) {
        if (c.className.split(/\s+/).includes(cls)) return c;
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
}

export class FakeDocument {
  activeElement: unknown = null;
  visibilityState = 'visible';
  listeners = new Map<string, Set<Listener>>();
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  addEventListener(type: string, fn: Listener): void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
}

/** 전역에 가짜 DOM을 깐다. 돌려준 함수로 걷는다 */
export function installDom(): { doc: FakeDocument; host: () => FakeElement; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const keys = ['document', 'window', 'getComputedStyle', 'ResizeObserver', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio', 'addEventListener', 'removeEventListener'];
  const saved = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]));
  const doc = new FakeDocument();
  let raf = 0;
  const set = (k: string, v: unknown): void => void Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  set('document', doc);
  set('window', g);
  set('devicePixelRatio', 1);
  set('getComputedStyle', () => ({ position: 'relative', getPropertyValue: () => '' }));
  set(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  set('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  set('requestAnimationFrame', () => ++raf);
  set('cancelAnimationFrame', () => undefined);
  set('addEventListener', () => undefined);
  set('removeEventListener', () => undefined);
  return {
    doc,
    host: () => doc.createElement('div'),
    restore: () => {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(g, k, d);
        else delete g[k];
      }
    },
  };
}
