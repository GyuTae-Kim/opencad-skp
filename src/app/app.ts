/**
 * OpenCAD SketchUp 뷰어 앱: 제목 막대 → 보기 도구 막대 → 3D 보기 + 오른쪽 패널(좁으면 아래 시트) → 상태 막대.
 *
 * - 파일은 하나만 연다(새로 열면 바꾼다). 해석은 웹 워커(src/worker/parse.worker.ts)에서 하고 진행률을 덮개로 보인다.
 *   새 파일이 실패하면 열려 있던 문서는 그대로 둔다.
 * - 키: 캔버스에 초점이 있으면 뷰어가 F·1~7을 직접 받고, 초점이 단추 등 다른 곳이어도(입력 칸 제외) 창 캡처 단계에서
 *   같은 키를 뷰어로 보낸다. F7 = 격자, Esc = 측정·고르기 지우기.
 * - 자동 확인용으로 window.opencadApp에 상태를 둔다.
 */
import { VIEW_LABELS, Viewer3d, type MeasureResult, type Pick3d, type Projection, type RenderMode, type ViewName } from 'opencad-viewer3d';
import { ParseClient } from './client';
import { h, icon } from './dom';
import {
  createDoc,
  docLabel,
  releaseName,
  selectionForPick,
  selectionIds,
  selectionText,
  unitLabel,
  unitSummary,
  unsupportedVersion,
  type Selection,
  type SkpDoc,
} from './doc';
import { MAX_FILE_BYTES, SKP_ACCEPT, baseName, fmtCount, fmtNum, formatBytes, formatMs, stripExtension } from './format';
import { VIEW_KEY_OF, VIEW_MENU, isEditableTarget, keyAction } from './keys';
import type { LaunchRequest } from './launch';
import { Panel, type PanelHost } from './panel';
import { errorText, sceneHasGeometry } from './protocol';
import { readStoredTheme, resolveTheme, storeTheme, systemPrefersDark, type ThemeName } from './theme';

export const APP_TITLE = 'OpenCAD SketchUp 뷰어';
const TOOLS_URL = 'https://gyutae-kim.github.io/opencad';
const REPO_URL = 'https://github.com/GyuTae-Kim/opencad-skp';
/** 이보다 좁으면 패널이 아래 시트가 된다(styles.css와 같은 값) */
export const NARROW_WIDTH = 760;
/** 뷰 큐브 한 변(CSS 화소): 넓은 화면 · 좁은 화면 */
export const VIEW_CUBE_WIDE = 112;
export const VIEW_CUBE_NARROW = 76;

const RENDER_MODES: [RenderMode, string, string][] = [
  ['shaded', '음영', 'shaded'],
  ['shadedEdges', '음영+모서리', 'shadedEdges'],
  ['wireframe', '와이어프레임', 'wireframe'],
  ['xray', 'X-ray', 'xray'],
];

type NoticeKind = 'error' | 'warn' | 'info';

/** window.opencadApp.state() 꼴 */
export interface AppSnapshot {
  ready: boolean;
  busy: boolean;
  /** 문서를 열고 장면을 뷰어에 올렸는지 */
  parsed: boolean;
  docName: string | null;
  version: string | null;
  units: string | null;
  faces: number | null;
  edges: number | null;
  triangles: number | null;
  warnings: number;
  tags: number;
  materials: number;
  outline: number;
  notice: { kind: NoticeKind; title: string; text: string } | null;
  theme: ThemeName;
  panelOpen: boolean;
  renderMode: RenderMode;
  projection: Projection;
  selection: string;
}

interface Els {
  docName: HTMLElement;
  themeBtn: HTMLButtonElement;
  toolbar: HTMLElement;
  viewBtn: HTMLButtonElement;
  projBtns: Map<Projection, HTMLButtonElement>;
  modeBtns: Map<RenderMode, HTMLButtonElement>;
  gridBtn: HTMLButtonElement;
  cubeBtn: HTMLButtonElement;
  axesBtn: HTMLButtonElement;
  measureBtn: HTMLButtonElement;
  panelBtn: HTMLButtonElement;
  workspace: HTMLElement;
  viewHost: HTMLElement;
  start: HTMLElement;
  notice: HTMLElement;
  busy: HTMLElement;
  busyTitle: HTMLElement;
  busyBar: HTMLElement;
  busyStage: HTMLElement;
  stMain: HTMLElement;
  stWarn: HTMLButtonElement;
  stSel: HTMLElement;
  dropCover: HTMLElement;
  fileInput: HTMLInputElement;
}

