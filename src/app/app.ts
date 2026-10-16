/**
 * OpenCAD SketchUp 뷰어 앱: 제목 막대 → 보기 도구 막대 → 3D 보기 + 오른쪽 패널(좁으면 아래 시트) → 상태 막대.
 *
 * - 파일은 하나만 연다(새로 열면 바꾼다). 해석은 웹 워커(src/worker/parse.worker.ts)에서 하고 진행률을 덮개로 보인다.
 *   새 파일이 실패하면 열려 있던 문서는 그대로 둔다.
 * - 키: 캔버스에 초점이 있으면 뷰어가 F·1~7을 직접 받고, 초점이 단추 등 다른 곳이어도(입력 칸 제외) 창 캡처 단계에서
 *   같은 키를 뷰어로 보낸다. F7 = 격자, Ctrl/⌘+O = 열기, Esc = 취소 → 측정 점 지우기 → 측정 끄기 → 고른 것 지우기.
 * - 3D 고르기: 구성 나무에서 펼친 단계까지 들어가 고른다(Alt+누르기 = 가장 안쪽, 3D에서 두 번 누르기 = 한 단계 들어가기).
 * - 패널 가장자리를 끌어 폭(좁은 화면은 시트 높이)을 바꾼다. 좁은 화면에서 시트를 열고 닫아도 확대해 둔 보기는 지킨다.
 * - 자동 확인용으로 window.opencadApp에 상태를 둔다.
 */
import {
  VIEW_LABELS,
  Viewer3d,
  type MeasureResult,
  type Pick3d,
  type IndexRange,
  type PickEvent,
  type Projection,
  type RenderMode,
  type SectionAxis,
  type ViewName,
} from 'opencad-viewer3d';
import { lerpCamera, type CameraState } from 'opencad-viewer3d/camera';
import { ParseClient } from './client';
import { h, icon } from './dom';
import {
  canHideNode,
  createDoc,
  docLabel,
  hiddenNodeRanges,
  isBigScene,
  itemVisible,
  nodeSelection,
  pickDeepest,
  releaseName,
  selectedNode,
  selectionForPick,
  selectionIds,
  selectionRanges,
  selectionSegments,
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
import { PANEL_WIDTH_DEFAULT, SHEET_DEFAULT, clampPanelWidth, clampSheetFraction, readLayout, storeLayout, type StoredLayout } from './layout';
import { Panel, type PanelHost } from './panel';
import { errorText, sceneHasGeometry } from './protocol';
import { deviceHints, textureLimitsFor, type TextureLimits } from './texlimits';
import { THEME_CHOICES, applyThemeChoice, readStoredTheme, resolveTheme, storeTheme, systemPrefersDark, themeChoiceOf, type ThemeChoice, type ThemeName } from './theme';
import { isAncestor, isSplit, nodeBox, nodePath, type PickMode } from './tree';
import { cameraForBox, keepViewOnHeightChange } from './view';

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
  /** 테마 고르기(시스템·밝게·어둡게) */
  themeChoice: ThemeChoice;
  measuring: boolean;
  /** 나무 노드 수(없으면 0) · 펼친 노드 수 · 3D 고르기 방식 */
  treeNodes: number;
  expanded: number;
  pickMode: PickMode;
  showSoft: boolean;
  showHidden: boolean;
  /** 꾸러미 안 그림 수(모형·무늬·컴포넌트·장면) */
  images: number;
  /** 패널 폭(px) · 시트 높이 비율 */
  panelWidth: number;
  sheet: number;
  /** 단면(꺼져 있으면 null) */
  section: { axis: SectionAxis | null; t: number; flip: boolean } | null;
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
  secBtns: Map<SectionAxis | 'off', HTMLButtonElement>;
  secRange: HTMLInputElement;
  secFlip: HTMLButtonElement;
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
  resizer: HTMLElement;
}

interface MenuItem {
  label: string;
  icon?: string;
  kbd?: string;
  checked?: boolean;
  run: () => void;
}

