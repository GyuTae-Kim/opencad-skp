// @vitest-environment jsdom
/**
 * 파일에서 온 글(이름·설명·속성 사전 등)이 화면 번역층에 바뀌지 않는지(52차).
 * 번역층은 사전 열쇠와 같은 글 마디를 통째로 바꾸고(재질 이름 "무늬" → "Texture"), 다른 언어 사전의 번역 글을 원문으로 되찾으며
 * (일본어 화면의 이름 "Texture" → "テクスチャ"), 틀이 맞지 않으면 " · "·" — "로 나눈 조각마다 옮긴다("태그 무늬 · 이" → "Tag 무늬 · This").
 * 사전 열쇠·번역 글과 같은 이름, 나눔 글을 품은 이름, HTML 같은 이름을 가진 합성 모형을 패널(태그·구성·선택·정보 탭, 속성 사전, 아래 띠)로
 * 그리고 영어·독일어·일본어·중국어와 다시 한국어로 바꾸며, 이름이었던 글 마디·속성이 다른 글로 바뀐 일이 없는지와 앱 글은 옮겨지는지 본다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { skpToScene } from '../../src/index';
import { createDoc, selectionParts, selectionText, type Selection, type SkpDoc } from '../../src/app/doc';
import { entityInfo, type EntityInput } from '../../src/app/entity';
import { DEFAULT_UNITS } from '../../src/app/units';
import { fileText, isAppName, joinMixed, mix, nameText, plainText } from '../../src/app/filetext';
import { installLocalization, mixNodes, mixText, uiName } from '../../src/app/i18n';
import { Panel, type PanelHost } from '../../src/app/panel';
import { translate } from '../../site/i18n.mjs';
import { dimPoint, edge, entities, face, f64, instance, materialXml, modelDat, sectionPlanes, skpFile, texts, tlv, utf8, val, vertex } from '../build';

const XSS_IMG = '<img src=x onerror="window.__xss=1">';
const XSS_B = '<b data-xss="1">굵게</b>';
/** 사전 열쇠(무늬·이·나무)·다른 언어 번역 글(Texture·Glass·Front·Glas·テクスチャ)·나눔 글을 품은 이름·HTML 같은 이름 */
const NAMES = ['무늬', '이', '나무', 'Texture', 'Glass', 'Front', 'Glas', 'テクスチャ', '무늬 · 이', '이 — 면', '이 · 면', XSS_IMG, XSS_B];

let n = 100;
const id = (): number => ++n;
/** 한 변 s인치 상자 요소 묶음 */
function box(s: number, o: { material?: number; defId?: number; components?: Uint8Array[]; groups?: Uint8Array[]; extra?: Uint8Array[]; attrs?: [string, [string, Uint8Array][]][] } = {}): Uint8Array {
  const P: [number, number, number][] = [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]];
  const vid = P.map(() => id());
  const em = new Map<string, { id: number; a: number }>();
  const edges: Uint8Array[] = [];
  const e = (a: number, b: number): [number, boolean] => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    let r = em.get(k);
    if (!r) {
      em.set(k, (r = { id: id(), a }));
      edges.push(edge(r.id, vid[a]!, vid[b]!));
    }
    return [r.id, r.a !== a];
  };
  const quads: [number[], [number, number, number, number]][] = [
    [[0, 3, 2, 1], [0, 0, -1, 0]],
    [[4, 5, 6, 7], [0, 0, 1, -s]],
    [[0, 1, 5, 4], [0, -1, 0, 0]],
    [[1, 2, 6, 5], [1, 0, 0, -s]],
    [[2, 3, 7, 6], [0, 1, 0, -s]],
    [[3, 0, 4, 7], [-1, 0, 0, 0]],
  ];
  const faces = quads.map(([q, pl]) => face(id(), pl, [q.map((a, i) => e(a, q[(i + 1) % 4]!))], o.material !== undefined ? { material: o.material } : {}));
  return entities(o.defId ?? (o.attrs ? id() : undefined), {
    vertices: P.map((p, i) => vertex(vid[i]!, ...p)),
    edges,
    faces,
    ...(o.components ? { components: o.components } : {}),
    ...(o.groups ? { groups: o.groups } : {}),
    ...(o.extra ? { extra: o.extra } : {}),
    ...(o.attrs ? { attrs: o.attrs } : {}),
  });
}
const at = (x: number): number[] => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, 0, 0, 1];

