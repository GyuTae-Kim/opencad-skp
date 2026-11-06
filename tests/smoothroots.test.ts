/**
 * 부드러운 음영 꼭짓점 법선(src/scene-smooth.ts cornerNormals) — 36차에 무리 뿌리를 꼭짓점마다 한 번만 찾고 정규화를 뿌리마다 한 번만 하게 바꿨다.
 * 바꾸기 전 차례(tests/smoothref.ts cornerNormalsBefore)와 굽은 띠·고리·크게 꺾인 면·고리 시작이 다른 면이 섞인 합성 정의에서
 * 두 결과가 값(±0까지)·차례 모두 같은지 본다.
 */
import { describe, expect, it } from 'vitest';
import { cornerNormals } from '../src/scene-smooth';
import { cornerNormalsBefore, rng, strip, stripDefinition } from './smoothref';

describe('부드러운 음영 꼭짓점 법선 — 뿌리마다 한 번 정규화(36차)', () => {
  it('바꾸기 전 차례와 값·차례가 모두 같다(굽은 띠·고리·크게 꺾인 면, 고리 시작이 다른 면)', () => {
    let joined = 0;
    let lone = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const ents = stripDefinition([strip(10000, 6 + Math.floor(r() * 20), r), strip(20000, 8 + Math.floor(r() * 24), r, { ring: true }), strip(30000, 12, r, { crease: 5 })]);
      const want = cornerNormalsBefore(ents);
      const got = cornerNormals(ents);
      expect(want).not.toBeNull();
      expect(got!.faceIndex).toEqual(want!.faceIndex);
      expect(got!.start).toEqual(want!.start);
      expect(got!.normals).toEqual(want!.normals);
      joined += want!.start.length - 1;
      // 크게 꺾인 면(세 번째 띠의 5번째)은 이어 칠하지 않는다
      for (let f = 0; f < want!.faceIndex.length; f++) if (want!.faceIndex[f]! < 0) lone++;
    }
    expect(joined).toBeGreaterThan(500);
    expect(lone).toBeGreaterThanOrEqual(40);
  });

  it('매끈한 모서리가 없으면 둘 다 null', () => {
    const ents = stripDefinition([strip(10000, 5, rng(7), { smooth: false })]);
    expect(ents.faces.length).toBe(5);
    expect(cornerNormals(ents)).toBeNull();
    expect(cornerNormalsBefore(ents)).toBeNull();
  });
});
