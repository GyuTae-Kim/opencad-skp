import { describe, expect, it } from 'vitest';
import { createDoc, selectionDefinition, selectedDefinitionNodes, selectionEntity, selectionIds, selectionRanges, selectionText } from '../../src/app/doc';
import { definitionNodes, normalizeQuery, parentPath, searchOutline, searchTree } from '../../src/app/search';
import { nodeDefinition, nodeName } from '../../src/app/tree';
import { sampleSkpBytes } from '../../src/app/sample';
import { skpToScene } from '../../src/index';

const doc = () => createDoc('예제.skp', 1, { scene: skpToScene(sampleSkpBytes(), { name: '예제', outline: true }), ms: 1 });

describe('구성 찾기', () => {
  it('이름·정의·태그에 든 글(대소문자·앞뒤 빈칸 무시)로 노드를 찾는다', () => {
    const d = doc();
    const t = d.tree!;
    expect(normalizeQuery('  ChAiR ')).toBe('chair');
    // 의자 넷과 그 안쪽(이름·정의에 "의자"가 든 부품)
    const chairs = searchTree(t, '의자');
    expect(chairs.nodes.filter((n) => nodeDefinition(t, n) === '의자').length).toBe(4);
    expect(chairs.nodes.every((n) => `${nodeName(t, n)} ${nodeDefinition(t, n)}`.includes('의자'))).toBe(true);
    // 태그로도 찾는다(가구 태그 = 의자 넷 + 탁자)
    expect(searchTree(t, '가구').total).toBeGreaterThanOrEqual(5);
    expect(searchTree(t, '없는 이름').total).toBe(0);
    expect(searchTree(t, '   ')).toEqual({ nodes: [], total: 0 });
    // 한도
    const one = searchTree(t, '의자', 1);
    expect(one).toEqual({ nodes: [chairs.nodes[0]], total: chairs.total });
  });

  it('나무가 없는 윗단계 목록도 거른다(바로 놓인 형상은 태그로 찾지 않는다)', () => {
    const d = doc();
    const res = searchOutline(d.outline, '나무');
    expect(res.total).toBe(3);
    expect(res.rows.every((r) => r.definition === '나무')).toBe(true);
    expect(searchOutline(d.outline, '').total).toBe(0);
  });

  it('경로 글은 부모들(맨 위부터)', () => {
    const d = doc();
    const t = d.tree!;
    const deep = Array.from({ length: t.count }, (_, i) => i).find((i) => t.parent[i]! >= 0)!;
    expect(parentPath(t, deep)).toBe(nodeName(t, t.parent[deep]!));
    expect(parentPath(t, 0)).toBe('');
  });
});

describe('같은 정의 모두 고르기', () => {
  it('정의 줄 → 인스턴스 모두(따로 나눈 노드는 항목, 깊은 노드는 구간), 엔티티는 컴포넌트 n개', () => {
    const d = doc();
    const t = d.tree!;
    const nodes = definitionNodes(t, '의자');
    expect(nodes.length).toBe(4);
    const sel = { kind: 'definition' as const, name: '의자' };
    expect(selectedDefinitionNodes(d, sel)).toEqual(nodes);
    const ids = selectionIds(d, sel);
    const ranges = selectionRanges(d, sel);
    // 인스턴스 넷이 모두 강조된다(항목째든 구간이든)
    expect(ids.length + (ranges?.size ?? 0)).toBeGreaterThan(0);
    d.selection = sel;
    const e = selectionEntity(d);
    expect(e).toMatchObject({ kind: 'component', count: 4, definition: '의자', instances: 4, faces: 31 * 4 });
    expect(selectionText(d, sel)).toBe('컴포넌트 정의 의자 · 놓인 수 4개');
  });

  it('고른 컴포넌트가 둘 이상 놓였으면 그 정의를 알려 준다(하나뿐이거나 그룹이면 null)', () => {
    const d = doc();
    const chair = d.outline.find((r) => r.definition === '의자')!;
    expect(selectionDefinition(d, { kind: 'outline', index: chair.index })).toEqual({ name: '의자', count: 4 });
    const table = d.outline.find((r) => r.definition === '탁자')!;
    expect(selectionDefinition(d, { kind: 'outline', index: table.index })).toBeNull();
    const house = d.outline.find((r) => r.kind === 'group')!;
    expect(selectionDefinition(d, { kind: 'outline', index: house.index })).toBeNull();
    expect(selectionDefinition(d, null)).toBeNull();
  });
});
