/**
 * 해석기가 Scene3d.meta에 더 적는 것의 꼴(화면과 해석기의 계약). 모두 선택 칸이다 — 파일에 없거나 읽지 못하면 넣지 않는다.
 *
 * 좌표는 장면 좌표(세계, Scene3d.units 단위, 그물 origin을 더한 값)다. 색은 0~1 RGB(A).
 * "노드"는 meta.tree의 노드 차례(모형 바로 아래 요소는 -1)다.
 * 이 꼴의 형식 지식(꼬리표·뜻)은 PRISME 엔진(prisme-engine io/skp/native)의 SketchUp 2021+ 해석기와 문서에서 옮겼다.
 */

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

/** 단위 표시 설정(UnitsOptions) — 앱 src/app/units.ts의 UnitsDisplay와 같은 꼴 */
export interface SkpUnitsMeta {
  lengthUnit: 'inch' | 'feet' | 'yard' | 'mm' | 'cm' | 'm';
  lengthFormat: 'decimal' | 'architectural' | 'engineering' | 'fractional';
  lengthPrecision: number;
  anglePrecision: number;
  /** 'square_inch' · 'square_feet' · 'square_mm' · 'square_cm' · 'square_m' · 'square_yard' (없으면 null) */
  areaUnit: string | null;
  areaPrecision: number | null;
  /** 'cubic_*' · 'liter' · 'us_gallon' (없으면 null) */
  volumeUnit: string | null;
  volumePrecision: number | null;
  suppressUnits: boolean;
}

/** 카메라(장면 좌표). SketchUp의 위 벡터는 시선과 직교로 저장된다 */
export interface SkpCameraMeta {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  perspective: boolean;
  /** 세로 시야각(도), 원근만 */
  fovY?: number;
  /** 평행 투영 화면 전체 높이(장면 단위), 평행만 */
  height?: number;
  /** 고정 종횡비(없으면 창을 따름) */
  aspect?: number;
  twoPoint?: boolean;
}

/** 면 스타일 */
export type SkpFaceStyle = 'wireframe' | 'hiddenLine' | 'shaded' | 'textured' | 'monochrome';

/** 스타일(렌더링 설정 + style.xml을 합친 값). 모르는 값은 빠진다 */
export interface SkpStyleMeta {
  name?: string;
  faceStyle?: SkpFaceStyle;
  /** X-ray(ModelTransparency) */
  xray?: boolean;
  /** 모서리 보이기(EdgeDisplayMode) */
  edges?: boolean;
  profiles?: boolean;
  /** 윤곽선 굵기(화소, SilhouetteWidth) */
  profileWidth?: number;
  backEdges?: boolean;
  background?: Rgb;
  /** 하늘·지면(켜져 있을 때만 색, 꺼져 있으면 null) */
  sky?: Rgb | null;
  ground?: Rgb | null;
  front?: Rgb;
  back?: Rgb;
  edgeColor?: Rgb;
  hiddenGeometry?: boolean;
  hiddenObjects?: boolean;
  axes?: boolean;
  texts?: boolean;
  dimensions?: boolean;
  guides?: boolean;
  sectionPlanes?: boolean;
  sectionCuts?: boolean;
  sectionFill?: boolean;
  colorByTag?: boolean;
  /** 안개 켜짐(DisplayFog)·색(FogColor, 배경 색을 쓰면 fogUseBackground)·시작·끝 거리(장면 단위, −1 = SketchUp 기본 — 모형 크기를 따름) */
  fog?: boolean;
  fogColor?: Rgb;
  fogUseBackground?: boolean;
  fogStart?: number;
  fogEnd?: number;
}

/**
 * 위치·그림자 설정(Model Info > 위치, 그림자 창 — 엔진 SkpShadowInfo). time은 그곳 시각을 UTC 초처럼 적은 것(시간대 tz를 빼면 실제 UTC).
 * north는 모형 축에서 북쪽 방향((0, 1, 0) = 북쪽 각 0). 읽지 못한 칸은 빠진다(2020 이하는 켜고 끄기 깃발이 없다)
 */
