import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scene3d } from 'opencad-viewer3d/types';
import { plainText } from '../../src/app/filetext';
import { collectTransfers, errorText, sceneHasGeometry } from '../../src/app/protocol';
import { emptySceneNotice, unsupportedNotice } from '../../src/worker/notice';
import { skpToScene } from '../../src/index';
import { entities, modelDat, skpFile } from '../build';

const scene = (o: Partial<Scene3d> = {}): Scene3d => ({ name: 's', units: 'mm', meshes: [], lines: [], ...o });

describe('collectTransfers', () => {
  it('형식 배열의 버퍼를 버퍼마다 한 번만 모은다', () => {
    const shared = new Float32Array(12);
    const idx = new Uint32Array([0, 1, 2]);
    const s = scene({
      meshes: [
        { id: 'a', positions: shared, indices: idx, color: [1, 1, 1, 1] },
        { id: 'b', positions: shared, color: [1, 1, 1, 1] },
      ],
      lines: [{ id: 'l', positions: new Float32Array(6) }],
      meta: { nested: { list: [new Uint8Array(4)], map: new Map([['k', new Float64Array(2)]]), set: new Set([new Int32Array(1)]) } },
    });
    const t = collectTransfers({ scene: s, ms: 1 });
    expect(t.length).toBe(6);
    expect(new Set(t).size).toBe(t.length);
    expect(t).toContain(shared.buffer);
    expect(t).toContain(idx.buffer);
  });

  it('빈 버퍼·원시 값·순환 참조를 견딘다', () => {
    const o: Record<string, unknown> = { n: 1, s: 'x', empty: new Uint8Array(0), raw: new ArrayBuffer(8) };
    o.self = o;
    const t = collectTransfers(o);
    expect(t.length).toBe(1);
    expect((t[0] as ArrayBuffer).byteLength).toBe(8);
    expect(collectTransfers(null)).toEqual([]);
    expect(collectTransfers(42)).toEqual([]);
  });

  it('같은 버퍼의 여러 보기(subarray)도 한 번', () => {
    const big = new Float32Array(30);
    expect(collectTransfers([big.subarray(0, 6), big.subarray(6, 12)]).length).toBe(1);
  });
});

describe('sceneHasGeometry · errorText', () => {
  it('그릴 것이 있는지', () => {
    expect(sceneHasGeometry(scene())).toBe(false);
    expect(sceneHasGeometry(scene({ meshes: [{ id: 'm', positions: new Float32Array(6), color: [1, 1, 1, 1] }] }))).toBe(false);
    expect(sceneHasGeometry(scene({ meshes: [{ id: 'm', positions: new Float32Array(9), color: [1, 1, 1, 1] }] }))).toBe(true);
    expect(sceneHasGeometry(scene({ lines: [{ id: 'l', positions: new Float32Array(6) }] }))).toBe(true);
    expect(sceneHasGeometry(scene({ points: [{ id: 'p', positions: new Float32Array(3) }] }))).toBe(true);
  });

  it('오류 글', () => {
    expect(errorText(new Error('깨짐'))).toBe('깨짐');
    expect(errorText(new TypeError(''))).toBe('TypeError');
    expect(errorText('글')).toBe('글');
  });
});

