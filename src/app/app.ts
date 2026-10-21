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
  type Pick3d,
  type IndexRange,
  type PickEvent,
  type Projection,
  type RenderMode,
  type SectionAxis,
  type ViewName,
} from 'opencad-viewer3d';
import { lerpCamera, type CameraState, type ViewFrame } from 'opencad-viewer3d/camera';
import { dragStartPx } from 'opencad-viewer3d/pointer';
import { ParseClient } from './client';
import { AnnotationLabels, occludedBy } from './annotations';
import { ExportDialog, type ExportContext } from './exporter';
import { edgeGeometry } from './faces';
import { copyText } from './clipboard';
import { HISTORY_LIMIT, HISTORY_SETTLE_MS, ViewHistory } from './history';
import { beginOpen, showAnalyticsSettings, trackExport, type OpenAttempt } from './analytics';
import { MeasureTool, type MeasureMode, type MeasureToolResult } from './measure';
import {
  baseFovOf,
  initialSection,
  initialView,
  openingPage,
  pagePlan,
  nextSlide,
  slideDurationMs,
  slideshowOrder,
  refitSceneCamera,
  renderModeForStyle,
  restoreSceneCamera,
  sectionFillOf,
  sameSceneFit,
  sectionToViewer,
  stepPage,
  unwidenSceneCamera,
  type SceneFit,
} from './pages';
import { DEFAULT_UNITS, mmPerSceneUnit } from './units';
import { Overlay } from './overlay';
import { cardName, cardRows, entityInfo } from './entity';
import { h, icon } from './dom';
import {
  canHideNode,
  createDoc,
  faceOrEdgeSelection,
  partBox,
  partOfPick,
  selectedDefinitionNodes,
  docLabel,
  hiddenNodeRanges,
  isBigScene,
  itemVisible,
  nodeSelection,
  pickDeepest,
  releaseName,
  revealGhostRanges,
  revealNodesFor,
  selectedNode,
  selectionForPick,
  selectionIds,
  selectionRanges,
  selectionSegments,
  selectionText,
  selectionEntity,
  measureAxes,
  measureLine,
  measureText,
  pushMeasure,
  nodeHiddenForLabels,
  annotationShown,
  tagHidden,
  unitSummary,
  unsupportedVersion,
  type Selection,
  type SkpDoc,
} from './doc';
import { MAX_FILE_BYTES, SKP_ACCEPT, baseName, fmtCount, formatBytes, formatMs } from './format';
import { VIEW_KEY_OF, VIEW_MENU, isEditableTarget, isViewKey, keyAction } from './keys';
import type { LaunchRequest } from './launch';
import { PANEL_WIDTH_DEFAULT, SHEET_DEFAULT, clampPanelWidth, clampSheetFraction, readLayout, storeLayout, type StoredLayout } from './layout';
import { Panel, type PanelHost } from './panel';
import { RecentStore, canKeepRecent, nameOfRecentId, recentTimeText, type RecentEntry } from './recent';
import { errorText, sceneHasGeometry } from './protocol';
import { deviceHints, textureLimitsFor, type TextureLimits } from './texlimits';
import { THEME_CHOICES, applyThemeChoice, readStoredTheme, resolveTheme, storeTheme, systemPrefersDark, themeChoiceOf, type ThemeChoice, type ThemeName } from './theme';
import { childrenOf, isAncestor, isSplit, nodeBox, nodePath, normalizeRanges, type PickMode } from './tree';
import { cameraForBox, keepViewOnHeightChange } from './view';
import { cssHex, isLightBackground, loadFileBackground, safeStorage, storeFileBackground, styleBackground, viewerTheme } from './backdrop';
import type { Rgb } from '../meta';

export const APP_TITLE = 'OpenCAD SketchUp 뷰어';
const TOOLS_URL = 'https://gyutae-kim.github.io/opencad';
const REPO_URL = 'https://github.com/GyuTae-Kim/opencad-skp';
/** 이보다 좁으면 패널이 아래 시트가 된다(styles.css와 같은 값) */
export const NARROW_WIDTH = 760;
/** 뷰 큐브 한 변(CSS 화소): 넓은 화면 · 좁은 화면 */
export const VIEW_CUBE_WIDE = 112;
export const VIEW_CUBE_NARROW = 76;
/** 정의의 인스턴스 모두에 맞춰 볼 때 범위를 셀 노드 수 한도 */
const MAX_FIT_NODES = 5000;

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
  /** 지금 카메라(뷰어가 없으면 null) */
  camera: CameraState | null;
  /** 장면 수 · 고른 장면 차례(없으면 null) · 적용한 파일 단면 차례 */
  pages: number;
  page: number | null;
  fileSection: number | null;
  /** 숨긴 태그(실제 숨김) · 숨긴 나무 노드 수 · 글·치수 라벨 수(그린 것) */
  hiddenTags: string[];
  hiddenNodes: number;
  labels: number;
  /** 형상에 가려 숨긴 라벨 수(카메라가 멈춘 뒤 판정) */
  labelsOccluded: number;
  /** 측정 도구(줄자·각도기, 꺼져 있으면 null) */
  measureMode: MeasureMode | null;
  /** 고른 것의 종류(outline·node·material·item·face·edge, 없으면 null) */
  selectionKind: Selection['kind'] | null;
  /** 장면 재생 중인지 */
  slideshow: boolean;
  /** 파일·장면 스타일 배경 색 쓰기(사용자 설정)와 지금 3D 배경(파일 색이면 #rrggbb, 앱 테마면 null) */
  fileBackground: boolean;
  background: string | null;
  /** 잘린 면 채우기(닫힌 입체) */
  sectionFill: boolean;
}

interface Els {
  sceneTabs: HTMLElement;
  docName: HTMLElement;
  themeBtn: HTMLButtonElement;
  toolbar: HTMLElement;
  viewBtn: HTMLButtonElement;
  projBtns: Map<Projection, HTMLButtonElement>;
  modeBtns: Map<RenderMode, HTMLButtonElement>;
  gridBtn: HTMLButtonElement;
  bgBtn: HTMLButtonElement;
  cubeBtn: HTMLButtonElement;
  axesBtn: HTMLButtonElement;
  measureBtn: HTMLButtonElement;
  protractorBtn: HTMLButtonElement;
  backBtn: HTMLButtonElement;
  fwdBtn: HTMLButtonElement;
  panelBtn: HTMLButtonElement;
  secBtns: Map<SectionAxis | 'off', HTMLButtonElement>;
  secRange: HTMLInputElement;
  secFlip: HTMLButtonElement;
  secFill: HTMLButtonElement;
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
  secMenuBtn: HTMLButtonElement;
  secBadge: HTMLElement;
  moreBtn: HTMLButtonElement;
  measureBar: HTMLElement;
  measureText: HTMLElement;
  measureClear: HTMLButtonElement;
  measureCopy: HTMLButtonElement;
  measureLogBtn: HTMLButtonElement;
  measureLog: HTMLElement;
  measureFlash: HTMLElement;
  updateBar: HTMLElement;
  selBar: HTMLElement;
  selText: HTMLElement;
  selPart: HTMLButtonElement;
}

interface MenuItem {
  label: string;
  icon?: string;
  kbd?: string;
  /** 고르기 표시(undefined면 표시 없는 명령) */
  checked?: boolean;
  /** 켜고 끄는 항목(menuitemcheckbox) — 아니면 하나 고르기(menuitemradio) */
  toggle?: boolean;
  disabled?: boolean;
  /** 앞에 구분선 */
  sep?: boolean;
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
  /**
   * 휴대폰: 좁은 화면이거나 손가락 기기의 낮은 가로 화면(폭은 760px을 넘을 수 있다).
   * 한 줄 도구 막대(styles.css)·작은 뷰 큐브·처음엔 닫힌 패널로 3D 보기 자리를 지킨다
   */
  private readonly phoneQuery: MediaQueryList | null =
    typeof window.matchMedia === 'function' ? window.matchMedia(`(max-width: ${NARROW_WIDTH - 0.02}px), (pointer: coarse) and (max-height: 499.98px)`) : null;
  /** 손가락이 주인 기기(휴대폰·태블릿): 측정 안내·파일 고르기를 맞춘다 */
  private readonly coarseQuery: MediaQueryList | null = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
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
  /** 그림 저장 창 */
  private exportDialog: ExportDialog | null = null;
  /** 최근 측정(새것이 앞)·측정 띠 알림 타이머 */
  private measureLog: MeasureToolResult[] = [];
  private flashTimer = 0;
  /** 곡선(묶음 차례#곡선 번호) → 중심(측정 "중심" 추정, 문서마다) */
  private curveCenters = new Map<string, [number, number, number] | null>();
  /** 파일·장면 스타일 배경 쓰기(사용자 설정)와 지금 스타일의 배경 색 */
  private fileBg = loadFileBackground(safeStorage());
  private styleBg: Rgb | null = null;
  private hiddenRanges = new Map<number, IndexRange[]>();
  /** 나눠 올리기가 끝나면 부를 것(새 문서로 바뀌면 바로 부른다) */
  private uploadDone: (() => void) | null = null;
  private camAnim = 0;
  /** 옮기는 중인 카메라 움직임이 끝나면 부를 것(그만둘 때도 부른다 — 보기 기록이 '옮기는 중'에 머물지 않게) */
  private camAnimDone: (() => void) | null = null;
  /** 장면 카메라를 지금 3D 보기 종횡비에 맞춘 상태(세로 화면이면 장면의 가로 범위를 지키게 넓힘 — 휴대폰을 돌리면 다시 맞춘다) */
  private sceneFit: SceneFit | null = null;
  /** 장면 전환 중에 화면을 돌렸으면 전환이 끝난 뒤 다시 맞춘다 */
  private refitLater = false;
  /** 3D 위 덧그림 층(문자·치수 라벨, 측정 표시) */
  private overlay: Overlay | null = null;
  /** 문자·치수 라벨 */
  private labels: AnnotationLabels | null = null;
  /** 줄자·각도기(코어 두 점 측정 대신) */
  private measureTool: MeasureTool | null = null;
  /** 측정 도구 안내 글(상태 막대·패널 아래 띠) */
  measureHint: string | null = null;
  /** 이전·다음 보기 기록(칸마다 그때의 장면 맞춤 — 되돌릴 때 지금 화면 방향에 다시 맞춘다) */
  private readonly history = new ViewHistory<SceneFit>(HISTORY_LIMIT, sameSceneFit);
  private historyTimer = 0;
  /** 분리해서 보기 중인지(다시 누르면 모두 보이기) */
  private isolatedOn = false;
  private openSeq = 0;
  private busy = false;
  private ready = false;
  private notice: AppSnapshot['notice'] = null;
  private menu: HTMLElement | null = null;
  private dragDepth = 0;
  /** 최근 문서(이 브라우저의 IndexedDB에만) — 시작 화면 카드 */
  private readonly recent = new RecentStore();
  private readonly recentCard = h('section', { class: 'recent', 'aria-labelledby': 'recent-title', hidden: true });
  private readonly recentList = h('ul', { class: 'recent-list' });

