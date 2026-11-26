// @vitest-environment jsdom
/**
 * 160차: 모달 대화 상자가 열린 동안 앱 글쇠가 뒤 3D 보기·문서에 듣는지(158차는 대화 상자 안의 Esc만 풀었음).
 * 이 앱의 모달은 바로 가기 안내 하나다(shortcuts.ts — role=dialog aria-modal=true, 어두운 바탕). 그림 저장 창(exporter.ts)은 aria-modal=false라
 * 모달이 아니다(바탕 없이 3D 보기를 그대로 쓰며 저장 — 158차 dialogkey 시험이 창 버튼의 글자 키를 앱 것으로 둠).
 * 앱 창 키(app.ts onKey — 창 keydown 캡처)는 모달이 열려 있으면 맨 앞에서 돌아섰지만 전파를 막지 않았다. 모달은 뒤 문서를 inert로 만들지 않아(showModal 아님)
 * 주소 막대에서 Tab으로 들어오면 뒤 문서 첫 버튼부터 3D 보기 캔버스(tabindex 0)까지 초점이 갈 수 있고, 그때 캔버스의 코어 키(Viewer3d keyboard 기본 켬 —
 * F·1~7 보기, 화살표·Enter 가상 커서 고르기, 걷기)와 뒤 위젯 키(나무·탭·가르개·메뉴)가 그대로 들었다. 상자 제목을 눌러 초점이 문서 몸으로 풀리면 Esc가 상자에 닿지 않아 닫히지도 않았다.
 * 160차: keys.ts inModal로 상자 안·밖을 가르고, 상자 밖 키는 전파를 막으며 Esc는 상자를 닫는다(APG dialog). 앱 클래스는 시험에서 만들지 않으므로(153차 꼴)
 * 판정 함수 + 실제 바로 가기 안내 + 창 캡처 리스너 + 앱 원문으로 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from '../../src/app/exporter';
import { inModal } from '../../src/app/keys';
import { openShortcutsDialog } from '../../src/app/shortcuts';

/** 뒤 문서(#app 꼴): 3D 보기 캔버스(코어가 tabindex 0을 줌)·장면 탭 모양 버튼·상자를 연 버튼 */
function backDoc(): { canvas: HTMLCanvasElement; tab: HTMLButtonElement; opener: HTMLButtonElement } {
  const app = document.body.appendChild(document.createElement('div'));
  app.id = 'app';
  const canvas = app.appendChild(document.createElement('canvas'));
  canvas.tabIndex = 0;
  const tab = app.appendChild(document.createElement('button'));
  tab.setAttribute('role', 'tab');
  const opener = app.appendChild(document.createElement('button'));
  return { canvas, tab, opener };
}

/** 실제 그림 저장 창을 열고 「PNG 저장」 버튼을 돌려준다 */
function exportButton(): HTMLElement {
  const parent = document.body.appendChild(document.createElement('div'));
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 640 });
  Object.defineProperty(canvas, 'clientHeight', { value: 480 });
  const ctx = { viewer: { canvas }, overlay: null, labels: null, base: 'light', restoreTheme: vi.fn() };
  new ExportDialog({ docName: () => '집.skp', context: () => ctx as never, notify: vi.fn(), track: vi.fn() }, parent).open();
  return parent.querySelector<HTMLElement>('.export-dialog button.primary')!;
}

