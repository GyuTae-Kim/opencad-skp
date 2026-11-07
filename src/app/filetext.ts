/**
 * 파일에서 온 글(태그·재질·컴포넌트·그룹·장면 이름, 설명, 경로 등)을 앱 글과 섞을 때 쓰는 꼴(DOM·번역 없음 — 52차).
 * 화면 번역층(i18n.ts)은 사전 열쇠와 같은 글 마디를 통째로 바꾸고(재질 이름 "무늬" → "Texture"), 틀이 맞지 않으면 " · "·" — "로 나눈
 * 조각마다 옮긴다. 그래서 이름을 앱 글에 그대로 이어 붙이면 이름이 열쇠와 같거나 나눔 글을 품을 때 이름까지 바뀌었다
 * ("태그 무늬 · 이" → "Tag 무늬 · This"). 섞은 글은 i18n.ts의 mixText(속성 글)·mixNodes(화면 마디)로 옮긴다 — 파일 글 자리는 번역기가 보지 않는다.
 */
export interface FileText {
  readonly file: string;
  /** 이름 칸에 든 앱 자리 글(isAppName): 그것만 따로 옮긴 뒤 파일 글처럼 끼운다 */
  readonly ui?: boolean;
}

/** 앱 글(문자열)과 파일 글이 섞인 글 */
export type Mixed = readonly (string | FileText)[];

export const fileText = (file: string): FileText => ({ file });

/** 앱 글 틀에 값 끼우기: mix`태그 ${fileText(name)} 보이기`. fileText·섞은 글이 아닌 값(수·앱 글)은 앱 글로 잇는다 */
export function mix(s: TemplateStringsArray, ...v: (string | number | FileText | Mixed)[]): Mixed {
  const out: (string | FileText)[] = [];
  let t = s[0]!;
  v.forEach((x, i) => {
    for (const p of Array.isArray(x) ? x : [x]) {
      if (typeof p === 'object') {
        out.push(t, p);
        t = '';
      } else t += String(p);
    }
    t += s[i + 1]!;
  });
  out.push(t);
  return out.filter((p) => p !== '');
}

/** 섞은 글 여럿을 나눔 글로 잇기 */
export function joinMixed(list: readonly Mixed[], sep = ' · '): Mixed {
  return list.flatMap((m, i) => (i ? [sep, ...m] : m));
}

/** 섞은 글의 원문(한국어 화면·복사·시험) */
export const plainText = (m: Mixed): string => m.map((p) => (typeof p === 'string' ? p : p.file)).join('');

/**
 * 섞은 글 → (옮긴 글, 파일 글 목록): 파일 글 자리를 번역기가 보지 않는 사용 영역 글자(U+E000~)로 바꿔 tr로 옮긴다(앱 자리 글(ui)은 그것만 tr로 옮겨 끼운다).
 * 사전 틀의 {0}이 그 글자를 그대로 잡고, 나눔 글로 조각낼 때도 한글이 없는 조각이라 그대로 둔다. i18n.ts mixText·mixNodes가 지금 언어로 쓰고,
 * 시험은 언어를 정해 쓴다(53차 — 이 모듈은 번역기를 받기만 한다)
 */
export function slotText(parts: Mixed, tr: (text: string) => string): [string, string[]] {
  const files: string[] = [];
  const text = tr(parts.map((p) => (typeof p === 'string' ? p : String.fromCharCode(0xe000 + files.push(p.ui ? tr(p.file) : p.file) - 1))).join(''));
  return [text, files];
}

/** slotText로 옮긴 글의 자리 글자를 파일 글로 되돌린다 */
export const fillSlots = (text: string, files: readonly string[]): string => text.replace(/[-]/g, (c) => files[c.charCodeAt(0) - 0xe000] ?? c);

/** 해석기·앱이 이름 칸에 넣는 자리 글(이름이 없는 것) — 파일 글이 아니라 화면 언어로 옮긴다 */
export const isAppName = (name: string): boolean =>
  name === '기본 재질' || name === '모형에 바로 놓인 형상' || name === '(이름 없음)' || name === '(이름 없는 폴더)' || /^재질 \d+$/.test(name);

/** 이름 → 섞은 글 조각(앱 자리 글이면 그것만 화면 언어로 옮긴다) */
export const nameText = (name: string): FileText => (isAppName(name) ? { file: name, ui: true } : fileText(name));