  constructor(root: HTMLElement) {
    this.root = root;
    this.themeStored = readStoredTheme();
    this.theme = resolveTheme(this.themeStored, systemPrefersDark());
    this.layout = readLayout();
    this.panelOpen = !this.phoneQuery?.matches;
    this.panel = new Panel(this);
  }

  // ───────────────────────── 틀 ─────────────────────────

  mount(): void {
    this.root.addEventListener('languagechange', () => { if (this.viewer) this.viewer.setViewCubeSize(this.viewer.viewCubeSize); });
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
      h('a', { class: 'brand', href: './', title: `${APP_TITLE} 처음 화면` }, h('span', { class: 'logo', html: icon('logo', 22) }), h('span', { class: 'brand-text' }, h('b', {}, 'OpenCAD'), h('span', { class: 'brand-sub' }, ' SketchUp 뷰어'))),
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
    const fitBtn = tbtn('전체 보기', 'fit', '전체 보기 (F)', () => {
      this.unwidenScene();
      this.viewer?.fit();
    });
    const backBtn = tbtn('이전 보기', 'back', '이전 보기(카메라 기록)', () => this.viewBack(), 'icon-only wide-only');
    const fwdBtn = tbtn('다음 보기', 'forward', '다음 보기(카메라 기록)', () => this.viewForward(), 'icon-only wide-only');
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
    const bgBtn = tbtn('배경', 'backdrop', '파일 스타일의 배경 색으로 보기(끄면 앱 테마 배경)', () => this.setFileBackground(!this.fileBg));
    const cubeBtn = tbtn('뷰 큐브', 'cube', '뷰 큐브 보이기', () => this.toggleCube());
    const axesBtn = tbtn('좌표축', 'axes', '좌표축 보이기', () => this.toggleAxes());
    const measureBtn = tbtn('줄자', 'tape', '줄자 (T): 두 점 거리 — 끝점·중간점·모서리·면에 붙고, 축 방향이면 축에 고정 · Esc 지우기', () => this.toggleMeasure());
    const protractorBtn = tbtn('각도기', 'protractor', '각도기: 중심 → 기준 방향 → 잴 방향(Shift = 평면 고정) · Esc 지우기', () => this.toggleProtractor());
    const pngBtn = tbtn('그림 저장', 'image', '지금 화면을 그림으로 저장·공유·인쇄(크기·투명 배경·글과 측정 넣기)', () => this.savePng(), 'compact wide-only');
    const panelBtn = tbtn('패널', 'panel', '패널 열기·닫기', () => this.setPanelOpen(!this.panelOpen));
    // 단면 보기: 끔·X·Y·Z, 위치 슬라이더(장면 범위 안 0~1), 뒤집기, 잘린 면 채우기(해석기가 닫힌 입체로 가린 그물만 — capGroup)
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
    const secFlip = tbtn('뒤집기', 'flip', '자르는 쪽 뒤집기', () => this.flipSection(), 'icon-only sec-flip');
    const secFill = tbtn('채우기', 'fill', '잘린 면 채우기(닫힌 입체 — 파일 스타일의 단면 채우기를 따름)', () => this.setSectionFill(!this.sectionFill), 'icon-only sec-fill');
    // 좁은 화면(휴대폰): 보기·측정에 쓰는 단추만 한 줄에 두고, 단면 축과 나머지 보기 설정은 메뉴로 모은다
    const menuBtn = (label: string, ico: string, title: string): HTMLButtonElement =>
      h('button', { class: 'tbtn narrow-only', type: 'button', title, 'aria-label': title, 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: `${icon(ico)}<span class="lbl">${label}</span>` });
    const secMenuBtn = menuBtn('단면', 'section', '단면 보기');
    const secBadge = h('b', { class: 'sec-badge', hidden: true });
    secMenuBtn.append(secBadge);
    secMenuBtn.addEventListener('click', () => this.toggleSectionMenu());
    const moreBtn = menuBtn('보기 설정', 'sliders', '보기 설정');
    moreBtn.addEventListener('click', () => this.toggleMoreMenu());
    const toolbar = h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': '보기 도구' },
      h('div', { class: 'tgroup' }, fitBtn, viewBtn, backBtn, fwdBtn),
      sep(),
      h('div', { class: 'tgroup seg wide-only', role: 'group', 'aria-label': '투영' }, ...projBtns.values()),
      sep(),
      h('div', { class: 'tgroup seg wide-only', role: 'group', 'aria-label': '그리기 방식' }, ...modeBtns.values()),
      sep(),
      h('div', { class: 'tgroup compact wide-only' }, gridBtn, cubeBtn, axesBtn, bgBtn),
      sep(),
      h('div', { class: 'tgroup' }, measureBtn, protractorBtn, pngBtn),
      sep(),
      h('div', { class: 'tgroup sec-group', role: 'group', 'aria-label': '단면 보기' }, secMenuBtn, h('div', { class: 'tgroup seg wide-only' }, ...secBtns.values()), secRange, secFlip, secFill),
      moreBtn,
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
    // 장면 탭(SketchUp 장면 탭처럼 3D 보기 위 한 줄)
    const sceneTabs = h('div', { class: 'scene-tabs', role: 'tablist', 'aria-label': '장면', hidden: true });
    // 측정 띠(휴대폰·터치): 안내·결과를 크게 보이고, Esc 대신 지우기·끝내기 단추를 둔다
    const measureText = h('div', { class: 'mb-text', 'aria-live': 'polite' });
    const measureClear = h('button', { class: 'mb-btn', type: 'button', title: '찍은 점과 결과 지우기', html: `${icon('back', 16)}<span>다시 재기</span>` });
    measureClear.addEventListener('click', () => this.measureTool?.clear());
    const measureClose = h('button', { class: 'mb-btn icon', type: 'button', title: '측정 끝내기', 'aria-label': '측정 끝내기', html: icon('close', 16) });
    measureClose.addEventListener('click', () => this.setMeasureMode(null));
    // 지금 결과 복사·최근 측정 기록(새것부터 10개, 줄마다 복사)
    const measureCopy = h('button', { class: 'mb-btn icon', type: 'button', title: '지금 결과 글 복사', 'aria-label': '지금 결과 글 복사', html: icon('copy', 16) });
    measureCopy.addEventListener('click', () => this.copyMeasure('current'));
    const measureLogBtn = h('button', { class: 'mb-btn icon', type: 'button', title: '최근 측정 기록', 'aria-label': '최근 측정 기록', html: icon('list', 16) });
    measureLogBtn.addEventListener('click', () => this.toggleMeasureLog());
    const measureLogEl = h('div', { class: 'measure-log', hidden: true });
    const measureFlash = h('div', { class: 'measure-flash', role: 'status', hidden: true });
    const measureBar = h(
      'div',
      { class: 'measure-bar', role: 'status', hidden: true },
      measureText,
      h('div', { class: 'mb-acts' }, measureCopy, measureLogBtn, measureClear, measureClose),
      measureLogEl,
      measureFlash,
    );
    // 고른 것 카드(휴대폰·터치): 패널을 열지 않고 고른 그룹·컴포넌트의 크기·태그를 보이고, 자세히(선택 탭)·선택 해제 단추를 둔다
    const selText = h('div', { class: 'mb-text' });
    // 그룹을 고른 뒤 누른 면·모서리 하나만(면 넓이·모서리 길이) — 휴대폰에서 패널을 열지 않고
    const selPart = h('button', { class: 'mb-btn', type: 'button', title: '누른 면 하나의 넓이(모서리면 길이)만 보기', hidden: true, html: `${icon('face', 16)}<span class="mb-part">면만</span>` });
    selPart.addEventListener('click', () => this.selectPickedPart());
    const selMore = h('button', { class: 'mb-btn', type: 'button', title: '패널의 선택 탭에서 전체 정보 보기', html: `${icon('panel', 16)}<span>자세히</span>` });
    selMore.addEventListener('click', () => this.showEntityTab());
    const selClose = h('button', { class: 'mb-btn icon', type: 'button', title: '선택 해제', 'aria-label': '선택 해제', html: icon('close', 16) });
    selClose.addEventListener('click', () => this.applySelection(null, false));
    const selBar = h('div', { class: 'measure-bar sel-bar', role: 'status', hidden: true }, selText, h('div', { class: 'mb-acts' }, selPart, selMore, selClose));
    // 새 판 알림(서비스 워커가 새 판을 받아 기다릴 때)
    const updLater = h('button', { class: 'mini-btn', type: 'button' }, '나중에');
    const updateBar = h(
      'div',
      { class: 'update-bar', role: 'status', hidden: true },
      h('span', {}, '새 버전이 있습니다. 새로 고치면 열어 둔 파일은 최근 문서에서 다시 엽니다.'),
      h('button', { class: 'mini-btn primary upd-apply', type: 'button' }, '새로 고침'),
      updLater,
    );
    updLater.addEventListener('click', () => (updateBar.hidden = true));
    const stage = h('div', { class: 'stage' }, viewHost, sceneTabs, measureBar, selBar, start, notice, busy, updateBar);
    this.exportDialog = new ExportDialog(
      {
        docName: () => this.doc?.name ?? 'model',
        context: () => this.exportContext(),
        notify: (e) => this.showNotice('error', '그림을 저장하지 못했습니다', errorText(e)),
        track: () => trackExport('png'),
      },
      stage,
    );
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
    // 휴대폰은 accept의 확장자(.skp)를 시스템 형식으로 못 바꾸면 파일을 고를 수 없게 흐리게 보인다(iOS) — 거르지 않고 고른 뒤 해석기가 알린다
    const fileInput = h('input', { type: 'file', accept: this.coarseQuery?.matches ? null : SKP_ACCEPT, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) void this.openFile(f);
    });

