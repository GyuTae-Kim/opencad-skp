// @vitest-environment jsdom
/**
 * 3D 뷰어 코어가 장면을 받으며 빼거나 고쳐 그린 깨진 입력(코어 0.50.0 sceneIssues — 54차)을 정보 탭 경고 칸에 잇기:
 * 코어 검사(checkScene — 뷰어가 setScene에서 쓰는 그 판정)가 낸 알림을 앱 글(warntext.ts CORE_ISSUE_TEXT — 사전 열쇠)로 옮기고,
 * 해석기 경고 뒤에 그 수만큼 줄을 더하며 칸 제목의 수에 더한다. 네 언어에서 한글이 남지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { checkScene, SCENE_ISSUE_MESSAGES, type SceneIssueCode } from 'opencad-viewer3d/sceneissues';
import type { Mesh3d } from 'opencad-viewer3d/types';
import { skpToScene } from '../../src/index';
import { sampleSkpBytes } from '../../src/app/sample';
import { createDoc } from '../../src/app/doc';
import { infoSections } from '../../src/app/infotab';
import { CORE_ISSUE_TEXT, coreIssueText } from '../../src/app/warntext';
import { languages, translate } from '../../site/i18n.mjs';

describe('코어 입력 알림 → 정보 탭 경고(54차)', () => {
  it('알림 종류마다 앱 글이 있고(코어 기본 글과 같은 종류), 수 자리를 채운다', () => {
    expect(Object.keys(CORE_ISSUE_TEXT).sort()).toEqual(Object.keys(SCENE_ISSUE_MESSAGES).sort());
    expect(coreIssueText({ code: 'positions', count: 1234 })).toBe('3D 보기: 좌표가 깨진 정점 1,234개를 쓰는 도형을 그리지 않았습니다');
    expect(coreIssueText({ code: 'placement', count: 1 })).toBe(CORE_ISSUE_TEXT.placement);
    // 항목 id(그물 이름)는 넣지 않는다
    for (const t of Object.values(CORE_ISSUE_TEXT)) expect(t).not.toMatch(/\{id\}|\{field\}/);
  });

  it('네 언어 사전이 모든 알림 글을 옮긴다(수를 넣은 글도)', () => {
    for (const { code } of languages.filter((l) => l.code !== 'ko'))
      for (const k of Object.keys(CORE_ISSUE_TEXT) as SceneIssueCode[]) {
        const t = coreIssueText({ code: k, count: 12 });
        const got = translate(t, code);
        expect(got, `${code}: ${t}`).not.toMatch(/[가-힣]/);
        if (CORE_ISSUE_TEXT[k].includes('{0}')) expect(got, `${code}: ${t}`).toContain('12');
      }
  });

  it('깨진 그물을 넣은 예제 장면: 코어 검사 알림을 해석기 경고 뒤로 잇고 칸 제목 수에 더한다', () => {
    const scene = skpToScene(sampleSkpBytes(), { name: '예제', outline: true });
    const before = scene.warnings?.length ?? 0;
    // 좌표 NaN 정점 둘·정점 수 밖 색인 하나인 그물
    const bad: Mesh3d = { id: 'bad', positions: new Float32Array([0, 0, 0, NaN, 0, 0, 1, 1, NaN, 2, 0, 0]), indices: new Uint32Array([0, 1, 2, 0, 3, 9]), color: [1, 0, 0, 1] };
    scene.meshes.push(bad);
    const { issues } = checkScene(scene);
    expect(issues.map((i) => i.code).sort()).toEqual(['indices', 'positions']);
    const d = createDoc('예제.skp', 1, { scene, ms: 1 });
    d.coreIssues = issues;
    const els = infoSections(d, () => undefined);
    const warn = els.find((s) => /^경고/.test(s.querySelector('h3, .sec-title, summary, header')?.textContent ?? s.textContent ?? ''))!;
    const items = [...warn.querySelectorAll('ul.warns > li')].map((li) => li.textContent);
    expect(items.length).toBe(before + 2);
    expect(items.slice(before)).toEqual(issues.map((i) => coreIssueText(i)));
    expect(warn.textContent).toContain(`경고 ${before + 2}개`);
  });

  it('멀쩡한 예제 장면은 알림이 없고 경고 칸은 해석기 경고 그대로', () => {
    const scene = skpToScene(sampleSkpBytes(), { name: '예제', outline: true });
    expect(checkScene(scene).issues).toEqual([]);
    const d = createDoc('예제.skp', 1, { scene, ms: 1 });
    expect(d.coreIssues).toEqual([]);
    const els = infoSections(d, () => undefined);
    const n = scene.warnings?.length ?? 0;
    const warn = els.find((s) => (s.textContent ?? '').includes(n ? `경고 ${n}개` : '해석기가 남긴 경고가 없습니다.'));
    expect(warn).toBeTruthy();
  });
});
