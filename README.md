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
   보기 도구 막대에서 전체 보기, 표준 뷰, 원근/평행, 음영·음영+모서리·와이어프레임·X-ray, 격자, 뷰 큐브, 좌표축, 두 점 측정, PNG 저장, 단면, 패널 열고 닫기를 고릅니다.
   - **단면**: 끔·X·Y·Z로 축에 수직인 평면을 두고, 슬라이더로 위치(장면 범위 안)를, 뒤집기로 잘라 낼 쪽을 바꿉니다. 새 파일을 열면 꺼집니다.
     SketchUp 면이 닫힌 입체인지는 파일에서 알 수 없어, 잘린 면은 채우지 않고 단면 테두리만 그립니다.
   - 창이 좁아지면 아이콘으로 알 수 있는 단추부터 글을 숨기고(제목 풍선은 남음), 태블릿 폭에서는 줄을 바꿉니다.
3. **패널**(폭 760px 미만이면 아래 시트). 가장자리를 끌면 폭(시트는 높이)이 바뀌고 이 브라우저에 기억합니다. 두 번 누르면 처음 크기.
   - 태그·재질: 부드러운 모서리 보기·숨긴 형상 보기(기본 꺼짐), 태그 켜고 끄기(면 수), 재질 견본(무늬 재질은 파일 안 무늬 그림)·이름·쓰인 면 수(누르면 그 재질의 면을 강조)
   - 구성: 여러 단계 그룹·컴포넌트 나무(› 단추로 펼치기, 누르면 강조, 두 번 누르면 확대, 체크로 숨기기), 3D 누르기 방식(펼친 단계·가장 안쪽), 컴포넌트 정의별 개수(파일 안 미리보기 그림)
   - 정보: 모형 미리보기 그림, SketchUp 판, 단위, 크기, 읽은 시간, 모형 통계, 장면 미리보기 목록(장면 이름·그림만 — 장면 카메라를 아직 몰라 전환은 안 됨), 해석기 경고
4. **고르기**: 3D에서 누르면 "펼친 단계"의 그룹·컴포넌트를 강조합니다(아무것도 펼치지 않았으면 모형 바로 아래 단계, 나무에서 그룹을 펼치면 그 안의 항목).
   3D에서 두 번 누르면 고른 그룹을 펼치고 한 단계 안쪽을 고릅니다(SketchUp에서 그룹에 들어가는 것과 비슷하게). Alt+누르기나 "가장 안쪽" 방식은 누른 곳을 품은 가장 안쪽 항목을 고릅니다.
   상태 막대와 패널 아래에 이름·위치(위 단계)·태그·재질을 보입니다.
5. **깨진 파일**: 끝이 잘렸거나 꾸러미·꼬리표 길이가 깨진 파일은 읽을 수 있는 부분만 그리고 알림으로 알립니다. 아주 큰 모형은 한도에서 멈추고 알립니다.

| 키 | 하는 일 |
|---|---|
| F | 전체 보기 |
| 1~7 | 앞 · 뒤 · 왼쪽 · 오른쪽 · 위 · 아래 · 남동 등각 |
| F7 | 바닥 격자 |
| Ctrl/⌘+O | 열기 |
| Esc | 여는 중이면 취소 → 측정 점 지우기 → (한 번 더) 측정 끄기 → 고른 것 지우기 |

캔버스에 초점이 없어도(입력 칸 제외) 위 키가 3D 보기로 갑니다.

주소 인자: `?sample`은 예제를 바로 열고, `?open=<같은 출처 주소>`는 그 파일을 바로 엽니다(자동 확인용, 다른 출처 주소는 막습니다).
자동 확인용으로 `window.opencadApp`에 상태(`state()` — 나무 노드 수·펼친 수·고르기 방식·단면·테마 고르기·패널 크기 등, `parsed`, `docName`)를 둡니다.

테마 단추는 "시스템 설정 따르기 · 밝은 테마 · 어두운 테마"를 고르는 메뉴입니다(시스템을 고르면 기억을 지웁니다).
좁은 화면에서 시트를 열고 닫을 때, 확대·이동해 둔 보기는 위쪽에 보이던 것이 같은 자리·같은 크기로 남게 카메라를 옮깁니다(움직이지 않았으면 다시 전체 보기).

SketchUp 2020 이하에서 저장한 파일은 형식이 달라 아직 읽지 못합니다. 열면 판(예: SketchUp 2017 · 17.2.2555)과 함께 안내를 보입니다.

