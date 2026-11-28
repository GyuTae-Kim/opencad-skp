// @vitest-environment jsdom
/**
 * 228차: 열 때 받는 조각을 받지 못했을 때(오프라인에서 새 판과 옛 캐시가 엇갈림·네트워크 끊김 — WCAG 3.3.1·4.1.3, NC 211·212차 꼴).
 * 창·예제(키보드 바로 가기·그림 저장·예제 모형)와 언어 사전을 가짜 import 실패(vi.doMock — 받는 모듈이 던짐)로 받지 못하게 하고 실제 앱 틀(SkpViewerApp.mount)에서 본다:
 * 알림 상자에 「{0}을(를) 불러오지 못했습니다.」와 「다시 시도」(까닭 글 — 브라우저의 영어 글 — 은 콘솔에만, 알림 글 칸은 비움), 받는 중 깃발이 남지 않음,
 * 다시 시도는 알림을 닫고(초점은 ✕와 같은 곳) 다시 받는다 — 또 받지 못하면 알림 하나가 다시 뜨고, 받을 수 있게 되면 그 창이 열린다.
 * 언어 사전: 바꾸기를 받지 못하면 바꾸기 전 화면 언어로 알리고(메뉴·문서 언어는 앞 언어 그대로), 첫 사전을 받지 못하면 한국어로 세우고 언어 메뉴는 둔다.
 * 조각마다 한 시험 앱만 받는다(같은 조각을 두 앱이 동시에 받지 않게 — vitest가 둘째를 self-import로 봄, NC 211차). 기다림은 조건과 마감 시간(vi.waitFor — 공용 규칙 13번).
 * 229차: 다시 시도를 누른 뒤 또 받지 못하면 그 알림 버튼만 「새로 고침」(글은 그대로 하나 — 새 판과 옛 캐시가 엇갈리면 브라우저가 실패한 모듈 받기를 기억해 다시 시도도 받지 못할 수 있다),
 * 새로 고침은 다시 시도를 부르지 않고(jsdom은 탐색하지 않는다 — 콘솔 글은 앱이 남긴 오류 객체만 센다), 다른 길(메뉴·언어 메뉴)로 받으면 떠 있는 그 실패 알림을 닫는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogs, translate } from '../../site/i18n.mjs';
import { fillSlots, slotText } from '../../src/app/filetext';
import { loadFailText } from '../../src/app/panel';
import { rowDoc } from './rowdoc';

type AppModule = typeof import('../../src/app/app');
type I18nModule = typeof import('../../src/app/i18n');
/** 시험에서 보는 앱 안쪽 */
interface Inner {
  els: { notice: HTMLElement; busy: HTMLElement; start: HTMLElement };
  viewer: unknown;
  doc: unknown;
  shortcutsLoading: boolean;
  shortcutsClose: (() => void) | null;
  exportLoading: boolean;
  openShortcuts(): void;
  savePng(): void;
  openSample(): Promise<void>;
}

