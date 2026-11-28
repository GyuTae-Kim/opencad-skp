// @vitest-environment jsdom
/**
 * 229차: 3D 보기 코어·측정 도구 조각을 받지 못한 알림(「3D 보기를 열 수 없습니다」·「측정 도구를 열 수 없습니다」 + chunkFailText — 글은 그대로)에도 다시 시도(WCAG 3.3.1·4.1.3):
 * 다시 열 길이 있으면(예제·최근 문서·주소 — 그 열기를 처음부터, 측정 도구 — 그 버튼 동작을 다시) 228차 꼴로 다시 시도, 고르거나 끌어 놓은 파일(바이트를 쥐지 않음)은 지금처럼.
 * 다시 시도를 누른 뒤 또 받지 못하면 버튼만 새로 고침(다시 시도를 부르지 않음), 다른 길(버튼)로 받으면 떠 있는 그 실패 알림을 닫는다.
 * 같은 글 알림이 떠 있는 채로 같은 버튼을 다시 누르면 상자를 떼고 그 자리에 새로 붙인다(알림 하나 — 글이 같으면 화면 읽기 프로그램이 다시 읽지 않을 수 있다, NC 211차 같은 글 하나 규칙).
 * 다시 시도는 조각 오류(isChunkLoadError — 브라우저 글)에만 주므로 core.ts 받기 함수를 브라우저 꼴 TypeError로 거부하는 가짜로 바꾼다(vi.doMock 공장이 던지면 vitest가 제 글로 감싼다).
 * 측정 도구 조각은 앱이 기다리지 않고 받는 길(FirstUse)이라 beforeAll에서 미리 불러 둔다(ci-guard 5). 기다림은 조건과 마감 시간(vi.waitFor — 공용 규칙 13번).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { rowDoc } from './rowdoc';

type AppModule = typeof import('../../src/app/app');
type CoreModule = typeof import('../../src/app/core');
/** 시험에서 보는 앱 안쪽 */
interface Inner {
  els: { notice: HTMLElement; start: HTMLElement };
  doc: unknown;
  ensureViewer(again?: () => unknown): Promise<boolean>;
  toggleMeasure(on?: boolean): void;
}

/** 브라우저가 조각을 받지 못한 꼴의 오류(isChunkLoadError가 알아본다) */
const chunkError = (name: string): TypeError => new TypeError(`Failed to fetch dynamically imported module: http://x/assets/${name}-x.js`);
/** 측정 도구 조각을 받을 수 있는지(가짜 loadMeasure가 본다) */
const state = { measure: false };

let mod: AppModule;
let core: CoreModule;
beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../../src/app/core', async (importOriginal) => {
    const m = await importOriginal<CoreModule>();
    return {
      ...m,
      loadViewerCore: () => Promise.reject(chunkError('viewer')),
      loadMeasure: () => (state.measure ? m.loadMeasure() : Promise.reject(chunkError('measure'))),
    };
  });
  await import('../../src/app/measure');
  mod = await import('../../src/app/app');
  core = await import('../../src/app/core');
});
afterAll(() => {
  vi.doUnmock('../../src/app/core');
});
afterEach(() => {
  document.body.innerHTML = '';
  state.measure = false;
  vi.restoreAllMocks();
});

function mount(): Inner {
  const root = document.body.appendChild(document.createElement('div'));
  root.id = 'app';
  const app = new mod.SkpViewerApp(root);
  app.mount();
  return app as unknown as Inner;
}

