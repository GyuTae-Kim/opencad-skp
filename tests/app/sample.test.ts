import { describe, expect, it } from 'vitest';
import { readSkpHeader } from '../../src/header';
import { skpToScene } from '../../src/index';
import { readZipDirectory } from '../../src/zip';
import { createSampleSkp, deflateRawAsync, loopNormal, placement, sampleSkpBytes, SAMPLE_VERSION } from '../../src/app/sample';
import { crc32 } from '../../src/app/skpwrite';
import { nodeDeflate } from '../build';

describe('예제 모형', () => {
  it('2026 판 꼴의 작은 파일이고 경고 없이 읽힌다', () => {
    const bytes = sampleSkpBytes();
    expect(bytes.length).toBeLessThan(200 * 1024);
    const h = readSkpHeader(bytes)!;
    expect(h.version).toBe(SAMPLE_VERSION);
    expect(h.container).toBe('zip');
    const s = skpToScene(bytes, { name: '예제', outline: true });
    expect(s.warnings).toEqual([]);
    expect(s.units).toBe('mm');
    expect(s.meta?.lengthUnit).toBe('mm');
    // 태그 다섯(치수 포함) + 기본, 재질 11, 윗단계 = 바로 놓인 형상 + 그룹 2 + 컴포넌트 8
    expect((s.meta?.tags as string[]).length).toBe(6);
    expect(s.meta?.materials).toBe(11);
    expect((s.meta?.outline as unknown[]).length).toBe(11);
    // 집 6 m × 4 m를 mm로: 잔디 마당 범위 14.5 m × 11 m, 지붕 마루 4.3 m + 판 두께
    expect(s.bounds!.max[0] - s.bounds!.min[0]).toBeCloseTo(14_500, 3);
    expect(s.bounds!.max[1] - s.bounds!.min[1]).toBeCloseTo(11_000, 3);
    expect(s.bounds!.max[2]).toBeGreaterThan(4300);
    expect(s.bounds!.max[2]).toBeLessThan(4700);
  });

  it('장면·카메라·글·치수·단면·태그 폴더·속성이 읽힌다', () => {
    const s = skpToScene(sampleSkpBytes(), { name: '예제', outline: true, extras: true, smooth: true });
    const m = s.meta as Record<string, any>;
    expect(s.warnings).toEqual([]);
    expect(m.pages.map((p: { name: string }) => p.name)).toEqual(['앞마당', '식탁', '단면', '위에서']);
    expect(m.activePage).toBe(0);
    expect(m.pages[1].hiddenTags).toEqual(['지붕']);
    expect(m.pages[2].sectionPlanes).toEqual([0]);
    expect(m.pages[3].camera).toMatchObject({ perspective: false });
    expect(m.pages[3].camera.height).toBeCloseTo(15000, 3);
    expect(m.pages[0].thumbnail).toBe('scene_thumbnails/앞마당.png');
    expect(m.camera.fovY).toBeCloseTo(35);
    expect(m.units).toMatchObject({ lengthUnit: 'mm', lengthFormat: 'decimal', lengthPrecision: 0, areaUnit: 'square_m' });
    expect(m.modelName).toBe('예제 집');
    expect(m.tagFolders.map((f: { name: string }) => f.name)).toEqual(['건물', '주석']);
    expect(m.texts.map((t: { text: string }) => t.text)).toEqual(['현관', 'OpenCAD 예제 집']);
    expect(m.texts[1].screen).toEqual([0.62, 0.92]);
    expect(m.dimensions.map((d: { value: number }) => Math.round(d.value))).toEqual([6000, 4000]);
    expect(m.sectionPlanes).toHaveLength(1);
    expect(m.sectionPlanes[0]).toMatchObject({ name: '집 단면', active: false, node: -1 });
    expect(m.annotationItems.dimensions.length).toBeGreaterThan(0);
    expect(m.annotationItems.guides.length).toBeGreaterThan(0);
    // 의자 정의 속성 사전(넷 놓인 의자 노드 모두 같은 정의 사전)
    const info = m.treeInfo;
    const tree = m.tree;
    const chair = tree.names.indexOf('의자 북');
    expect(chair).toBeGreaterThanOrEqual(0);
    expect(m.attributes[info.attrs[chair]]).toEqual({ 배치: { 자리: '북쪽', 주인: '집주인' } });
    const def = tree.definition[chair];
    expect(m.attributes[info.definitionAttrs[def]].제품.이름).toBe('식탁 의자');
    expect(info.definitionDescription[def]).toContain('의자');
    // 의자 크기(정의 범위 × 축 배율): 폭 약 0.45 m
    expect(info.size[chair * 3]).toBeGreaterThan(300);
  });

  it('면 구멍(창)과 홈(문)이 삼각화된다 — 실패한 면이 없다', () => {
    const s = skpToScene(sampleSkpBytes());
    const glass = s.meshes.filter((m) => m.name?.startsWith('유리'));
    expect(glass.length).toBe(1);
    expect(glass[0]!.color[3]).toBeCloseTo(0.35);
    expect((s.meta?.faces as number) > 100).toBe(true);
  });

  it('압축해도 같은 장면, ZIP 항목 CRC가 맞다', async () => {
    const stored = sampleSkpBytes();
    const packed = sampleSkpBytes(nodeDeflate);
    expect(packed.length).toBeLessThan(stored.length / 2);
    const a = skpToScene(stored);
    const b = skpToScene(packed);
    expect(b.meshes.map((m) => m.positions.length)).toEqual(a.meshes.map((m) => m.positions.length));
    const dir = readZipDirectory(packed)!;
    expect(dir.find((d) => d.name === 'model.dat')!.method).toBe(8);
    // 브라우저 경로(CompressionStream)도 같은 장면 — 없는 환경이면 저장 방식
    const viaStream = await createSampleSkp();
    expect(skpToScene(viaStream).meshes.length).toBe(a.meshes.length);
    const raw = await deflateRawAsync(new Uint8Array([1, 2, 3]));
    expect(raw === null || raw.length > 0).toBe(true);
  });

  it('CRC-32·법선·배치 도움 함수', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    const n = loopNormal([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]);
    expect(n).toEqual([0, 0, 1]);
    const m = placement(254, 0, 0, 90, 2);
    expect(m.slice(0, 9)).toEqual([0, -2, 0, 2, 0, 0, 0, 0, 2]);
    expect(m[9]).toBeCloseTo(10);
  });
});
