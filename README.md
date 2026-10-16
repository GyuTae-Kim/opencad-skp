# OpenCAD SketchUp 뷰어

SketchUp(.skp) 파일을 설치 없이 브라우저에서 3D로 여는 뷰어 앱과, 그 안에서 쓰는 SketchUp 해석기입니다.
파일은 서버로 보내지 않고 브라우저 안(웹 워커)에서 읽고, 결과 장면(`Scene3d`)은 [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)로 그립니다.

- 앱 주소(배포 예정): https://gyutae-kim.github.io/opencad-skp/
- 함께 쓰는 저장소: [opencad-viewer3d](https://github.com/GyuTae-Kim/opencad-viewer3d)(3D 뷰어 코어) ·
  [opencad-nc](https://github.com/GyuTae-Kim/opencad-nc) · [opencad-step](https://github.com/GyuTae-Kim/opencad-step) ·
  [OpenCAD 도구 목록](https://gyutae-kim.github.io/opencad)

SketchUp 형식은 공개 명세가 없어, 인터넷에 공개된 표본 파일의 바이트만 보고 구조를 추론했습니다(클린룸).
SketchUp SDK·다른 SKP 읽기 프로그램의 코드는 보지 않았습니다. 조사 기록은 [docs/formats/skp.md](docs/formats/skp.md)에 있습니다.

## 앱 사용법

1. **열기**: 위 막대의 "열기"를 누르거나, `.skp` 파일을 창 어디에나 끌어다 놓습니다. "예제 열기"는 브라우저에서 만든 작은 집 모형(태그 넷·재질 11개·컴포넌트)을 엽니다.
   한 번에 파일 하나를 열고, 새 파일을 열면 바꿉니다(새 파일을 못 열면 보던 모형은 그대로 둡니다).
2. **보기**: 왼쪽 끌기 돌리기 · 오른쪽(가운데) 끌기 옮기기 · 휠 확대. 휴대폰은 한 손가락 돌리기, 두 손가락 옮기기·확대.
   보기 도구 막대에서 전체 보기, 표준 뷰, 원근/평행, 음영·음영+모서리·와이어프레임·X-ray, 격자, 뷰 큐브, 좌표축, 두 점 측정, PNG 저장, 패널 열고 닫기를 고릅니다.
3. **패널**(폭 760px 미만이면 아래 시트)
   - 태그·재질: 태그 켜고 끄기(면 수), 재질 색 견본·이름·쓰인 면 수(누르면 그 재질의 면을 강조)
   - 구성: 모형 바로 아래 그룹·컴포넌트 목록(누르면 강조, 두 번 누르면 확대, 체크로 숨기기), 컴포넌트 정의별 개수
   - 정보: SketchUp 판, 단위, 크기, 읽은 시간, 모형 통계, 해석기 경고
4. **고르기**: 3D에서 누르면 그 면이 든 그룹·컴포넌트 전체를 강조하고, 상태 막대와 패널 아래에 이름·태그·재질을 보입니다.

| 키 | 하는 일 |
|---|---|
| F | 전체 보기 |
| 1~7 | 앞 · 뒤 · 왼쪽 · 오른쪽 · 위 · 아래 · 남동 등각 |
| F7 | 바닥 격자 |
| Esc | 측정 지우기(측정 중) · 고른 것 지우기 |

캔버스에 초점이 없어도(입력 칸 제외) 위 키가 3D 보기로 갑니다.

주소 인자: `?sample`은 예제를 바로 열고, `?open=<같은 출처 주소>`는 그 파일을 바로 엽니다(자동 확인용, 다른 출처 주소는 막습니다).
자동 확인용으로 `window.opencadApp`에 상태(`state()`, `parsed`, `docName` 등)를 둡니다.

SketchUp 2020 이하에서 저장한 파일은 형식이 달라 아직 읽지 못합니다. 열면 판(예: SketchUp 2017 · 17.2.2555)과 함께 안내를 보입니다.

## 해석기가 읽는 것

- SketchUp 2021~2026: 면(구멍 포함)·모서리·재질 색·그룹/컴포넌트 인스턴스 변환·태그·단위
- 2020 이하 파일은 형식이 완전히 달라(MFC 객체 그래프) 아직 읽지 못하고, 경고와 함께 빈 장면을 돌려줍니다.

## 라이브러리로 쓰기

```ts
import { skpToScene } from 'opencad-skp';

const scene = skpToScene(bytes, { name: 'model.skp' });
// scene: Scene3d (opencad-viewer3d의 Viewer3d.setScene에 넘긴다), scene.warnings에 읽지 못한 것
```

선택:

- `outline: true` — 모형 바로 아래 그룹·컴포넌트마다 그물·모서리를 따로 나누고 `meta.outline`에 목록(이름·종류·정의·태그·면 수·항목 id)을 적습니다. 기본은 꺼져 있어 예전처럼 (태그, 재질)마다 하나로 모읍니다. 윗단계 인스턴스가 1,000개를 넘으면 나누지 않고 `meta.outlineSkipped`에 수를 적습니다.
- `onProgress(fraction, stage)` — 단계가 바뀔 때 진행률을 알립니다(워커에서 진행 막대용).

`meta`에는 판(`version`)·그릇(`container`)·단위(`lengthUnit`)·개수 통계와 함께, 태그별 면·모서리 수(`tagStats`), 재질별 색·면 수·그물 id(`materialStats`)가 들어 있습니다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 앱 진입(제목·설명·파비콘, 자바스크립트 없을 때 안내) |
| `src/app/main.ts`, `src/app/app.ts` | 앱 입구와 화면(제목 막대·보기 도구 막대·3D 보기·상태 막대·시작 화면·키·끌어 놓기) |
| `src/app/panel.ts` | 오른쪽 패널(태그·재질 / 구성 / 정보) |
| `src/app/doc.ts` | 열린 문서 상태와 패널 목록 만들기(순수 함수) |
| `src/app/protocol.ts`, `src/app/client.ts` | 해석 워커 메시지·이전 목록, 워커 손님 |
| `src/app/format.ts`, `src/app/keys.ts`, `src/app/launch.ts`, `src/app/theme.ts` | 글 꼴, 키, 주소 인자, 테마(순수 함수) |
| `src/app/sample.ts`, `src/app/skpwrite.ts` | 예제 모형 만들기와 SKP 바이트 쓰기 도구(시험과 함께 씀) |
| `src/app/dom.ts`, `src/app/styles.css` | DOM 도우미·아이콘, 스타일(밝은·어두운 테마) |
| `src/worker/parse.worker.ts` | 해석 워커 |
| `src/index.ts` | 해석기 공개 입구(`skpToScene`, 지원 판 범위) |
| `src/header.ts` | 파일 머리와 판 |
| `src/zip.ts`, `src/inflate.ts` | ZIP 꾸러미와 deflate 풀기 |
| `src/tlv.ts`, `src/model.ts` | `model.dat` 꼬리표-길이-값 해석 |
| `src/materials.ts`, `src/scene.ts` | 재질과 `Scene3d` 만들기(면은 earcut 삼각화, 태그·재질 통계, outline) |
| `tests/` | 해석기 시험(`tests/build.ts`는 시험용 바이트 만들기), `tests/app/`은 앱 순수 로직 시험 |
| `docs/formats/skp.md` | 형식 조사 기록 |

## 개발

```bash
npm install
npm run dev        # http://localhost:4403/ (예제 바로 열기: http://localhost:4403/?sample)
npm run typecheck
npm test
npm run build      # dist/
npm run preview
```

시험은 표본 파일 없이 `tests/build.ts`(본체는 `src/app/skpwrite.ts`)로 만든 작은 바이트로 돌립니다. 표본 파일은 저장소에 넣지 않습니다.
확인용 표본·임시 파일은 `.runtime/`(git 무시)에만 둡니다.
3D 뷰어 코어는 `github:GyuTae-Kim/opencad-viewer3d#v0.3.0`으로 받습니다.

## 배포

`main`에 올리면 GitHub Actions(`.github/workflows/deploy.yml`)가 타입 확인·시험·빌드를 거쳐 `dist/`를 `gh-pages` 가지에 올립니다(GitHub Pages).
빌드는 상대 경로(`base: './'`)라 https://gyutae-kim.github.io/opencad-skp/ 같은 하위 경로에서 돕니다.
끌어오기 요청에서는 `.github/workflows/ci.yml`이 같은 확인을 합니다.

## 남은 일

- SketchUp 2020 이하(MFC 객체 그래프)
- 무늬(텍스처)·장면
- 2024 표본 확인
- 겹친 그룹·컴포넌트 안쪽 고르기(지금은 모형 바로 아래 단계까지)

## 내력

[2dcad-viewer](https://github.com/GyuTae-Kim/2dcad-viewer)의 `src/formats/skp/`와 `docs/formats/skp.md`에서 분리했습니다(커밋 `d7c584a` 기준, 처음 들어온 것은 PR #7).
앱 화면은 그 커밋의 2D 뷰어 안 3D 탭 화면(`src/app/view3d/`의 태그·재질 패널, 워커, 프로토콜)을 바탕으로, 혼자 도는 앱에 맞게 새로 짰습니다.

## 라이선스

MIT. 의존성 earcut은 ISC입니다([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
SketchUp은 Trimble Inc.의 상표이며, 이 프로젝트는 Trimble과 관계가 없습니다.