const title = (n: HTMLElement): string => n.querySelector('.notice-text b')!.textContent ?? '';
const text = (n: HTMLElement): string => n.querySelector('.notice-text > span')!.textContent ?? '';
const labels = (n: HTMLElement): string[] => [...n.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
const retries = (n: HTMLElement): HTMLButtonElement[] => [...n.querySelectorAll('button')].filter((b) => b.textContent === '다시 시도');
const reloads = (n: HTMLElement): HTMLButtonElement[] => [...n.querySelectorAll('button')].filter((b) => b.textContent === '새로 고침');
/** 알림 상자를 떼었다 붙인 수(상자 부모의 childList 기록 — 같은 글 하나 규칙) */
function reattached(n: HTMLElement): () => number {
  let count = 0;
  new MutationObserver((records) => {
    for (const r of records) if ([...r.removedNodes].includes(n)) count++;
  }).observe(n.parentElement!, { childList: true });
  return () => count;
}

describe('229차: 3D 보기·측정 도구 조각을 받지 못하면 다시 시도', () => {
  it('3D 보기: 다시 열 길이 있으면 같은 글(chunkFailText)에 다시 시도 — 누르면 닫고 그 열기를 처음부터, 또 받지 못하면 버튼만 새로 고침(다시 열지 않음). 다시 열 길이 없으면(고르기·끌어 놓기) 지금처럼', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = mount();
    const n = a.els.notice;
    const moved = reattached(n);
    // 다시 열 길 없음(openFile — 바이트를 쥐지 않음): 글만(✕ 하나), 처음 뜰 때는 상자를 떼지 않는다
    expect(await a.ensureViewer()).toBe(false);
    expect(n.hidden).toBe(false);
    expect(title(n)).toBe('3D 보기를 열 수 없습니다');
    expect(text(n)).toBe(core.chunkFailText('viewer', true));
    expect(labels(n)).toEqual(['알림 닫기']);
    await Promise.resolve();
    expect(moved()).toBe(0);
    // 다시 열 길 있음(예제·최근 문서·주소 — openBlob이 넘긴 again): 같은 글에 다시 시도(✕ 앞)
    const again = vi.fn((): Promise<boolean> => a.ensureViewer(again));
    expect(await a.ensureViewer(again)).toBe(false);
    expect(title(n)).toBe('3D 보기를 열 수 없습니다');
    expect(text(n)).toBe(core.chunkFailText('viewer', true));
    expect(labels(n)).toEqual(['다시 시도', '알림 닫기']);
    expect(document.querySelectorAll('.notice')).toHaveLength(1);
    // 같은 글이 떠 있는 채로 다시 띄웠다 — 상자를 떼고 그 자리에 새로 붙임(한 번)
    await vi.waitFor(() => expect(moved()).toBe(1));
    // 다시 시도: 닫고 그 열기를 처음부터 — 또 받지 못하면 숨은 상자가 다시 떠(떼지 않음) 같은 글, 버튼만 새로 고침
    retries(n)[0]!.click();
    expect(n.hidden).toBe(true);
    expect(again).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(moved()).toBe(1);
    expect(title(n)).toBe('3D 보기를 열 수 없습니다');
    expect(text(n)).toBe(core.chunkFailText('viewer', true));
    expect(labels(n)).toEqual(['새로 고침', '알림 닫기']);
    // 새로 고침은 다시 시도를 부르지 않는다(jsdom은 탐색하지 않아 알림 그대로)
    reloads(n)[0]!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(again).toHaveBeenCalledTimes(1);
    expect(n.hidden).toBe(false);
  });

  it('측정 도구: 같은 글에 다시 시도(그 버튼 동작을 다시) — 같은 버튼을 다시 누르면 알림 하나를 떼고 새로 붙이고 다시 시도 그대로, 다시 시도 뒤 또 받지 못하면 새로 고침, 다른 길(버튼)로 받으면 실패 알림을 닫는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = mount();
    a.doc = rowDoc();
    const n = a.els.notice;
    const moved = reattached(n);
    a.toggleMeasure();
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(title(n)).toBe('측정 도구를 열 수 없습니다');
    expect(text(n)).toBe(core.chunkFailText('measure', true));
    expect(labels(n)).toEqual(['다시 시도', '알림 닫기']);
    await Promise.resolve();
    expect(moved()).toBe(0);
    // 같은 글 알림이 떠 있는 채로 같은 버튼(줄자)을 다시 누름 — 또 받지 못함: 상자를 떼고 그 자리에 새로 붙인다(알림 하나). 누른 것은 다시 시도가 아니라 다시 시도 그대로
    a.toggleMeasure();
    await vi.waitFor(() => expect(moved()).toBe(1));
    expect(n.isConnected).toBe(true);
    expect(n.hidden).toBe(false);
    expect(document.querySelectorAll('.notice')).toHaveLength(1);
    expect(title(n)).toBe('측정 도구를 열 수 없습니다');
    expect(labels(n)).toEqual(['다시 시도', '알림 닫기']);
    // 다시 시도: 닫고 그 버튼 동작을 다시 — 또 받지 못하면 숨은 상자가 다시 떠(떼지 않음) 버튼만 새로 고침
    retries(n)[0]!.click();
    expect(n.hidden).toBe(true);
    await vi.waitFor(() => expect(n.hidden).toBe(false));
    expect(moved()).toBe(1);
    expect(text(n)).toBe(core.chunkFailText('measure', true));
    expect(labels(n)).toEqual(['새로 고침', '알림 닫기']);
    // 다른 길(줄자 버튼)로 받으면 떠 있던 실패 알림을 닫는다(✕처럼)
    state.measure = true;
    a.toggleMeasure();
    await vi.waitFor(() => expect(n.hidden).toBe(true), { timeout: 10_000 });
  });

  it('열기 길: 예제·최근 문서·주소는 openBlob에 그 열기를 처음부터 다시 하는 함수를 넘기고, 고르기·끌어 놓기·공유 받은 큰 파일은 넘기지 않는다. 뷰어를 만들면 3D 보기 실패 알림을 닫는다', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toContain('await this.openBlob(name, new Blob([bytes as BlobPart]), seq, attempt, () => this.openSample());');
    expect(app).toContain('await this.openBlob(got.entry.name, got.data, seq, attempt, () => this.openRecent(e));');
    expect(app).toContain('await this.openBlob(name, file, seq, attempt, () => this.openUrl(url, name));');
    expect(app).toContain('if (await this.openBlob(name, file, seq, attempt)) void this.keepRecent(file, name);');
    expect(app).toContain('await this.openBlob(name, data, seq, attempt);');
    expect(app.match(/this\.openBlob\(/g)).toHaveLength(5);
    expect(app).toContain('if (!(await this.ensureViewer(again)) || seq !== this.openSeq) return false;');
    expect(app).toMatch(/this\.loadDone\('viewer'\);\n\s*return true;\n\s*\} catch \(e\) \{/);
  });
});
