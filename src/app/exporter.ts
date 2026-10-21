/**
 * 그림 내보내기(DOM·캔버스): 3D 캔버스(코어 toBlob)에 화면의 덧그림(문자·치수 라벨, 줄자·각도기 선·글)을 합쳐 PNG로 만든다.
 * 2배 크기는 코어가 그릴 때 읽는 기기 화소 비율을 잠깐 2로 두고 그린다(코어 화소 비율 상한 2 안 — 코어에 내보내기 배율이 생기면 그것으로).
 * 투명 배경은 배경만 검정·흰색으로 바꿔 두 번 그려 차이 매트로 푼다(exportimage.ts unmatte). 하늘·땅 기울기 바탕(코어 setBackground)은
 * 테마와 상관없이 그려지므로 두 장을 찍는 동안 끄고 되돌린다(matteShots).
 * 저장(내려받기)·공유(Web Share, 파일을 받는 브라우저만)·인쇄(인쇄 전용 쪽에 그림 한 장)를 고르는 작은 창도 여기에 있다.
 */
import type { Viewer3d } from 'opencad-viewer3d';
import type { AnnotationLabels } from './annotations';
import { h, icon } from './dom';
import { exportFileName, exportSizes, labelBoxOrigin, labelOps, unmatte, type ExportSize, type LabelOp } from './exportimage';
import type { Overlay } from './overlay';

export interface ExportOptions {
  /** 기기 화소 비율(2배는 MAX_EXPORT_RATIO) */
  ratio: number;
  transparent: boolean;
  /** 문자·치수·측정 덧그림을 넣는다 */
  overlays: boolean;
}

export interface ExportContext {
  viewer: Viewer3d;
  overlay: Overlay | null;
  labels: AnnotationLabels | null;
  /** 3D 보기 테마(투명 배경 두 장은 이 base로 배경만 바꾼다) */
  base: 'dark' | 'light';
  /** 투명 배경을 그린 뒤 테마를 되돌린다 */
  restoreTheme: () => void;
}

/** 코어가 그릴 때 읽는 window.devicePixelRatio를 잠깐 바꾼다(끝나면 되돌린다) */
async function withPixelRatio<T>(ratio: number, run: () => Promise<T>): Promise<T> {
  const own = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  if (Math.abs((window.devicePixelRatio || 1) - ratio) < 1e-6) return run();
  try {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
  } catch {
    return run();
  }
  try {
    return await run();
  } finally {
    if (own) Object.defineProperty(window, 'devicePixelRatio', own);
    else delete (window as unknown as Record<string, unknown>).devicePixelRatio;
  }
}