export class SkpViewerApp implements PanelHost {
  private readonly root: HTMLElement;
  private els!: Els;
  private viewer: Viewer3d | null = null;
  private doc: SkpDoc | null = null;
  private readonly client = new ParseClient();
  /** 무늬 그림 한도(기기마다 — 뷰어와 해석 워커가 같은 값을 쓴다) */
  private readonly texLimits: TextureLimits = textureLimitsFor(deviceHints());
  private readonly panel: Panel;
  private panelOpen: boolean;
  private readonly narrowQuery: MediaQueryList | null =
    typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${NARROW_WIDTH - 0.02}px)`) : null;
  private projection: Projection = 'perspective';
  private renderMode: RenderMode = 'shadedEdges';
  private theme: ThemeName;
  /** 기억한 테마(null = 시스템 설정 따르기) */
  private themeStored: ThemeName | null;
  private layout: StoredLayout;
  /** 3D 보기를 사용자가 직접 돌리거나 옮기거나 확대했는지(전체 보기·표준 뷰를 하면 false) */
  private userMoved = false;
  /** 구간을 숨겨 둔 항목 id(다음에 바뀌면 풀려고)와 지금 숨긴 구간(항목 차례 → 구간) */
  private rangedIds = new Set<string>();
  private hiddenRanges = new Map<number, IndexRange[]>();
  /** 나눠 올리기가 끝나면 부를 것(새 문서로 바뀌면 바로 부른다) */
  private uploadDone: (() => void) | null = null;
  private camAnim = 0;
  private openSeq = 0;
  private busy = false;
  private ready = false;
  private notice: AppSnapshot['notice'] = null;
  private menu: HTMLElement | null = null;
  private dragDepth = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.themeStored = readStoredTheme();
    this.theme = resolveTheme(this.themeStored, systemPrefersDark());
    this.layout = readLayout();
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
    const themeBtn = tbtn('테마', 'moon', '', () => this.toggleThemeMenu(), 'icon-only');
    themeBtn.setAttribute('aria-haspopup', 'menu');
    themeBtn.setAttribute('aria-expanded', 'false');
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
    const pngBtn = tbtn('PNG 저장', 'image', '지금 화면을 PNG 그림으로 저장', () => void this.savePng(), 'compact');
    const panelBtn = tbtn('패널', 'panel', '패널 열기·닫기', () => this.setPanelOpen(!this.panelOpen));
    // 단면 보기: 끔·X·Y·Z, 위치 슬라이더(장면 범위 안 0~1), 뒤집기. 잘린 면은 채우지 않고 테두리만(SKP는 입체 여부를 모른다)
    const axisBtn = (axis: SectionAxis): HTMLButtonElement => {
      const b = h('button', { class: 'tbtn sec-axis', type: 'button', title: `${axis.toUpperCase()}축에 수직인 단면(+${axis.toUpperCase()} 쪽을 잘라 냄)`, 'aria-label': `${axis.toUpperCase()}축 단면` }, axis.toUpperCase());
      b.addEventListener('click', () => this.setSectionAxis(axis));
      return b;
    };
    const secBtns = new Map<SectionAxis | 'off', HTMLButtonElement>([
      ['off', tbtn('단면 끔', 'section', '단면 보기 끄기', () => this.setSectionAxis(null), 'sec-off icon-only')],
      ['x', axisBtn('x')],
      ['y', axisBtn('y')],
      ['z', axisBtn('z')],
    ]);
    const secRange = h('input', { class: 'sec-range', type: 'range', min: '0', max: '1000', step: '1', value: '500', 'aria-label': '단면 위치', title: '단면 위치(장면 범위 안)' });
    secRange.addEventListener('input', () => this.viewer?.setSectionPosition(Number(secRange.value) / 1000));
    const secFlip = tbtn('뒤집기', 'flip', '자르는 쪽 뒤집기', () => this.flipSection(), 'icon-only');
    const toolbar = h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': '보기 도구' },
      h('div', { class: 'tgroup' }, fitBtn, viewBtn),
      sep(),
      h('div', { class: 'tgroup seg', role: 'group', 'aria-label': '투영' }, ...projBtns.values()),
      sep(),
      h('div', { class: 'tgroup seg', role: 'group', 'aria-label': '그리기 방식' }, ...modeBtns.values()),
      sep(),
      h('div', { class: 'tgroup compact' }, gridBtn, cubeBtn, axesBtn),
      sep(),
      h('div', { class: 'tgroup' }, measureBtn, pngBtn),
      sep(),
      h('div', { class: 'tgroup sec-group', role: 'group', 'aria-label': '단면 보기' }, h('div', { class: 'tgroup seg' }, ...secBtns.values()), secRange, secFlip),
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
    const resizer = h('div', {
      class: 'resizer',
      role: 'separator',
      tabindex: '0',
      'aria-label': '패널 크기 바꾸기(끌기·화살표 키, 두 번 누르면 처음 크기)',
      title: '끌어서 패널 크기 바꾸기 · 두 번 누르면 처음 크기',
      hidden: true,
    });
    const workspace = h('main', { class: 'workspace' }, stage, resizer, this.panel.el);

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
      secBtns,
      secRange,
      secFlip,
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
      resizer,
    };

    this.bindWindow();
    this.bindResizer();
    this.applyLayout();
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
        if (this.themeStored) return;
        this.theme = e.matches ? 'dark' : 'light';
        this.applyTheme();
      });
    } catch {
      /* 오래된 브라우저 */
    }
    window.addEventListener('resize', () => {
      this.closeMenu();
      this.applyLayout();
    });
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
      const res = await this.client.open(
        name,
        buf,
        (f, stage) => {
          if (seq === this.openSeq) this.setBusy(name, f, stage);
        },
        { textureLimit: this.texLimits.limit },
      );
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
      // GPU에 올리기: 작은 모형은 한 번에(그 전에 단계 글을 한 번 그린다), 큰 모형은 프레임마다 나눠 올리며 실제 진행을 보인다
      this.setBusy(name, isBigScene(res) ? 0 : 0.99, '화면에 올리는 중');
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (seq !== this.openSeq) return;
      const doc = createDoc(name, size, res, { makeUrl: (b, mime) => URL.createObjectURL(new Blob([b as BlobPart], { type: mime })) });
      const uploaded = this.setDoc(doc, (done, total) => {
        if (seq === this.openSeq) this.setBusy(name, total ? done / total : 1, `화면에 올리는 중 · 묶음 ${fmtCount(done)}/${fmtCount(total)}`);
      });
      this.noticeDamage(doc);
      await uploaded;
    } catch (e) {
      if (seq !== this.openSeq) return;
      this.showNotice('error', `"${name}" 파일을 열지 못했습니다`, errorText(e));
    } finally {
      if (this.parsingSeq === seq) this.parsingSeq = 0;
      if (seq === this.openSeq) this.setBusy(null);
    }
  }

  /**
   * 문서를 뷰어에 올린다. 큰 장면(삼각형+선분 INCREMENTAL_PRIMS 이상 또는 묶음 INCREMENTAL_ITEMS 이상)은
   * 코어의 나눠 올리기(프레임마다 8 ms)로 올리고 progress(올린 묶음, 전체)를 알린다. 올리기가 끝나면 풀리는 약속을 돌려준다
   */
  private setDoc(d: SkpDoc, progress?: (done: number, total: number) => void): Promise<void> {
    const v = this.ensureViewer();
    if (!v) {
      revokeImages(d);
      return Promise.resolve();
    }
    this.closeNotice();
    const old = this.doc;
    this.doc = d;
    // 앞 문서의 나눠 올리기를 기다리던 것은 끝낸다
    this.uploadDone?.();
    this.uploadDone = null;
    this.rangedIds.clear();
    const big = isBigScene(d);
    const done = new Promise<void>((resolve) => {
      if (!big) {
        resolve();
        return;
      }
      this.uploadDone = resolve;
    });
    if (big)
      v.setScene(d.scene, {
        incremental: true,
        onProgress: (n, total) => {
          progress?.(n, total);
          if (n >= total && this.doc === d) {
            this.uploadDone?.();
            this.uploadDone = null;
          }
        },
      });
    else v.setScene(d.scene);
    v.setRenderMode(this.renderMode);
    v.highlight(null);
    v.highlightRanges(null);
    v.setHighlightSegments(null);
    if (v.measureMode) v.clearMeasure();
    // 부드러운 모서리·숨긴 형상은 처음에 숨긴다(장면 범위에는 들어 있지 않다)
    this.refreshItemVisibility();
    this.userMoved = false;
    if (old && old !== d) revokeImages(old);
    this.panel.show(d);
    document.title = `${d.name} - ${APP_TITLE}`;
    this.refreshChrome();
    return done;
  }

  /** 잘렸거나 깨진 파일·출력 한도는 알림으로 알린다(경고 목록은 정보 탭) */
  private noticeDamage(d: SkpDoc): void {
    const warns = d.scene.warnings ?? [];
    if (d.damaged) {
      const why = warns.find((w) => /잘렸|깨져|깨진/.test(w)) ?? warns[0] ?? '';
      this.showNotice('warn', `"${d.name}" 파일의 일부만 보입니다`, `파일이 잘렸거나 깨진 곳이 있어 읽을 수 있는 부분만 그렸습니다. ${why}`);
    } else if (d.limited) {
      const why = warns.find((w) => /한도/.test(w)) ?? '';
      this.showNotice('warn', '모형이 너무 커서 일부만 그렸습니다', why);
    }
  }

  private ensureViewer(): Viewer3d | null {
    if (this.viewer) return this.viewer;
    try {
      const v = new Viewer3d(this.els.viewHost, {
        theme: this.theme,
        projection: this.projection,
        renderMode: this.renderMode,
        viewCubeSize: this.viewCubeSize(),
        textureLimit: this.texLimits.limit,
        textureBudget: this.texLimits.budget,
      });
      v.onPick((p, e) => this.onPick(p, e));
      v.onMeasure((m) => this.onMeasure(m));
      // 단면 상태(앱 단추·슬라이더·새 장면으로 꺼짐 등)는 코어 알림으로 도구 막대에 맞춘다
      v.onSectionChange(() => this.refreshToolbar());
      this.watchCanvas(v);
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

  /** 3D 보기 입력 엿보기: 사용자가 보기를 직접 움직였는지(Alt·두 번 누르기는 코어의 onPick 두 번째 인자로 받는다) */
  private watchCanvas(v: Viewer3d): void {
    const cv = v.canvas;
    let down: { x: number; y: number } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointermove', (e) => {
      if (down && e.buttons && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) this.userMoved = true;
    });
    cv.addEventListener('pointerup', () => (down = null));
    cv.addEventListener('wheel', () => (this.userMoved = true), { passive: true });
    // 뷰 큐브를 누르면 표준 뷰 + 전체 보기
    v.host.querySelector('.v3d-cube')?.addEventListener('pointerdown', () => (this.userMoved = false));
  }

  /** 3D 고르기: Alt = 가장 안쪽, 두 번째 누르기(e.clicks = 2) = 고른 그룹에 한 단계 들어가기 */
  private onPick(p: Pick3d | null, e?: PickEvent): void {
    const d = this.doc;
    if (!d) return;
    // 단면에서 잘린 면(채운 면)은 형상이 아니므로 고르기에서 무시한다
    if (p?.section) return;
    if (e?.clicks === 2 && this.enterLevel(p)) return;
    d.pick = p;
    const sel = selectionForPick(d, p, !!e?.altKey);
    // 가장 안쪽을 골랐으면 목록에서 보이게 조상을 펼친다(펼친 단계 방식이면 이미 펼쳐져 있다)
    const n = selectedNode(d, sel);
    let opened = false;
    if (d.tree && n !== null && n >= 0)
      for (const a of nodePath(d.tree, n).slice(0, -1))
        if (!d.expanded.has(a)) {
          d.expanded.add(a);
          opened = true;
        }
    if (opened && d.panelTab === 'outline') this.panel.rerender();
    this.applySelection(sel, true);
  }

  /** 3D에서 두 번 누르기: 고른 그룹·컴포넌트를 펼치고, 누른 곳을 품은 바로 안쪽 항목을 고른다. 들어갔으면 true */
  private enterLevel(p: Pick3d | null): boolean {
    const d = this.doc;
    const t = d?.tree;
    const deep = d ? pickDeepest(d, p) : null;
    if (!d || !t || deep === null || deep < 0 || this.measuring) return false;
    const n = selectedNode(d, d.selection);
    if (n === null || n < 0 || n === deep || !isAncestor(t, n, deep)) return false;
    const path = nodePath(t, deep);
    const next = path[path.indexOf(n) + 1];
    if (next === undefined) return false;
    d.pick = p;
    d.expanded.add(n);
    if (d.panelTab === 'outline') this.panel.rerender();
    this.applySelection(nodeSelection(d, next), true);
    return true;
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
    const v = this.viewer;
    v?.highlight(ids.length ? ids : null);
    // 나누지 않은 깊은 노드: 면은 구간 강조(코어 highlightRanges), 안쪽 모서리는 굵은 강조 선(가려진 부분은 흐리게).
    // 숨긴 구간과 겹치면 코어가 숨김을 앞세우고, 강조 선분도 숨긴 구간을 빼고 모은다
    v?.highlightRanges(selectionRanges(d, sel));
    const seg = v ? selectionSegments(d, sel, (item) => v.isVisible(this.itemId(item)), this.hiddenRanges) : null;
    v?.setHighlightSegments(seg?.positions ?? null, seg?.origin ? { width: 3, hidden: 0.25, origin: seg.origin } : { width: 3, hidden: 0.25 });
    this.panel.refreshSelection(reveal);
    this.refreshStatus();
  }

  private itemId(item: number): string {
    const s = this.doc!.scene;
    return item < s.meshes.length ? s.meshes[item]!.id : (s.lines[item - s.meshes.length]?.id ?? '');
  }

  zoomToSelection(): void {
    const d = this.doc;
    const v = this.viewer;
    if (!d || !v) return;
    const sel = d.selection;
    if (sel?.kind === 'node' && d.tree && !isSplit(d.tree, sel.index)) {
      const box = nodeBox(d.tree, d.scene, sel.index, (item) => v.isVisible(this.itemId(item)), this.hiddenRanges);
      if (box) this.animateCamera(cameraForBox(v.getCamera(), box, v.canvas.clientWidth / Math.max(1, v.canvas.clientHeight)));
      return;
    }
    const ids = selectionIds(d, sel);
    // 보이는 것만 맞춰 본다(모두 숨겼으면 뷰어가 전체 보기로)
    if (ids.length) v.fitItems(ids);
  }

  /** 카메라를 부드럽게 옮긴다(뷰어의 맞춰 보기 움직임과 비슷한 시간) */
  private animateCamera(to: CameraState, ms = 320): void {
    const v = this.viewer;
    if (!v) return;
    cancelAnimationFrame(this.camAnim);
    const from = v.getCamera();
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      v.setCamera(lerpCamera(from, to, e));
      if (k < 1) this.camAnim = requestAnimationFrame(step);
    };
    this.camAnim = requestAnimationFrame(step);
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
    // 나무가 있으면 윗단계 항목도 나무 노드로 숨긴다(안쪽 노드 숨김과 겹쳐도 맞게)
    if (r.node !== null && d.tree) {
      this.setNodeVisible(r.node, on);
      return;
    }
    if (on) d.hiddenOutline.delete(index);
    else d.hiddenOutline.add(index);
    this.refreshItemVisibility();
    this.panel.refreshVisibility();
  }

  /** 노드 보이기·숨기기: 따로 나눈 노드는 항목째, 나누지 않은 깊은 노드는 그물 안 구간째(코어 setHiddenRanges) */
  setNodeVisible(node: number, on: boolean): void {
    const d = this.doc;
    if (!d?.tree || !canHideNode(d, node)) return;
    if (on) d.hiddenNodes.delete(node);
    else d.hiddenNodes.add(node);
    this.refreshItemVisibility();
    this.panel.refreshVisibility();
  }

  setExpanded(node: number, on: boolean): void {
    const d = this.doc;
    if (!d?.tree) return;
    if (on) d.expanded.add(node);
    else {
      // 접으면 안쪽에 펼쳐 둔 것도 접는다
      for (const n of [...d.expanded]) if (isAncestor(d.tree, node, n)) d.expanded.delete(n);
    }
    this.panel.rerender();
    this.refreshStatus();
  }

  collapseAll(): void {
    const d = this.doc;
    if (!d) return;
    d.expanded.clear();
    this.panel.rerender();
  }

  setPickMode(mode: PickMode): void {
    const d = this.doc;
    if (!d || d.pickMode === mode) return;
    d.pickMode = mode;
    this.panel.rerender();
  }

  setShowSoft(on: boolean): void {
    const d = this.doc;
    if (!d) return;
    d.showSoft = on;
    this.refreshItemVisibility();
    this.panel.rerender();
  }

  setShowHidden(on: boolean): void {
    const d = this.doc;
    if (!d) return;
    d.showHidden = on;
    this.refreshItemVisibility();
    this.panel.rerender();
  }

  /** 항목마다 보이기(부드러운·숨긴 형상 켜짐, 숨긴 윗단계·노드)를 뷰어에 맞춘다. 강조 선분도 다시 모은다 */
  private refreshItemVisibility(): void {
    const d = this.doc;
    const v = this.viewer;
    if (!d || !v) return;
    const n = d.scene.meshes.length + d.scene.lines.length;
    for (let i = 0; i < n; i++) v.setItemVisible(this.itemId(i), itemVisible(d, i));
    // 나누지 않은 깊은 노드 숨김: 항목마다 구간을 합쳐 한 번에 넘기고, 더는 숨길 것이 없는 항목은 푼다
    this.hiddenRanges = hiddenNodeRanges(d);
    const next = new Set<string>();
    for (const [item, list] of this.hiddenRanges) {
      const id = this.itemId(item);
      next.add(id);
      v.setHiddenRanges(id, list);
    }
    for (const id of this.rangedIds) if (!next.has(id)) v.setHiddenRanges(id, null);
    this.rangedIds = next;
    if (d.selection?.kind === 'node') this.applySelection(d.selection, false);
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

  // ───────────────────────── 단면 ─────────────────────────

  /** 단면 축 고르기(null = 끔). 같은 축이면 위치는 그대로, 새 축이면 가운데 */
  setSectionAxis(axis: SectionAxis | null): void {
    const v = this.viewer;
    if (!v || !this.doc) return;
    if (!axis) v.setSection(null);
    else {
      const cur = v.section;
      v.setSectionAxis(axis, cur && cur.axis === axis ? cur.t : 0.5, { caps: 'closed', outline: true, plane: true });
    }
    this.refreshToolbar();
  }

  flipSection(): void {
    this.viewer?.flipSection();
    this.refreshToolbar();
  }

  setPanelOpen(on: boolean): void {
    if (this.panelOpen === on) return;
    const h0 = this.els.viewHost.clientHeight;
    this.panelOpen = on;
    this.refreshChrome();
    if (this.viewer && this.doc && this.narrowQuery?.matches) this.afterViewHeightChange(h0);
  }

  /**
   * 좁은 화면에서 아래 시트가 3D 보기 높이를 바꾼 뒤: 사용자가 보기를 움직이지 않았으면 다시 전체 보기,
   * 확대·이동해 두었으면 위쪽에 보이던 것이 같은 자리·같은 크기로 남게 카메라를 옮긴다.
   */
  private afterViewHeightChange(h0: number): void {
    const v = this.viewer;
    if (!v) return;
    const h1 = this.els.viewHost.clientHeight;
    if (!this.userMoved) {
      requestAnimationFrame(() => requestAnimationFrame(() => this.viewer?.fit(false)));
      return;
    }
    if (h0 > 0 && h1 > 0 && h0 !== h1) v.setCamera(keepViewOnHeightChange(v.getCamera(), h0, h1));
  }

  // ───────────────────────── 패널 크기 ─────────────────────────

  private get narrow(): boolean {
    return !!this.narrowQuery?.matches;
  }

  /** 기억한 패널 폭·시트 높이를 CSS 변수로 */
  private applyLayout(): void {
    const st = this.root.style;
    const w = this.layout.panelWidth;
    if (w !== undefined) st.setProperty('--panel-w', `${clampPanelWidth(w, window.innerWidth)}px`);
    else st.removeProperty('--panel-w');
    const f = this.layout.sheet;
    if (f !== undefined) st.setProperty('--sheet-h', `${(clampSheetFraction(f, this.els?.workspace.clientHeight || window.innerHeight) * 100).toFixed(2)}%`);
    else st.removeProperty('--sheet-h');
  }

  private bindResizer(): void {
    const el = this.els.resizer;
    let drag: { id: number } | null = null;
    const moveTo = (clientX: number, clientY: number): void => {
      const ws = this.els.workspace.getBoundingClientRect();
      if (this.narrow) {
        const h0 = this.els.viewHost.clientHeight;
        this.layout.sheet = clampSheetFraction((ws.bottom - clientY) / ws.height, ws.height);
        this.applyLayout();
        if (this.viewer && this.doc && this.userMoved) {
          const h1 = this.els.viewHost.clientHeight;
          if (h0 > 0 && h1 > 0 && h0 !== h1) this.viewer.setCamera(keepViewOnHeightChange(this.viewer.getCamera(), h0, h1));
        }
      } else {
        this.layout.panelWidth = clampPanelWidth(ws.right - clientX, window.innerWidth);
        this.applyLayout();
      }
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { id: e.pointerId };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 붙잡지 못해도 끌기는 된다 */
      }
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.id) moveTo(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      el.classList.remove('dragging');
      storeLayout(this.layout);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => {
      const h0 = this.els.viewHost.clientHeight;
      if (this.narrow) delete this.layout.sheet;
      else delete this.layout.panelWidth;
      this.applyLayout();
      storeLayout(this.layout);
      if (this.narrow && this.doc) this.afterViewHeightChange(h0);
    });
    el.addEventListener('keydown', (e) => {
      const ws = this.els.workspace.getBoundingClientRect();
      const step = e.shiftKey ? 64 : 16;
      if (this.narrow && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const cur = (this.layout.sheet ?? SHEET_DEFAULT) * ws.height;
        moveTo(0, ws.bottom - (cur + (e.key === 'ArrowUp' ? step : -step)));
        storeLayout(this.layout);
      } else if (!this.narrow && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const cur = this.layout.panelWidth ?? PANEL_WIDTH_DEFAULT;
        moveTo(ws.right - (cur + (e.key === 'ArrowLeft' ? step : -step)), 0);
        storeLayout(this.layout);
      }
    });
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
    this.openMenu(
      btn,
      '표준 뷰',
      VIEW_MENU.map((v) => {
        const item: MenuItem = { label: VIEW_LABELS[v], run: () => this.setView(v) };
        const key = VIEW_KEY_OF[v];
        if (key) item.kbd = key;
        return item;
      }),
    );
  }

  /** 테마 메뉴: 시스템 설정 따르기 · 밝게 · 어둡게 */
  private toggleThemeMenu(): void {
    const btn = this.els.themeBtn;
    if (this.menu) {
      const same = this.menuBtn === btn;
      this.closeMenu();
      if (same) return;
    }
    const cur = themeChoiceOf(this.themeStored);
    this.openMenu(
      btn,
      '테마',
      THEME_CHOICES.map((c) => ({
        label: c.choice === 'system' ? `${c.label}(지금 ${systemPrefersDark() ? '어두움' : '밝음'})` : c.label,
        icon: c.icon,
        checked: c.choice === cur,
        run: () => this.setThemeChoice(c.choice),
      })),
    );
  }

  private menuBtn: HTMLButtonElement | null = null;

  private openMenu(btn: HTMLButtonElement, label: string, items: MenuItem[]): void {
    const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label });
    for (const it of items) {
      const item = h(
        'button',
        { class: `menu-item${it.checked ? ' checked' : ''}`, type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked === undefined ? null : it.checked ? 'true' : 'false' },
        it.checked !== undefined ? h('span', { class: 'menu-check', html: it.checked ? icon('check', 15) : '' }) : null,
        it.icon ? h('span', { class: 'menu-ico', html: icon(it.icon, 16) }) : null,
        h('span', { class: 'menu-label' }, it.label),
        it.kbd ? h('kbd', {}, it.kbd) : null,
      );
      item.addEventListener('click', () => {
        this.closeMenu();
        it.run();
      });
      menu.append(item);
    }
    menu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = [...menu.querySelectorAll<HTMLElement>('.menu-item')];
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    menu.style.top = `${r.bottom + 4}px`;
    this.menu = menu;
    this.menuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    ((menu.querySelector('.menu-item.checked') ?? menu.firstElementChild) as HTMLElement | null)?.focus();
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
    this.menuBtn?.setAttribute('aria-expanded', 'false');
    this.menuBtn = null;
  }

  setView(v: ViewName): void {
    this.userMoved = false;
    this.viewer?.setView(v);
  }

  // ───────────────────────── 키 ─────────────────────────

  private onKey(ev: KeyboardEvent): void {
    if (this.menu && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      const btn = this.menuBtn;
      this.closeMenu();
      btn?.focus();
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
      measureMode: !!v?.measureMode,
      busy: this.busy,
    });
    if (!act) return;
    if (act.kind === 'open') {
      ev.preventDefault();
      ev.stopPropagation();
      this.chooseFile();
      return;
    }
    if (act.kind === 'cancelOpen') {
      ev.preventDefault();
      ev.stopPropagation();
      this.cancelOpen();
      return;
    }
    if (!v) return;
    if (act.kind === 'clearSelection') {
      // 단추의 Esc 기본 동작 등은 그대로 두고 고른 것만 지운다
      this.applySelection(null, false);
      return;
    }
    if (act.kind === 'measureOff') {
      // 측정 점을 지운 뒤 한 번 더 누른 Esc: 측정을 끈다(다른 두 앱과 같게)
      ev.preventDefault();
      ev.stopPropagation();
      this.toggleMeasure(false);
      return;
    }
    if (act.kind === 'grid') {
      ev.preventDefault();
      ev.stopPropagation();
      this.toggleGrid();
      return;
    }
    // F·1~7·Esc(측정 지우기)는 뷰어 규칙대로. 캡처 단계에서 처리했으면 캔버스의 같은 키 처리까지 가지 않게 막는다
    if (v.handleKey(ev)) {
      ev.stopPropagation();
      if (ev.key !== 'Escape') this.userMoved = false;
    }
  }

  // ───────────────────────── 테마 ─────────────────────────

  /** 테마 고르기(시스템이면 기억을 지우고 시스템 설정을 따른다) */
  setThemeChoice(choice: ThemeChoice): void {
    const r = applyThemeChoice(choice, systemPrefersDark());
    this.themeStored = r.stored;
    this.theme = r.theme;
    storeTheme(r.stored);
    this.applyTheme();
  }

  /** 밝게 ↔ 어둡게(기억한다) */
  toggleTheme(): void {
    this.setThemeChoice(this.theme === 'dark' ? 'light' : 'dark');
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.theme === 'dark' ? '#1b2027' : '#f4f5f7');
    this.viewer?.setTheme(this.theme);
    if (this.els) {
      const choice = themeChoiceOf(this.themeStored);
      const label = THEME_CHOICES.find((c) => c.choice === choice)!.label;
      const b = this.els.themeBtn;
      b.innerHTML = `${icon(choice === 'system' ? 'system' : this.theme === 'dark' ? 'moon' : 'sun')}<span class="lbl">테마</span>`;
      b.title = `테마: ${label}${choice === 'system' ? `(지금 ${this.theme === 'dark' ? '어두움' : '밝음'})` : ''} — 눌러서 바꾸기`;
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
    e.resizer.hidden = !open;
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
    const sec = this.viewer?.section ?? null;
    for (const [k, b] of e.secBtns) press(b, k === 'off' ? !sec : sec?.axis === k);
    e.secRange.disabled = !has || !sec;
    e.secFlip.disabled = !has || !sec;
    press(e.secFlip, !!sec?.flip);
    if (sec) e.secRange.value = String(Math.round(Math.min(1, Math.max(0, sec.t)) * 1000));
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
      themeChoice: themeChoiceOf(this.themeStored),
      measuring: this.measuring,
      treeNodes: d?.tree?.count ?? 0,
      expanded: d?.expanded.size ?? 0,
      pickMode: d?.pickMode ?? 'open',
      showSoft: d?.showSoft ?? false,
      showHidden: d?.showHidden ?? false,
      images: d?.images ? (d.images.model ? 1 : 0) + d.images.materials.size + d.images.components.size + d.images.scenes.length : 0,
      panelWidth: this.panel.el.getBoundingClientRect().width,
      sheet: this.layout.sheet ?? SHEET_DEFAULT,
      section: (() => {
        const sec = this.viewer?.section;
        return sec ? { axis: sec.axis, t: sec.t, flip: sec.flip } : null;
      })(),
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

/** 문서가 쓰던 그림 Blob 주소와 워커가 넘긴 무늬 ImageBitmap을 푼다(뷰어는 이미 다음 장면으로 바꿨다) */
function revokeImages(d: SkpDoc): void {
  for (const u of d.images?.urls ?? [])
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* 이미 풀렸다 */
    }
  if (d.images) d.images.urls.length = 0;
  for (const t of d.scene.textures ?? [])
    try {
      t.bitmap?.close();
    } catch {
      /* 이미 닫혔다 */
    }
}
