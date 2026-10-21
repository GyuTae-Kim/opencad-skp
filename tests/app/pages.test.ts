import { describe, expect, it } from 'vitest';
import { DEFAULT_FOV, cameraBasis, cameraEye, computeFrame, projectToScreen, type CameraState } from 'opencad-viewer3d/camera';
import type { SkpCameraMeta, SkpPageMeta } from '../../src/meta';
import {
  DEFAULT_TRANSITION_S,
  MAX_TRANSITION_S,
  PORTRAIT_MAX_FOV_DEG,
  SCENE_REF_ASPECT,
  baseFovOf,
  cameraFromSkp,
  cameraShowsBox,
  delaySeconds,
  eyeHeightFor,
  isTwoPoint,
  rollFromUp,
  twoPointCamera,
  withFov,
  fitSceneCamera,
  effectiveTagHidden,
  folderHiddenTags,
  initialCamera,
  activeSections,
  initialSection,
  initialSections,
  initialView,
  openingPage,
  pagePlan,
  pickSection,
  readActivePage,
  readPages,
  refitSceneCamera,
  renderModeForStyle,
  restoreSceneCamera,
  sameSceneFit,
  sameSkpCamera,
  sceneCoverageScale,
  sectionFillOf,
  sectionToViewer,
  stepPage,
  transitionCamera,
  transitionProgress,
  transitionSeconds,
  unwidenSceneCamera,
  widenFov,
} from '../../src/app/pages';

const close = (a: readonly number[], b: readonly number[], eps = 1e-6): void => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));
};