async function blobPixels(b: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * 투명 배경 두 장: 바탕만 검정·흰색으로 바꿔 찍는다. 하늘·땅 기울기 바탕(파일 스타일의 하늘·지면)은 테마 바탕 위에 그려져
 * 두 장에서 같으므로(불투명으로 남는다) 찍는 동안 끄고, 끝나면 바탕과 테마를 되돌린다
 */
export async function matteShots<T>(ctx: Pick<ExportContext, 'viewer' | 'base' | 'restoreTheme'>, shoot: () => Promise<T>): Promise<[T, T]> {
  const v = ctx.viewer;
  const sky = v.background;
  try {
    if (sky) v.setBackground(null);
    v.setTheme({ base: ctx.base, background: '#000000' });
    const black = await shoot();
    v.setTheme({ base: ctx.base, background: '#ffffff' });
    const white = await shoot();
    return [black, white];
  } finally {
    if (sky) v.setBackground(sky);
    ctx.restoreTheme();
  }
}

/** 3D 캔버스 그림(불투명 또는 투명 배경) */
async function viewerCanvas(ctx: ExportContext, o: ExportOptions): Promise<HTMLCanvasElement> {
  const v = ctx.viewer;
  const shot = (): Promise<Blob> => withPixelRatio(o.ratio, () => v.toBlob('image/png'));
  const c = document.createElement('canvas');
  if (!o.transparent) {
    const bmp = await createImageBitmap(await shot());
    v.renderNow();
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return c;
  }
  const [black, white] = await matteShots(ctx, async () => blobPixels(await shot()));
  // 화면 캔버스를 지금 크기·테마로 다시 그린다(내보내려고 키운 화소 비율이 남지 않게)
  v.renderNow();
  c.width = black.width;
  c.height = black.height;
  const g = c.getContext('2d')!;
  const out = g.createImageData(c.width, c.height);
  unmatte(black.data, white.data, out.data);
  g.putImageData(out, 0, 0);
  return c;
}

/** 라벨 그리기(CSS 화소 명령을 scale배로) */
function drawLabels(g: CanvasRenderingContext2D, ops: readonly LabelOp[], scale: number): void {
  for (const op of ops) {
    g.save();
    g.scale(scale, scale);
    g.globalAlpha = op.alpha;
    g.font = op.font;
    g.textBaseline = 'top';
    const lineH = op.px * 1.2;
    const w = Math.max(...op.lines.map((l) => g.measureText(l).width)) + 4;
    const hh = lineH * op.lines.length + 2;
    g.translate(op.x, op.y);
    if (op.angle) g.rotate((op.angle * Math.PI) / 180);
    const [ox, oy] = labelBoxOrigin(op.angle ? 'center' : op.align, w, hh);
    g.lineJoin = 'round';
    g.lineWidth = 3;
    g.strokeStyle = op.halo;
    g.fillStyle = op.color;
    op.lines.forEach((l, i) => {
      const y = oy + 1 + i * lineH + (lineH - op.px) / 2;
      g.strokeText(l, ox + 2, y);
      g.fillText(l, ox + 2, y);
    });
    g.restore();
  }
}

/** SVG 덧그림(줄자·각도기 선·점)을 currentColor를 풀어 그림으로 */
async function drawOverlaySvg(g: CanvasRenderingContext2D, svg: SVGSVGElement, w: number, h: number, scale: number): Promise<void> {
  if (!svg.childElementCount) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const d = dst[i];
    if (!d) return;
    const color = getComputedStyle(el).color;
    for (const a of ['stroke', 'fill']) if (d.getAttribute(a) === 'currentColor') d.setAttribute(a, color);
    if (getComputedStyle(el).display === 'none') d.setAttribute('display', 'none');
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const text = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    g.drawImage(img, 0, 0, w * scale, h * scale);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 측정 글(DOM 상자: 바탕·테두리·글)을 화면 자리 그대로 */
function drawMeasureBoxes(g: CanvasRenderingContext2D, layer: HTMLElement, host: DOMRect, scale: number): void {
  for (const el of layer.querySelectorAll<HTMLElement>('.measure-label, .measure-tip')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.textContent) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const x = r.left - host.left;
    const y = r.top - host.top;
    g.save();
    g.scale(scale, scale);
    g.fillStyle = cs.backgroundColor;
    g.strokeStyle = cs.borderTopColor;
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect?.(x + 0.5, y + 0.5, r.width - 1, r.height - 1, parseFloat(cs.borderTopLeftRadius) || 0);
    g.fill();
    g.stroke();
    g.fillStyle = cs.color;
    g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.textBaseline = 'middle';
    g.fillText(el.textContent, x + (parseFloat(cs.paddingLeft) || 0), y + r.height / 2);
    g.restore();
  }
}

/** 내보낼 그림(PNG Blob) */
export async function renderExport(ctx: ExportContext, o: ExportOptions): Promise<Blob> {
  const c = await viewerCanvas(ctx, o);
  const canvas = ctx.viewer.canvas;
  const cssW = canvas.clientWidth || c.width;
  const cssH = canvas.clientHeight || c.height;
  const scale = c.width / Math.max(1, cssW);
  if (o.overlays) {
    const g = c.getContext('2d')!;
    if (ctx.overlay) {
      try {
        await drawOverlaySvg(g, ctx.overlay.svg, cssW, cssH, scale);
      } catch {
        /* SVG를 그림으로 못 바꾸는 브라우저: 선은 빼고 글만 */
      }
    }
    if (ctx.labels) drawLabels(g, labelOps(ctx.labels.placements, ctx.labels.itemList), scale);
    if (ctx.overlay) drawMeasureBoxes(g, ctx.overlay.labels, canvas.getBoundingClientRect(), scale);
  }
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('그림을 만들지 못했습니다'))), 'image/png'));
}