describe('빈 장면 알림', () => {
  it('깨지지 않은 빈 SketchUp 모형은 "비어 있습니다"(정보), 정의만 있으면 그 수', () => {
    const empty = skpToScene(skpFile(modelDat({ root: entities(undefined, {}) })));
    expect(sceneHasGeometry(empty)).toBe(false);
    const n = emptySceneNotice(empty, 'a.skp');
    expect(n.kind).toBe('info');
    // 53차: 파일 이름은 파일 글 자리(화면이 옮길 때 그대로 둔다)
    expect(n.title).toEqual(['"', { file: 'a.skp' }, '" 모형이 비어 있습니다']);
    expect(plainText(n.text)).toContain('그릴 면·모서리가 없습니다');
    const onlyDefs = emptySceneNotice(scene({ warnings: [], meta: { version: '26.1.1', definitions: 3 } }), 'b.skp');
    expect(onlyDefs.kind).toBe('info');
    expect(plainText(onlyDefs.text)).toContain('컴포넌트 정의 3개');
  });

  it('경고가 있거나 깨졌거나 SketchUp 파일이 아니면 "열지 못했습니다"와 첫 경고', () => {
    const notSkp = skpToScene(new Uint8Array([1, 2, 3, 4]));
    expect(emptySceneNotice(notSkp, 'x.skp')).toEqual({ kind: 'error', title: ['"', { file: 'x.skp' }, '" 파일을 열지 못했습니다'], text: [notSkp.warnings![0]] });
    expect(emptySceneNotice(scene({ meta: { version: '15.0.1', damaged: true } }), 'y.skp')).toMatchObject({ kind: 'error', text: ['그릴 면이나 모서리를 찾지 못했습니다.'] });
    // 모형 요소 절이 없는 꾸러미는 해석기 경고와 함께
    const noRoot = scene({ warnings: ['모형 요소(01f6)를 찾지 못했습니다'], meta: { version: '21.0.339' } });
    expect(emptySceneNotice(noRoot, 'z.skp')).toMatchObject({ kind: 'error', text: ['모형 요소(01f6)를 찾지 못했습니다'] });
    // 경고 끝의 꾸러미 항목 이름도 파일 글 자리로
    const zip = scene({ warnings: ['SketchUp 파일을 읽지 못했습니다: ZIP 항목이 잘렸습니다: materials/면/a.png'], meta: { version: '21.0.339' } });
    expect(emptySceneNotice(zip, 'w.skp').text).toEqual(['SketchUp 파일을 읽지 못했습니다: ZIP 항목이 잘렸습니다: ', { file: 'materials/면/a.png' }]);
  });
});

describe('옛 판 알림(62차 — 화면이 만들던 글을 해석 워커로)', () => {
  it('SketchUp 3보다 옛 판이면 61차 화면 글과 같은 제목·글(파일 이름은 파일 글 자리), 읽는 판이면 null', () => {
    const TEXT = '" 파일은 SketchUp 3보다 옛 형식으로 저장되어 있습니다. 이 뷰어는 SketchUp 3~8·2013~2026 파일을 읽습니다. SketchUp 3 이상(가능하면 2021 이상)에서 다시 저장한 뒤 열어 주세요.';
    expect(unsupportedNotice(scene({ meta: { version: '2.0.1', container: 'mfc', unsupported: true } }), 'old.skp')).toEqual({
      title: ['아직 읽지 못하는 판입니다: SketchUp 2 (2.0.1)'],
      text: ['"', { file: 'old.skp' }, TEXT],
    });
    // 판 번호를 모르는 거절 파일
    expect(unsupportedNotice(scene({ meta: { unsupported: true } }), 'x.skp')!.title).toEqual(['아직 읽지 못하는 판입니다: SketchUp (알 수 없음)']);
    expect(unsupportedNotice(scene({ meta: { version: '3.0.1', container: 'mfc' } }), 'a.skp')).toBeNull();
    expect(unsupportedNotice(scene({ meta: { version: '26.1.194' } }), 'a.skp')).toBeNull();
    expect(unsupportedNotice(scene(), 'a.skp')).toBeNull();
    // 해석 워커가 결과에 달고, 화면은 그 알림으로(글을 첫 화면 JS에 두지 않는다)
    const worker = readFileSync(resolve(__dirname, '../../src/worker/parse.worker.ts'), 'utf8');
    expect(worker).toContain('const old = unsupportedNotice(scene, req.name);');
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toContain('const old = res.unsupported;');
    expect(app).not.toContain('SketchUp 3보다 옛 형식');
  });
});