export class SkpViewerApp implements PanelHost {
  private readonly root: HTMLElement;
  private els!: Els;
  private viewer: Viewer3d | null = null;
  private doc: SkpDoc | null = null;
  private readonly client = new ParseClient();
  private readonly panel: Panel;
  private panelOpen: boolean;
  private readonly narrowQuery: MediaQueryList | null =
    typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${NARROW_WIDTH - 0.02}px)`) : null;
  private projection: Projection = 'perspective';
  private renderMode: RenderMode = 'shadedEdges';
  private theme: ThemeName;
  private themeChosen: boolean;
  private openSeq = 0;
  private busy = false;
  private ready = false;
  private notice: AppSnapshot['notice'] = null;
  private menu: HTMLElement | null = null;
  private dragDepth = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const stored = readStoredTheme();
    this.themeChosen = stored !== null;
    this.theme = resolveTheme(stored, systemPrefersDark());
    this.panelOpen = !this.narrowQuery?.matches;
    this.panel = new Panel(this);
  }

  // ───────────────────────── 틀 ─────────────────────────

  mount(): void {
    this.root.innerHTML = '';
    this.root.className = 'app';
    this.applyTheme();

    const tbtn = (label: string, ico: string, title: string, run: () => void, cls = ''): HTMLButtonElement => {
      const b = h('button', { class: `tbtn ${cls}`.trim(), type: 'button', title, 'aria-label': title, html: `${icon(ico)}<span class="lbl">${label}</span>` });
      b.addEventListener('click', run);
      return b;
    };
    const link = (label: string, ico: string, href: string, title: string, cls = ''): HTMLAnchorElement =>
      h('a', { class: `tbtn ${cls}`.trim(), href, target: '_blank', rel: 'noopener noreferrer', title, 'aria-label': title, html: `${icon(ico)}<span class="lbl">${label}</span>` });

    // 제목 막대
    const docName = h('span', { class: 'docname' });
    const themeBtn = tbtn('테마', 'moon', '', () => this.toggleTheme(), 'icon-only');
    const title = h(
      'header',
      { class: 'titlebar' },
      h('a', { class: 'brand', href: './', title: `${APP_TITLE} 처음 화면` }, h('span', { class: 'logo', html: icon('logo', 22) }), h('span', { class: 'brand-text' }, h('b', {}, 'OpenCAD'), ' SketchUp 뷰어')),
      docName,
      h('span', { class: 'spacer' }),
      tbtn('열기', 'open', 'SketchUp 파일 열기 (.skp)', () => this.chooseFile(), 'primary'),
      tbtn('예제 열기', 'sample', '예제 모형 열기(브라우저에서 만든 집 모형)', () => void this.openSample()),
      themeBtn,
      link('OpenCAD 도구', 'tools', TOOLS_URL, 'OpenCAD 도구 목록(새 창)'),
      link('GitHub', 'github', REPO_URL, 'GitHub 소스 코드(새 창)'),
    );

    // 보기 도구 막대
    const sep = (): HTMLElement => h('span', { class: 'tsep', 'aria-hidden': 'true' });
    const fitBtn = tbtn('전체 보기', 'fit', '전체 보기 (F)', () => this.viewer?.fit());
    const viewBtn = h('button', {
      class: 'tbtn',
      type: 'button',
      title: '표준 뷰 (1 앞 · 2 뒤 · 3 왼쪽 · 4 오른쪽 · 5 위 · 6 아래 · 7 등각)',
      'aria-label': '표준 뷰 메뉴',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      html: `${icon('views')}<span class="lbl">표준 뷰</span>${icon('chevron', 14)}`,
    });
    viewBtn.addEventListener('click', () => this.toggleViewMenu(viewBtn));
    const projBtns = new Map<Projection, HTMLButtonElement>([
      ['perspective', tbtn('원근', 'persp', '원근 투영', () => this.setProjection('perspective'))],
      ['orthographic', tbtn('평행', 'ortho', '평행 투영', () => this.setProjection('orthographic'))],
    ]);
    const modeBtns = new Map<RenderMode, HTMLButtonElement>(RENDER_MODES.map(([m, label, ico]) => [m, tbtn(label, ico, `그리기: ${label}`, () => this.setRenderMode(m))]));
    const gridBtn = tbtn('격자', 'grid', '바닥 격자 (F7)', () => this.toggleGrid());
    const cubeBtn = tbtn('뷰 큐브', 'cube', '뷰 큐브 보이기', () => this.toggleCube());
    const axesBtn = tbtn('좌표축', 'axes', '좌표축 보이기', () => this.toggleAxes());
    const measureBtn = tbtn('측정', 'measure', '두 점 측정(거리·dx·dy·dz, Esc로 지우기)', () => this.toggleMeasure());
    const pngBtn = tbtn('PNG 저장', 'image', '지금 화면을 PNG 그림으로 저장', () => void this.savePng());
    const panelBtn = tbtn('패널', 'panel', '패널 열기·닫기', () => this.setPanelOpen(!this.panelOpen));
    const toolbar = h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': '보기 도구' },
      h('div', { class: 'tgroup' }, fitBtn, viewBtn),
      sep(),
      h('div', { class: 'tgroup seg', role: 'group', 'aria-label': '투영' }, ...projBtns.values()),
      sep(),
      h('div', { class: 'tgroup seg', role: 'group', 'aria-label': '그리기 방식' }, ...modeBtns.values()),
      sep(),
      h('div', { class: 'tgroup' }, gridBtn, cubeBtn, axesBtn),
      sep(),
      h('div', { class: 'tgroup' }, measureBtn, pngBtn),
      h('span', { class: 'spacer' }),
      h('div', { class: 'tgroup' }, panelBtn),
    );

    // 가운데
    const viewHost = h('div', { class: 'view-host' });
    const notice = h('div', { class: 'notice', role: 'alert', hidden: true });
    const busyTitle = h('div', { class: 'busy-title' });
    const busyBar = h('i');
    const busyStage = h('div', { class: 'busy-stage' });
    const cancelBtn = h('button', { class: 'mini-btn', type: 'button' }, '취소');
    cancelBtn.addEventListener('click', () => this.cancelOpen());
    const busy = h(
      'div',
      { class: 'busy', hidden: true, 'aria-live': 'polite' },
      h(
        'div',
        { class: 'busy-card' },
        busyTitle,
        h('div', { class: 'bar', role: 'progressbar', 'aria-label': '해석 진행률', 'aria-valuemin': '0', 'aria-valuemax': '100' }, busyBar),
        h('div', { class: 'busy-row' }, busyStage, cancelBtn),
      ),
    );
    const start = this.buildStart();
    const stage = h('div', { class: 'stage' }, viewHost, start, notice, busy);
    const workspace = h('main', { class: 'workspace' }, stage, this.panel.el);

    // 상태 막대
    const stMain = h('span', { class: 'st-main' });
    const stWarn = h('button', { class: 'st-warn', type: 'button', hidden: true, title: '해석기 경고 보기(정보 탭)' });
    stWarn.addEventListener('click', () => this.showInfoTab());
    const stSel = h('span', { class: 'st-sel' });
    const status = h('footer', { class: 'statusbar' }, stMain, stWarn, stSel);

    const dropCover = h('div', { class: 'dropcover', hidden: true }, h('div', { class: 'dropcover-card', html: `${icon('drop', 40)}<b>놓으면 엽니다</b><span>SketchUp(.skp) 파일</span>` }));
    const fileInput = h('input', { type: 'file', accept: SKP_ACCEPT, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) void this.openFile(f);
    });

    this.root.append(title, toolbar, workspace, status, dropCover, fileInput);
    this.els = {
      docName,
      themeBtn,
      toolbar,
      viewBtn,
      projBtns,
      modeBtns,
      gridBtn,
      cubeBtn,
      axesBtn,
      measureBtn,
      panelBtn,
      workspace,
      viewHost,
      start,
      notice,
      busy,
      busyTitle,
      busyBar,
      busyStage,
      stMain,
      stWarn,
      stSel,
      dropCover,
      fileInput,
    };

    this.bindWindow();
    this.applyTheme();
    this.refreshChrome();
    this.ready = true;
  }

  private buildStart(): HTMLElement {
    const openBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('open')}<span>파일 열기</span>` });
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.chooseFile();
    });
    const sampleBtn = h('button', { class: 'btn', type: 'button', html: `${icon('sample')}<span>예제 열기</span>` });
    sampleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.openSample();
    });
    const zone = h(
      'div',
      { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': 'SketchUp 파일을 끌어다 놓거나 눌러서 열기' },
      h('div', { class: 'dz-icon', html: icon('drop', 34) }),
      h('p', { class: 'dz-main' }, '.skp 파일을 여기에 끌어다 놓으세요'),
      h('p', { class: 'dz-sub' }, '창 어디에 놓아도 열립니다'),
      h('div', { class: 'dz-actions' }, openBtn, sampleBtn),
    );
    zone.addEventListener('click', () => this.chooseFile());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.chooseFile();
      }
    });
    return h(
      'div',
      { class: 'start' },
      h(
        'div',
        { class: 'start-card' },
        h('h1', {}, 'SketchUp 파일을 브라우저에서 3D로 보기'),
        h('p', { class: 'lead' }, '설치 없이 SketchUp(.skp) 모형을 열어 돌려 보고, 태그를 켜고 끄고, 재질과 그룹·컴포넌트를 살펴보세요.'),
        zone,
        h(
          'ul',
          { class: 'facts' },
          h('li', {}, h('b', {}, '지원 형식 '), 'SketchUp 2021~2026에서 저장한 파일 (확장자 .skp)'),
          h('li', { class: 'muted' }, h('b', {}, '아직 못 읽음 '), 'SketchUp 2020 이하에서 저장한 파일(형식이 달라 판만 알려 드립니다)'),
          h('li', {}, h('span', { class: 'lock', html: icon('lock', 15) }), h('b', {}, '파일은 이 브라우저 밖으로 나가지 않습니다. '), '서버로 올리지 않고 이 컴퓨터에서 읽습니다.'),
        ),
        h('p', { class: 'keys' }, '왼쪽 끌기 돌리기 · 오른쪽 끌기 옮기기 · 휠 확대 · F 전체 보기 · 1~7 표준 뷰 · F7 격자'),
        h(
          'p',
          { class: 'foot' },
          'OpenCAD 오픈소스 프로젝트(MIT) · ',
          h('a', { href: TOOLS_URL, target: '_blank', rel: 'noopener noreferrer' }, 'OpenCAD 도구 목록'),
          ' · ',
          h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'GitHub'),
          h('br'),
          'SketchUp은 Trimble Inc.의 상표이며, 이 프로젝트는 Trimble과 관계가 없습니다.',
        ),
      ),
    );
  }

  private bindWindow(): void {
    window.addEventListener('keydown', (ev) => this.onKey(ev), true);
    // 끌어다 놓기: 창 어디에나
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.dragDepth++;
      this.els.dropCover.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) this.els.dropCover.hidden = true;
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      this.dragDepth = 0;
      this.els.dropCover.hidden = true;
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.openFile(f);
    });
    // 시스템 테마(직접 고르지 않았을 때만 따른다)
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (this.themeChosen) return;
        this.theme = e.matches ? 'dark' : 'light';
        this.applyTheme();
      });
    } catch {
      /* 오래된 브라우저 */
    }
    window.addEventListener('resize', () => this.closeMenu());
    // 좁은 화면에서는 뷰 큐브를 줄인다
    this.narrowQuery?.addEventListener('change', () => this.viewer?.setViewCubeSize(this.viewCubeSize()));
  }

  // ───────────────────────── 열기 ─────────────────────────

  chooseFile(): void {
    this.els.fileInput.click();
  }

  async openFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_BYTES) {
      this.showNotice('error', `"${file.name}" 파일이 너무 큽니다`, `${formatBytes(file.size)} — 이 뷰어는 ${formatBytes(MAX_FILE_BYTES)}까지 엽니다.`);
      return;
    }
    const seq = ++this.openSeq;
    this.setBusy(file.name, 0.005, '파일 읽는 중');
    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      if (seq === this.openSeq) {
        this.setBusy(null);
        this.showNotice('error', `"${file.name}" 파일을 읽지 못했습니다`, errorText(e));
      }
      return;
    }
    if (seq !== this.openSeq) return;
    await this.openBuffer(baseName(file.name), buf, seq);
  }

  /** 같은 출처 주소의 파일 열기(?open=) */
  async openUrl(url: string, name = baseName(new URL(url, location.href).pathname) || 'model.skp'): Promise<void> {
    const seq = ++this.openSeq;
    this.setBusy(name, 0.005, '파일 받는 중');
    let buf: ArrayBuffer;
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await res.arrayBuffer();
    } catch (e) {
      if (seq === this.openSeq) {
        this.setBusy(null);
        this.showNotice('error', `"${name}" 파일을 받지 못했습니다`, errorText(e));
      }
      return;
    }
    if (seq !== this.openSeq) return;
    await this.openBuffer(name, buf, seq);
  }

  async openSample(): Promise<void> {
    const seq = ++this.openSeq;
    this.setBusy('예제 모형', 0.005, '예제 모형 만드는 중');
    let bytes: Uint8Array;
    let name: string;
    try {
      // 예제 만들기 도구는 누를 때만 받는다(첫 화면 묶음을 작게)
      const sample = await import('./sample');
      name = sample.SAMPLE_NAME;
      bytes = await sample.createSampleSkp();
    } catch (e) {
      if (seq === this.openSeq) {
        this.setBusy(null);
        this.showNotice('error', '예제를 만들지 못했습니다', errorText(e));
      }
      return;
    }
    if (seq !== this.openSeq) return;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await this.openBuffer(name, buf, seq);
  }

  /** 여는 중인 파일을 그만 연다(해석 중이면 워커를 끝낸다). 열려 있던 문서는 그대로 둔다 */
  cancelOpen(): void {
    this.openSeq++;
    this.client.cancel();
    this.parsingSeq = 0;
    this.setBusy(null);
  }

  private parsingSeq = 0;

  /** 바이트 해석(buf는 워커로 이전된다). seq가 더 새 요청에 밀리면 결과를 버린다 */
  private async openBuffer(name: string, buf: ArrayBuffer, seq: number): Promise<void> {
    const size = buf.byteLength;
    this.setBusy(name, 0.01, '해석 준비 중');
    // 앞 파일을 아직 해석 중이면 멈추고(동기 해석이라 기다리면 늦어진다) 새 파일을 읽는다
    if (this.parsingSeq) this.client.cancel();
    this.parsingSeq = seq;
    try {
      const res = await this.client.open(name, buf, (f, stage) => {
        if (seq === this.openSeq) this.setBusy(name, f, stage);
      });
      if (seq !== this.openSeq) return;
      const old = unsupportedVersion(res.scene);
      if (old) {
        this.showNotice(
          'warn',
          `아직 읽지 못하는 판입니다: ${releaseName(old)} (${old})`,
          `"${name}" 파일은 SketchUp 2020 이하의 옛 형식으로 저장되어 있습니다. 이 뷰어는 SketchUp 2021~2026 파일만 읽습니다. SketchUp 2021 이상에서 다시 저장한 뒤 열어 주세요.`,
        );
        return;
      }
      if (!sceneHasGeometry(res.scene)) {
        const why = res.scene.warnings?.[0] ?? '그릴 면이나 모서리를 찾지 못했습니다.';
        this.showNotice('error', `"${name}" 파일을 열지 못했습니다`, why);
        return;
      }
      this.setDoc(createDoc(name, size, res));
    } catch (e) {
      if (seq !== this.openSeq) return;
      this.showNotice('error', `"${name}" 파일을 열지 못했습니다`, errorText(e));
    } finally {
      if (this.parsingSeq === seq) this.parsingSeq = 0;
      if (seq === this.openSeq) this.setBusy(null);
    }
  }

  private setDoc(d: SkpDoc): void {
    const v = this.ensureViewer();
    if (!v) return;
    this.closeNotice();
    this.doc = d;
    v.setScene(d.scene);
    v.setRenderMode(this.renderMode);
    v.highlight(null);
    if (v.measureMode) v.clearMeasure();
    this.panel.show(d);
    document.title = `${d.name} - ${APP_TITLE}`;
    this.refreshChrome();
  }

  private ensureViewer(): Viewer3d | null {
    if (this.viewer) return this.viewer;
    try {
      const v = new Viewer3d(this.els.viewHost, {
        theme: this.theme,
        projection: this.projection,
        renderMode: this.renderMode,
        viewCubeSize: this.viewCubeSize(),
      });
      v.onPick((p) => this.onPick(p));
      v.onMeasure((m) => this.onMeasure(m));
      this.viewer = v;
      return v;
    } catch (e) {
      this.showNotice('error', '3D 보기를 열 수 없습니다', errorText(e));
      return null;
    }
  }

  private viewCubeSize(): number {
    return this.narrowQuery?.matches ? VIEW_CUBE_NARROW : VIEW_CUBE_WIDE;
  }

  // ───────────────────────── 고르기·측정 ─────────────────────────

  private onPick(p: Pick3d | null): void {
    const d = this.doc;
    if (!d) return;
    d.pick = p;
    this.applySelection(selectionForPick(d, p), true);
  }

  private onMeasure(m: MeasureResult | null): void {
    const d = this.doc;
    if (!d) return;
    d.measure = m;
    this.panel.refreshSelection();
    this.refreshStatus();
  }

  /** 목록에서 고르기(PanelHost) */
  select(sel: Selection | null): void {
    const d = this.doc;
    if (!d) return;
    d.pick = null;
    this.applySelection(sel, false);
  }

  private applySelection(sel: Selection | null, reveal: boolean): void {
    const d = this.doc;
    if (!d) return;
    d.selection = sel;
    if (!sel) d.pick = null;
    const ids = selectionIds(d, sel);
    this.viewer?.highlight(ids.length ? ids : null);
    this.panel.refreshSelection(reveal);
    this.refreshStatus();
  }

  zoomToSelection(): void {
    const d = this.doc;
    const v = this.viewer;
    if (!d || !v) return;
    const ids = selectionIds(d, d.selection);
    // 보이는 것만 맞춰 본다(모두 숨겼으면 뷰어가 전체 보기로)
    if (ids.length) v.fitItems(ids);
  }

  get measuring(): boolean {
    return !!this.viewer?.measureMode;
  }

  // ───────────────────────── 보이기(PanelHost) ─────────────────────────

  setTagVisible(name: string, on: boolean): void {
    const d = this.doc;
    if (!d) return;
    if (on) d.hiddenTags.delete(name);
    else d.hiddenTags.add(name);
    this.viewer?.setGroupVisible(name, on);
    this.panel.refreshVisibility();
  }

  setAllTagsVisible(on: boolean): void {
    const d = this.doc;
    if (!d) return;
    for (const t of d.tags) {
      if (!t.hasGeometry) continue;
      if (on) d.hiddenTags.delete(t.name);
      else d.hiddenTags.add(t.name);
      this.viewer?.setGroupVisible(t.name, on);
    }
    this.panel.refreshVisibility();
  }

  setOutlineVisible(index: number, on: boolean): void {
    const d = this.doc;
    const r = d?.outline[index];
    if (!d || !r) return;
    if (on) d.hiddenOutline.delete(index);
    else d.hiddenOutline.add(index);
    for (const id of r.ids) this.viewer?.setItemVisible(id, on);
    this.panel.refreshVisibility();
  }

  closePanel(): void {
    this.setPanelOpen(false);
  }

  private showInfoTab(): void {
    const d = this.doc;
    if (!d) return;
    d.panelTab = 'info';
    this.panel.show(d);
    this.setPanelOpen(true);
  }

  // ───────────────────────── 보기 명령 ─────────────────────────

  setProjection(p: Projection): void {
    this.projection = p;
    this.viewer?.setProjection(p);
    this.refreshToolbar();
  }

  setRenderMode(m: RenderMode): void {
    this.renderMode = m;
    this.viewer?.setRenderMode(m);
    this.refreshToolbar();
  }

  // 격자·뷰 큐브·좌표축 상태는 뷰어가 들고 있다(뷰어를 만들기 전에는 뷰어 기본값 켜짐)
  private get gridOn(): boolean {
    return this.viewer?.gridVisible ?? true;
  }

  private get cubeOn(): boolean {
    return this.viewer?.viewCubeVisible ?? true;
  }

  private get axesOn(): boolean {
    return this.viewer?.axesVisible ?? true;
  }

  toggleGrid(on = !this.gridOn): void {
    this.viewer?.setGridVisible(on);
    this.refreshToolbar();
  }

  toggleCube(on = !this.cubeOn): void {
    this.viewer?.setViewCubeVisible(on);
    this.refreshToolbar();
  }

  toggleAxes(on = !this.axesOn): void {
    this.viewer?.setAxesVisible(on);
    this.refreshToolbar();
  }

  toggleMeasure(on = !this.measuring): void {
    const v = this.viewer;
    if (!v || !this.doc) return;
    v.setMeasureMode(on);
    if (!on) this.doc.measure = null;
    this.panel.refreshSelection();
    this.refreshToolbar();
    this.refreshStatus();
  }

  setPanelOpen(on: boolean): void {
    if (this.panelOpen === on) return;
    this.panelOpen = on;
    this.refreshChrome();
    // 좁은 화면에서는 아래 시트가 3D 보기 높이를 크게 바꾸므로, 크기가 정해진 뒤 다시 맞춘다
    if (this.viewer && this.doc && window.innerWidth < NARROW_WIDTH) requestAnimationFrame(() => requestAnimationFrame(() => this.viewer?.fit(false)));
  }

  async savePng(): Promise<void> {
    const v = this.viewer;
    const d = this.doc;
    if (!v || !d) return;
    try {
      const b = await v.toBlob('image/png');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${stripExtension(d.name)}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      this.showNotice('error', '그림을 저장하지 못했습니다', errorText(e));
    }
  }

  private toggleViewMenu(btn: HTMLButtonElement): void {
    if (this.menu) {
      this.closeMenu();
      return;
    }
    if (!this.viewer || !this.doc) return;
    const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': '표준 뷰' });
    for (const v of VIEW_MENU) {
      const key = VIEW_KEY_OF[v];
      const item = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' }, h('span', {}, VIEW_LABELS[v]), key ? h('kbd', {}, key) : null);
      item.addEventListener('click', () => {
        this.closeMenu();
        this.setView(v);
      });
      menu.append(item);
    }
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    menu.style.top = `${r.bottom + 4}px`;
    this.menu = menu;
    btn.setAttribute('aria-expanded', 'true');
    (menu.firstElementChild as HTMLElement | null)?.focus();
    const away = (e: PointerEvent): void => {
      if (menu.contains(e.target as Node) || btn.contains(e.target as Node)) return;
      this.closeMenu();
    };
    setTimeout(() => window.addEventListener('pointerdown', away, true));
    this.menuOff = () => window.removeEventListener('pointerdown', away, true);
  }

  private menuOff: (() => void) | null = null;

  private closeMenu(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.menuOff?.();
    this.menuOff = null;
    this.els.viewBtn.setAttribute('aria-expanded', 'false');
  }

  setView(v: ViewName): void {
    this.viewer?.setView(v);
  }

  // ───────────────────────── 키 ─────────────────────────

  private onKey(ev: KeyboardEvent): void {
    if (this.menu && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.closeMenu();
      this.els.viewBtn.focus();
      return;
    }
    const v = this.viewer;
    const act = keyAction({
      key: ev.key,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      alt: ev.altKey,
      editable: isEditableTarget(ev.target),
      hasDoc: !!this.doc && !!v && !this.busy,
      measurePoints: v?.measurePointCount ?? 0,
    });
    if (!act || !v) return;
    if (act.kind === 'clearSelection') {
      // 단추의 Esc 기본 동작 등은 그대로 두고 고른 것만 지운다
      this.applySelection(null, false);
      return;
    }
    if (act.kind === 'grid') {
      ev.preventDefault();
      ev.stopPropagation();
      this.toggleGrid();
      return;
    }
    // F·1~7·Esc(측정 지우기)는 뷰어 규칙대로. 캡처 단계에서 처리했으면 캔버스의 같은 키 처리까지 가지 않게 막는다
    if (v.handleKey(ev)) ev.stopPropagation();
  }

  // ───────────────────────── 테마 ─────────────────────────

  toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    this.themeChosen = true;
    storeTheme(this.theme);
    this.applyTheme();
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.theme === 'dark' ? '#1b2027' : '#f4f5f7');
    this.viewer?.setTheme(this.theme);
    if (this.els) {
      const next = this.theme === 'dark' ? '밝은' : '어두운';
      const b = this.els.themeBtn;
      b.innerHTML = `${icon(this.theme === 'dark' ? 'sun' : 'moon')}<span class="lbl">테마</span>`;
      b.title = `${next} 테마로 바꾸기${this.themeChosen ? '' : ' (지금은 시스템 설정을 따름)'}`;
      b.setAttribute('aria-label', b.title);
    }
  }

  // ───────────────────────── 화면 갱신 ─────────────────────────

  private setBusy(name: string | null, fraction = 0, stage = ''): void {
    const e = this.els;
    this.busy = name !== null;
    e.busy.hidden = name === null;
    if (name !== null) {
      this.closeMenu();
      const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      e.busyTitle.textContent = `${name} 여는 중…`;
      e.busyBar.style.width = `${Math.max(2, pct)}%`;
      e.busyBar.parentElement!.setAttribute('aria-valuenow', String(pct));
      e.busyStage.textContent = `${stage} · ${pct}%`;
    }
  }

  private showNotice(kind: NoticeKind, title: string, text: string): void {
    this.notice = { kind, title, text };
    const n = this.els.notice;
    n.className = `notice ${kind}`;
    n.innerHTML = '';
    const close = h('button', { class: 'icon-btn', type: 'button', title: '알림 닫기', 'aria-label': '알림 닫기', html: icon('close') });
    close.addEventListener('click', () => this.closeNotice());
    n.append(
      h('span', { class: 'notice-icon', html: icon(kind === 'info' ? 'info' : 'warn', 22) }),
      h('div', { class: 'notice-text' }, h('b', {}, title), h('span', {}, text)),
      close,
    );
    n.hidden = false;
  }

  private closeNotice(): void {
    this.notice = null;
    this.els.notice.hidden = true;
  }

  private refreshChrome(): void {
    const e = this.els;
    const d = this.doc;
    e.start.hidden = !!d;
    e.docName.textContent = d ? d.name : '';
    e.docName.title = d ? `${d.name} (${docLabel(d.info)})` : '';
    const open = this.panelOpen && !!d;
    this.panel.el.hidden = !open;
    this.root.classList.toggle('panel-open', open);
    this.refreshToolbar();
    this.refreshStatus();
  }

  private refreshToolbar(): void {
    const e = this.els;
    if (!e) return;
    const has = !!this.doc;
    for (const b of e.toolbar.querySelectorAll('button')) b.disabled = !has;
    const press = (b: HTMLButtonElement, on: boolean): void => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    };
    for (const [p, b] of e.projBtns) press(b, this.projection === p);
    for (const [m, b] of e.modeBtns) press(b, this.renderMode === m);
    press(e.gridBtn, this.gridOn);
    press(e.cubeBtn, this.cubeOn);
    press(e.axesBtn, this.axesOn);
    press(e.measureBtn, this.measuring);
    press(e.panelBtn, this.panelOpen && has);
  }

  private refreshStatus(): void {
    const e = this.els;
    if (!e) return;
    const d = this.doc;
    if (!d) {
      e.stMain.textContent = '파일을 열면 여기에 모형 정보가 보입니다 · SketchUp 2021~2026(.skp)';
      e.stWarn.hidden = true;
      e.stSel.textContent = '';
      return;
    }
    const info = d.info;
    const parts = [
      docLabel(info),
      `단위 ${unitSummary(info, d.scene.units)}`,
      formatBytes(d.size),
      `면 ${fmtCount(info.faces)} · 모서리 ${fmtCount(info.edges)}`,
      `읽기 ${formatMs(d.ms)}`,
    ];
    e.stMain.textContent = parts.join('  |  ');
    e.stMain.title = parts.join(' · ');
    const w = d.scene.warnings?.length ?? 0;
    e.stWarn.hidden = !w;
    e.stWarn.textContent = `경고 ${w}`;
    const u = unitLabel(d.scene.units);
    let sel = '';
    if (d.measure) sel = `거리 ${fmtNum(d.measure.distance, 2)} ${u}`;
    else if (this.measuring) sel = '측정: 두 점을 누르세요';
    else {
      const t = selectionText(d, d.selection, d.pick);
      if (t) sel = `고른 것: ${t}`;
    }
    e.stSel.textContent = sel;
    e.stSel.title = sel;
  }

  // ───────────────────────── 자동 확인용 ─────────────────────────

  snapshot(): AppSnapshot {
    const d = this.doc;
    return {
      ready: this.ready,
      busy: this.busy,
      parsed: !!d && !!this.viewer && this.viewer.scene === d.scene,
      docName: d?.name ?? null,
      version: d?.info.version ?? null,
      units: d ? unitSummary(d.info, d.scene.units) : null,
      faces: d?.info.faces ?? null,
      edges: d?.info.edges ?? null,
      triangles: d?.info.triangles ?? null,
      warnings: d?.scene.warnings?.length ?? 0,
      tags: d?.tags.length ?? 0,
      materials: d?.materials.length ?? 0,
      outline: d?.outline.length ?? 0,
      notice: this.notice ? { ...this.notice } : null,
      theme: this.theme,
      panelOpen: this.panelOpen,
      renderMode: this.renderMode,
      projection: this.projection,
      selection: d ? selectionText(d, d.selection, d.pick) : '',
    };
  }

  get viewer3d(): Viewer3d | null {
    return this.viewer;
  }

  /** 처음 주소 인자 처리 */
  async launch(req: LaunchRequest): Promise<void> {
    if (req.kind === 'sample') await this.openSample();
    else if (req.kind === 'url') await this.openUrl(req.url, req.name);
    else if (req.kind === 'error') this.showNotice('error', '주소의 파일을 열 수 없습니다', req.message);
  }
}