/** 파일 공유(Web Share Level 2)를 쓸 수 있는지 */
export function canShareFiles(): boolean {
  try {
    const f = new File([new Uint8Array(1)], 'x.png', { type: 'image/png' });
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

/** 내려받기(a[download]) */
export function downloadBlob(b: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** 인쇄: 인쇄 전용 쪽(그림 한 장과 이름·날짜)을 붙이고 인쇄 창을 연 뒤 지운다 */
export function printImage(b: Blob, title: string): void {
  const url = URL.createObjectURL(b);
  const sheet = h(
    'div',
    { class: 'print-sheet', 'aria-hidden': 'true' },
    h('img', { src: url, alt: title }),
    h('p', { class: 'print-cap', 'data-i18n-skip': '' }, `${title} · ${new Date().toLocaleDateString()}`),
  );
  document.body.append(sheet);
  const done = (): void => {
    window.removeEventListener('afterprint', done);
    sheet.remove();
    URL.revokeObjectURL(url);
  };
  window.addEventListener('afterprint', done);
  const img = sheet.querySelector('img')!;
  const go = (): void => {
    window.print();
    // afterprint가 오지 않는 브라우저(일부 휴대폰)
    setTimeout(done, 60_000);
  };
  if (img.complete) go();
  else img.addEventListener('load', go, { once: true });
}

export interface ExportDialogHost {
  /** 문서 이름(파일 이름에 쓴다) */
  docName(): string;
  context(): ExportContext | null;
  notify(error: unknown): void;
  /** 저장·공유·인쇄 통계(analytics) */
  track(kind: 'png' | 'share' | 'print'): void;
}

/** 그림 저장 창(크기·투명 배경·덧그림, 저장·공유·인쇄) */
export class ExportDialog {
  private el: HTMLElement | null = null;
  private opts = { double: false, transparent: false, overlays: true };

  constructor(
    private readonly host: ExportDialogHost,
    private readonly parent: HTMLElement,
  ) {}

  get isOpen(): boolean {
    return !!this.el;
  }

  close(): void {
    this.el?.remove();
    this.el = null;
  }

  open(): void {
    this.close();
    const ctx = this.host.context();
    if (!ctx) return;
    const cv = ctx.viewer.canvas;
    const sizes = exportSizes(cv.clientWidth, cv.clientHeight, window.devicePixelRatio || 1);
    if (sizes.length < 2) this.opts.double = false;
    const radio = (on: boolean, s: ExportSize, label: string, set: () => void): HTMLElement => {
      const input = h('input', { type: 'radio', name: 'export-size' });
      input.checked = on;
      input.addEventListener('change', set);
      return h('label', { class: 'ex-opt' }, input, h('span', {}, label), h('small', { 'data-i18n-skip': '' }, `${s.width} × ${s.height}`));
    };
    const check = (on: boolean, label: string, set: (v: boolean) => void): HTMLElement => {
      const input = h('input', { type: 'checkbox' });
      input.checked = on;
      input.addEventListener('change', () => set(input.checked));
      return h('label', { class: 'ex-opt' }, input, h('span', {}, label));
    };
    const status = h('p', { class: 'ex-status', 'aria-live': 'polite' });
    const run = async (kind: 'png' | 'share' | 'print', btn: HTMLButtonElement): Promise<void> => {
      const c = this.host.context();
      if (!c) return;
      const size = this.opts.double ? sizes[1]! : sizes[0]!;
      btn.disabled = true;
      status.textContent = '그림 만드는 중…';
      try {
        const blob = await renderExport(c, { ratio: size.ratio, transparent: this.opts.transparent, overlays: this.opts.overlays });
        const name = exportFileName(this.host.docName(), this.opts.double, this.opts.transparent);
        if (kind === 'png') downloadBlob(blob, name);
        else if (kind === 'share') {
          const file = new File([blob], name, { type: 'image/png' });
          try {
            await navigator.share({ files: [file], title: name });
          } catch (e) {
            // 사용자가 공유 창을 닫음
            if ((e as { name?: string })?.name !== 'AbortError') throw e;
          }
        } else printImage(blob, this.host.docName());
        this.host.track(kind);
        status.textContent = '';
        if (kind !== 'share') this.close();
      } catch (e) {
        status.textContent = '';
        this.host.notify(e);
      } finally {
        btn.disabled = false;
      }
    };
    const btn = (label: string, ico: string, kind: 'png' | 'share' | 'print', primary = false): HTMLButtonElement => {
      const b = h('button', { class: `btn${primary ? ' primary' : ''}`, type: 'button', html: `${icon(ico, 16)}<span>${label}</span>` });
      b.addEventListener('click', () => void run(kind, b));
      return b;
    };
    const closeBtn = h('button', { class: 'icon-btn', type: 'button', title: '닫기', 'aria-label': '닫기', html: icon('close') });
    closeBtn.addEventListener('click', () => this.close());
    const el = h(
      'div',
      { class: 'export-dialog', role: 'dialog', 'aria-label': '그림 저장', 'aria-modal': 'false' },
      h('div', { class: 'ex-head' }, h('b', {}, '그림 저장'), closeBtn),
      h(
        'fieldset',
        { class: 'ex-group' },
        h('legend', {}, '크기'),
        radio(!this.opts.double, sizes[0]!, '화면 크기', () => (this.opts.double = false)),
        sizes[1] ? radio(this.opts.double, sizes[1], '2배 크기', () => (this.opts.double = true)) : null,
      ),
      check(this.opts.transparent, '배경 투명(PNG)', (v) => (this.opts.transparent = v)),
      check(this.opts.overlays, '글·치수·측정 넣기', (v) => (this.opts.overlays = v)),
      h('div', { class: 'ex-acts' }, btn('PNG 저장', 'image', 'png', true), canShareFiles() ? btn('공유', 'share', 'share') : null, btn('인쇄', 'print', 'print')),
      status,
    );
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    this.parent.append(el);
    this.el = el;
    el.querySelector<HTMLElement>('button.primary')?.focus();
  }
}