## 해석기가 읽는 것

- SketchUp 2021~2026: 면(구멍 포함)·모서리·재질 색·그룹/컴포넌트 인스턴스 변환·태그·단위, 부드러운·숨긴 형상(선택), 꾸러미 안 그림(무늬·미리보기)
- 2020 이하 파일은 형식이 완전히 달라(MFC 객체 그래프) 아직 읽지 못하고, 경고와 함께 빈 장면을 돌려줍니다.
- 깨진 파일: 끝(ZIP 목록)이 잘렸으면 지역 머리를 앞에서부터 따라가 `model.dat`를 찾고, `model.dat`가 잘렸거나 압축이 깨졌으면 앞부분만 풀어
  꼬리표 길이가 맞는 데까지 읽습니다(`meta.damaged`). 잘린 DEFLATE 흐름이 끝없이 도는 문제를 막았습니다.
- 한도: 펼친 면 정점 1,200만 · 선분 300만 · 인스턴스 배치 200만(서로를 여러 번 품는 정의) · 자기 자신을 품는 정의는 64겹(`meta.limited`).
- 큰 좌표: 원점에서 100 m보다 먼 형상은 1 km 칸마다 따로 묶고 묶음 원점(`Mesh3d.origin`·`LineSet3d.origin`)을 두어 positions를 그만큼 빼서 적습니다
  (float32 떨림 방지, 코어 v0.4). 모든 형상이 100 m 안인 모형은 예전 출력과 같습니다.

## 라이브러리로 쓰기

```ts
import { skpToScene } from 'opencad-skp';

const scene = skpToScene(bytes, { name: 'model.skp' });
// scene: Scene3d (opencad-viewer3d의 Viewer3d.setScene에 넘긴다), scene.warnings에 읽지 못한 것
```

선택:

- `outline: true` — 그룹·컴포넌트를 하나씩 고르게 나눕니다. 기본은 꺼져 있어 예전처럼 (태그, 재질)마다 하나로 모읍니다.
  - `meta.outline`: 모형 바로 아래 항목 목록(이름·종류·정의·태그·면 수·안쪽까지의 항목 id·나무 노드). 윗단계 인스턴스가 1,000개를 넘으면 나누지 않고 `meta.outlineSkipped`에 수를 적습니다.
  - `meta.tree`: 여러 단계 나무(`SkpTree`, 형식 배열). 넓이 우선으로 노드 5만 개까지(단계 단위로 자르고 `TREE_MORE` 표시).
    그리기 호출이 터지지 않게, 그물·모서리 항목 수 어림이 3,000 안인 가장 깊은 단계(`splitDepth`)까지만 노드마다 따로 모으고,
    더 깊은 노드는 그 단계 조상의 그물에 함께 넣습니다. 펼치기는 깊이 우선이라 노드 안쪽이 각 그물 안에서 이어진 구간이 되므로,
    구간 목록(`runItem`·`runStart`·`runNode`, 노드마다 `runFirst`·`runEnd`)으로 고른 삼각형의 가장 안쪽 노드를 찾고 깊은 노드도 강조·맞춰 보기할 수 있습니다.
- `extras: true` — 부드러운·매끈한 모서리(`skp-soft-*`)와 숨긴 형상(숨긴 면·모서리·인스턴스, `skp-hidden-*`)을 따로 묶어 더 넣고 `meta.extraItems`에 id·수를 적습니다(범위·통계에는 넣지 않음).
- `onProgress(fraction, stage)` — 진행률(단계 안에서도 몇천 항목·몇 MB마다)을 알립니다(워커에서 진행 막대용).

`meta`에는 판(`version`)·그릇(`container`)·단위(`lengthUnit`)·개수 통계와 함께, 태그별 면·모서리 수(`tagStats`), 재질별 색·면 수·그물 id·꾸러미 폴더(`materialStats`),
깨짐·한도 표시(`damaged`·`limited`)가 들어 있습니다.

