/**
 * SketchUp 2027 판(87차): 실제 2027 표본 하나(27.0.277)를 2026 표본과 기록 단위로 견준 결과를 손으로 옮긴 합성 바이트로 못 박는다
 * (실제 파일은 저장소에 넣지 않는다 — docs/formats/skp.md "SketchUp 2027 표본 대조").
 * - 확인한 판 한도는 27: 27.x는 판 경고 없이 2021~2026과 같은 장면, 28.x부터 "표본으로 확인하지 않은 판" 경고(2021~2027 형식으로 읽음).
 * - 2027 표본에서 처음 본 뿌리 절 0211·0215·0218은 빈 꼴(0211 → 7D00 → 7D01, 0215 → 7D82, 0218 → 7E90 — 모두 길이 0)이었다:
 *   그 꼴이면 경고 없음, 내용이 있으면 읽지 않았다고 절마다 경고(형상은 그대로). 한 버퍼 읽기와 풀면서 읽기가 같다.
 * - 렌더링 레코드 7388(기본 단면 채우기 해치: 7D0A → 색·배율·회전)·738C(bool)는 읽지 않는 레코드라 장면과 상관없다.
 */
import { describe, expect, it } from 'vitest';
import { SKP_MAX_CHECKED_MAJOR, skpToScene, skpToSceneAsync } from '../src/index';
import { sceneDigest } from '../scripts/sweep/probe';
import { edge, entities, f32, face, modelDat, skpFile, tlv, vertex } from './build';

/** 정사각형 판 하나(재질 없음) */
function plateRoot(): Uint8Array {
  return entities(undefined, {
    vertices: [vertex(1, 0, 0, 0), vertex(2, 10, 0, 0), vertex(3, 10, 10, 0), vertex(4, 0, 10, 0)],
    edges: [edge(11, 1, 2), edge(12, 2, 3), edge(13, 3, 4), edge(14, 4, 1)],
    faces: [
      face(
        21,
        [0, 0, 1, 0],
        [
          [
            [11, false],
            [12, false],
            [13, false],
            [14, false],
          ],
        ],
      ),
    ],
  });
}

const EMPTY = new Uint8Array(0);
/** 2027 표본의 빈 꼴 그대로 */
const S0211 = (): Uint8Array => tlv(0x0211, tlv(0x7d00, tlv(0x7d01, EMPTY)));
const S0215 = (inner: Uint8Array = EMPTY): Uint8Array => tlv(0x0215, tlv(0x7d82, inner));
const S0218 = (inner: Uint8Array = EMPTY): Uint8Array => tlv(0x0218, tlv(0x7e90, inner));
/** 2027 렌더링 레코드의 새 칸(표본 값): 7388 → 7D0A(색 0,0,0,255 · 빈 칸 · 배율 1·1 · 빈 칸 둘 · 회전 0), 738C bool 0 */
const RENDER_2027: [number, Uint8Array][] = [
  [
    0x7388,
    tlv(
      0x7d0a,
      tlv(0x7d0c, new Uint8Array([0, 0, 0, 255])),
      tlv(0x7d0d, EMPTY),
      tlv(0x7d0e, f32(1)),
      tlv(0x7d0f, f32(1)),
      tlv(0x7d12, EMPTY),
      tlv(0x7d13, EMPTY),
      tlv(0x7d14, f32(0)),
    ),
  ],
  [0x738c, new Uint8Array([0])],
];

function file(version: string, sections: Uint8Array[] = [], rendering?: [number, Uint8Array][]): Uint8Array {
  return skpFile(modelDat({ root: plateRoot(), sections, ...(rendering ? { rendering } : {}) }), { version });
}

const NEW_RECORD = (tag: string) => `표본에서 비어 있던 모형 기록(0x${tag})에 내용이 있어 읽지 않았습니다(SketchUp 2027의 단면 해치 패턴 같은 새 설정일 수 있습니다)`;

describe('SketchUp 2027 판(87차)', () => {
  it('확인한 판 한도는 27 — 27.x는 판 경고 없이 26.x와 같은 장면', () => {
    expect(SKP_MAX_CHECKED_MAJOR).toBe(27);
    const a = skpToScene(file('26.2.242'));
    const b = skpToScene(file('27.0.277'));
    expect(a.warnings).toEqual([]);
    expect(b.warnings).toEqual([]);
    expect(b.meta?.version).toBe('27.0.277');
    expect(b.meshes.length).toBe(1);
    expect(sceneDigest({ ...b, meta: { ...b.meta, version: a.meta?.version } })).toBe(sceneDigest(a));
  });

  it('28 이상은 "표본으로 확인하지 않은 판" 경고와 함께 같은 형식으로 읽는다', () => {
    const s = skpToScene(file('28.0.10'));
    expect(s.meshes.length).toBe(1);
    expect(s.warnings).toEqual(['표본으로 확인하지 않은 SketchUp 버전 28.0.10입니다. 2021~2027 형식으로 읽어 봅니다.']);
  });

  it('2027 표본처럼 새 뿌리 절이 빈 꼴이고 렌더링 새 칸이 기본값이면 경고 없이 같은 장면', () => {
    const plain = skpToScene(file('27.0.277'));
    const s = skpToScene(file('27.0.277', [S0211(), S0215(), S0218()], RENDER_2027));
    expect(s.warnings).toEqual([]);
    expect(s.meshes.length).toBe(1);
    expect(s.meshes[0]!.positions).toEqual(plain.meshes[0]!.positions);
  });

  it('새 뿌리 절에 내용이 있으면 절마다 읽지 않았다고 경고하고 형상은 그대로 읽는다', () => {
    const plain = skpToScene(file('27.0.277'));
    const filled = skpToScene(file('27.0.277', [S0211(), S0215(tlv(0x7d83, new Uint8Array([1, 2, 3]))), S0218()], RENDER_2027));
    expect(filled.warnings).toEqual([NEW_RECORD('0215')]);
    expect(filled.meshes[0]!.positions).toEqual(plain.meshes[0]!.positions);
    // 빈 꼴과 다른 꼴(자식이 둘·길이가 다른 절)도 내용으로 본다
    const odd = skpToScene(file('27.0.277', [tlv(0x0211, tlv(0x7d00, tlv(0x7d01, new Uint8Array([7])))), S0215(), tlv(0x0218, tlv(0x7e90, EMPTY), tlv(0x7e91, EMPTY))]));
    expect(odd.warnings).toEqual([NEW_RECORD('0211'), NEW_RECORD('0218')]);
    // 판과 상관없이 같은 규칙(2021~2026 표본에는 이 절이 없었다)
    expect(skpToScene(file('26.1.257', [S0215(new Uint8Array([9]))])).warnings).toEqual([NEW_RECORD('0215')]);
  });

  it('풀면서 읽어도(skpToSceneAsync) 같은 경고·장면', async () => {
    for (const bytes of [file('27.0.277', [S0211(), S0215(), S0218()], RENDER_2027), file('27.0.277', [S0211(), S0215(), S0218(tlv(0x7e91, new Uint8Array([1])))])]) {
      const a = skpToScene(bytes.slice());
      const b = await skpToSceneAsync(bytes.slice(), { streamMin: 1 });
      expect(b.warnings).toEqual(a.warnings);
      expect(sceneDigest(b)).toBe(sceneDigest(a));
    }
  });
});