    this.root.append(title, toolbar, workspace, status, dropCover, fileInput);
    this.els = {
      sceneTabs,
      docName,
      themeBtn,
      toolbar,
      viewBtn,
      projBtns,
      modeBtns,
      gridBtn,
      bgBtn,
      cubeBtn,
      axesBtn,
      measureBtn,
      protractorBtn,
      backBtn,
      fwdBtn,
      panelBtn,
      secBtns,
      secRange,
      secFlip,
      secFill,
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
      secMenuBtn,
      secBadge,
      moreBtn,
      measureBar,
      measureText,
      measureClear,
      measureCopy,
      measureLogBtn,
      measureLog: measureLogEl,
      measureFlash,
      updateBar,
      selBar,
      selText,
      selPart,
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
      h('p', { class: 'dz-main fine-only' }, '.skp 파일을 여기에 끌어다 놓으세요'),
      h('p', { class: 'dz-sub fine-only' }, '창 어디에 놓아도 열립니다'),
      h('p', { class: 'dz-main coarse-only' }, '.skp 파일을 골라 여세요'),
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
        this.buildRecent(),
        h(
          'ul',
          { class: 'facts' },
          h('li', {}, h('b', {}, '지원 형식 '), 'SketchUp 6·7·8·2013~2026에서 저장한 파일 (확장자 .skp)'),
          h('li', { class: 'muted' }, h('b', {}, '아직 못 읽음 '), 'SketchUp 3~5에서 저장한 아주 옛 파일(형식이 달라 판만 알려 드립니다)'),
          h('li', {}, h('span', { class: 'lock', html: icon('lock', 15) }), h('b', {}, '파일은 이 브라우저 밖으로 나가지 않습니다. '), '서버로 올리지 않고 이 컴퓨터에서 읽습니다.'),
        ),
        h('p', { class: 'keys fine-only' }, '왼쪽 끌기 돌리기 · 오른쪽 끌기 옮기기 · 휠 확대 · F 전체 보기 · 1~7 표준 뷰 · F7 격자'),
        h('p', { class: 'keys coarse-only' }, '한 손가락 끌기 돌리기 · 두 손가락 옮기기·확대 · 줄자·각도기는 길게 눌러 정밀 조준'),
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

  /** 시작 화면의 최근 문서 카드(비었으면 숨김) */
  private buildRecent(): HTMLElement {
    const clear = h('button', { class: 'recent-clear', type: 'button', title: '최근 문서 목록을 모두 지웁니다(원래 파일은 그대로)' }, '모두 지우기');
    clear.addEventListener('click', () => void this.recent.clear().then(() => this.refreshRecent()));
    this.recentCard.append(
      h('div', { class: 'recent-head' }, h('h2', { id: 'recent-title' }, '최근 문서'), clear),
      this.recentList,
      h('p', { class: 'recent-note' }, '파일은 이 기기의 이 브라우저에만 저장되고, 서버로 보내지 않습니다.'),
    );
    void this.refreshRecent();
    return this.recentCard;
  }

  /** 최근 문서 목록을 다시 그린다 */
  private async refreshRecent(): Promise<void> {
    const list = await this.recent.list();
    const now = Date.now();
    this.recentList.replaceChildren(...list.map((e) => this.recentRow(e, now)));
    this.recentCard.hidden = !list.length;
  }

  private recentRow(e: RecentEntry, now: number): HTMLElement {
    const open = h(
      'button',
      { class: 'recent-open', type: 'button' },
      h('span', { class: 'recent-icon', html: icon('open', 18) }),
      h('span', { class: 'recent-name', translate: 'no' }, e.name),
      // 크기와 시각은 따로 번역되게 나눈다(독일어 "vor 3 Min."이 크기 앞으로 가지 않게)
      h('span', { class: 'recent-meta' }, formatBytes(e.size), ' · ', h('span', {}, recentTimeText(e.time, now))),
    );
    open.addEventListener('click', () => void this.openRecent(e));
    const del = h('button', { class: 'recent-del', type: 'button', title: '목록에서 지우기', 'aria-label': `최근 문서에서 지우기: ${e.name}`, html: icon('close', 16) });
    del.addEventListener('click', () => void this.recent.remove(e.id).then(() => this.refreshRecent()));
    return h('li', { class: 'recent-row' }, open, del);
  }

  /** 최근 문서 다시 열기(저장한 바이트로) */
  async openRecent(e: Pick<RecentEntry, 'id' | 'name'>): Promise<void> {
    const attempt = beginOpen('local', 'skp');
    const seq = ++this.openSeq;
    this.setBusy(e.name, 0.005, '파일 읽는 중');
    const got = await this.recent.open(e.id);
    if (seq !== this.openSeq) return;
    if (!got) {
      this.setBusy(null);
      attempt.error('read_error');
      this.showNotice('error', `"${e.name}" 파일을 찾지 못했습니다`, '이 브라우저에 저장해 둔 사본이 지워졌습니다. 파일을 다시 골라 여세요.');
      void this.refreshRecent();
      return;
    }
    await this.openBuffer(got.entry.name, got.data, seq, attempt);
    void this.refreshRecent();
  }

  /** 고르거나 끌어다 놓아 연 파일을 최근 문서에 저장(바이트는 워커로 넘어갔으므로 파일에서 다시 읽는다) */
  private async keepRecent(file: File, name: string): Promise<void> {
    if (!canKeepRecent(file.size)) return;
    try {
      if (await this.recent.add(name, await file.arrayBuffer())) await this.refreshRecent();
    } catch {
      /* 다시 못 읽으면 저장하지 않는다 */
    }
  }

  private bindWindow(): void {
    window.addEventListener('keydown', (ev) => this.onKey(ev), true);
    // 각도기 Shift(평면 고정)는 떼는 것까지 도구에 넘긴다
    window.addEventListener(
      'keyup',
      (ev) => {
        if (ev.key === 'Shift' && this.measureTool?.active) this.measureTool.handleKey(ev);
      },
      true,
    );
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
    // 휴대폰 주소 막대가 숨고 나타날 때(높이만 바뀜)는 열린 메뉴를 닫지 않는다
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
      const turned = window.innerWidth !== lastWidth;
      if (turned) this.closeMenu();
      lastWidth = window.innerWidth;
      this.applyLayout();
      // 폭이 바뀌면(휴대폰을 돌림) 장면 맞춤을 새 종횡비로 — 높이만 바뀌는 주소 막대·시트는 건드리지 않는다
      if (turned) requestAnimationFrame(() => this.refitScene());
    });
    // 휴대폰(좁은 화면·낮은 가로 화면)에서는 뷰 큐브를 줄인다
    this.phoneQuery?.addEventListener('change', () => this.viewer?.setViewCubeSize(this.viewCubeSize()));
  }

  // ───────────────────────── 열기 ─────────────────────────

  chooseFile(): void {
    this.els.fileInput.click();
  }

  async openFile(file: File): Promise<void> {
    const attempt = beginOpen('local', 'skp');
    if (file.size > MAX_FILE_BYTES) {
      attempt.error('size_limit');
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
        attempt.error('read_error');
      }
      return;
    }
    if (seq !== this.openSeq) return;
    const name = baseName(file.name);
    if (await this.openBuffer(name, buf, seq, attempt)) void this.keepRecent(file, name);
  }

  /** 같은 출처 주소의 파일 열기(?open=) */
  async openUrl(url: string, name = baseName(new URL(url, location.href).pathname) || 'model.skp'): Promise<void> {
    const attempt = beginOpen('url', 'skp');
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
        attempt.error('fetch_error');
      }
      return;
    }
    if (seq !== this.openSeq) return;
    await this.openBuffer(name, buf, seq, attempt);
  }

  async openSample(): Promise<void> {
    const attempt = beginOpen('sample', 'skp');
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
        attempt.error('read_error');
      }
      return;
    }
    if (seq !== this.openSeq) return;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await this.openBuffer(name, buf, seq, attempt);
  }

  /** 여는 중인 파일을 그만 연다(해석 중이면 워커를 끝낸다). 열려 있던 문서는 그대로 둔다 */
  cancelOpen(): void {
    this.openSeq++;
    this.client.cancel();
    this.parsingSeq = 0;
    this.setBusy(null);
  }

  private parsingSeq = 0;

  /** 바이트 해석(buf는 워커로 이전된다). seq가 더 새 요청에 밀리면 결과를 버린다. 열어 보였으면 true */
  private async openBuffer(name: string, buf: ArrayBuffer, seq: number, attempt: OpenAttempt): Promise<boolean> {
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
      if (seq !== this.openSeq) return false;
      const old = unsupportedVersion(res.scene);
      if (old) {
        attempt.error('unsupported');
        this.showNotice(
          'warn',
          `아직 읽지 못하는 판입니다: ${releaseName(old)} (${old})`,
          `"${name}" 파일은 SketchUp 3~5의 아주 옛 형식으로 저장되어 있습니다. 이 뷰어는 SketchUp 6·7·8·2013~2026 파일을 읽습니다. SketchUp 6 이상(가능하면 2021 이상)에서 다시 저장한 뒤 열어 주세요.`,
        );
        return false;
      }
      if (!sceneHasGeometry(res.scene)) {
        attempt.error('empty');
        const why = res.scene.warnings?.[0] ?? '그릴 면이나 모서리를 찾지 못했습니다.';
        this.showNotice('error', `"${name}" 파일을 열지 못했습니다`, why);
        return false;
      }
      // GPU에 올리기: 작은 모형은 한 번에(그 전에 단계 글을 한 번 그린다), 큰 모형은 프레임마다 나눠 올리며 실제 진행을 보인다
      this.setBusy(name, isBigScene(res) ? 0 : 0.99, '화면에 올리는 중');
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (seq !== this.openSeq) return false;
      const doc = createDoc(name, size, res, { makeUrl: (b, mime) => URL.createObjectURL(new Blob([b as BlobPart], { type: mime })) });
      const uploaded = this.setDoc(doc, (done, total) => {
        if (seq === this.openSeq) this.setBusy(name, total ? done / total : 1, `화면에 올리는 중 · 묶음 ${fmtCount(done)}/${fmtCount(total)}`);
      });
      this.noticeDamage(doc);
      await uploaded;
      if (seq !== this.openSeq || this.doc !== doc) return false;
      attempt.success();
      return true;
    } catch (e) {
      if (seq !== this.openSeq) return false;
      this.showNotice('error', `"${name}" 파일을 열지 못했습니다`, errorText(e));
      attempt.error('parse_error');
      return false;
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
    this.stopSlideshow();
    this.exportDialog?.close();
    this.curveCenters.clear();
    this.measureLog = [];
    // 앞 장면이 세로 화면에 맞춰 넓힌 시야각은 원래대로(새 문서의 전체 보기·카메라가 넓은 시야각을 물려받지 않게)
    const fov = this.sceneBaseFov(v);
    if (fov !== v.getCamera().fovY) v.setCamera({ ...v.getCamera(), fovY: fov });
    this.sceneFit = null;
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
    this.measureTool?.clear();
    // 부드러운 모서리·숨긴 형상은 처음에 숨긴다(장면 범위에는 들어 있지 않다)
    this.refreshItemVisibility();
    // 파일에서 숨긴 태그·태그 폴더는 처음부터 숨긴다
    for (const t of d.tags) if (tagHidden(d, t.name)) v.setGroupVisible(t.name, false);
    this.isolatedOn = false;
    this.userMoved = false;
    this.history.reset(null);
    // 파일이 기억한 보기: 스타일의 그리기 방식, 활성 모형 단면, 처음 카메라(모형을 실제로 보여 줄 때만), 지금 장면
    const mode = renderModeForStyle(d.style);
    if (mode) {
      this.renderMode = mode;
      v.setRenderMode(mode);
    }
    // 잘린 면 채우기: 모형 스타일의 단면 채우기(장면 스타일이 바꿀 수 있다)
    this.sectionFill = sectionFillOf(d.style, d.info.major);
    const sec = initialSection(d.scene.meta);
    if (sec) {
      v.setSection({ normal: sec.normal, offset: sec.offset }, { caps: this.caps });
      d.fileSection = sec.index;
    }
    const first = initialView(d.scene.meta, d.scene.bounds, v.canvas.clientWidth, v.canvas.clientHeight, v.getCamera().fovY);
    if (first) {
      v.setCamera(first.camera);
      this.sceneFit = first.fit;
      this.projection = first.camera.projection;
      this.userMoved = true;
    }
    d.page = openingPage(d.scene.meta);
    // 배경: 모형 스타일의 배경 색(장면을 고르면 그 장면 스타일의 색으로 바뀐다)
    this.styleBg = styleBackground(d.style);
    this.applyTheme();
    this.labels?.setData(d.texts, d.dimensions, d.scene.units, d.units);
    this.refreshAnnotations();
    if (old && old !== d) revokeImages(old);
    this.panel.show(d);
    this.renderSceneTabs();
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
        theme: viewerTheme(this.theme, this.backdrop),
        projection: this.projection,
        renderMode: this.renderMode,
        viewCubeSize: this.viewCubeSize(),
        textureLimit: this.texLimits.limit,
        textureBudget: this.texLimits.budget,
      });
      v.onPick((p, e) => this.onPick(p, e));
      // 단면 상태(앱 단추·슬라이더·새 장면으로 꺼짐 등)는 코어 알림으로 도구 막대에 맞춘다
      v.onSectionChange(() => {
        this.refreshToolbar();
        this.refreshAnnotations();
      });
      v.onCameraChange((c) => this.onCamera(c));
      this.watchCanvas(v);
      this.viewer = v;
      this.overlay = new Overlay(this.els.viewHost);
      this.overlay.attach(v);
      this.labels = new AnnotationLabels(this.overlay);
      // 형상 뒤의 글·치수는 숨긴다(카메라가 멈추면 라벨 기준점에서 코어 고르기로 판정)
      this.labels.setOcclusion((p, x, y, f) => this.labelOccluded(p, x, y, f));
      this.measureTool = new MeasureTool(v, this.overlay, {
        getScene: () => this.doc?.scene ?? null,
        getUnits: () => this.doc?.units ?? DEFAULT_UNITS,
        onResult: (r) => this.onMeasure(r),
        onHint: (t) => {
          this.measureHint = t;
          this.refreshStatus();
          this.panel.refreshSelection();
        },
        touch: () => !!this.coarseQuery?.matches,
        curveCenter: (id, seg) => this.curveCenter(id, seg),
        // 모형의 그리기 축을 옮겼으면 줄자·각도기의 축 고정·기본 평면이 그 축을 따른다
        getAxes: () => {
          const a = this.doc?.axes;
          return a ? { x: a.x, y: a.y, z: a.z } : null;
        },
      });
      return v;
    } catch (e) {
      this.showNotice('error', '3D 보기를 열 수 없습니다', errorText(e));
      return null;
    }
  }

  private viewCubeSize(): number {
    return this.phoneQuery?.matches ? VIEW_CUBE_NARROW : VIEW_CUBE_WIDE;
  }

  // ───────────────────────── 고르기·측정 ─────────────────────────

  /** 3D 보기 입력 엿보기: 사용자가 보기를 직접 움직였는지(Alt·두 번 누르기는 코어의 onPick 두 번째 인자로 받는다) */
  private watchCanvas(v: Viewer3d): void {
    const cv = v.canvas;
    let down: { x: number; y: number } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      // 3D를 만지면 장면 재생을 멈춘다(SketchUp처럼)
      this.stopSlideshow();
    });
    cv.addEventListener('pointermove', (e) => {
      // 코어와 같은 끌기 시작 거리(터치 10화소): 그 안의 손가락 떨림은 누르기라 보기를 움직이지 않는다
      if (down && e.buttons && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= dragStartPx(e.pointerType)) this.userMoved = true;
    });
    cv.addEventListener('pointerup', () => (down = null));
    cv.addEventListener('wheel', () => {
      this.userMoved = true;
      this.stopSlideshow();
    }, { passive: true });
    // 뷰 큐브를 누르면 표준 뷰 + 전체 보기
    const cube = v.host.querySelector<HTMLElement>('.v3d-cube');
    cube?.addEventListener('pointerdown', () => (this.userMoved = false));
    // 뷰 큐브 누르기·가운데 단추 두 번 누르기(코어의 표준 뷰·전체 보기)도 넓힌 시야각을 먼저 되돌린다.
    // 코어보다 먼저 받도록 보기 바탕의 캡처 단계에서 본다(코어와 같은 문턱: 큐브 끌기 3화소, 가운데 두 번 420 ms·8화소)
    let cubeDown: { x: number; y: number } | null = null;
    let middle = { t: -Infinity, x: 0, y: 0 };
    v.host.addEventListener(
      'pointerdown',
      (e) => {
        if (cube && cube.contains(e.target as Node)) {
          cubeDown = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
          return;
        }
        if (e.pointerType !== 'mouse' || e.button !== 1) return;
        const t = performance.now();
        if (t - middle.t < 420 && Math.hypot(e.clientX - middle.x, e.clientY - middle.y) < 8) {
          middle.t = -Infinity;
          this.unwidenScene();
        } else middle = { t, x: e.clientX, y: e.clientY };
      },
      true,
    );
    v.host.addEventListener(
      'pointerup',
      (e) => {
        const d = cubeDown;
        cubeDown = null;
        if (d && cube?.contains(e.target as Node) && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) this.unwidenScene();
      },
      true,
    );
  }

  /** 3D 고르기: Alt = 가장 안쪽, 두 번째 누르기(e.clicks = 2) = 고른 그룹에 한 단계 들어가기 */
  private onPick(p: Pick3d | null, e?: PickEvent): void {
    const d = this.doc;
    if (!d) return;
    // 줄자·각도기가 켜져 있으면 누르기는 측정 점이다(코어는 같은 누르기로 고르기를 따로 알린다)
    if (this.measureTool?.active) return;
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
    // 면·모서리 방식에서 두 번 누르면 그 면·모서리에 맞춰 본다
    if (e?.clicks === 2 && (sel?.kind === 'face' || sel?.kind === 'edge')) this.zoomToSelection();
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

  private onMeasure(m: MeasureToolResult | null): void {
    const d = this.doc;
    if (!d) return;
    d.measure = m;
    this.measureLog = pushMeasure(this.measureLog, m);
    this.panel.refreshSelection();
    this.refreshStatus();
  }

  /** 최근 측정(새것이 앞, PanelHost) */
  get measureLogList(): readonly MeasureToolResult[] {
    return this.measureLog;
  }

  /** 측정 결과 글 복사: 차례(기록 안), 'all'(기록 전부, 한 줄씩), 'current'(지금 결과) */
  copyMeasure(which: number | 'all' | 'current'): void {
    const d = this.doc;
    if (!d) return;
    const mm = mmPerSceneUnit(d.scene.units);
    const list = which === 'all' ? this.measureLog : which === 'current' ? (d.measure ? [d.measure] : []) : this.measureLog.slice(which, which + 1);
    if (!list.length) return;
    const text = list.map((m) => measureLine(m, d.units, mm)).join('\n');
    void copyText(text).then((ok) => this.flashMeasure(ok ? '복사했습니다' : '복사하지 못했습니다'));
  }

  clearMeasureLog(): void {
    this.measureLog = [];
    this.els.measureLog.hidden = true;
    this.panel.refreshSelection();
    this.refreshStatus();
  }

  /** 측정 띠에 잠깐 알림(복사 등) */
  private flashMeasure(text: string): void {
    const el = this.els.measureFlash;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (el.hidden = true), 1600);
  }

  /** 측정 기록 펼치기(측정 띠 위 목록) */
  private toggleMeasureLog(): void {
    const el = this.els.measureLog;
    el.hidden = !el.hidden;
    if (!el.hidden) this.renderMeasureLog();
  }

  private renderMeasureLog(): void {
    const d = this.doc;
    const el = this.els.measureLog;
    if (!d || el.hidden) return;
    const mm = mmPerSceneUnit(d.scene.units);
    const rows = this.measureLog.map((m, i) => {
      const b = h('button', { class: 'ml-row', type: 'button', title: '눌러서 이 결과 복사' }, h('span', { 'data-i18n-skip': '' }, measureLine(m, d.units, mm)), h('span', { class: 'ml-copy', html: icon('copy', 14) }));
      b.addEventListener('click', () => this.copyMeasure(i));
      return b;
    });
    const all = h('button', { class: 'mini-btn', type: 'button' }, '모두 복사');
    all.addEventListener('click', () => this.copyMeasure('all'));
    const clear = h('button', { class: 'mini-btn', type: 'button' }, '기록 지우기');
    clear.addEventListener('click', () => this.clearMeasureLog());
    el.replaceChildren(h('div', { class: 'ml-head' }, h('b', {}, `최근 측정 ${fmtCount(this.measureLog.length)}개`)), ...rows, h('div', { class: 'pbar ml-acts' }, all, clear));
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

  /** 측정 도구 "중심" 추정: 선분이 든 호·원의 중심(곡선 번호마다 한 번 재어 둔다 — 곡선 선분을 모으려고 묶음 전체를 훑는다) */
  private curveCenter(id: string, seg: number): [number, number, number] | null {
    const d = this.doc;
    const item = d?.lineIndex.get(id);
    if (!d || item === undefined) return null;
    const curves = d.faceIndex.segmentCurves[item];
    const no = curves?.[seg];
    if (!curves || no === undefined || no < 0) return null;
    const key = `${item}#${no}`;
    let c = this.curveCenters.get(key);
    if (c === undefined) {
      const line = d.scene.lines[item];
      c = (line ? edgeGeometry(line, curves, seg)?.center : null) ?? null;
      this.curveCenters.set(key, c);
    }
    return c;
  }

  /** 마지막으로 3D에서 누른 자리의 면·모서리 하나를 고른다(PanelHost, 고른 것 카드) */
  selectPickedPart(): void {
    const d = this.doc;
    const part = d ? faceOrEdgeSelection(d, d.pick) : null;
    if (part) this.applySelection(part, false);
  }

  zoomToSelection(): void {
    const d = this.doc;
    const v = this.viewer;
    if (!d || !v) return;
    this.unwidenScene();
    const sel = d.selection;
    const pb = partBox(d, sel);
    if (pb) {
      this.animateCamera(cameraForBox(v.getCamera(), pb, v.canvas.clientWidth / Math.max(1, v.canvas.clientHeight)));
      return;
    }
    // 정의의 인스턴스 모두: 보이는 노드 범위를 합친다(많으면 앞의 MAX_FIT_NODES개)
    const defNodes = selectedDefinitionNodes(d, sel);
    if (defNodes.length && d.tree) {
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const n of defNodes.slice(0, MAX_FIT_NODES)) {
        const b = nodeBox(d.tree, d.scene, n, (item) => v.isVisible(this.itemId(item)), this.hiddenRanges);
        if (!b) continue;
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, b.min[k]!);
          hi[k] = Math.max(hi[k]!, b.max[k]!);
        }
      }
      if (lo[0] <= hi[0]) this.animateCamera(cameraForBox(v.getCamera(), { min: lo, max: hi }, v.canvas.clientWidth / Math.max(1, v.canvas.clientHeight)));
      return;
    }
    if (sel?.kind === 'node' && d.tree && !isSplit(d.tree, sel.index)) {
      const box = nodeBox(d.tree, d.scene, sel.index, (item) => v.isVisible(this.itemId(item)), this.hiddenRanges);
      if (box) this.animateCamera(cameraForBox(v.getCamera(), box, v.canvas.clientWidth / Math.max(1, v.canvas.clientHeight)));
      return;
    }
    const ids = selectionIds(d, sel);
    // 보이는 것만 맞춰 본다(모두 숨겼으면 뷰어가 전체 보기로)
    if (ids.length) v.fitItems(ids);
  }

  private viewAspect(v: Viewer3d): number {
    return v.canvas.clientWidth / Math.max(1, v.canvas.clientHeight);
  }

  /** 지금 시야각에서 세로 화면 맞춤을 뺀 것(맞춘 뒤 사용자가 시야각을 바꾸지 않았을 때만 장면의 원래 시야각) */
  private sceneBaseFov(v: Viewer3d): number {
    return baseFovOf(v.getCamera(), this.sceneFit);
  }

  /** 이전·다음 보기로 갈 카메라: 장면 맞춤으로 적은 칸은 지금 화면 방향에 다시 맞추고, 그 맞춤을 이어 간다 */
  private restoreView(c: CameraState): CameraState {
    const v = this.viewer;
    const r = restoreSceneCamera(c, this.history.tag, v ? this.viewAspect(v) : 1);
    this.sceneFit = r.fit;
    return r.camera;
  }

  /**
   * 전체 보기·표준 뷰·맞춰 보기 전에: 장면이 세로 화면에서 넓힌 시야각을 원래대로(넓은 시야각의 전체 보기는 가장자리가 늘어난다).
   * 이 보기들은 장면 보기가 아니므로 장면 맞춤도 끝낸다(돌려도 다시 넓히지 않는다)
   */
  private unwidenScene(): void {
    const v = this.viewer;
    const f = this.sceneFit;
    if (!v || !f) return;
    this.sceneFit = null;
    // 장면 전환·이전 보기 중이면 그만 옮긴다(전체 보기가 그 위에서 시작한다)
    this.refitLater = false;
    this.stopCameraAnim();
    const c = v.getCamera();
    const u = unwidenSceneCamera(c, f);
    if (u !== c) v.setCamera(u);
  }

  /** 휴대폰을 돌린 뒤: 장면 맞춤을 새 종횡비로(보기를 돌리거나 옮긴 것은 그대로, 사용자가 투영을 바꿨으면 그만 따라간다) */
  private refitScene(): void {
    const v = this.viewer;
    const f = this.sceneFit;
    if (!v || !f || !this.doc) return;
    if (this.camAnim) {
      this.refitLater = true;
      return;
    }
    const cur = v.getCamera();
    const r = refitSceneCamera(cur, f, this.viewAspect(v));
    this.sceneFit = r?.fit ?? null;
    // 더 따라갈 수 없으면(그 사이 평행 투영으로 바꿈 등) 넓힌 시야각을 원래대로 — 다시 원근으로 와도 넓은 시야각이 남지 않게
    const next = r ? r.camera : unwidenSceneCamera(cur, f);
    if (next !== cur) {
      v.setCamera(next);
      // 시야각만 바뀌면 코어가 카메라 변화를 알리지 않는다 — 기록의 마지막 카메라·맞춤을 직접 새로 한다
      this.onCamera(v.getCamera());
    }
  }

  /** 옮기는 중인 카메라 움직임을 그만둔다(끝났을 때 부를 것도 부른다 — 이전·다음 보기면 보기 기록의 '옮기는 중'을 푼다) */
  private stopCameraAnim(): void {
    cancelAnimationFrame(this.camAnim);
    this.camAnim = 0;
    const done = this.camAnimDone;
    this.camAnimDone = null;
    done?.();
  }

  /** 카메라를 부드럽게 옮긴다(뷰어의 맞춰 보기 움직임과 비슷한 시간). 앞의 움직임은 그만두고 그 done을 먼저 부른다 */
  private animateCamera(to: CameraState, ms = 320, done?: () => void): void {
    const v = this.viewer;
    if (!v) return;
    this.stopCameraAnim();
    const from = v.getCamera();
    if (!(ms > 0)) {
      v.setCamera(to);
      done?.();
      return;
    }
    this.camAnimDone = done ?? null;
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      v.setCamera(lerpCamera(from, to, e));
      if (k < 1) {
        this.camAnim = requestAnimationFrame(step);
        return;
      }
      this.camAnim = 0;
      this.camAnimDone = null;
      done?.();
      // 옮기는 동안 휴대폰을 돌렸으면 다 옮긴 뒤 다시 맞춘다
      if (this.refitLater) {
        this.refitLater = false;
        this.refitScene();
      }
    };
    this.camAnim = requestAnimationFrame(step);
  }

  /** 카메라가 바뀔 때: 보기 기록(멈추면 한 칸, 그때의 장면 맞춤과 함께) */
  private onCamera(c: CameraState): void {
    this.history.observe(c, performance.now(), this.sceneFit);
    clearTimeout(this.historyTimer);
    this.historyTimer = window.setTimeout(() => {
      if (this.history.settle(performance.now())) this.refreshToolbar();
    }, HISTORY_SETTLE_MS + 30);
  }

  viewBack(): void {
    // 앞의 이전·다음 보기 움직임을 먼저 끝낸다(그 done이 기록의 '옮기는 중'을 풀므로 새로 옮기기 전에)
    this.stopCameraAnim();
    const c = this.history.back(performance.now());
    if (!c) return;
    this.userMoved = true;
    this.projection = c.projection;
    this.animateCamera(this.restoreView(c), 280, () => {
      this.history.done();
      this.refreshToolbar();
    });
  }

  viewForward(): void {
    this.stopCameraAnim();
    const c = this.history.forward();
    if (!c) return;
    this.userMoved = true;
    this.projection = c.projection;
    this.animateCamera(this.restoreView(c), 280, () => {
      this.history.done();
      this.refreshToolbar();
    });
  }

  get measuring(): boolean {
    return !!this.measureTool?.active;
  }

  // ───────────────────────── 보이기(PanelHost) ─────────────────────────

  setTagVisible(name: string, on: boolean): void {
    const d = this.doc;
    if (!d) return;
    if (on) d.hiddenTags.delete(name);
    else d.hiddenTags.add(name);
    this.applyTagVisibility();
  }

  setAllTagsVisible(on: boolean): void {
    const d = this.doc;
    if (!d) return;
    for (const t of d.tags) {
      if (!t.hasGeometry) continue;
      if (on) d.hiddenTags.delete(t.name);
      else d.hiddenTags.add(t.name);
    }
    if (on) d.hiddenFolders.clear();
    this.applyTagVisibility();
  }

  /** 태그 폴더 보이기·숨기기(안쪽 태그는 폴더가 숨으면 함께 숨는다 — 태그 자신의 보임은 그대로 둔다) */
  setFolderVisible(folder: number, on: boolean): void {
    const d = this.doc;
    if (!d || folder < 0 || folder >= d.tagFolders.length) return;
    if (on) d.hiddenFolders.delete(folder);
    else d.hiddenFolders.add(folder);
    this.applyTagVisibility();
  }

  /** 태그마다 실제 숨김(태그 자신 또는 든 폴더)을 뷰어에 맞춘다 */
  private applyTagVisibility(): void {
    const d = this.doc;
    if (!d) return;
    for (const t of d.tags) this.viewer?.setGroupVisible(t.name, !tagHidden(d, t.name));
    this.panel.refreshVisibility();
    this.refreshAnnotations();
  }

  /** 글·치수·보조선·단면 기호 보이기 */
  setAnnotationVisible(kind: 'texts' | 'dimensions' | 'guides' | 'sectionPlanes', on: boolean): void {
    const d = this.doc;
    if (!d) return;
    if (kind === 'texts') d.showTexts = on;
    else if (kind === 'dimensions') d.showDimensions = on;
    else if (kind === 'guides') d.showGuides = on;
    else d.showSectionPlanes = on;
    this.refreshItemVisibility();
    this.refreshAnnotations();
    this.panel.rerender();
  }

  // ───────────────────────── 숨기기·분리해서 보기 ─────────────────────────

  get isolated(): boolean {
    return this.isolatedOn;
  }

  /**
   * 장면(페이지) 적용: 장면이 기억하는 것만 바꾼다(카메라·숨긴 태그·숨긴 개체·단면·스타일).
   * 카메라는 장면 전환 시간(없으면 2초) 동안 부드럽게 옮긴다.
   */
  applyPage(index: number, fromSlideshow = false): number {
    const d = this.doc;
    const v = this.viewer;
    const page = d?.pages[index];
    if (!d || !v || !page) return 0;
    // 사용자가 장면을 고르면 재생을 멈춘다
    if (!fromSlideshow) this.stopSlideshow();
    const plan = pagePlan(page, { sectionPlanes: d.sectionPlanesRaw, viewerFovY: this.sceneBaseFov(v), viewAspect: this.viewAspect(v) });
    if (plan.hiddenTags) d.hiddenTags = new Set([...plan.hiddenTags].filter((t) => d.tags.some((x) => x.name === t)));
    if (plan.hiddenNodes) {
      // 숨긴 개체 목록은 저장 당시 전체 상태다: 보기에서 숨긴 것은 버리고 장면 목록으로 바꾼다
      d.hiddenNodes.clear();
      d.hiddenOutline.clear();
      for (const n of plan.hiddenNodes) if (canHideNode(d, n)) d.hiddenNodes.add(n);
      this.isolatedOn = false;
      // 모형에서 숨겼지만 이 장면은 숨기지 않는 개체는 보인다
      d.revealNodes = revealNodesFor(d, plan.hiddenNodes) ?? d.revealNodes;
    }
    // 장면 스타일의 단면 채우기(기억하는 장면만) — 단면을 바꾸지 않는 장면이면 지금 단면에 바로
    if (typeof plan.style?.sectionFill === 'boolean' && plan.style.sectionFill !== this.sectionFill) {
      this.sectionFill = plan.style.sectionFill;
      if (!plan.setsSection) this.applySectionFill();
    }
    if (plan.setsSection) {
      if (plan.section) v.setSection({ normal: plan.section.normal, offset: plan.section.offset }, { caps: this.caps });
      else v.setSection(null);
      d.fileSection = plan.section?.index ?? null;
    }
    if (plan.style) {
      const st = plan.style;
      if (st.texts !== undefined) d.showTexts = st.texts;
      if (st.dimensions !== undefined) d.showDimensions = st.dimensions;
      if (st.guides !== undefined) d.showGuides = st.guides;
      if (st.sectionPlanes !== undefined) d.showSectionPlanes = st.sectionPlanes;
    }
    if (plan.renderMode) this.setRenderMode(plan.renderMode);
    // 장면 스타일의 배경 색
    const bg = styleBackground(plan.style);
    if (bg) {
      this.styleBg = bg;
      this.applyTheme();
    }
    d.page = index;
    for (const t of d.tags) v.setGroupVisible(t.name, !tagHidden(d, t.name));
    this.refreshItemVisibility();
    this.refreshAnnotations();
    if (plan.camera) {
      const to = plan.camera;
      this.sceneFit = plan.fit;
      this.userMoved = true;
      // 평행·원근도 장면을 따른다(도구 막대도 맞춘다)
      this.projection = to.projection;
      this.animateCamera(to, Math.min(plan.seconds, 4) * 1000, () => this.refreshToolbar());
    }
    this.renderSceneTabs();
    this.panel.rerender();
    this.refreshToolbar();
    this.refreshStatus();
    return plan.camera ? plan.seconds : 0;
  }

  // ───────────────────────── 장면 재생(슬라이드 쇼) ─────────────────────────

  private slideTimer = 0;
  private sliding = false;
  private slides = 0;

  /** 장면 재생 켜고 끄기(▶ 단추) */
  toggleSlideshow(): void {
    if (this.sliding) this.stopSlideshow();
    else this.startSlideshow();
  }

  /** 지금 장면 다음부터 "장면 재생에 넣기" 장면을 전환 + 지연 시간마다 넘긴다(모형 설정이 되풀이를 끄면 한 바퀴) */
  startSlideshow(): void {
    const d = this.doc;
    if (!d || !d.pages.length || !this.viewer) return;
    this.sliding = true;
    this.slides = 0;
    this.slideNext();
  }

  stopSlideshow(): void {
    if (!this.sliding) return;
    this.sliding = false;
    clearTimeout(this.slideTimer);
    this.slideTimer = 0;
    this.renderSceneTabs();
  }

  private slideNext(): void {
    const d = this.doc;
    if (!this.sliding || !d) return;
    const loop = (d.scene.meta as { animation?: { loop?: boolean } } | undefined)?.animation?.loop !== false;
    const next = nextSlide(slideshowOrder(d.pages), d.page, loop, this.slides);
    if (next === null) {
      this.stopSlideshow();
      return;
    }
    this.slides++;
    const seconds = this.applyPage(next, true);
    this.slideTimer = window.setTimeout(() => this.slideNext(), slideDurationMs(d.pages[next]!, seconds));
  }

  /** 장면 탭 줄을 다시 그린다(장면이 없으면 숨김) */
  private renderSceneTabs(): void {
    const el = this.els.sceneTabs;
    const d = this.doc;
    el.innerHTML = '';
    el.hidden = !d || !d.pages.length;
    if (!d) return;
    // 장면 재생(▶/■)
    const play = h('button', {
      class: `scene-play${this.sliding ? ' on' : ''}`,
      type: 'button',
      title: this.sliding ? '장면 재생 멈추기' : '장면 재생: 장면을 전환 시간과 지연 시간마다 차례로 넘깁니다(3D를 누르거나 장면을 고르면 멈춤)',
      'aria-label': this.sliding ? '장면 재생 멈추기' : '장면 재생',
      'aria-pressed': this.sliding ? 'true' : 'false',
      html: icon(this.sliding ? 'stop' : 'play', 16),
    });
    play.addEventListener('click', () => this.toggleSlideshow());
    el.append(play);
    d.pages.forEach((pg, i) => {
      const on = d.page === i;
      const b = h(
        'button',
        { class: `scene-tab${on ? ' on' : ''}${pg.includeInAnimation === false ? ' no-play' : ''}`, type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', title: [pg.name, pg.description].filter(Boolean).join('\n') },
        pg.name || `장면 ${i + 1}`,
      );
      b.addEventListener('click', () => this.applyPage(i));
      el.append(b);
    });
    el.querySelector<HTMLElement>('.scene-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** 이전·다음 장면(PageUp·PageDown) */
  stepPage(delta: 1 | -1): void {
    const d = this.doc;
    if (!d || !d.pages.length) return;
    const next = stepPage(d.pages.length, d.page, delta);
    if (next !== null) this.applyPage(next);
  }

  /** 파일 단면 적용(null = 끔). 코어 단면은 평면 하나라 그룹 안 단면도 모형 전체를 자른다 */
  setFileSection(index: number | null): void {
    const d = this.doc;
    const v = this.viewer;
    if (!d || !v) return;
    const sp = index === null ? null : d.sectionPlanes.find((p) => p.index === index);
    const s = sp ? sectionToViewer(sp.plane) : null;
    if (s) v.setSection(s, { caps: this.caps });
    else v.setSection(null);
    d.fileSection = s ? index : null;
    this.refreshAnnotations();
    this.panel.rerender();
    this.refreshToolbar();
  }

  /** 고른 것을 숨긴다(보기에서만 — 파일은 바꾸지 않는다) */
  hideSelection(): void {
    const d = this.doc;
    const sel = d?.selection;
    if (!d || !sel) return;
    if (sel.kind === 'outline') this.setOutlineVisible(sel.index, false);
    else if (sel.kind === 'node') this.setNodeVisible(sel.index, false);
    else return;
    this.applySelection(null, false);
  }

  /** 고른 그룹·컴포넌트만 보이게 한다(같은 경로의 다른 항목을 모두 숨긴다). 다시 부르면 모두 보이기 */
  isolateSelection(): void {
    const d = this.doc;
    const sel = d?.selection;
    if (!d || !sel) return;
    if (this.isolatedOn) {
      this.unhideAll();
      return;
    }
    const node = selectedNode(d, sel);
    const t = d.tree;
    if (t && node !== null && node >= 0) {
      const path = nodePath(t, node);
      // 뿌리 단계: 다른 윗단계 노드와 바로 놓인 형상
      for (let i = 0; i < t.rootCount; i++) if (i !== path[0] && canHideNode(d, i)) d.hiddenNodes.add(i);
      for (let k = 1; k < path.length; k++) for (const c of childrenOf(t, path[k - 1]!)) if (c !== path[k] && canHideNode(d, c)) d.hiddenNodes.add(c);
      d.outline.forEach((r, i) => {
        if (r.kind === 'loose') d.hiddenOutline.add(i);
      });
    } else if (sel.kind === 'outline') {
      d.outline.forEach((_, i) => {
        if (i !== sel.index) d.hiddenOutline.add(i);
      });
    } else return;
    this.isolatedOn = true;
    this.refreshItemVisibility();
    this.panel.refreshVisibility();
    this.refreshAnnotations();
    this.refreshToolbar();
  }

  /** 숨긴 그룹·컴포넌트를 모두 보인다(태그는 그대로) */
  unhideAll(): void {
    const d = this.doc;
    if (!d) return;
    d.hiddenNodes.clear();
    d.hiddenOutline.clear();
    this.isolatedOn = false;
    this.refreshItemVisibility();
    this.panel.refreshVisibility();
    this.refreshAnnotations();
    this.refreshToolbar();
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
    // 점 묶음(보조점)은 주석 켜고 끄기만 따른다
    for (const p of d.scene.points ?? []) {
      const k = d.annotationKind.get(p.id);
      v.setItemVisible(p.id, !k || annotationShown(d, k));
    }
    // 나누지 않은 깊은 노드 숨김: 항목마다 구간을 합쳐 한 번에 넘기고, 더는 숨길 것이 없는 항목은 푼다
    this.hiddenRanges = hiddenNodeRanges(d);
    // 장면이 다시 보이게 한 숨김 개체: 반투명 숨긴 형상은 숨긴다(보통 색 그림과 겹치지 않게)
    for (const [item, list] of revealGhostRanges(d)) {
      const cur = this.hiddenRanges.get(item);
      this.hiddenRanges.set(item, cur ? normalizeRanges([...cur, ...list]) : list);
    }
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

  /** 문자·치수 라벨을 보이기 상태(태그·숨긴 노드·켜고 끄기)에 맞춰 다시 그린다 */
  private refreshAnnotations(): void {
    const d = this.doc;
    const l = this.labels;
    if (!d || !l) return;
    const hiddenTags = new Set(d.tags.filter((t) => tagHidden(d, t.name)).map((t) => t.name));
    const sec = this.viewer?.section ?? null;
    l.setFilter({
      texts: d.showTexts,
      dimensions: d.showDimensions,
      hiddenTags,
      isNodeHidden: (n) => nodeHiddenForLabels(d, n),
      showHidden: d.showHidden,
      section: sec ? { normal: sec.normal, offset: sec.offset } : null,
    });
  }

  closePanel(): void {
    this.setPanelOpen(false);
  }

  /**
   * 패널을 선택 탭으로 연다(고른 것 카드의 "자세히"). 좁은 화면은 아래 시트가 3D 보기를 줄이므로,
   * 바뀐 높이에서 고른 것이 가려지지 않게 그것에 맞춰 본다
   */
  private showEntityTab(): void {
    const d = this.doc;
    if (!d) return;
    d.panelTab = 'entity';
    this.panel.show(d);
    this.setPanelOpen(true);
    if (this.narrow) requestAnimationFrame(() => requestAnimationFrame(() => this.zoomToSelection()));
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
    // X-ray·와이어프레임은 형상이 글을 가리지 않는다
    this.labels?.resetOcclusion();
    this.refreshToolbar();
  }

  /**
   * 라벨 가림: 음영 방식에서 라벨 기준점의 화면 자리에서 고른 형상(불투명 면, 또는 면에 붙은 모서리 — 코어는 선을 면보다 앞세운다)이
   * 기준점보다 앞에 있으면 가렸다. 단면에 잘린 쪽·숨긴 항목은 코어가 고르지 않는다. 반투명 면(유리)과 주석 선(치수선·지시선)은 가리지 않는다
   */
  private labelOccluded(p: readonly number[], x: number, y: number, f: ViewFrame): boolean {
    const v = this.viewer;
    const d = this.doc;
    if (!v || !d || (this.renderMode !== 'shaded' && this.renderMode !== 'shadedEdges')) return false;
    const hit = v.pick(x, y);
    if (!hit || hit.section || hit.kind === 'point') return false;
    if (hit.kind === 'mesh') {
      const k = d.meshIndex.get(hit.id);
      const mesh = k === undefined ? undefined : d.scene.meshes[k];
      if (!mesh || mesh.color[3] < 0.999) return false;
    } else if (d.annotationKind.has(hit.id) || d.extras?.soft.has(hit.id)) return false;
    const b = d.scene.bounds;
    const diag = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 0;
    return occludedBy(f, p, hit.point, diag * 0.002);
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

  /** 줄자 켜고 끄기 */
  toggleMeasure(on = this.measureTool?.mode !== 'tape'): void {
    this.setMeasureMode(on ? 'tape' : null);
  }

  /** 각도기 켜고 끄기 */
  toggleProtractor(on = this.measureTool?.mode !== 'protractor'): void {
    this.setMeasureMode(on ? 'protractor' : null);
  }

  private setMeasureMode(mode: MeasureMode | null): void {
    const t = this.measureTool;
    if (!t || !this.doc) return;
    t.setMode(mode);
    if (!mode) this.doc.measure = null;
    this.panel.refreshSelection();
    this.refreshToolbar();
    this.refreshStatus();
  }

  // ───────────────────────── 단면 ─────────────────────────

  /** 단면 축 고르기(null = 끔). 같은 축이면 위치는 그대로, 새 축이면 가운데 */
  setSectionAxis(axis: SectionAxis | null): void {
    const v = this.viewer;
    if (!v || !this.doc) return;
    // 축 단면은 파일 단면을 대신한다
    this.doc.fileSection = null;
    if (!axis) v.setSection(null);
    else {
      const cur = v.section;
      v.setSectionAxis(axis, cur && cur.axis === axis ? cur.t : 0.5, { caps: this.caps, outline: true, plane: true });
    }
    this.refreshToolbar();
  }

  flipSection(): void {
    this.viewer?.flipSection();
    this.refreshToolbar();
  }

  /** 잘린 면 채우기(닫힌 입체만): 처음엔 파일 스타일을 따르고, 사용자가 켜고 끈다 */
  private sectionFill = true;

  /** 코어 단면 채우기 선택 */
  private get caps(): 'closed' | 'none' {
    return this.sectionFill ? 'closed' : 'none';
  }

  setSectionFill(on: boolean): void {
    this.sectionFill = on;
    this.applySectionFill();
    this.refreshToolbar();
  }

  /** 지금 단면 평면 모두에 채우기 선택을 다시 건다 */
  private applySectionFill(): void {
    const v = this.viewer;
    if (!v) return;
    v.sections.forEach((_, i) => v.setSectionOptions({ caps: this.caps }, i));
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
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // 뷰 큐브를 끌어 돌린 뒤 등(움직였다고 적지 않은 경우)에도 넓힌 시야각으로 전체 보기를 하지 않게
          this.unwidenScene();
          this.viewer?.fit(false);
        }),
      );
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

  /** 그림 저장 창(크기·투명 배경·글 넣기, 저장·공유·인쇄). 이미 열려 있으면 닫는다 */
  savePng(): void {
    if (!this.viewer || !this.doc) return;
    const x = this.exportDialog;
    if (!x) return;
    if (x.isOpen) x.close();
    else {
      this.closeMenu();
      x.open();
    }
  }

  /** 그림 내보내기 맥락: 뷰어·덧그림·라벨과 3D 테마 밝기(투명 배경 두 장은 배경만 바꾼다) */
  private exportContext(): ExportContext | null {
    const v = this.viewer;
    if (!v || !this.doc) return null;
    const bg = this.backdrop;
    return {
      viewer: v,
      overlay: this.overlay,
      labels: this.labels,
      base: bg ? (isLightBackground(bg) ? 'light' : 'dark') : this.theme,
      restoreTheme: () => this.applyTheme(),
    };
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

  /** 좁은 화면의 단면 메뉴: 끔 · X · Y · Z · 뒤집기(넓은 화면은 도구 막대 단추) */
  private toggleSectionMenu(): void {
    const btn = this.els.secMenuBtn;
    if (this.menu) {
      const same = this.menuBtn === btn;
      this.closeMenu();
      if (same) return;
    }
    const v = this.viewer;
    if (!v || !this.doc) return;
    const sec = v.section;
    this.openMenu(btn, '단면 보기', [
      { label: '단면 보기 끄기', checked: !sec, run: () => this.setSectionAxis(null) },
      ...(['x', 'y', 'z'] as const).map((a) => ({
        label: `${a.toUpperCase()}축에 수직인 단면(+${a.toUpperCase()} 쪽을 잘라 냄)`,
        checked: sec?.axis === a,
        run: () => this.setSectionAxis(a),
      })),
      { label: '자르는 쪽 뒤집기', icon: 'flip', sep: true, disabled: !sec, run: () => this.flipSection() },
      { label: '잘린 면 채우기', checked: this.sectionFill, toggle: true, run: () => this.setSectionFill(!this.sectionFill) },
    ]);
  }

  /** 좁은 화면의 보기 설정 메뉴: 넓은 화면 도구 막대에만 있는 단추(이전·다음 보기, 투영, 그리기 방식, 격자·뷰 큐브·좌표축, PNG) */
  private toggleMoreMenu(): void {
    const btn = this.els.moreBtn;
    if (this.menu) {
      const same = this.menuBtn === btn;
      this.closeMenu();
      if (same) return;
    }
    if (!this.viewer || !this.doc) return;
    this.openMenu(btn, '보기 설정', [
      { label: '이전 보기', icon: 'back', disabled: !this.history.canBack(), run: () => this.viewBack() },
      { label: '다음 보기', icon: 'forward', disabled: !this.history.canForward(), run: () => this.viewForward() },
      { label: '원근 투영', checked: this.projection === 'perspective', sep: true, run: () => this.setProjection('perspective') },
      { label: '평행 투영', checked: this.projection === 'orthographic', run: () => this.setProjection('orthographic') },
      ...RENDER_MODES.map(([m, label], i): MenuItem => ({ label, checked: this.renderMode === m, sep: i === 0, run: () => this.setRenderMode(m) })),
      { label: '격자', checked: this.gridOn, toggle: true, sep: true, run: () => this.toggleGrid() },
      { label: '뷰 큐브', checked: this.cubeOn, toggle: true, run: () => this.toggleCube() },
      { label: '좌표축', checked: this.axesOn, toggle: true, run: () => this.toggleAxes() },
      { label: '파일 배경 색', checked: this.fileBg, toggle: true, run: () => this.setFileBackground(!this.fileBg) },
      { label: '그림 저장…', icon: 'image', sep: true, run: () => this.savePng() },
    ]);
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
      '앱 설정',
      [...THEME_CHOICES.map((c) => ({
        label: c.choice === 'system' ? `${c.label}(지금 ${systemPrefersDark() ? '어두움' : '밝음'})` : c.label,
        icon: c.icon,
        checked: c.choice === cur,
        run: () => this.setThemeChoice(c.choice),
      })), { label: '방문 통계 설정', icon: 'lock', run: showAnalyticsSettings }],
    );
  }

  private menuBtn: HTMLButtonElement | null = null;

  private openMenu(btn: HTMLButtonElement, label: string, items: MenuItem[]): void {
    const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label });
    for (const it of items) {
      if (it.sep && menu.firstChild) menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      const role = it.checked === undefined ? 'menuitem' : it.toggle ? 'menuitemcheckbox' : 'menuitemradio';
      const item = h(
        'button',
        { class: `menu-item${it.checked ? ' checked' : ''}`, type: 'button', role, disabled: !!it.disabled, 'aria-checked': it.checked === undefined ? null : it.checked ? 'true' : 'false' },
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
      const list = [...menu.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)')];
      const i = list.indexOf(document.activeElement as HTMLElement);
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    });
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    menu.style.top = `${r.bottom + 4}px`;
    // 낮은 화면(휴대폰 가로 등)에서는 창 안에서 굴린다
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - r.bottom - 12)}px`;
    this.menu = menu;
    this.menuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    ((menu.querySelector('.menu-item.checked') ?? menu.querySelector('.menu-item:not(:disabled)')) as HTMLElement | null)?.focus();
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
    this.unwidenScene();
    this.viewer?.setView(v);
  }

  // ───────────────────────── 키 ─────────────────────────

  private onKey(ev: KeyboardEvent): void {
    if (this.sliding && !['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) this.stopSlideshow();
    if (this.menu && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      const btn = this.menuBtn;
      this.closeMenu();
      btn?.focus();
      return;
    }
    const v = this.viewer;
    const tool = this.measureTool;
    if (tool?.active && !isEditableTarget(ev.target)) {
      if (tool.handleKey(ev)) {
        ev.stopPropagation();
        return;
      }
      // 지울 것이 없는 Esc: 도구를 끈다
      if (ev.key === 'Escape' && !this.busy) {
        ev.preventDefault();
        ev.stopPropagation();
        this.setMeasureMode(null);
        return;
      }
    }
    const act = keyAction({
      key: ev.key,
      ctrl: ev.ctrlKey,
      meta: ev.metaKey,
      alt: ev.altKey,
      editable: isEditableTarget(ev.target),
      hasDoc: !!this.doc && !!v && !this.busy,
      measurePoints: tool?.pointCount ?? 0,
      measureMode: !!tool?.active,
      busy: this.busy,
      hasPages: !!this.doc?.pages.length,
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
    if (act.kind === 'page') {
      ev.preventDefault();
      ev.stopPropagation();
      this.stepPage(act.delta);
      return;
    }
    if (act.kind === 'tape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.toggleMeasure();
      return;
    }
    // F·1~7·Esc(측정 지우기)는 뷰어 규칙대로. 캡처 단계에서 처리했으면 캔버스의 같은 키 처리까지 가지 않게 막는다.
    // 전체 보기·표준 뷰 키는 그 전에 넓힌 시야각을 되돌린다
    if (isViewKey({ key: ev.key, ctrl: ev.ctrlKey, meta: ev.metaKey, alt: ev.altKey })) this.unwidenScene();
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

  /** 3D 보기에 쓰는 파일 배경(설정이 꺼졌거나 스타일에 없으면 null) */
  private get backdrop(): Rgb | null {
    return this.fileBg && this.doc ? this.styleBg : null;
  }

  /** 파일·장면 스타일의 배경 색으로 볼지(기억한다) */
  setFileBackground(on: boolean): void {
    this.fileBg = on;
    storeFileBackground(safeStorage(), on);
    this.applyTheme();
    this.refreshToolbar();
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.theme === 'dark' ? '#1b2027' : '#f4f5f7');
    this.viewer?.setTheme(viewerTheme(this.theme, this.backdrop));
    if (this.els) {
      const choice = themeChoiceOf(this.themeStored);
      const label = THEME_CHOICES.find((c) => c.choice === choice)!.label;
      const b = this.els.themeBtn;
      b.innerHTML = `${icon(choice === 'system' ? 'system' : this.theme === 'dark' ? 'moon' : 'sun')}<span class="lbl">설정</span>`;
      b.title = `앱 설정 · 테마: ${label}${choice === 'system' ? `(지금 ${this.theme === 'dark' ? '어두움' : '밝음'})` : ''} — 눌러서 바꾸기`;
      b.setAttribute('aria-label', '앱 설정');
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
    press(e.bgBtn, this.fileBg);
    press(e.cubeBtn, this.cubeOn);
    press(e.axesBtn, this.axesOn);
    press(e.measureBtn, this.measureTool?.mode === 'tape');
    press(e.protractorBtn, this.measureTool?.mode === 'protractor');
    press(e.panelBtn, this.panelOpen && has);
    e.backBtn.disabled = !has || !this.history.canBack();
    e.fwdBtn.disabled = !has || !this.history.canForward();
    const sec = this.viewer?.section ?? null;
    for (const [k, b] of e.secBtns) press(b, k === 'off' ? !sec : sec?.axis === k);
    press(e.secMenuBtn, !!sec);
    // 파일 단면(축이 아닌 평면)은 표시 글 없이 눌림만
    e.secBadge.hidden = !sec?.axis;
    e.secBadge.textContent = sec?.axis ? sec.axis.toUpperCase() : '';
    e.secRange.parentElement?.classList.toggle('sec-on', !!sec);
    e.secRange.disabled = !has || !sec;
    e.secFlip.disabled = !has || !sec;
    press(e.secFlip, !!sec?.flip);
    e.secFill.disabled = !has || !sec;
    press(e.secFill, this.sectionFill);
    if (sec) e.secRange.value = String(Math.round(Math.min(1, Math.max(0, sec.t)) * 1000));
  }

  private refreshStatus(): void {
    const e = this.els;
    if (!e) return;
    const d = this.doc;
    if (!d) {
      e.stMain.textContent = '파일을 열면 여기에 모형 정보가 보입니다 · SketchUp 6~2026(.skp)';
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
    let sel = '';
    if (d.measure) sel = measureText(d.measure, d.units, mmPerSceneUnit(d.scene.units));
    else if (this.measuring) sel = this.measureHint ?? '측정: 점을 누르세요';
    else {
      const t = selectionText(d, d.selection, d.pick);
      if (t) sel = `고른 것: ${t}`;
    }
    e.stSel.textContent = sel;
    e.stSel.title = sel;
    this.refreshMeasureBar();
    this.refreshSelBar();
  }

  /** 고른 것 카드: 측정 중이 아니고 패널이 닫혀 있을 때, 고른 그룹·컴포넌트·재질의 이름과 크기·태그 */
  private refreshSelBar(): void {
    const e = this.els;
    const d = this.doc;
    const on = !!d && !!d.selection && !this.measuring && !this.panelOpen;
    e.selBar.hidden = !on;
    if (!on || !d) return;
    const info = entityInfo(selectionEntity(d), d.units, mmPerSceneUnit(d.scene.units));
    const name = cardName(info);
    // 이름·태그 같은 파일 글은 번역하지 않는다
    const head = h('b', { class: 'mb-value' }, info.title, name ? h('span', { class: 'mb-name', 'data-i18n-skip': '' }, name) : null);
    const facts = cardRows(info).map((r) => h('span', { class: 'mb-fact' }, h('span', { class: 'mb-k' }, r.label), h('span', { 'data-i18n-skip': '' }, r.value)));
    e.selText.replaceChildren(head, ...(facts.length ? [h('span', { class: 'mb-sub' }, ...facts)] : []));
    const part = partOfPick(d);
    e.selPart.hidden = !part;
    const label = e.selPart.querySelector('.mb-part');
    if (label) label.textContent = part === 'edge' ? '모서리만' : '면만';
    e.selPart.title = part === 'edge' ? '누른 모서리 하나의 길이(곡선이면 곡선 전체)만 보기' : '누른 면 하나의 넓이만 보기';
  }

  /** 측정 띠: 결과(거리와 축별 길이·각도)나 다음에 누를 곳 안내 */
  private refreshMeasureBar(): void {
    const e = this.els;
    const d = this.doc;
    const tool = this.measureTool;
    const on = !!d && !!tool?.active;
    e.measureBar.hidden = !on;
    if (!on || !d || !tool) return;
    const t = e.measureText;
    t.replaceChildren();
    if (d.measure) {
      const mm = mmPerSceneUnit(d.scene.units);
      const axes = measureAxes(d.measure, d.units, mm);
      t.append(h('b', { class: 'mb-value' }, measureText(d.measure, d.units, mm)));
      // 축마다 한 덩어리로 줄을 바꾼다("dz ~" / "-171 mm"로 갈리지 않게)
      if (axes) t.append(h('span', { class: 'mb-sub' }, ...axes.split(' · ').map((x) => h('span', { class: 'mb-fact mb-axis' }, x))));
    } else t.append(h('span', { class: 'mb-hint' }, this.measureHint ?? ''));
    e.measureClear.disabled = !d.measure && !tool.pointCount;
    e.measureCopy.disabled = !d.measure;
    e.measureLogBtn.disabled = !this.measureLog.length;
    e.measureLogBtn.title = this.measureLog.length ? `최근 측정 기록 ${this.measureLog.length}개` : '최근 측정 기록';
    if (!this.measureLog.length) e.measureLog.hidden = true;
    this.renderMeasureLog();
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
      camera: this.viewer?.getCamera() ?? null,
      pages: d?.pages.length ?? 0,
      page: d?.page ?? null,
      fileSection: d?.fileSection ?? null,
      hiddenTags: d ? d.tags.filter((t) => tagHidden(d, t.name)).map((t) => t.name) : [],
      hiddenNodes: d?.hiddenNodes.size ?? 0,
      labels: this.labels?.size ?? 0,
      labelsOccluded: this.labels?.occludedCount ?? 0,
      measureMode: this.measureTool?.mode ?? null,
      selectionKind: d?.selection?.kind ?? null,
      slideshow: this.sliding,
      fileBackground: this.fileBg,
      background: this.backdrop ? cssHex(this.backdrop) : null,
      sectionFill: this.sectionFill,
    };
  }

  get viewer3d(): Viewer3d | null {
    return this.viewer;
  }

  /** 처음 주소 인자 처리 */
  async launch(req: LaunchRequest): Promise<void> {
    if (req.kind === 'sample') await this.openSample();
    else if (req.kind === 'url') await this.openUrl(req.url, req.name);
    else if (req.kind === 'shared') await this.openShared(req.key);
    else if (req.kind === 'error') this.showNotice('error', '주소의 파일을 열 수 없습니다', req.message);
  }

  /** 홈 화면 앱이 공유 받은 파일(서비스 워커가 이 브라우저의 최근 문서에 넣었다)을 연다. 주소의 ?shared는 지운다(다시 읽어도 또 열지 않게) */
  async openShared(key: string): Promise<void> {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('shared');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch {
      /* 주소를 못 바꾸면 그대로 */
    }
    if (key === ':none' || key === ':error') {
      this.showNotice(
        'error',
        '공유 받은 파일을 열지 못했습니다',
        key === ':none' ? '공유에 파일이 없었습니다. .skp 파일을 공유해 주세요.' : '이 브라우저에 파일을 저장하지 못했습니다(저장 공간 부족·비공개 창 등). 파일을 저장한 뒤 "열기"로 골라 주세요.',
      );
      return;
    }
    const name = nameOfRecentId(key);
    if (!key.startsWith('shared:')) {
      await this.openRecent({ id: key, name });
      return;
    }
    // 60 MB보다 커서 최근 목록에 넣지 않은 파일: 한 번 꺼내 열고 지운다
    const attempt = beginOpen('local', 'skp');
    const seq = ++this.openSeq;
    this.setBusy(name, 0.005, '파일 읽는 중');
    const data = await this.recent.take(key);
    if (seq !== this.openSeq) return;
    if (!data) {
      this.setBusy(null);
      attempt.error('read_error');
      this.showNotice('error', `"${name}" 파일을 찾지 못했습니다`, '공유 받은 사본이 지워졌습니다. 다시 공유하거나 "열기"로 골라 주세요.');
      return;
    }
    await this.openBuffer(name, data, seq, attempt);
  }

  /** 새 판 알림(서비스 워커): 새로 고치면 새 판으로 다시 읽는다(열어 둔 파일은 최근 문서에서 다시 연다) */
  offerUpdate(apply: () => void): void {
    const n = this.els.updateBar;
    n.hidden = false;
    const ok = n.querySelector<HTMLButtonElement>('.upd-apply')!;
    ok.onclick = () => {
      ok.disabled = true;
      apply();
    };
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