function collideFile(): Uint8Array {
  n = 100;
  const mats: [number, string][] = [[1, '무늬'], [2, '이 — 면'], [3, XSS_B], [4, 'Glass']];
  const defTree = 9001;
  const defGroup = 9002;
  const attrs: [string, [string, Uint8Array][]][] = [
    ['재질', [['이', val.str('무늬')], ['면', val.str('이 · 면')], [XSS_IMG, val.str(XSS_IMG)]]],
    [XSS_B, [['Texture', val.str('Front')]]],
  ];
  const sec = id();
  const root = box(30, {
    material: 2,
    groups: [instance(id(), defGroup, at(100), { name: '무늬 · 이', layer: 5, material: 1, attrs })],
    components: [
      instance(id(), defTree, at(200), { name: '이', layer: 2, material: 4 }),
      instance(id(), defTree, at(300), { name: 'Front', layer: 3 }),
      instance(id(), defTree, at(400), { name: XSS_IMG, layer: 4, material: 3 }),
    ],
    extra: [
      texts([{ id: id(), text: '무늬', point: dimPoint(1, [10, 10, 40]) }]),
      sectionPlanes([{ id: sec, plane: [-1, 0, 0, 100], name: 'Texture', layer: 2 }]),
    ],
    attrs: [['이', [['무늬', val.str('Glas')]]]],
  });
  const cam = { eye: [-200, -300, 200] as [number, number, number], target: [150, 0, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number] };
  const shadow = tlv(0x0204, tlv(0x6590, tlv(0x6593, utf8('무늬')), tlv(0x6594, utf8('Texture')), tlv(0x6595, f64(127)), tlv(0x6596, f64(37.5))));
  return skpFile(
    modelDat({
      materials: mats,
      tags: [{ id: 1, name: 'Layer0' }, { id: 2, name: '이' }, { id: 3, name: 'Texture' }, { id: 4, name: XSS_IMG }, { id: 5, name: '무늬 · 이' }],
      tagFolders: [{ id: id(), name: 'テクスチャ', tags: [2, 3] }],
      defaultLayer: 1,
      definitions: [
        { name: '나무', entities: box(10, { material: 1, defId: defTree }), description: '무늬' },
        { name: 'Group#1', entities: box(12, { defId: defGroup }), kind: 1 },
      ],
      root,
      lengthUnit: 2,
      properties: [['ModelProperties', [['Name', val.str('무늬')], ['Description', val.str('이 — 면')]]]],
      camera: cam,
      pages: {
        list: [
          { id: id(), name: '무늬', description: 'Texture', flags: 0x01, camera: cam },
          { id: id(), name: 'Front', flags: 0x41, camera: cam, sections: [sec] },
          { id: id(), name: XSS_IMG, description: '이 · 면', flags: 0x01, camera: cam },
        ],
      },
      sections: [shadow],
    }),
    { materials: mats.map(([, nm]): [string, string] => [nm, materialXml(nm, [120, 120, 120])]) },
  );
}

/** 이름이었던 글 마디·속성이 그 이름을 잃은 바뀜(조각 — " · "·" — "·" › "·": ·괄호·따옴표로 나눈 것 — 가운데 하나가 이름이고 새 글에 그 조각이 없으면) */
function watch(root: Node): { hits: string[]; stop: () => void } {
  const names = new Set(NAMES);
  const toks = (s: string | null): string[] => (s ?? '').split(/\n| · | \| | — | › |: |[()"]/).map((x) => x.trim()).filter(Boolean);
  const hits: string[] = [];
  const check = (old: string | null, now: string | null, where: string): void => {
    if (old === null || old === now) return;
    const t = new Set(toks(now));
    for (const k of new Set([...toks(old), old.trim()])) if (names.has(k) && !t.has(k) && !(k.length > 2 && (now ?? '').includes(k))) hits.push(`${where}: ${old} → ${now}`);
  };
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'characterData') check(r.oldValue, r.target.nodeValue, (r.target.parentElement?.className as string) || 'text');
      else if (r.type === 'attributes') check(r.oldValue, (r.target as Element).getAttribute(r.attributeName!), `${(r.target as Element).tagName}@${r.attributeName}`);
    }
  });
  mo.observe(root, { subtree: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true, attributeFilter: ['title', 'aria-label', 'alt'] });
  return { hits, stop: () => mo.disconnect() };
}

const tick = async (k = 4): Promise<void> => {
  for (let i = 0; i < k; i++) await new Promise((r) => setTimeout(r, 0));
};

