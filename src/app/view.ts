/**
 * 카메라 도움(순수 함수): 좁은 화면에서 아래 시트를 열고 닫아 3D 보기 높이가 바뀔 때 확대해 둔 보기 지키기,
 * 나누지 않은 깊은 노드 맞춰 보기. 카메라 계산은 뷰어 코어(opencad-viewer3d/camera)의 것을 쓴다.
 */
import type { Box3 } from 'opencad-viewer3d';
import { cameraBasis, fitCamera, type CameraState } from 'opencad-viewer3d/camera';

/**
 * 3D 보기 높이가 h0 → h1로 바뀔 때(위쪽 가장자리는 그대로, 아래가 시트에 덮이거나 드러날 때),
 * 위쪽에 보이던 것이 같은 자리·같은 크기로 남게 카메라를 옮긴다.
 * 대상점 깊이에서 화소당 세계 길이(2·거리·tan(시야/2)/높이)를 지키도록 거리를 h1/h0배로 바꾸고,
 * 화면 가운데가 (h0 − h1)/2 화소만큼 위로 옮겨간 자리를 새 대상점으로 한다.
 */
export function keepViewOnHeightChange(c: CameraState, h0: number, h1: number): CameraState {
  if (!(h0 > 0) || !(h1 > 0) || Math.abs(h0 - h1) < 0.5) return c;
  const wpp = (2 * c.distance * Math.tan(c.fovY / 2)) / h0;
  const shift = ((h0 - h1) / 2) * wpp;
  const up = cameraBasis(c).up;
  return {
    ...c,
    distance: (c.distance * h1) / h0,
    target: [c.target[0] + up[0] * shift, c.target[1] + up[1] * shift, c.target[2] + up[2] * shift],
  };
}

/** 범위에 맞춰 보는 카메라(방향은 그대로) */
export function cameraForBox(c: CameraState, box: Box3, aspect: number): CameraState {
  return fitCamera(c, box, aspect > 0 && Number.isFinite(aspect) ? aspect : 1);
}