export interface SkpShadowMeta {
  time?: number;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  tz?: number;
  north?: Vec3;
  light?: number;
  dark?: number;
  display?: boolean;
  onFaces?: boolean;
  onGround?: boolean;
  useSun?: boolean;
}

/** 모형 위치(정보 탭): 그림자 설정의 도시·나라·위경도·시간대·북쪽과, 모형이 지리 참조를 쓰는지(GeoReference.UsesGeoReferencing) */
export interface SkpLocationMeta {
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  tz?: number;
  /** 북쪽 각(도, 초록 축에서 빨강 축 쪽으로) */
  northAngle?: number;
  georeferenced: boolean;
}

/** 그리기 축(원점은 장면 단위, 축은 단위 벡터). 기본 축이면 없다 */
export interface SkpAxesMeta {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/** 장면(페이지). 각 칸은 그 장면이 그 속성을 기억할 때만 있다(use 깃발) */
export interface SkpPageMeta {
  name: string;
  description?: string;
  camera?: SkpCameraMeta;
  /** 이 장면에서 숨긴 태그 이름(숨긴 태그를 기억하는 장면만) */
  hiddenTags?: string[];
  /** 숨길 나무 노드(숨긴 개체를 기억하는 장면만). 정의 안 인스턴스 하나를 숨기면 그 정의가 놓인 모든 자리의 노드 */
  hiddenNodes?: number[];
  /** 활성 단면(meta.sectionPlanes 차례, 단면을 기억하는 장면만) */
  sectionPlanes?: number[];
  style?: SkpStyleMeta;
  /** 전환·지연 시간(초) */
  transition?: number;
  delay?: number;
  /** 장면 미리보기 그림의 ZIP 경로(readSkpImages의 scenes[].name과 같음) */
  thumbnail?: string;
  /** 장면 재생(슬라이드 쇼)에서 뺀 장면이면 false(넣는 장면은 칸이 없다) */
  includeInAnimation?: boolean;
  /** 이 장면이 기억하는 그림자 설정 */
  shadow?: SkpShadowMeta;
}

/** 태그 폴더 */
export interface SkpTagFolderMeta {
  name: string;
  visible: boolean;
  /** 부모 폴더 차례(-1 = 뿌리 바로 아래) */
  parent: number;
}

export interface SkpFontMeta {
  face: string;
  pointSize?: number;
  bold: boolean;
  italic: boolean;
  /** 세계 크기 글의 높이(장면 단위). 없으면 화면 크기(pointSize) */
  worldHeight?: number;
}

export type SkpArrowMeta = 'none' | 'slash' | 'dot' | 'closed' | 'open';

/** 문자(배치마다 하나) */
export interface SkpTextMeta {
  text: string;
  /** 붙는 점(세계). 화면 고정 글이면 없다 */
  point?: Vec3;
  /** 지시선 글의 글 자리(세계, = 붙는 점 + 지시선 벡터) */
  textPoint?: Vec3;
  leaderType: 'none' | 'view_based' | 'pushpin';
  /** 화면 고정 글: 화면 비율 0~1(왼쪽 위 원점) */
  screen?: [number, number];
  arrow?: SkpArrowMeta;
  font?: SkpFontMeta;
  color?: Rgb;
  /** 태그 이름 */
  tag: string;
  /** 요소 자신이나 감싼 인스턴스가 숨김 */
  hidden: boolean;
  /** 이 글이 든 배치의 나무 노드(-1 = 모형 바로 아래) */
  node: number;
}

/** 치수 글(배치마다 하나). 치수선·연장선·끝 표시는 meta.annotationItems.dimensions의 선분 묶음에 들어 있다 */
export interface SkpDimensionMeta {
  kind: 'linear' | 'radial' | 'diameter';
  /** 파일에 적힌 글(비었거나 '<>'가 들어 있으면 앱이 value로 채운다) */
  text: string;
  /** 잰 값(장면 단위: 선형은 길이, 반지름·지름은 그 길이) */
  value: number;
  /** 글 자리(세계) */
  textPoint: Vec3;
  /** 치수선 방향(세계 단위 벡터) — 글을 선에 맞춰 돌릴 때 */
  direction?: Vec3;
  alignedText?: boolean;
  font?: SkpFontMeta;
  color?: Rgb;
  tag: string;
  hidden: boolean;
  node: number;
}

/** 주석 선분 묶음 하나의 화면 크기 표시(meta.annotationMarks 한 칸). 표시 n개 */
export interface SkpAnnotationMarks {
  /** 표시마다 9개(세계): 끝점 xyz, 바깥 방향 xyz(단위 — 화살이 가리키는 쪽, 넘침은 이쪽으로 긋는다), 치수 평면에서 선에 수직 xyz(단위) */
  geom: Float64Array;
  /** 표시마다 꼴: 1 빗금 · 2 점 · 3 닫힌 화살 · 4 열린 화살 · 5 연장선 넘침 */
  kind: Uint8Array;
  /** 표시마다 그 표시가 붙은 선(치수선·지시선·반지름)의 세계 길이 — 화면에서 짧은 선은 표시를 줄인다 */
  span: Float64Array;
  /** 표시마다 놓인 나무 노드(-1 = 모형에 바로) — 숨긴 그룹·컴포넌트 안 표시는 숨긴다 */
  node: Int32Array;
}

/** 단면 평면(배치마다 하나). plane = [a, b, c, d]: a·x+b·y+c·z+d ≥ 0 쪽이 남는다(세계) */
export interface SkpSectionPlaneMeta {
  name: string;
  plane: [number, number, number, number];
  /** 그 요소 묶음의 활성 단면인지 */
  active: boolean;
  tag: string;
  hidden: boolean;
  /** 이 단면이 든 배치의 노드(-1 = 모형 단면 = 모형 전체를 자른다). 노드 단면은 그 노드 안쪽만 자른다 */
  node: number;
  /** 기호 사각형 반 크기(장면 단위) — 기호 선분은 annotationItems.sectionPlanes */
  size: number;
}

/** 주석을 그린 장면 항목 id(코어의 setItemVisible로 한꺼번에 켜고 끄기용, 묶음의 group = 태그 이름) */
export interface SkpAnnotationItems {
  /** 치수선(LineSet3d) */
  dimensions: string[];
  /** 지시선(LineSet3d) */
  leaders: string[];
  /** 보조선(LineSet3d, 점선)과 보조점(PointSet3d) */
  guides: string[];
  /** 단면 기호(LineSet3d) */
  sectionPlanes: string[];
}

/** 속성 사전 값(화면용으로 풀어 둔 글) */
export type SkpAttrValueMeta = string | number | boolean | null;
/** 사전 이름 → 열쇠 → 값 */
export type SkpAttrDictsMeta = Record<string, Record<string, SkpAttrValueMeta>>;

/** 나무 노드·정의의 더 많은 정보(meta.tree와 같은 차례) */
export interface SkpTreeInfo {
  /** 노드마다 인스턴스 GUID('' = 없음) */
  guid: string[];
  /** 노드마다 meta.attributes 차례(-1 = 없음) */
  attrs: Int32Array;
  /** 노드마다 정의 로컬 범위 크기 × 인스턴스 축 배율(가로·세로·높이, 장면 단위) — count×3 */
  size: Float32Array;
  /** 노드마다 그 안쪽 전부의 보통 면 넓이 합(세계, 장면 단위²) */
  area: Float64Array;
  /** 노드마다 잠김(인스턴스 깃발 0x20) */
  locked: Uint8Array;
  /** 정의마다(tree.definitionNames 차례) 설명·GUID·속성(meta.attributes 차례, -1 = 없음)·항상 카메라 보기 */
  definitionDescription: string[];
  definitionGuid: string[];
  definitionAttrs: Int32Array;
  /** 정의마다 항상 카메라 보기(동작 0x1B5D, 1 = 켜짐) */
  definitionFaceCamera?: Uint8Array;
  /**
   * 노드마다 SketchUp 입체(닫힌 껍질, 면 방향이 맞고 떠 있는 모서리·안쪽 그룹이 없음)면 부피(장면 단위³), 아니면 NaN.
   * 입체 노드가 하나도 없으면 칸이 없다
   */
  volume?: Float64Array;
}

/**
 * Scene3d.meta에 더하는 칸(SkpOptions에 따라). 기존 칸(version·lengthUnit·tagStats·materialStats·outline·tree·extraItems 등)은 그대로다.
 * tagStats 항목에는 visible(태그 자신의 보임)·color·folder(tagFolders 차례)·dashed(선 종류가 실선이 아님)·lineStyle이 더해진다.
 * materialStats·outline 항목에는 area(보통 면 넓이 합, 장면 단위²)가 더해진다.
 */
export interface SkpMetaExtras {
  units?: SkpUnitsMeta;
  camera?: SkpCameraMeta;
  pages?: SkpPageMeta[];
  /** 활성 장면(pages 차례) */
  activePage?: number;
  /** 모형 스타일 */
  style?: SkpStyleMeta;
  tagFolders?: SkpTagFolderMeta[];
  modelName?: string;
  modelDescription?: string;
  texts?: SkpTextMeta[];
  dimensions?: SkpDimensionMeta[];
  sectionPlanes?: SkpSectionPlaneMeta[];
  annotationItems?: SkpAnnotationItems;
  /**
   * 주석 선분 묶음(annotationItems의 선분 묶음 id)마다 나무 노드 구간: 선분 차례 start[k]부터 다음 구간 전까지가 노드 node[k](-1 = 모형에 바로) 안의 주석.
   * 나무(outline)가 있고 그룹·컴포넌트 안에 주석이 있을 때만. 화면은 숨긴 노드의 구간을 숨긴다(문자·치수 라벨과 같게)
   */
  annotationRuns?: Record<string, { start: Uint32Array; node: Int32Array }>;
  /**
   * 치수·지시선 선분 묶음(annotationItems의 id)마다 화면 크기로 그릴 끝 표시(화살·빗금·점)와 연장선 넘침. 선분 묶음에는 선만 있고,
   * 화면은 이 표시를 그 묶음이 보일 때(같은 태그·숨김·노드·단면) 덧그림 층에 같은 화소 크기로 그린다(확대·축소해도 크기가 그대로)
   */
  annotationMarks?: Record<string, SkpAnnotationMarks>;
  /**
   * 그물마다(scene.meshes 차례) 면 경계: 면 k의 삼각형은 [runs[k], runs[k + 1])(마지막 면은 그물 끝까지).
   * 해석기가 면마다 삼각형을 이어 붙이므로 고른 삼각형(Pick3d.raw)이 든 SketchUp 면 하나를 구간으로 찾는다
   */
  faceRuns?: Uint32Array[];
  /** 모서리 묶음마다(scene.lines 차례) 선분의 놓인 곡선 번호(-1 = 곡선 아님, 같은 수 = 같은 곡선의 한 배치). 곡선이 없는 묶음·주석은 null */
  segmentCurves?: (Int32Array | null)[];
  /** 위치(정보 탭)·그림자 설정·그리기 축 */
  location?: SkpLocationMeta;
  shadow?: SkpShadowMeta;
  axes?: SkpAxesMeta;
  /** Model Info > Animation: 장면 재생을 되풀이할지(loop) */
  animation?: { loop?: boolean };
  /**
   * 모형에서 숨겼지만 어떤 장면(숨긴 개체를 기억하는)에서는 보이는 인스턴스: 나무 노드마다 그 안쪽을 보통 색으로 따로 그린 항목 id.
   * 화면은 처음에 숨기고, 그 노드를 숨기지 않는 장면을 고르면 보인다(숨긴 형상 보기의 반투명 그물과는 따로)
   */
  revealItems?: { node: number; ids: string[] }[];
  /** 속성 사전 모음(같은 것은 한 번만): 모형 속성은 modelAttrs 차례 */
  attributes?: SkpAttrDictsMeta[];
  modelAttrs?: number;
  treeInfo?: SkpTreeInfo;
}
