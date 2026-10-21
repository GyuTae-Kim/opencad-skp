/**
 * 구성(아웃라이너) 찾기와 정의별 인스턴스 모으기(순수 함수, DOM 없음) — SketchUp 아웃라이너의 거르기 칸과
 * 컴포넌트 창의 "인스턴스 고르기"처럼. 이름·정의·태그에 찾는 글이 들어 있으면(대소문자·한글 조합 무시) 맞는다.
 */
import type { OutlineRow } from './doc';
import { nodeDefinition, nodeName, nodeTag, type TreeData } from './tree';

/** 한 번에 보이는 찾은 항목 수 */
export const SEARCH_LIMIT = 500;

/** 찾는 글 다듬기(앞뒤 빈칸, 소문자, 한글 조합 NFC) */
export function normalizeQuery(q: string): string {
  return q.normalize('NFC').trim().toLocaleLowerCase();
}

const has = (text: string, q: string): boolean => text.normalize('NFC').toLocaleLowerCase().includes(q);

/** 나무 노드 찾기: 이름·정의·태그. 노드 차례(얕은 단계부터)로 limit개까지, total은 맞은 전체 수 */
export function searchTree(t: TreeData, query: string, limit = SEARCH_LIMIT): { nodes: number[]; total: number } {
  const q = normalizeQuery(query);
  const nodes: number[] = [];
  let total = 0;
  if (!q) return { nodes, total };
  for (let i = 0; i < t.count; i++) {
    if (!(has(nodeName(t, i), q) || has(nodeDefinition(t, i), q) || has(nodeTag(t, i), q))) continue;
    total++;
    if (nodes.length < limit) nodes.push(i);
  }
  return { nodes, total };
}

/** 윗단계 목록(나무가 없을 때) 찾기: 이름·정의·태그 */
export function searchOutline(rows: readonly OutlineRow[], query: string, limit = SEARCH_LIMIT): { rows: OutlineRow[]; total: number } {
  const q = normalizeQuery(query);
  const out: OutlineRow[] = [];
  let total = 0;
  if (!q) return { rows: out, total };
  for (const r of rows) {
    if (!(has(r.name, q) || has(r.definition ?? '', q) || (r.kind !== 'loose' && has(r.tag, q)))) continue;
    total++;
    if (out.length < limit) out.push(r);
  }
  return { rows: out, total };
}

/** 정의 이름이 같은 컴포넌트 노드(모든 단계) */
export function definitionNodes(t: TreeData, name: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.count; i++) if (t.kind[i] === 1 && nodeDefinition(t, i) === name) out.push(i);
  return out;
}

/** 나무 노드의 경로 글(부모들, "집 › 1층") */
export function parentPath(t: TreeData, i: number): string {
  const names: string[] = [];
  for (let k = t.parent[i]!, n = 0; k >= 0 && n < 64; k = t.parent[k]!, n++) names.push(nodeName(t, k));
  return names.reverse().join(' › ');
}