function host(d: SkpDoc, panel: () => Panel): PanelHost {
  const noop = (): void => {};
  return {
    setTagVisible: noop, setAllTagsVisible: noop, setOutlineVisible: noop, setNodeVisible: noop,
    setExpanded: (node, on) => {
      if (on) d.expanded.add(node);
      else d.expanded.delete(node);
      panel().rerender();
    },
    collapseAll: noop, setPickMode: noop, setShowSoft: noop, setShowHidden: noop, setFolderVisible: noop, setAnnotationVisible: noop,
    setFileSection: (i) => {
      d.fileSections = i === null ? [] : [i];
      panel().rerender();
    },
    applyPage: noop, hideSelection: noop, isolateSelection: noop, unhideAll: noop,
    isolated: false, measureHint: null, measureLogList: [],
    copyMeasure: noop, clearMeasureLog: noop,
    select: (sel: Selection | null) => {
      d.selection = sel;
      panel().refreshSelection();
    },
    selectPickedPart: noop, zoomToSelection: noop, closePanel: noop, measuring: false,
  };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

describe('파일 글을 앱 글과 섞기(filetext·mixText)', () => {
  it('mix·joinMixed·plainText: 파일 글 자리와 원문', () => {
    const m = mix`태그 ${fileText('무늬 · 이')} · 면 ${12}`;
    expect(m).toEqual(['태그 ', { file: '무늬 · 이' }, ' · 면 12']);
    expect(plainText(joinMixed([m, ['면 3']]))).toBe('태그 무늬 · 이 · 면 12 · 면 3');
    expect(mix`${fileText('a')}${fileText('b')}`).toEqual([{ file: 'a' }, { file: 'b' }]);
    expect(isAppName('기본 재질')).toBe(true);
    expect(isAppName('재질 12')).toBe(true);
    expect(isAppName('(이름 없음)')).toBe(true);
    expect(isAppName('무늬')).toBe(false);
    expect(nameText('모형에 바로 놓인 형상')).toEqual({ file: '모형에 바로 놓인 형상', ui: true });
  });

  it('지금 언어로 옮기되 파일 글은 그대로(이름이 사전 열쇠와 같거나 나눔 글을 품어도), 앱 자리 글은 옮긴다', async () => {
    history.replaceState(null, '', '/opencad-skp/en/');
    dispose = await installLocalization(document.body);
    // 예전 꼴(한 글로 이은 것)은 이름까지 바뀌었다
    expect(translate('태그 무늬 · 나무 · 면 18', 'en')).toBe('Tag 무늬 · Tree · Face 18');
    expect(mixText(mix`태그 ${fileText('무늬 · 나무')} · 면 18`)).toBe('Tag 무늬 · 나무 · Face 18');
    expect(mixText(mix`태그 ${fileText('무늬 · 이')} · 면 18`)).toBe('Tag 무늬 · 이 · Face 18');
    expect(mixText(mix`${fileText('무늬 · 이')}: 면 ${6} · 모서리 ${12}`)).toBe('무늬 · 이: Face 6 · Edge 12');
    expect(mixText(mix`${fileText('무늬 · 이')} 보이기`)).toBe('Show 무늬 · 이');
    expect(mixText(mix`${fileText('무늬')}`)).toBe('무늬');
    expect(mixText(mix`${nameText('(이름 없음)')} 보이기`)).toBe(`Show ${translate('(이름 없음)', 'en')}`);
    expect(uiName('(이름 없음)')).toBe(translate('(이름 없음)', 'en'));
    expect(uiName('무늬')).toBe('무늬');
    // 화면 마디: 파일 글은 translate="no" 묶음, 앱 글은 옮긴 글
    const box = document.createElement('div');
    box.append(...mixNodes(mix`그룹 ${fileText('을')} (${fileText('무늬')}) · 태그 ${fileText('이 — 면')} · 면 3`));
    expect(box.textContent).toBe('Group 을 (무늬) · Tag 이 — 면 · Face 3');
    expect([...box.querySelectorAll('[translate="no"]')].map((e) => e.textContent)).toEqual(['을', '무늬', '이 — 면']);
    // 사용 영역 글자를 품은 이름도 그대로
    expect(mixText(mix`태그 ${fileText('x')}`)).toBe('Tag x');
  });

  it('번역층: data-i18n-keep 속성과 translate="no" 이름은 두고, 다른 언어 사전의 번역 글과 같은 이름도 되찾아 바꾸지 않는다', async () => {
    history.replaceState(null, '', '/opencad-skp/ja/');
    dispose = await installLocalization(document.body);
    const kept = document.createElement('button');
    kept.setAttribute('title', '무늬');
    kept.setAttribute('data-i18n-keep', 'title');
    kept.setAttribute('aria-label', '무늬');
    const name = document.createElement('span');
    name.setAttribute('translate', 'no');
    name.textContent = 'Texture';
    const plain = document.createElement('span');
    plain.textContent = 'Texture';
    document.body.append(kept, name, plain);
    await tick();
    expect(kept.title).toBe('무늬');
    expect(kept.getAttribute('aria-label')).toBe(translate('무늬', 'ja'));
    expect(name.textContent).toBe('Texture');
    // 감싸지 않은 영어 이름은 영어 사전의 글로 보고 열쇠("무늬")로 되찾아 일본어로 바꾼다 — 파일 글을 감싸야 하는 까닭
    expect(plain.textContent).toBe(translate('무늬', 'ja'));
  });
});

describe('패널의 파일 글(52차)', () => {
  const scene = skpToScene(collideFile(), { outline: true });

  it('합성 모형의 이름이 태그·재질·구성·정의·단면·장면·속성 사전·모형 정보에 그대로 든다', () => {
    const m = scene.meta as Record<string, any>;
    expect(m.tagStats.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['이', 'Texture', XSS_IMG, '무늬 · 이']));
    expect(m.materialStats.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['무늬', '이 — 면', XSS_B, 'Glass']));
    expect(m.pages.map((p: { name: string }) => p.name)).toEqual(['무늬', 'Front', XSS_IMG]);
    expect(m.modelName).toBe('무늬');
    expect(m.location.city).toBe('무늬');
    expect(JSON.stringify(m.attributes)).toContain('이 · 면');
  });

  it.each(['en', 'de', 'ja', 'zh-CN'])('%s: 이름은 원문 그대로, 앱 글은 옮기고, HTML 같은 이름은 글로만 — 한국어로 되돌려도', async (code) => {
    history.replaceState(null, '', `/opencad-skp/${code}/`);
    const d = createDoc('무늬.skp', 1, { scene, ms: 1 });
    let panel!: Panel;
    panel = new Panel(host(d, () => panel));
    document.body.append(panel.el);
    panel.el.hidden = false;
    const w = watch(document.body);
    dispose = await installLocalization(document.body);
    // 감시가 잡는지: 감싸지 않은 이름 마디("나무")와 속성은 번역층이 바꾼다
    const bare = document.createElement('span');
    bare.textContent = '나무';
    bare.title = '무늬';
    document.body.append(bare);
    await tick();
    expect(w.hits.length).toBe(2);
    w.hits.length = 0;
    bare.remove();
    const tour = async (): Promise<void> => {
      for (const tab of ['tags', 'outline', 'info', 'entity'] as const) {
        d.panelTab = tab;
        panel.show(d);
        await tick();
      }
      d.panelTab = 'outline';
      for (let i = 0; i < (d.tree?.count ?? 0); i++) d.expanded.add(i);
      panel.rerender();
      await tick();
      d.outlineQuery = '무늬';
      panel.rerender();
      await tick();
      d.outlineQuery = '';
      d.fileSections = [d.sectionPlanes[0]!.index];
      d.panelTab = 'tags';
      panel.rerender();
      await tick();
      d.panelTab = 'entity';
      const sels: Selection[] = [
        ...Array.from({ length: d.tree?.count ?? 0 }, (_, i): Selection => ({ kind: 'node', index: i })),
        ...d.outline.map((r): Selection => ({ kind: 'outline', index: r.index })),
        ...d.materials.map((m): Selection => ({ kind: 'material', name: m.name })),
        { kind: 'definition', name: '나무' },
        null as unknown as Selection,
      ];
      for (const s of sels) {
        d.selection = s;
        panel.rerender();
        await tick(6);
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    await tour();
    // 장면 카드·정보 줄
    d.panelTab = 'info';
    panel.rerender();
    await tick();
    const info = [...panel.el.querySelectorAll('.prop-row')].map((r) => [r.querySelector('.k')!.textContent, r.querySelector('.v')!.textContent]);
    expect(info).toContainEqual([translate('이름', code), '무늬.skp']);
    expect(info).toContainEqual([translate('모형 이름', code), '무늬']);
    expect(info).toContainEqual([translate('설명', code), '이 — 면']);
    expect(info).toContainEqual([translate('장소', code), '무늬, Texture']);
    expect([...panel.el.querySelectorAll<HTMLElement>('.scene-card')].map((c) => c.title)).toEqual(['무늬\nTexture', 'Front', `${XSS_IMG}\n이 · 면`]);
    // 고른 것: 속성 사전(이름·열쇠·값)과 아래 띠
    d.panelTab = 'entity';
    d.selection = d.outline.find((r) => r.name === '무늬 · 이') ? { kind: 'outline', index: d.outline.find((r) => r.name === '무늬 · 이')!.index } : null;
    panel.rerender();
    await new Promise((r) => setTimeout(r, 20));
    await tick();
    const dicts = [...panel.el.querySelectorAll('.attr-dict')];
    expect(dicts.map((x) => x.querySelector('summary [translate="no"]')!.textContent)).toEqual(expect.arrayContaining(['재질', XSS_B]));
    const kv = dicts.flatMap((x) => [...x.querySelectorAll('.prop-row')].map((r) => [r.querySelector('.k')!.textContent, r.querySelector('.v')!.textContent]));
    expect(kv).toEqual(expect.arrayContaining([['이', '무늬'], ['면', '이 · 면'], [XSS_IMG, XSS_IMG], ['Texture', 'Front']]));
    const rows = [...panel.el.querySelectorAll('.pbody .prop-row')].map((r) => [r.querySelector('.k')!.textContent, r.querySelector('.v')!.textContent]);
    expect(rows).toContainEqual([translate('인스턴스', code), '무늬 · 이']);
    expect(rows).toContainEqual([translate('태그', code), '무늬 · 이']);
    const foot = panel.el.querySelector('.pfoot')!.textContent!;
    expect(foot).toContain('무늬 · 이');
    expect(foot).not.toMatch(/This|Dieses|この|此/);
    // 바뀐 이름이 없고, 주입된 요소가 없다
    expect(w.hits).toEqual([]);
    expect(document.querySelector('[data-xss], img[src="x"]')).toBeNull();
    // 앱 글은 옮겼다(탭 이름·정보 줄 이름표·칩)
    expect([...panel.el.querySelectorAll('.ptab')].map((t) => t.textContent)).not.toContainEqual(expect.stringMatching(/[가-힣]/));
    // 한국어로 되돌려도(다른 언어 사전의 번역 글과 같은 이름 "Texture"·"Glass"·"Front"를 열쇠로 되찾지 않는다)
    (document.querySelector('.language-list [data-language="ko"]') as HTMLButtonElement).click();
    await tick(8);
    await tour();
    expect(w.hits).toEqual([]);
    expect(document.querySelector('[data-xss], img[src="x"]')).toBeNull();
    w.stop();
  });

  it('정보 줄: 이름·정의·위치·태그·재질·설명·GUID·불러온 파일만 파일 글, 앱 글 값("기본값"·"3개"·상태)과 앱 자리 이름은 옮긴다', () => {
    const rows = (e: EntityInput): Record<string, boolean> => Object.fromEntries(entityInfo(e, DEFAULT_UNITS, 1).rows.map((r) => [`${r.label}=${r.value}`, !!r.file]));
    expect(rows({ kind: 'component', name: '이', definition: '나무', instances: 3, path: '무늬 › 이', tag: 'Texture', material: '무늬', description: '면', guid: 'g', hidden: true, locked: true, faces: 2 })).toEqual({
      '인스턴스=이': true,
      '정의=나무': true,
      '놓인 수=3개': false,
      '위치=무늬 › 이': true,
      '태그=Texture': true,
      '재질=무늬': true,
      '면=2': false,
      '설명=면': true,
      'GUID=g': true,
      '상태=숨김 · 잠김': false,
    });
    expect(rows({ kind: 'face', material: null })).toEqual({ '재질=기본값': false });
    expect(rows({ kind: 'face', material: '기본 재질' })).toEqual({ '재질=기본 재질': false });
    expect(rows({ kind: 'loose', name: '모형에 바로 놓인 형상' })).toEqual({ '이름=모형에 바로 놓인 형상': false });
  });

  it('고른 것 설명: 원문은 예전과 같고, 파일 글 자리를 따로 둔다', () => {
    const d = createDoc('무늬.skp', 1, { scene, ms: 1 });
    const r = d.outline.find((x) => x.name === '무늬 · 이')!;
    expect(selectionText(d, { kind: 'outline', index: r.index })).toBe('그룹 무늬 · 이 (Group#1) · 태그 무늬 · 이 · 면 6');
    expect(selectionParts(d, { kind: 'outline', index: r.index }).filter((p) => typeof p !== 'string')).toEqual([{ file: '무늬 · 이' }, { file: 'Group#1' }, { file: '무늬 · 이' }]);
    expect(selectionText(d, { kind: 'material', name: '이 — 면' })).toMatch(/^재질 이 — 면 · 면 \d+$/);
    expect(selectionText(d, { kind: 'definition', name: '나무' })).toBe('컴포넌트 정의 나무 · 놓인 수 3개');
  });
});
