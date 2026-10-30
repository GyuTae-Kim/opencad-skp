/**
 * 그래픽 문맥 복구 때 다시 줄 것 고르기(27차 — 해석 워커의 arrays 요청에서 쓰는 순수 부분).
 *
 * 큰 모형은 코어 0.25.0 놓기로 법선·무늬 좌표와 손질한 무늬 그림을 GPU에 올린 뒤 놓는다(app/release.ts). 문맥을 되찾으면 화면이 같은 파일을
 * 다시 넘기고, 워커는 처음 열 때와 같은 선택으로 다시 푼 장면에서 바란 그물의 배열과 바란 무늬만 골라 보낸다. 나머지(위치·색인·선분·meta·그림 바이트)는
 * 이전하지 않고 버린다(워커를 끝내면 놓인다). 정점 수가 다른 그물은 주지 않는다 — 파일이 바뀐 것이다(코어는 배열 길이만 본다).
 * 28차: 처음 열 때 법선·무늬 좌표를 줄였으면(pack.ts — 큰 모형) 같은 꼴로 다시 줄여 준다. 법선은 pack이면 Int8 정점 4값, 무늬 좌표는 화면이 보낸 변환
 * (장면 그물에 남은 uvTransform·backUvTransform)이 있으면 다시 줄여 변환이 같을 때만, 없으면(Float32로 두었던 것) 다시 푼 Float32 그대로.
 */
import type { Scene3d } from 'opencad-viewer3d/types';
import type { ArraysResult, ArraysWant } from '../app/protocol';
import { packMeshNormals, restoreUvs } from './pack';

/** 다시 푼 장면에서 바란 그물의 배열(바란 것 가운데 있는 것만, 하나도 없으면 그 그물은 뺀다). pack: 처음 열 때 법선을 줄였다 */
export function pickRestoreMeshes(scene: Pick<Scene3d, 'meshes'>, want: readonly ArraysWant[], pack = false): ArraysResult['meshes'] {
  const byId = new Map(scene.meshes.map((m) => [m.id, m] as const));
  const out: ArraysResult['meshes'] = [];
  for (const w of want) {
    const m = byId.get(w.id);
    if (!m || m.positions.length !== w.nv * 3) continue;
    const o: ArraysResult['meshes'][number] = { id: w.id };
    if (w.normals && m.normals) o.normals = pack && m.normals instanceof Float32Array ? packMeshNormals(m.normals) : m.normals;
    const uvs = w.uvs && m.uvs ? restoreUvs(m.uvs, w.nv, w.uvT) : null;
    if (uvs) o.uvs = uvs;
    const back = w.backUvs && m.backUvs ? restoreUvs(m.backUvs, w.nv, w.backUvT) : null;
    if (back) o.backUvs = back;
    if (o.normals || o.uvs || o.backUvs) out.push(o);
  }
  return out;
}

/** 다시 푼 장면에서 바란 무늬(워커가 손질한 그림, 손질하지 않은 무늬는 그림 바이트) */
export function pickRestoreTextures(scene: Pick<Scene3d, 'textures'>, ids: readonly string[]): ArraysResult['textures'] {
  const want = new Set(ids);
  const out: ArraysResult['textures'] = [];
  for (const t of scene.textures ?? []) {
    if (!want.has(t.id)) continue;
    if (t.bitmap) out.push({ id: t.id, bitmap: t.bitmap, width: t.bitmap.width, height: t.bitmap.height });
    else if (t.data?.length) {
      const o: ArraysResult['textures'][number] = { id: t.id, data: t.data };
      if (t.mime) o.mime = t.mime;
      if (t.width) o.width = t.width;
      if (t.height) o.height = t.height;
      out.push(o);
    }
  }
  return out;
}