const HANGUL = /[가-힣]/;
const CODES = ['en', 'ja', 'zh-CN', 'de'] as const;
/** 받는 모듈이 던진다(브라우저가 조각을 받지 못한 꼴의 글) */
const fail = (name: string) => (): never => {
  throw new TypeError(`Failed to fetch dynamically imported module: http://x/assets/${name}-x.js`);
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

/** 앱 틀을 붙인다(번역층은 main.ts처럼 붙인 뒤에 — i18n을 주면, 사전을 받지 못한 알림도 main.ts처럼 앱 loadFailed로) */
async function mount(mod: AppModule, i18n?: I18nModule, path = '/opencad-skp/'): Promise<Inner> {
  history.replaceState(null, '', path);
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new mod.SkpViewerApp(root);
  app.mount();
  if (i18n) dispose = await i18n.installLocalization(root, (...a) => app.loadFailed(...a));
  return app as unknown as Inner;
}

it('main.ts가 번역층에 앱 loadFailed를 넘긴다(사전을 받지 못한 알림 — 아래 언어 시험이 같은 꼴로 붙인다)', () => {
  const main = readFileSync(resolve(__dirname, '../../src/app/main.ts'), 'utf8');
  expect(main).toContain('void installLocalization(root, (...a) => app.loadFailed(...a));');
  expect(main.match(/installLocalization\(/g)).toHaveLength(1);
});

const retries = (n: HTMLElement): HTMLButtonElement[] => [...n.querySelectorAll('button')].filter((b) => b.textContent === '다시 시도' || b.textContent === 'Try again');
/** 229차: 다시 시도 뒤 또 받지 못한 알림의 새로 고침 버튼 */
const reloads = (n: HTMLElement): HTMLButtonElement[] => [...n.querySelectorAll('button')].filter((b) => b.textContent === '새로 고침');
/** 앱이 콘솔에 남긴 받기 실패(오류 객체) 수 — jsdom이 새로 고침(탐색 없음)에 남기는 글은 빼고 센다 */
const ours = (err: { mock: { calls: unknown[][] } }): number => err.mock.calls.filter(([e]) => typeof e !== 'string').length;
const title = (n: HTMLElement): string => n.querySelector('.notice-text b')!.textContent ?? '';
/** 알림 글(제목 b 다음 span — 제목 안 이름 조각 span(translate="no")은 빼고 자식으로 고른다) */
const text = (n: HTMLElement): string => n.querySelector('.notice-text > span')!.textContent ?? '';

describe('228차: 창·예제 조각을 받지 못하면 알림 하나와 다시 시도', () => {
  let mod: AppModule;
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/app/shortcuts', fail('shortcuts'));
    vi.doMock('../../src/app/exporter', fail('exporter'));
    vi.doMock('../../src/app/sample', fail('sample'));
    mod = await import('../../src/app/app');
  });

  it('키보드 바로 가기 창: 알림(까닭 글은 콘솔에만)·다시 시도, 받는 중 깃발이 남지 않고, 다시 시도가 다시 받는다 — 229차: 또 받지 못하면 버튼만 새로 고침(다시 시도를 부르지 않음), 다른 길(메뉴)로 받으면 창이 열리고 실패 알림을 닫는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await mount(mod);
    const n = a.els.notice;
    a.openShortcuts();
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(n.className).toBe('notice error');
    expect(title(n)).toBe('키보드 바로 가기을(를) 불러오지 못했습니다.');
    expect(text(n)).toBe('');
    expect(n.textContent).not.toMatch(/Failed to fetch|dynamically|vitest/);
    expect(err).toHaveBeenCalledTimes(1);
    expect(a.shortcutsLoading).toBe(false);
    expect(retries(n)).toHaveLength(1);
    // 다시 시도는 ✕ 앞(✕는 끝 그대로)
    expect(n.lastElementChild!.getAttribute('aria-label')).toBe('알림 닫기');
    // 다시 시도: 알림을 닫고(초점은 ✕와 같은 곳 — 문서가 없으면 처음 화면의 첫 버튼) 다시 받는다 — 또 받지 못하면 숨은 상자가 다시 떠 알림 하나
    retries(n)[0]!.focus();
    retries(n)[0]!.click();
    expect(n.hidden).toBe(true);
    expect(document.activeElement).toBe(a.els.start.querySelector('button'));
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(err).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.notice')).toHaveLength(1);
    // 229차: 다시 시도를 누른 뒤 또 받지 못함 — 글은 그대로 하나, 버튼만 새로 고침(✕는 끝 그대로)
    expect(retries(n)).toHaveLength(0);
    expect(reloads(n)).toHaveLength(1);
    expect(n.lastElementChild!.getAttribute('aria-label')).toBe('알림 닫기');
    expect(title(n)).toBe('키보드 바로 가기을(를) 불러오지 못했습니다.');
    expect(text(n)).toBe('');
    // 새로 고침은 다시 시도를 부르지 않는다(되풀이 고리 없음 — 다시 받지 않아 콘솔 오류 그대로, 알림 그대로)
    reloads(n)[0]!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(ours(err)).toBe(2);
    expect(a.shortcutsLoading).toBe(false);
    expect(n.hidden).toBe(false);
    // 다른 길(메뉴·? — openShortcuts)로 받을 수 있게 되면 창이 열리고 떠 있던 실패 알림은 닫힌다
    vi.doUnmock('../../src/app/shortcuts');
    a.openShortcuts();
    await vi.waitFor(() => expect(document.querySelector('.sc-box')).not.toBeNull());
    expect(n.hidden).toBe(true);
    await vi.waitFor(() => expect(a.shortcutsLoading).toBe(false));
    a.shortcutsClose?.();
  });

  it('그림 저장 창: 알림 「그림 저장을(를) 불러오지 못했습니다.」(전에는 브라우저 영어 글이 알림 글에 들었다)·다시 시도, 받는 중 깃발이 남지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await mount(mod);
    a.viewer = { canvas: document.createElement('canvas') };
    a.doc = rowDoc();
    const n = a.els.notice;
    a.savePng();
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(title(n)).toBe('그림 저장을(를) 불러오지 못했습니다.');
    expect(text(n)).toBe('');
    expect(err).toHaveBeenCalledTimes(1);
    expect(retries(n)).toHaveLength(1);
    await vi.waitFor(() => expect(a.exportLoading).toBe(false));
    // 다시 시도도 받지 못하면 알림 하나가 다시 뜬다 — 229차: 버튼만 새로 고침(글 그대로)
    retries(n)[0]!.click();
    expect(n.hidden).toBe(true);
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(err).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.notice')).toHaveLength(1);
    expect(retries(n)).toHaveLength(0);
    expect(reloads(n)).toHaveLength(1);
    expect(title(n)).toBe('그림 저장을(를) 불러오지 못했습니다.');
    await vi.waitFor(() => expect(a.exportLoading).toBe(false));
    a.viewer = null;
    a.doc = null;
  });

  it('예제 모형: 받지 못하면 여는 중 덮개를 내리고 알림 「예제 모형을(를) 불러오지 못했습니다.」·다시 시도(까닭 글은 콘솔에만)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await mount(mod);
    const n = a.els.notice;
    await a.openSample();
    expect(a.els.busy.hidden).toBe(true);
    expect(n.hidden).toBe(false);
    expect(title(n)).toBe('예제 모형을(를) 불러오지 못했습니다.');
    expect(text(n)).toBe('');
    expect(err).toHaveBeenCalledTimes(1);
    expect(retries(n)).toHaveLength(1);
    retries(n)[0]!.click();
    await vi.waitFor(() => expect(err).toHaveBeenCalledTimes(2));
    expect(n.hidden).toBe(false);
    expect(a.els.busy.hidden).toBe(true);
    // 229차: 다시 시도 뒤 또 받지 못함 — 버튼만 새로 고침(글 그대로), 새로 고침은 예제를 다시 열지 않는다
    expect(retries(n)).toHaveLength(0);
    expect(reloads(n)).toHaveLength(1);
    expect(title(n)).toBe('예제 모형을(를) 불러오지 못했습니다.');
    reloads(n)[0]!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(ours(err)).toBe(2);
    expect(a.els.busy.hidden).toBe(true);
  });
});

