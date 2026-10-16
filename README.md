# OpenCAD SketchUp 해석기

SketchUp(.skp) 파일을 브라우저 안에서 읽어 3D 장면으로 만듭니다.
DOM·WebGL에 기대지 않아 웹 워커에서 돌 수 있고, 결과 장면(`Scene3d`)은 [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)로 그립니다.

SketchUp 형식은 공개 명세가 없어, 인터넷에 공개된 표본 파일의 바이트만 보고 구조를 추론했습니다(클린룸).
SketchUp SDK·다른 SKP 읽기 프로그램의 코드는 보지 않았습니다. 조사 기록은 [docs/formats/skp.md](docs/formats/skp.md)에 있습니다.

함께 쓰는 저장소: [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)(3D 뷰어 코어) ·
[opencad-nc](https://github.com/GyuTae-Kim/opencad-nc) · [opencad-step](https://github.com/GyuTae-Kim/opencad-step)

## 할 수 있는 것

- SketchUp 2021~2026: 면(구멍 포함)·모서리·재질 색·그룹/컴포넌트 인스턴스 변환·태그·단위
- 2020 이하 파일은 형식이 완전히 달라(MFC 객체 그래프) 아직 읽지 못하고, 경고와 함께 빈 장면을 돌려줍니다.

## 쓰는 법

```ts
import { skpToScene } from 'opencad-skp';

const scene = skpToScene(bytes, { name: 'model.skp' });
// scene: Scene3d (opencad-viewer3d의 Viewer3d.setScene에 넘긴다), scene.warnings에 읽지 못한 것
```

## 구조

| 경로 | 내용 |
|---|---|
| `src/index.ts` | 공개 입구(`skpToScene`, 지원 판 범위) |
| `src/header.ts` | 파일 머리와 판 |
| `src/zip.ts`, `src/inflate.ts` | ZIP 꾸러미와 deflate 풀기 |
| `src/tlv.ts`, `src/model.ts` | `model.dat` 꼬리표-길이-값 해석 |
| `src/materials.ts`, `src/scene.ts` | 재질과 `Scene3d` 만들기(면은 earcut 삼각화) |
| `docs/formats/skp.md` | 형식 조사 기록 |

## 개발

```bash
npm install
npm run typecheck
npm test
```

시험은 표본 파일 없이 `tests/build.ts`로 만든 작은 바이트로 돌립니다. 표본 파일은 저장소에 넣지 않습니다.
3D 뷰어 코어는 `github:GyuTae-Kim/opencad-viewer3d#v0.1.0`으로 받습니다.

## 남은 일

- SketchUp 2020 이하(MFC 객체 그래프)
- 무늬(텍스처)·장면
- 2024 표본 확인

## 내력

[2dcad-viewer](https://github.com/GyuTae-Kim/2dcad-viewer)의 `src/formats/skp/`와 `docs/formats/skp.md`에서 분리했습니다(커밋 `d7c584a` 기준, 처음 들어온 것은 PR #7).
2D 뷰어 안에서 SKP 파일을 3D 탭으로 열던 화면(태그·재질 패널, 리본, 웹 워커 — `src/app/view3d/`)은 2D 뷰어 화면 골격에 붙어 있어 옮기지 않았고,
그 커밋의 2dcad-viewer에 남아 있습니다.

## 라이선스

MIT. 의존성 earcut은 ISC입니다([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
SketchUp은 Trimble Inc.의 상표이며, 이 프로젝트는 Trimble과 관계가 없습니다.
