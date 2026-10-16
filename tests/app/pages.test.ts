import { describe, expect, it } from 'vitest';
import { DEFAULT_FOV, cameraBasis, cameraEye, type CameraState } from 'opencad-viewer3d/camera';
import type { SkpCameraMeta, SkpPageMeta } from '../../src/meta';
import {
  DEFAULT_TRANSITION_S,
  MAX_TRANSITION_S,
  cameraFromSkp,
  cameraShowsBox,
  delaySeconds,
  effectiveTagHidden,
  folderHiddenTags,
  initialCamera,
  initialSection,
  openingPage,
  pagePlan,
  pickSection,
  readActivePage,
  readPages,
  renderModeForStyle,
  sameSkpCamera,
  sectionToViewer,
  stepPage,
  transitionCamera,
  transitionProgress,
  transitionSeconds,
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
});

describe('스타일 → 그리기 방식', () => {
  it('면 스타일·X-ray·모서리 보이기', () => {
    expect(renderModeForStyle(null)).toBeNull();
    expect(renderModeForStyle({})).toBeNull();
    expect(renderModeForStyle({ faceStyle: 'wireframe', xray: true })).toBe('wireframe');
    expect(renderModeForStyle({ faceStyle: 'shaded', xray: true })).toBe('xray');
    expect(renderModeForStyle({ faceStyle: 'textured' })).toBe('shadedEdges');
    expect(renderModeForStyle({ faceStyle: 'monochrome', edges: false })).toBe('shaded');
    expect(renderModeForStyle({ faceStyle: 'hiddenLine' })).toBe('shadedEdges');
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
    expect(p.renderMode).toBe('shaded');
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