describe('모달 대화 상자가 열린 동안 상자 밖 키는 뒤 3D 보기·문서로 보내지 않는다(160차)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('바로 가기 안내(aria-modal=true) 안은 상자 것, 뒤 문서·문서 몸·그림 저장 창(aria-modal=false — 모달 아님)은 밖 — 상자가 뒤를 inert로 만들지 않아 뒤 캔버스에 초점이 갈 수 있다', () => {
    expect(typeof inModal).toBe('function');
    const { canvas, tab } = backDoc();
    const exportBtn = exportButton();
    openShortcutsDialog(document.body, vi.fn());
    const box = document.querySelector<HTMLElement>('.sc-box')!;
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    const closeBtn = box.querySelector('button')!;
    expect(document.activeElement).toBe(closeBtn);
    for (const t of [box, closeBtn, box.querySelector('.sc-body'), box.querySelector('h2')]) expect(inModal(t)).toBe(true);
    expect(exportBtn.closest('[role="dialog"]')!.getAttribute('aria-modal')).toBe('false');
    for (const t of [canvas, tab, exportBtn, document.body, null, window]) expect(inModal(t)).toBe(false);
    // 주소 막대에서 Tab으로 들어온 꼴: 상자가 열린 채 뒤 캔버스가 초점을 받는다(inert 아님 — 상자의 Tab 가두기는 초점이 상자 안일 때만 듣는다)
    canvas.focus();
    expect(document.activeElement).toBe(canvas);
    expect(document.querySelector('.sc-box')).not.toBeNull();
  });

  it('창 캡처 리스너(onKey 꼴)는 상자 안 키를 상자에 두고, 뒤로 빠진 초점의 키는 코어 캔버스·뒤 위젯이 듣지 않으며, 상자 밖 Esc는 상자를 닫는다', () => {
    expect(typeof inModal).toBe('function');
    const { canvas, tab, opener } = backDoc();
    const heard: string[] = [];
    // 코어 캔버스 keydown 꼴(Viewer3d keyboard 기본 켬 — 받은 키는 전파를 막음)과 뒤 위젯 keydown(장면 탭 ←→ 등)
    canvas.addEventListener('keydown', (e) => {
      heard.push(`canvas ${e.key}`);
      e.stopPropagation();
    });
    tab.addEventListener('keydown', (e) => heard.push(`tab ${e.key}`));
    opener.focus();
    let close: (() => void) | null = null;
    close = openShortcutsDialog(document.body, () => (close = null));
    const taken: string[] = [];
    // app.ts onKey 꼴: 모달이 열려 있으면 맨 앞에서 — 상자 밖이면 전파를 막고 Esc는 상자를 닫은 뒤 돌아선다. 닫혀 있으면 앱 글쇠(받아 전파를 막음)
    const onKey = (ev: KeyboardEvent): void => {
      if (close) {
        if (!inModal(ev.target)) {
          ev.stopPropagation();
          if (ev.key === 'Escape') {
            ev.preventDefault();
            close();
          }
        }
        return;
      }
      taken.push(ev.key);
      ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const press = (key: string): void => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    try {
      const box = document.querySelector<HTMLElement>('.sc-box')!;
      expect(document.activeElement).toBe(box.querySelector('button'));
      // 상자 안: 글자 키는 아무 일 없고 Tab은 상자 안에서 돈다
      press('f');
      press('Tab');
      expect(document.activeElement).toBe(box.querySelector('.sc-body'));
      // 뒤로 빠진 초점(주소 막대에서 Tab으로 들어온 꼴): 보기·가상 커서·걷기·장면 키와 장면 탭 화살표를 아무도 듣지 않고 상자는 열린 채
      canvas.focus();
      for (const key of ['1', 'f', 'ArrowLeft', 'Enter', 'w', 'PageDown']) press(key);
      tab.focus();
      press('ArrowRight');
      expect(heard).toEqual([]);
      expect(taken).toEqual([]);
      expect(close).not.toBeNull();
      expect(document.querySelector('.sc-box')).not.toBeNull();
      // 상자 제목을 눌러 초점이 문서 몸으로 풀린 꼴: Esc가 상자를 닫고 연 버튼으로 초점
      (document.activeElement as HTMLElement).blur();
      expect(document.activeElement).toBe(document.body);
      press('Escape');
      expect(close).toBeNull();
      expect(document.querySelector('.sc-box')).toBeNull();
      expect(document.activeElement).toBe(opener);
      // 닫은 뒤에는 앱 글쇠 그대로
      canvas.focus();
      press('1');
      expect(taken).toEqual(['1']);
      expect(heard).toEqual([]);
    } finally {
      window.removeEventListener('keydown', onKey, true);
    }
  });

  it('app.ts 창 키는 맨 앞에서 모달이 열려 있으면 상자 밖 키의 전파를 막고 Esc로 상자를 닫은 뒤 돌아선다(메뉴·겹친 것 목록·menuKey·측정 도구·keyAction·뷰어 키 앞)', () => {
    const src = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\binModal\b[^}]*\} from '\.\/keys';/);
    const start = src.indexOf('  private onKey(ev: KeyboardEvent): void {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    expect(body).not.toContain('if (this.shortcutsClose) return;');
    const guard = body.indexOf('if (this.shortcutsClose) {');
    expect(guard).toBeGreaterThan(-1);
    const block = body.slice(guard, body.indexOf('\n    }\n', guard));
    const at = (s: string): number => {
      const i = block.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    expect(at('if (!inModal(ev.target)) {')).toBeLessThan(at('ev.stopPropagation();'));
    expect(at('ev.stopPropagation();')).toBeLessThan(at("if (ev.key === 'Escape') {"));
    expect(at("if (ev.key === 'Escape') {")).toBeLessThan(at('this.shortcutsClose();'));
    expect(at('this.shortcutsClose();')).toBeLessThan(at('return;'));
    for (const later of [
      'if (this.sliding',
      "if (this.menu && ev.key === 'Escape')",
      'if (this.pickList?.escape(ev)) return;',
      // 164차: 메뉴 안 글자·숫자 키도 거르는 가드(조합 키는 넘김)
      'if (menuKey(ev.target, ev.key, ev.ctrlKey || ev.metaKey || ev.altKey)) return;',
      'if (tool?.undoKey(ev))',
      'if (this.keyPick?.handleKey(ev))',
      'const act = keyAction({',
      'if (v.handleKey(ev))',
    ]) {
      const i = body.indexOf(later);
      expect(i, later).toBeGreaterThan(-1);
      expect(guard, later).toBeLessThan(i);
    }
  });
});