describe('228차: 언어 사전을 받지 못하면 바꾸기 전 화면 언어로 알림과 다시 시도', () => {
  // 사전 가짜는 it마다 풀어 둔다(앞 it가 끝에 닿지 못해도 다음 it가 가짜를 받지 않게)
  afterEach(() => {
    vi.doUnmock('../../site/locales/de.json');
    vi.doUnmock('../../site/locales/en.json');
  });

  it('바꾸기: 받지 못하면 바꾸기 전 언어(영어)로 알리고 메뉴·문서 언어는 그대로 — 다시 시도가 그 언어를 다시 받는다', async () => {
    vi.resetModules();
    vi.doMock('../../site/locales/de.json', fail('de'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../../src/app/app');
    const i18n = await import('../../src/app/i18n');
    const a = await mount(mod, i18n, '/opencad-skp/en/');
    const n = a.els.notice;
    expect(document.documentElement.lang).toBe('en');
    document.querySelector<HTMLButtonElement>('[data-language="de"]')!.click();
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    // 231차: 영어 틀도 이름을 따옴표로(같은 사전 문장 안 이름 자리 "{n}" 10 : 감싸지 않음 6 — i18n.test 50차 규칙 표 231차 줄)
    expect(title(n)).toBe('Couldn\'t load "Deutsch".');
    expect(text(n)).toBe('');
    expect(err).toHaveBeenCalledTimes(1);
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('[data-language="en"]')!.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-language="de"]')!.getAttribute('aria-checked')).toBe('false');
    // 다시 시도 버튼 글도 화면 언어로(번역층이 옮김)
    await vi.waitFor(() => expect(retries(n).map((b) => b.textContent)).toEqual(['Try again']));
    vi.doUnmock('../../site/locales/de.json');
    retries(n)[0]!.click();
    expect(n.hidden).toBe(true);
    await vi.waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(document.querySelector('[data-language="de"]')!.getAttribute('aria-checked')).toBe('true');
    expect(n.hidden).toBe(true);
  });

  it('첫 사전: 받지 못하면 한국어로 세우고 언어 메뉴는 둔다 — 한국어 알림과 다시 시도. 229차: 다른 길(언어 메뉴로 그 언어)로 받으면 떠 있는 실패 알림을 닫는다', async () => {
    vi.resetModules();
    vi.doMock('../../site/locales/en.json', fail('en'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../../src/app/app');
    const i18n = await import('../../src/app/i18n');
    const a = await mount(mod, i18n, '/opencad-skp/en/');
    const n = a.els.notice;
    expect(document.documentElement.lang).toBe('ko');
    expect(document.querySelector('.language-control')).not.toBeNull();
    expect(document.querySelector('[data-language="ko"]')!.getAttribute('aria-checked')).toBe('true');
    expect(n.hidden).toBe(false);
    expect(title(n)).toBe('English을(를) 불러오지 못했습니다.');
    expect(text(n)).toBe('');
    expect(err).toHaveBeenCalledTimes(1);
    expect(retries(n).map((b) => b.textContent)).toEqual(['다시 시도']);
    vi.doUnmock('../../site/locales/en.json');
    // 다시 시도 대신 언어 메뉴로 같은 언어를 고른다(다른 길 — 알림은 그대로 떠 있다가 받으면 닫힌다)
    document.querySelector<HTMLButtonElement>('[data-language="en"]')!.click();
    await vi.waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(document.querySelector('[data-language="en"]')!.getAttribute('aria-checked')).toBe('true');
    expect(n.hidden).toBe(true);
    expect(err).toHaveBeenCalledTimes(1);
  });
});

describe('228차 사전: 새 원문 둘(알림 틀·다시 시도)', () => {
  it('네 언어에 있고, 틀 {0}에 탭·창·칸 이름(앱 글)을 끼워도 한글이 남지 않는다', () => {
    const names = ['구성', '선택', '정보', '속성 사전', '키보드 바로 가기', '그림 저장', '예제 모형'];
    for (const code of CODES) {
      expect(catalogs[code]!['{0}을(를) 불러오지 못했습니다.'], code).toContain('{0}');
      expect(translate('다시 시도', code), code).not.toMatch(HANGUL);
      for (const name of names) {
        const [t, files] = slotText(loadFailText(name), (s, ui) => translate(s, code, ui));
        expect(fillSlots(t, files), `${code}: ${name}`).not.toMatch(HANGUL);
      }
    }
  });
});