const cam = (o: Partial<SkpCameraMeta>): SkpCameraMeta => ({ eye: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], perspective: true, ...o });
const box = { min: [-10, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };

describe('SketchUp 카메라 → 코어 카메라', () => {
  it('원근: 눈·목표·세로 시야각을 그대로 지킨다', () => {
    const c = cameraFromSkp(cam({ eye: [120, -150, 90], target: [20, 15, 10], fovY: 40 }))!;
    expect(c.projection).toBe('perspective');
    close(c.target, [20, 15, 10]);
    close(cameraEye(c), [120, -150, 90], 1e-6);
    expect(c.fovY).toBeCloseTo((40 * Math.PI) / 180, 12);
  });

  it('원근 시야각이 없으면 35°, 범위 밖은 1°~120°로 묶는다', () => {
    expect(cameraFromSkp(cam({}))!.fovY).toBeCloseTo((35 * Math.PI) / 180, 12);
    expect(cameraFromSkp(cam({ fovY: 150 }))!.fovY).toBeCloseTo((120 * Math.PI) / 180, 12);
    expect(cameraFromSkp(cam({ fovY: 0.2 }))!.fovY).toBeCloseTo(Math.PI / 180, 12);
  });

  it('평행: 화면 전체 높이가 같게 거리를 맞추고, 높이가 없으면 대상점 깊이의 원근 높이로', () => {
    const fov = (30 * Math.PI) / 180;
    const c = cameraFromSkp(cam({ perspective: false, height: 80 }), fov)!;
    expect(c.projection).toBe('orthographic');
    expect(c.fovY).toBe(fov);
    expect(2 * c.distance * Math.tan(c.fovY / 2)).toBeCloseTo(80, 9);
    const d = cameraFromSkp(cam({ perspective: false }))!;
    expect(d.fovY).toBe(DEFAULT_FOV);
    expect(d.distance).toBeCloseTo(100, 9);
  });

  it('곧장 위·아래 보기: yaw는 위 벡터에서(화면 위 = 위 벡터)', () => {
    const top = cameraFromSkp(cam({ eye: [0, 0, 100], up: [1, 0, 0] }))!;
    expect(top.pitch).toBeCloseTo(Math.PI / 2, 12);
    close(cameraBasis(top).up, [1, 0, 0]);
    const plan = cameraFromSkp(cam({ eye: [5, 5, 100], target: [5, 5, 0], up: [0, 1, 0] }))!;
    close(cameraBasis(plan).up, [0, 1, 0]);
    close(plan.target, [5, 5, 0]);
    const bottom = cameraFromSkp(cam({ eye: [0, 0, -100], up: [0, 1, 0] }))!;
    expect(bottom.pitch).toBeCloseTo(-Math.PI / 2, 12);
    close(cameraBasis(bottom).up, [0, 1, 0]);
  });

  it('수직을 살짝 넘은 카메라는 곧장 아래 보기로 바로잡아 그림이 뒤집히지 않는다', () => {
    // 눈이 +Y 쪽으로 0.3°쯤 넘어갔고 위 벡터는 +Y(SketchUp이 그대로 저장하는 꼴)
    const c = cameraFromSkp(cam({ eye: [0, 0.5, 100], up: [0, 1, -0.005] }))!;
    expect(c.pitch).toBeCloseTo(Math.PI / 2, 12);
    close(cameraBasis(c).up, [0, 1, 0], 1e-9);
    // 수직에서 먼 보기는 시선을 따른다(위 벡터가 이상해도 굴리지 않는다)
    const iso = cameraFromSkp(cam({ eye: [100, -100, 100], up: [0.3, 0.3, -0.9] }))!;
    close(cameraEye(iso), [100, -100, 100], 1e-6);
    expect(cameraBasis(iso).up[2]).toBeGreaterThan(0);
  });

  it('굴림: 위 벡터가 시선 둘레로 기운 카메라는 roll로(코어 틀의 화면 위가 그 위 벡터), 작거나 아래로 기운 것은 버린다', () => {
    const up: [number, number, number] = [Math.sin(0.3), 0, Math.cos(0.3)];
    const c = cameraFromSkp(cam({ eye: [0, -100, 0], target: [0, 0, 0], up }))!;
    expect(c.roll).toBeCloseTo(-0.3, 9);
    close(cameraBasis(c).up, up, 1e-9);
    expect(rollFromUp(0, 0, [0, 0, 1])).toBe(0);
    expect(rollFromUp(0, 0, [1e-6, 0, 1])).toBe(0);
    expect(rollFromUp(0, 0, [0.2, 0, -1])).toBe(0);
    expect(cameraFromSkp(cam({}))!.roll).toBeUndefined();
  });

  it('2점 투시: 앙각 0·눈 자리 그대로, 원래 대상점이 화면 가운데에 남게 렌즈를 위아래로 옮긴다(세로선이 곧다)', () => {
    const c: CameraState = { target: [10, 20, 0], distance: 100, yaw: 0.3, pitch: 0.4, projection: 'perspective', fovY: 0.7, roll: 0.1 };
    const t = twoPointCamera(c)!;
    expect(t.pitch).toBe(0);
    expect(t.roll).toBeUndefined();
    close(cameraEye(t), cameraEye(c), 1e-9);
    expect(isTwoPoint(t)).toBe(true);
    const f = computeFrame(t, 800, 600, { center: [0, 0, 0], radius: 500 });
    const p = projectToScreen(f, c.target)!;
    expect(p[0]).toBeCloseTo(400, 6);
    expect(p[1]).toBeCloseTo(300, 6);
    // 세로선의 두 점은 화면 x가 같다
    const a = projectToScreen(f, [30, 40, 0])!;
    const b = projectToScreen(f, [30, 40, 50])!;
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(twoPointCamera({ ...c, projection: 'orthographic' })).toBeNull();
    expect(twoPointCamera({ ...c, pitch: 1.5 })).toBeNull();
    // 파일의 2점 투시 카메라
    const fromFile = cameraFromSkp(cam({ eye: [0, -100, 60], target: [0, 0, 0], up: [0, 0.5, 0.86], twoPoint: true }))!;
    expect(fromFile.pitch).toBe(0);
    // 눈보다 아래의 대상점을 가운데에 두려고 렌즈를 올린다(+)
    expect(fromFile.shiftY).toBeGreaterThan(0);
  });

  it('시야각만 바꾸면 렌즈 이동도 tan 비로 맞추고, 걷기 눈높이는 5′6″', () => {
    const c: CameraState = { target: [0, 0, 0], distance: 10, yaw: 0, pitch: 0, projection: 'perspective', fovY: 0.6, shiftY: 0.2 };
    const w = withFov(c, 1.2);
    expect(w.fovY).toBe(1.2);
    expect(w.shiftY).toBeCloseTo((0.2 * Math.tan(0.3)) / Math.tan(0.6), 12);
    expect(withFov({ ...c, shiftY: undefined }, 1).shiftY).toBeUndefined();
    expect(eyeHeightFor('mm')).toBeCloseTo(1676.4, 9);
    expect(eyeHeightFor('inch')).toBeCloseTo(66, 9);
    expect(eyeHeightFor('m')).toBeCloseTo(1.6764, 9);
    expect(eyeHeightFor('unknown')).toBeUndefined();
  });

  it('눈과 목표가 같거나 값이 이상하면 null', () => {
    expect(cameraFromSkp(cam({ eye: [0, 0, 0] }))).toBeNull();
    expect(cameraFromSkp(cam({ eye: [Number.NaN, 0, 0] }))).toBeNull();
    expect(cameraFromSkp({} as SkpCameraMeta)).toBeNull();
  });

  it('같은 보기 판정', () => {
    expect(sameSkpCamera(cam({}), cam({ eye: [0, -100.000001, 0] }))).toBe(true);
    expect(sameSkpCamera(cam({}), cam({ eye: [0, -90, 0] }))).toBe(false);
    expect(sameSkpCamera(cam({}), cam({ perspective: false }))).toBe(false);
    expect(sameSkpCamera(cam({}), null)).toBe(false);
  });
});

describe('처음 카메라', () => {
  const looking: CameraState = { target: [0, 0, 0], distance: 100, yaw: 0, pitch: 0, projection: 'perspective', fovY: DEFAULT_FOV };

  it('상자가 화면에 충분히 보이는지', () => {
    expect(cameraShowsBox(looking, box, 800, 600)).toBe(true);
    // 반대쪽을 본다(상자가 모두 눈 뒤)
    expect(cameraShowsBox({ ...looking, target: [0, -200, 0], yaw: Math.PI }, box, 800, 600)).toBe(false);
    // 아주 멀리서 점처럼 보인다
    expect(cameraShowsBox({ ...looking, distance: 1e6 }, box, 800, 600)).toBe(false);
    // 화면 옆으로 벗어났다
    expect(cameraShowsBox({ ...looking, target: [500, 0, 0] }, box, 800, 600)).toBe(false);
    // 평행 투영
    expect(cameraShowsBox({ ...looking, projection: 'orthographic' }, box, 800, 600)).toBe(true);
    // 범위가 없으면 판정할 것이 없다
    expect(cameraShowsBox(looking, null, 800, 600)).toBe(true);
  });

  it('모형 카메라가 모형을 보여 줄 때만 쓰고, 아니면 null(앱이 전체 보기)', () => {
    const shown = initialCamera({ camera: cam({}) }, box, 800, 600);
    expect(shown).not.toBeNull();
    close(cameraEye(shown!), [0, -100, 0], 1e-6);
    expect(initialCamera({ camera: cam({ target: [0, -200, 0] }) }, box, 800, 600)).toBeNull();
    expect(initialCamera({}, box, 800, 600)).toBeNull();
    expect(initialCamera(null, box, 800, 600)).toBeNull();
  });

  it('활성 장면이 모형 카메라와 같을 때만 열 때의 장면으로 본다', () => {
    const pages = [{ name: 'A', camera: cam({ eye: [0, -50, 0] }) }, { name: 'B', camera: cam({}) }];
    expect(openingPage({ camera: cam({}), pages, activePage: 1 })).toBe(1);
    expect(openingPage({ camera: cam({}), pages, activePage: 0 })).toBeNull();
    expect(openingPage({ camera: cam({}), pages: [{ name: 'C' }], activePage: 0 })).toBe(0);
    expect(openingPage({ camera: cam({}), pages, activePage: 5 })).toBeNull();
  });
});

describe('장면 읽기', () => {
  it('차례를 지키고 꼴이 다른 칸은 버린다', () => {
    const pages = readPages({
      pages: [
        { name: '평면', hiddenTags: ['벽', 3], hiddenNodes: [1, -2, 2.5, 4], sectionPlanes: [0, 'x'], transition: -1, delay: 2, camera: { eye: [0, 0, 1] } },
        'broken',
        { name: '', style: { faceStyle: 'bogus', xray: true, background: [2, 0.5, -1], sky: null } },
      ],
    });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toEqual({ name: '평면', hiddenTags: ['벽'], hiddenNodes: [1, 4], sectionPlanes: [0], delay: 2 });
    expect(pages[1]).toEqual({ name: '장면 2' });
    expect(pages[2]!.name).toBe('장면 3');
    expect(pages[2]!.style).toEqual({ xray: true, background: [1, 0.5, 0], sky: null });
    expect(readPages({})).toEqual([]);
    expect(readActivePage({ activePage: 2 }, 3)).toBe(2);
    expect(readActivePage({ activePage: 3 }, 3)).toBeNull();
    expect(readActivePage({ activePage: 1.5 }, 3)).toBeNull();
  });
});

describe('단면', () => {
  it('SketchUp 평면(남는 쪽 ≥ 0) → 코어 평면(normal·p > offset 쪽을 잘라 냄)', () => {
    const plane = [0, 0, -1, 50]; // z ≤ 50 이 남는다
    const v = sectionToViewer(plane)!;
    const cut = (p: number[]): boolean => v.normal[0] * p[0]! + v.normal[1] * p[1]! + v.normal[2] * p[2]! > v.offset;
    const kept = (p: number[]): boolean => plane[0]! * p[0]! + plane[1]! * p[1]! + plane[2]! * p[2]! + plane[3]! >= 0;
    for (const p of [[0, 0, 0], [0, 0, 49], [0, 0, 51], [3, -2, 100]]) expect(cut(p)).toBe(!kept(p));
    expect(sectionToViewer([0, 0, 0, 1])).toBeNull();
    expect(sectionToViewer([0, Number.NaN, 1, 0])).toBeNull();
  });

  it('활성 단면 가운데 모형 단면(node −1)만 고른다', () => {
    const planes = [
      { name: '안쪽', plane: [1, 0, 0, 0], active: true, tag: '', hidden: false, node: 3, size: 10 },
      { name: '모형', plane: [0, 1, 0, -5], active: true, tag: '', hidden: false, node: -1, size: 10 },
    ];
    const s = pickSection([0, 1], planes)!;
    expect(s.index).toBe(1);
    expect(s.plane.name).toBe('모형');
    close(s.normal, [0, -1, 0]);
    expect(s.offset).toBe(-5);
    expect(pickSection([0], planes)).toBeNull();
    expect(pickSection([7], planes)).toBeNull();
    expect(initialSection({ sectionPlanes: planes })!.index).toBe(1);
    expect(initialSection({ sectionPlanes: planes, style: { sectionCuts: false } })).toBeNull();
    expect(initialSection({ sectionPlanes: [{ ...planes[1], active: false }] })).toBeNull();
  });

  it('여러 단면: 모형 단면 먼저, 그룹 안 단면은 노드를 달고, 같은 노드는 처음 것만', () => {
    const planes = [
      { name: '안쪽', plane: [1, 0, 0, 0], active: true, tag: '', hidden: false, node: 3, size: 10 },
      { name: '모형', plane: [0, 1, 0, -5], active: true, tag: '', hidden: false, node: -1, size: 10 },
      { name: '안쪽2', plane: [0, 0, 1, 0], active: true, tag: '', hidden: false, node: 3, size: 10 },
      { name: '다른 그룹', plane: [0, 0, -1, 2], active: false, tag: '', hidden: false, node: 7, size: 10 },
    ];
    expect(activeSections([0, 1, 2, 3, 9], planes).map((s) => [s.index, s.plane.node])).toEqual([
      [1, -1],
      [0, 3],
      [3, 7],
    ]);
    expect(initialSections({ sectionPlanes: planes }).map((s) => s.index)).toEqual([1, 0]);
    expect(initialSections({ sectionPlanes: planes, style: { sectionCuts: false } })).toEqual([]);
    const plan = pagePlan({ name: 'p', sectionPlanes: [0, 3] }, { sectionPlanes: planes });
    expect(plan.sections.map((s) => s.index)).toEqual([0, 3]);
    expect(plan.section).toBeNull();
    expect(pagePlan({ name: 'q', sectionPlanes: [0], style: { sectionCuts: false } }, { sectionPlanes: planes }).sections).toEqual([]);
  });
});

describe('단면 채우기(스타일)', () => {
  it('스타일 값이 먼저, 없으면 SketchUp 2018 이상(또는 판을 모르면)만 채운다', () => {
    expect(sectionFillOf({ sectionFill: false }, 26)).toBe(false);
    expect(sectionFillOf({ sectionFill: true }, 8)).toBe(true);
    expect(sectionFillOf({}, 17)).toBe(false);
    expect(sectionFillOf(null, 18)).toBe(true);
    expect(sectionFillOf(undefined, null)).toBe(true);
  });
});

describe('스타일 → 그리기 방식', () => {
  it('면 스타일·X-ray·모서리 보이기', () => {
    expect(renderModeForStyle(null)).toBeNull();
    expect(renderModeForStyle({})).toBeNull();
    expect(renderModeForStyle({ faceStyle: 'wireframe', xray: true })).toBe('wireframe');
    expect(renderModeForStyle({ faceStyle: 'shaded', xray: true })).toBe('xray');
    expect(renderModeForStyle({ faceStyle: 'textured' })).toBe('shadedEdges');
    expect(renderModeForStyle({ faceStyle: 'textured', edges: false })).toBe('shaded');
    // 은선(1)·단색(5)·무늬 끈 음영은 코어 0.7.0 모드로
    expect(renderModeForStyle({ faceStyle: 'monochrome', edges: false })).toBe('monochrome');
    expect(renderModeForStyle({ faceStyle: 'hiddenLine' })).toBe('hiddenLine');
    expect(renderModeForStyle({ faceStyle: 'shaded' })).toBe('noTexture');
    expect(renderModeForStyle({ edges: false })).toBe('shaded');
  });
});

describe('태그 실제 보임', () => {
  const folders = [
    { name: '가구', visible: true, parent: -1 },
    { name: '철물', visible: true, parent: 0 },
    { name: '숨긴 폴더', visible: false, parent: -1 },
    { name: '보관', visible: true, parent: 2 },
  ];
  const tags = [
    { name: '경첩', visible: true, folder: 1 },
    { name: '옛것', visible: true, folder: 3 },
    { name: '끈 태그', visible: false },
    { name: '벽', visible: true },
    { name: '문', folder: 0 },
  ];

  it('태그 visible && 모든 조상 폴더 visible', () => {
    expect([...effectiveTagHidden(tags, folders)].sort()).toEqual(['끈 태그', '옛것'].sort());
    expect([...folderHiddenTags(tags, folders)]).toEqual(['옛것']);
    expect([...effectiveTagHidden(tags, [])]).toEqual(['끈 태그']);
    expect(effectiveTagHidden(null, null).size).toBe(0);
  });

  it('폴더가 서로를 부모로 가리켜도 멈춘다', () => {
    const loop = [
      { name: 'a', visible: true, parent: 1 },
      { name: 'b', visible: true, parent: 0 },
    ];
    expect(effectiveTagHidden([{ name: 't', visible: true, folder: 0 }], loop).size).toBe(0);
  });
});

describe('장면 적용 계획', () => {
  const planes = [
    { name: '모형', plane: [0, 0, -1, 30], active: false, tag: '', hidden: false, node: -1, size: 5 },
    { name: '노드', plane: [1, 0, 0, 0], active: true, tag: '', hidden: false, node: 2, size: 5 },
  ];

  it('장면이 기억하는 것만 바꾼다', () => {
    const p = pagePlan({ name: '카메라만', camera: cam({}) });
    expect(p.camera).not.toBeNull();
    expect(p.seconds).toBe(DEFAULT_TRANSITION_S);
    expect(p.hiddenTags).toBeNull();
    expect(p.hiddenNodes).toBeNull();
    expect(p.setsSection).toBe(false);
    expect(p.style).toBeNull();
    expect(p.renderMode).toBeNull();
    const none = pagePlan({ name: '빈 장면' });
    expect(none.camera).toBeNull();
    expect(none.seconds).toBe(0);
  });

  it('숨긴 태그·숨긴 개체·단면·스타일', () => {
    const page: SkpPageMeta = {
      name: '평면',
      camera: cam({ eye: [0, 0, 100], up: [0, 1, 0], perspective: false, height: 40 }),
      hiddenTags: ['지붕'],
      hiddenNodes: [4, 9],
      sectionPlanes: [1, 0],
      style: { faceStyle: 'shaded', edges: false },
      transition: 0.5,
    };
    const p = pagePlan(page, { sectionPlanes: planes, folderHidden: new Set(['보관']), viewerFovY: DEFAULT_FOV });
    expect(p.camera!.projection).toBe('orthographic');
    expect(p.seconds).toBe(0.5);
    expect([...p.hiddenTags!].sort()).toEqual(['보관', '지붕'].sort());
    expect([...p.hiddenNodes!]).toEqual([4, 9]);
    expect(p.setsSection).toBe(true);
    expect(p.section!.index).toBe(0);
    expect(p.renderMode).toBe('noTexture');
    // 단면을 기억하지만 모형 단면이 없으면 끈다
    const off = pagePlan({ name: '노드 단면', sectionPlanes: [1] }, { sectionPlanes: planes });
    expect(off.setsSection).toBe(true);
    expect(off.section).toBeNull();
    // 기억한 스타일이 단면 자르기를 껐으면 끈다
    const cuts = pagePlan({ name: '자르기 끔', style: { sectionCuts: false } }, { sectionPlanes: planes });
    expect(cuts.setsSection).toBe(true);
    expect(cuts.section).toBeNull();
    // 빈 목록 = 모든 태그를 보인다
    expect(pagePlan({ name: '모두', hiddenTags: [] }).hiddenTags!.size).toBe(0);
  });
});

describe('장면 차례·전환', () => {
  it('전환·지연 시간', () => {
    expect(transitionSeconds({ transition: 0.5 })).toBe(0.5);
    expect(transitionSeconds({})).toBe(DEFAULT_TRANSITION_S);
    expect(transitionSeconds({}, { fallback: 1.5 })).toBe(1.5);
    expect(transitionSeconds({ transition: 1000 })).toBe(MAX_TRANSITION_S);
    expect(transitionSeconds({ transition: 1 }, { mode: 'off' })).toBe(0);
    expect(transitionSeconds({ transition: 1 }, { showTransition: false })).toBe(0);
    expect(transitionSeconds({ transition: 0 }, { mode: 'on' })).toBe(DEFAULT_TRANSITION_S);
    expect(delaySeconds({ delay: 3 })).toBe(3);
    expect(delaySeconds({})).toBe(1);
    expect(delaySeconds({ delay: 1e9 })).toBe(3600);
  });

  it('이전·다음 장면', () => {
    expect(stepPage(3, null, 1)).toBe(0);
    expect(stepPage(3, null, -1)).toBe(2);
    expect(stepPage(3, 0, 1)).toBe(1);
    expect(stepPage(3, 2, 1)).toBe(0);
    expect(stepPage(3, 0, -1)).toBe(2);
    expect(stepPage(3, 2, 1, false)).toBeNull();
    expect(stepPage(0, null, 1)).toBeNull();
  });

  it('전환 진행과 보간(처음·끝은 그대로, 가운데는 부드럽게)', () => {
    const a: CameraState = { target: [0, 0, 0], distance: 10, yaw: 0, pitch: 0, projection: 'perspective', fovY: DEFAULT_FOV };
    const b: CameraState = { target: [10, 0, 0], distance: 40, yaw: 1, pitch: 0.5, projection: 'perspective', fovY: DEFAULT_FOV };
    expect(transitionProgress(1000, 1500, 1)).toBe(0.5);
    expect(transitionProgress(1000, 9000, 1)).toBe(1);
    expect(transitionProgress(1000, 1000, 0)).toBe(1);
    close(transitionCamera(a, b, 0).target, [0, 0, 0]);
    expect(transitionCamera(a, b, 1)).toEqual(b);
    const mid = transitionCamera(a, b, 0.5);
    expect(mid.target[0]).toBeCloseTo(5, 9);
    expect(mid.distance).toBeCloseTo(20, 9);
    expect(transitionCamera(a, b, 0.25).target[0]).toBeLessThan(2.5);
  });
});

describe('세로 화면에서 장면이 만든 가로 범위 지키기', () => {
  const deg = (r: number): number => (r * 180) / Math.PI;
  const rad = (d: number): number => (d * Math.PI) / 180;
  /** 상자 꼭짓점을 화면 정규 좌표(−1~1)로 — 가로 범위 [x0, x1], 세로 범위 [y0, y1] */
  const ndc = (c: CameraState, b: typeof box, aspect: number): [number, number, number, number] => {
    const bs = cameraBasis(c);
    const eye = cameraEye(c);
    const tan = Math.tan(c.fovY / 2);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]];
      const d = [p[0]! - eye[0], p[1]! - eye[1], p[2]! - eye[2]];
      const dot = (v: readonly number[]): number => d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!;
      const z = c.projection === 'perspective' ? -dot(bs.back) : 1;
      const hh = c.projection === 'perspective' ? z * tan : c.distance * tan;
      x0 = Math.min(x0, dot(bs.right) / (hh * aspect));
      x1 = Math.max(x1, dot(bs.right) / (hh * aspect));
      y0 = Math.min(y0, dot(bs.up) / hh);
      y1 = Math.max(y1, dot(bs.up) / hh);
    }
    return [x0, x1, y0, y1];
  };
  const persp: CameraState = { target: [0, 0, 0], distance: 100, yaw: 0.3, pitch: 0.2, projection: 'perspective', fovY: rad(35) };

  it('가로·정사각 화면은 그대로(배율 1), 세로 화면은 장면 종횡비의 가로 범위까지', () => {
    expect(sceneCoverageScale(844 / 269)).toBe(1);
    expect(sceneCoverageScale(1)).toBe(1);
    expect(sceneCoverageScale(1.2, 1.6)).toBe(1);
    expect(sceneCoverageScale(390 / 725)).toBeCloseTo(SCENE_REF_ASPECT / (390 / 725), 12);
    expect(sceneCoverageScale(0.8)).toBeCloseTo(SCENE_REF_ASPECT / 0.8, 12);
    // 파일에 고정 종횡비가 있으면 그것을 기준으로
    expect(sceneCoverageScale(0.5, 2)).toBeCloseTo(4, 12);
    // 정사각과 0.8 사이는 점점(정사각 바로 아래에서 튀지 않는다)
    expect(sceneCoverageScale(0.999)).toBeLessThan(1.01);
    const mid = sceneCoverageScale(0.9);
    expect(mid).toBeGreaterThan(1 / 0.9);
    expect(mid).toBeLessThan(SCENE_REF_ASPECT / 0.9);
    // 세로로 만든 장면(종횡비 < 화면)은 넓히지 않는다
    expect(sceneCoverageScale(0.6, 0.5)).toBe(1);
    // 이상한 값은 1
    expect(sceneCoverageScale(Number.NaN)).toBe(1);
    expect(sceneCoverageScale(0)).toBe(1);
  });

  it('시야각은 tan 기준으로 넓히고 90°에서 멈춘다(원래 더 넓으면 그대로)', () => {
    expect(widenFov(rad(35), 1)).toBeCloseTo(rad(35), 12);
    expect(Math.tan(widenFov(rad(35), 2) / 2)).toBeCloseTo(2 * Math.tan(rad(17.5)), 12);
    expect(deg(widenFov(rad(35), 10))).toBeCloseTo(PORTRAIT_MAX_FOV_DEG, 9);
    expect(deg(widenFov(rad(100), 3))).toBeCloseTo(100, 9);
  });

  it('원근: 눈 자리·방향은 그대로 두고 시야각만 넓혀, 세로 화면에서도 장면의 가로 범위가 다 보인다', () => {
    const portrait = 390 / 725;
    const { camera, fit } = fitSceneCamera(persp, portrait);
    close(cameraEye(camera), cameraEye(persp), 1e-9);
    expect(camera.distance).toBe(persp.distance);
    expect(camera.yaw).toBe(persp.yaw);
    expect(camera.pitch).toBe(persp.pitch);
    // 가로 반폭(tan) = 장면 종횡비에서의 가로 반폭
    expect(Math.tan(camera.fovY / 2) * portrait).toBeCloseTo(Math.tan(persp.fovY / 2) * SCENE_REF_ASPECT, 9);
    expect(deg(camera.fovY)).toBeLessThan(PORTRAIT_MAX_FOV_DEG);
    expect(fit.baseFovY).toBe(persp.fovY);
    expect(fit.fovY).toBe(camera.fovY);
    // 장면 종횡비 화면에서 가로로 꽉 찬 상자(지붕·옆벽)가 세로 화면에서도 가로 안에 든다
    const house = { min: [-40, -10, -12] as [number, number, number], max: [40, 10, 12] as [number, number, number] };
    const [rx0, rx1] = ndc(persp, house, SCENE_REF_ASPECT);
    expect(Math.max(-rx0, rx1)).toBeLessThan(1);
    const [bx0, bx1] = ndc(persp, house, portrait);
    expect(Math.max(-bx0, bx1)).toBeGreaterThan(1); // 고치기 전: 잘림
    const [x0, x1, y0, y1] = ndc(camera, house, portrait);
    expect(Math.max(-x0, x1)).toBeLessThan(1);
    expect(Math.max(-y0, y1)).toBeLessThan(1);
  });

  it('가로 화면(휴대폰 가로·데스크톱)은 카메라가 지금과 똑같다', () => {
    for (const aspect of [844 / 269, 1280 / 720, 1]) {
      const { camera, fit } = fitSceneCamera(persp, aspect);
      expect(camera).toEqual(persp);
      expect(fit.scale).toBe(1);
      const ortho: CameraState = { ...persp, projection: 'orthographic' };
      expect(fitSceneCamera(ortho, aspect).camera).toEqual(ortho);
    }
  });

  it('평행: 화면 높이를 배율만큼 키운다', () => {
    const ortho: CameraState = { ...persp, projection: 'orthographic' };
    const { camera, fit } = fitSceneCamera(ortho, 0.5);
    expect(camera.fovY).toBe(ortho.fovY);
    expect(camera.distance).toBeCloseTo(ortho.distance * (SCENE_REF_ASPECT / 0.5), 9);
    expect(fit.scale).toBeCloseTo(SCENE_REF_ASPECT / 0.5, 12);
  });

  it('휴대폰을 돌리면 다시 맞추고, 사용자가 시야각·투영을 바꿨으면 그만 따라간다', () => {
    const p = fitSceneCamera(persp, 0.5);
    // 그사이 사용자가 돌리고 확대함(시야각은 그대로)
    const moved: CameraState = { ...p.camera, yaw: 1, distance: 60 };
    const land = refitSceneCamera(moved, p.fit, 844 / 269)!;
    expect(land.camera.fovY).toBeCloseTo(persp.fovY, 12);
    expect(land.camera.yaw).toBe(1);
    expect(land.camera.distance).toBe(60);
    const back = refitSceneCamera(land.camera, land.fit, 0.5)!;
    expect(back.camera.fovY).toBeCloseTo(p.camera.fovY, 12);
    // 같은 종횡비면 그대로
    expect(refitSceneCamera(p.camera, p.fit, 0.5)!.camera).toBe(p.camera);
    expect(refitSceneCamera({ ...p.camera, fovY: rad(50) }, p.fit, 2)).toBeNull();
    expect(refitSceneCamera({ ...p.camera, projection: 'orthographic' }, p.fit, 2)).toBeNull();
    const o = fitSceneCamera({ ...persp, projection: 'orthographic' }, 0.5);
    const oLand = refitSceneCamera(o.camera, o.fit, 2)!;
    expect(oLand.camera.distance).toBeCloseTo(persp.distance, 9);
  });

  it('처음 카메라와 장면 계획에 같은 맞춤을 쓴다(장면 종횡비가 파일에 있으면 그것)', () => {
    const meta = { camera: cam({ eye: [0, -100, 10], target: [0, 0, 0], fovY: 35 }) };
    const land = initialView(meta, box, 844, 269)!;
    expect(land.camera).toEqual(cameraFromSkp(meta.camera)!);
    expect(initialCamera(meta, box, 844, 269)).toEqual(land.camera);
    const port = initialView(meta, box, 390, 725)!;
    expect(port.fit.scale).toBeCloseTo(SCENE_REF_ASPECT / (390 / 725), 9);
    expect(port.camera.fovY).toBeGreaterThan(land.camera.fovY);
    const fixed = initialView({ camera: cam({ fovY: 35, aspect: 2 }) }, box, 390, 725)!;
    expect(fixed.fit.ref).toBe(2);

    const page: SkpPageMeta = { name: '앞마당', camera: cam({ fovY: 35 }) };
    const plain = pagePlan(page);
    expect(plain.fit).toBeNull();
    const wide = pagePlan(page, { viewAspect: 844 / 269 });
    expect(wide.camera).toEqual(plain.camera);
    const tall = pagePlan(page, { viewAspect: 390 / 725 });
    expect(tall.fit!.scale).toBeGreaterThan(2.9);
    expect(tall.camera!.fovY).toBeCloseTo(tall.fit!.fovY, 12);
    const top = pagePlan({ name: '위에서', camera: cam({ eye: [0, 0, 100], up: [0, 1, 0], perspective: false, height: 40 }) }, { viewAspect: 0.5, viewerFovY: DEFAULT_FOV });
    expect(2 * top.camera!.distance * Math.tan(top.camera!.fovY / 2)).toBeCloseTo(40 * (SCENE_REF_ASPECT / 0.5), 6);
  });

  it('전체 보기·표준 뷰 전에는 넓힌 시야각을 원래대로(대상점 깊이 화면 크기는 그대로)', () => {
    const p = fitSceneCamera(persp, 390 / 725);
    expect(deg(p.camera.fovY)).toBeGreaterThan(80);
    const u = unwidenSceneCamera({ ...p.camera, yaw: 1.2 }, p.fit);
    expect(u.fovY).toBeCloseTo(persp.fovY, 12);
    expect(u.yaw).toBe(1.2);
    close(u.target, p.camera.target);
    // 대상점 깊이의 화면 반높이(거리·tan)는 같다 — 이어지는 맞춰 보기가 튀지 않는다
    expect(u.distance * Math.tan(u.fovY / 2)).toBeCloseTo(p.camera.distance * Math.tan(p.camera.fovY / 2), 9);
    // 넓히지 않았거나(가로 화면), 맞춤이 없거나, 평행이면 그대로
    const land = fitSceneCamera(persp, 2);
    expect(unwidenSceneCamera(land.camera, land.fit)).toBe(land.camera);
    expect(unwidenSceneCamera(p.camera, null)).toBe(p.camera);
    const o = fitSceneCamera({ ...persp, projection: 'orthographic' }, 0.5);
    expect(unwidenSceneCamera(o.camera, o.fit)).toBe(o.camera);
  });

  it('돌린 뒤 이전 보기: 맞춤으로 적은 칸은 지금 방향의 시야각으로, 맞춤 없이 적은 칸은 그대로', () => {
    const p = fitSceneCamera(persp, 390 / 725);
    // 세로에서 적은 칸을 가로에서 되돌린다
    const back = restoreSceneCamera({ ...p.camera, yaw: 0.9 }, p.fit, 844 / 269);
    expect(back.camera.fovY).toBeCloseTo(persp.fovY, 12);
    expect(back.camera.yaw).toBe(0.9);
    expect(back.fit!.scale).toBe(1);
    // 가로에서 적은 칸을 세로에서 되돌리면 다시 넓힌다
    const l = fitSceneCamera(persp, 844 / 269);
    expect(restoreSceneCamera(l.camera, l.fit, 390 / 725).camera.fovY).toBeCloseTo(p.camera.fovY, 12);
    // 맞춤 없이 적은 칸(전체 보기 뒤)은 그대로, 맞춤도 없음
    const plain = restoreSceneCamera(persp, null, 0.5);
    expect(plain.camera).toBe(persp);
    expect(plain.fit).toBeNull();
    expect(sameSceneFit(p.fit, l.fit)).toBe(true);
    expect(sameSceneFit(p.fit, fitSceneCamera({ ...persp, fovY: rad(50) }, 0.5).fit)).toBe(false);
    expect(sameSceneFit(null, null)).toBe(true);
    expect(sameSceneFit(p.fit, null)).toBe(false);
  });

  it('넓힌 뒤 평행 투영으로 바꿔도 시야각을 되돌린다(평행 화면 높이는 그대로) — 다시 원근으로 와도 넓은 시야각이 남지 않게', () => {
    const p = fitSceneCamera(persp, 390 / 725);
    // 평행 투영 단추: 시야각·거리는 그대로 두고 투영만 바뀐다
    const ortho: CameraState = { ...p.camera, projection: 'orthographic' };
    const u = unwidenSceneCamera(ortho, p.fit);
    expect(u.projection).toBe('orthographic');
    expect(u.fovY).toBeCloseTo(persp.fovY, 12);
    // 평행 화면 반높이 = 거리·tan(시야/2)가 그대로라 화면이 바뀌지 않는다
    expect(u.distance * Math.tan(u.fovY / 2)).toBeCloseTo(ortho.distance * Math.tan(ortho.fovY / 2), 9);
    // 평행에서 돌리면 맞춤을 따라갈 수 없다 → 앱은 이 되돌리기를 쓴다
    expect(refitSceneCamera(ortho, p.fit, 2)).toBeNull();
    // 그 평행 카메라를 기록에서 되돌려도(꼬리표는 원근 맞춤) 넓은 시야각은 돌아오지 않는다
    const back = restoreSceneCamera(ortho, p.fit, 2);
    expect(back.fit).toBeNull();
    expect(back.camera.fovY).toBeCloseTo(persp.fovY, 12);
  });

  it('지금 시야각에서 맞춤을 뺀 원래 시야각(투영은 따지지 않는다): 새 문서·평행 장면 변환이 넓힌 시야각을 물려받지 않게', () => {
    const p = fitSceneCamera(persp, 390 / 725);
    expect(baseFovOf(p.camera, p.fit)).toBe(persp.fovY);
    expect(baseFovOf({ ...p.camera, projection: 'orthographic' }, p.fit)).toBe(persp.fovY);
    // 맞춘 뒤 시야각이 바뀌었으면(되돌림 등) 지금 시야각
    expect(baseFovOf({ ...p.camera, fovY: rad(40) }, p.fit)).toBeCloseTo(rad(40), 12);
    expect(baseFovOf(p.camera, null)).toBe(p.camera.fovY);
  });
});