꾸러미 안 그림은 `readSkpImages(bytes, { maxCount, maxBytesEach, maxTotalBytes })`로 꺼냅니다: 모형 미리보기(`meta/model_thumbnail.png`), 재질 폴더별 무늬 그림,
컴포넌트 미리보기(`thumbnails/`), 장면 미리보기(`scene_thumbnails/`). 꼴은 첫 바이트로 가리고 개수 600·한 장 8 MB·전체 64 MB 한도를 둡니다.

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 앱 진입(제목·설명·파비콘, 자바스크립트 없을 때 안내) |
| `src/app/main.ts`, `src/app/app.ts` | 앱 입구와 화면(제목 막대·보기 도구 막대·3D 보기·상태 막대·시작 화면·키·끌어 놓기) |
| `src/app/panel.ts` | 오른쪽 패널(태그·재질 / 구성 나무 / 정보) |
| `src/app/doc.ts` | 열린 문서 상태·패널 목록·고르기·보이기·그림 주소(순수 함수) |
| `src/app/tree.ts` | 구성 나무 도움: 고른 삼각형 → 가장 안쪽 노드, 펼친 단계, 깊은 노드 강조 선분·범위(순수 함수) |
| `src/app/layout.ts`, `src/app/view.ts` | 패널 폭·시트 높이(기억), 시트를 여닫을 때 보기 지키기·맞춰 보기 카메라(순수 함수) |
| `src/app/protocol.ts`, `src/app/client.ts` | 해석 워커 메시지·이전 목록, 워커 손님 |
| `src/app/format.ts`, `src/app/keys.ts`, `src/app/launch.ts`, `src/app/theme.ts` | 글 꼴, 키, 주소 인자, 테마(순수 함수) |
| `src/app/sample.ts`, `src/app/skpwrite.ts` | 예제 모형 만들기와 SKP 바이트 쓰기 도구(시험과 함께 씀) |
| `src/app/dom.ts`, `src/app/styles.css` | DOM 도우미·아이콘, 스타일(밝은·어두운 테마) |
| `src/worker/parse.worker.ts` | 해석 워커 |
| `src/index.ts` | 해석기 공개 입구(`skpToScene`, `readSkpImages`, 지원 판 범위) |
| `src/header.ts` | 파일 머리와 판 |
| `src/zip.ts`, `src/inflate.ts` | ZIP 꾸러미(잘린 파일은 지역 머리 따라가기)와 deflate 풀기(잘린 흐름은 앞부분만) |
| `src/images.ts` | 꾸러미 안 그림(무늬·미리보기) 꺼내기 |
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
`SKP_BIG=1 npx vitest run tests/large.test.ts`는 수십만 면 합성 모형으로 해석 시간을 재고 `.runtime/tmp/`에 파일을 씁니다(확인 뒤 지우세요).
3D 뷰어 코어는 `github:GyuTae-Kim/opencad-viewer3d#v0.4.0`(단면 보기·묶음 원점)으로 받습니다.
의존을 올릴 때는 `npm install "opencad-viewer3d@github:GyuTae-Kim/opencad-viewer3d#<태그>"`로 받아야 잠금 파일의 커밋이 바뀝니다.

## 배포

`main`에 올리면 GitHub Actions(`.github/workflows/deploy.yml`)가 타입 확인·시험·빌드를 거쳐 `dist/`를 `gh-pages` 가지에 올립니다(GitHub Pages).
빌드는 상대 경로(`base: './'`)라 https://gyutae-kim.github.io/opencad-skp/ 같은 하위 경로에서 돕니다.
끌어오기 요청에서는 `.github/workflows/ci.yml`이 같은 확인을 합니다.

## 남은 일

- SketchUp 2020 이하(MFC 객체 그래프)
- 무늬 좌표(UV)를 읽어 3D에 무늬 입히기(지금은 무늬 그림을 견본으로만 보이고 3D는 평균색)
- 장면(페이지) 카메라·장면 전환(지금은 장면 이름·미리보기 그림만)
- 태그 숨김 값(어느 꼬리표인지 모름), 문자·치수·보조선·단면 요소, 곡선의 원래 모양
- 나누지 않은 깊은 노드 숨기기(코어에 그물 안 범위 숨기기가 생기면)
- 2024 표본 확인, 새 기능(나무·그림·깨진 파일 살리기)의 실제 표본 확인

## 내력

[2dcad-viewer](https://github.com/GyuTae-Kim/2dcad-viewer)의 `src/formats/skp/`와 `docs/formats/skp.md`에서 분리했습니다(커밋 `d7c584a` 기준, 처음 들어온 것은 PR #7).
앱 화면은 그 커밋의 2D 뷰어 안 3D 탭 화면(`src/app/view3d/`의 태그·재질 패널, 워커, 프로토콜)을 바탕으로, 혼자 도는 앱에 맞게 새로 짰습니다.

## 라이선스

MIT. 의존성 earcut은 ISC입니다([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
SketchUp은 Trimble Inc.의 상표이며, 이 프로젝트는 Trimble과 관계가 없습니다.
