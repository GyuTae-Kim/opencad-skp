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

/**
 * 화면 맞춤 범위(73차): 코어 뷰어는 아무것도 숨기지 않았을 때만 장면 범위(Scene3d.bounds — 해석기가 형상만 넣는다)로, 무엇이든 숨기면 보이는 묶음 범위를 합쳐
 * 화면을 맞춘다. 어떤 묶음도 쓰지 않는 이 그룹을 늘 숨겨 두면 숨김 여부와 상관없이 보이는 묶음(형상·치수선·지시선·단면 기호·보조선·보조점)의 범위로 맞춘다
 * (SketchUp 도움말 Zoom Extents — 모형 전체가 보이게). 장면 범위에 주석을 넣으면 격자 높이·단면 평면 크기·위치 범위까지 바뀌어 이 길을 골랐다.
 * 코어가 맞춤 범위를 따로 받게 되면 걷어 낼 것. setScene이 숨긴 그룹을 비우므로 장면을 올릴 때마다 setGroupVisible(FIT_GROUP, false)를 부른다
 */
export const FIT_GROUP = '\u0000fit';

/** 범위에 맞춰 보는 카메라(방향은 그대로) */
export function cameraForBox(c: CameraState, box: Box3, aspect: number): CameraState {
  return fitCamera(c, box, aspect > 0 && Number.isFinite(aspect) ? aspect : 1);
}
