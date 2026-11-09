/**
 * 파일 단면 → 코어 여러 단면 평면(순수 함수, DOM 없음). 55차: 구간 단면(코어 0.44.0)을 더하며 첫 화면 조각에서 빼 코어와 함께 받는다
 * (core.ts loadViewerCore — 단면은 뷰어가 있어야 쓰므로 뷰어를 만들 때 늘 받아 있다).
 */
import type { Scene3d, SectionItem, SectionPlane } from 'opencad-viewer3d';
import type { SkpSectionPlaneMeta } from '../meta';
import { MAX_SECTION_PLANES, type SkpDoc } from './doc';
import { triangleCount } from './faces';
import { isSplit, nodeItemIds, nodeRanges, type TreeView } from './tree';

/**
 * 그룹·컴포넌트 안 단면이 자를 것(코어 SectionPlane.items): 따로 나눈 노드는 그 노드의 항목 id, 나누지 않은 깊은 노드는 그 노드 구간(nodeRanges —
 * 해석기가 재질·태그로 합친 그물 안의 삼각형·선분 번호, 코어 0.44.0 구간 단면 { id, start, count }). 카메라를 보는 그물은 삼각형을 모두 자르면
 * 그 윤곽선(그 배치의 모서리)도 자른다(edges: true — 숨김 구간과 같은 규칙). 구간을 버린 큰 나무(runsDropped)면 빈 목록(자를 수 없음).
 * 잘린 면 채우기: 노드 구간은 늘 배치 단위로 이어지고(구간 = 그 노드 아래 배치들의 면), 닫힌 입체 묶음(capGroup)에는 닫힌 배치만 들므로
 * 그 구간은 닫힌 입체들이다 — 코어는 같은 capGroup의 같은 갈래(같은 평면 모음)를 한 단위로 홀짝을 센다
 */
export function sectionItems(t: TreeView, scene: Scene3d, node: number): SectionItem[] {
  if (node < 0 || node >= t.count) return [];
  if (isSplit(t, node)) return nodeItemIds(t, scene, node);
  const out: SectionItem[] = [];
  for (const [it, list] of nodeRanges(t, scene, node)) {
    if (it < scene.meshes.length) {
      const mesh = scene.meshes[it]!;
      for (const r of list) out.push({ id: mesh.id, start: r.start, count: r.count });
      const e = mesh.edges;
      if (e && e.length >= 6 && list.length === 1 && list[0]!.start <= 0 && list[0]!.start + list[0]!.count >= triangleCount(mesh))
        out.push({ id: mesh.id, start: 0, count: Math.floor(e.length / 6), edges: true });
    } else {
      const line = scene.lines[it - scene.meshes.length];
      if (line) for (const r of list) out.push({ id: line.id, start: r.start, count: r.count });
    }
  }
  return out;
}

/**
 * 파일 단면(activeSections) → 코어 setSections 평면: 모형 단면은 장면 전체, 그룹·컴포넌트 안 단면은 그 노드 안쪽만 자른다(sectionItems —
 * 따로 나눈 노드는 항목, 나누지 않은 노드는 구간). 자를 것을 모르는 단면(구간을 버린 큰 나무·나무 밖 노드)과 코어 한도(MAX_SECTION_PLANES)를 넘는
 * 단면은 건너뛰고 수를 센다
 */
export function sectionPlanesFor(
  d: Pick<SkpDoc, 'tree' | 'scene'>,
  list: readonly { index: number; plane: Pick<SkpSectionPlaneMeta, 'node'>; normal: readonly number[]; offset: number }[],
  caps: 'closed' | 'none' | 'all',
): { planes: SectionPlane[]; applied: number[]; skipped: { scope: number; limit: number } } {
  const planes: SectionPlane[] = [];
  const applied: number[] = [];
  const skipped = { scope: 0, limit: 0 };
  for (const s of list) {
    const base: SectionPlane = { normal: [s.normal[0]!, s.normal[1]!, s.normal[2]!], offset: s.offset, caps, id: `skp-section-${s.index}` };
    const node = s.plane.node;
    if (node >= 0) {
      const items = d.tree ? sectionItems(d.tree, d.scene, node) : [];
      if (!items.length) {
        skipped.scope++;
        continue;
      }
      base.items = items;
    }
    if (planes.length >= MAX_SECTION_PLANES) {
      skipped.limit++;
      continue;
    }
    planes.push(base);
    applied.push(s.index);
  }
  return { planes, applied, skipped };
}
