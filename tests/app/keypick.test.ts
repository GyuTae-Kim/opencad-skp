/**
 * 3D 보기 키보드 고르기(56차 — keypick.ts, 코어 0.46.0 가상 커서·0.47.0 겹친 것 고르기 돌리기):
 * 알림 틀 사전 열쇠(네 언어, 틀이 번역층에서 다른 글을 바꾸지 않는지), 앱 키·줄자 화살표와 겹치지 않음,
 * 가짜 WebGL2 위 코어 뷰어에서 화살표·Tab·Enter·Esc와 onPick e.cycle → 펼친 단계를 건너뛴 고르기.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Viewer3d, type Pick3d, type PickEvent } from 'opencad-viewer3d';
import { KEY_SNAP_KEYS, KEY_SNAP_MESSAGES, keySnapAction, keySnapHint, keySnapMessages, type KeySnapMessageKey, type KeySnapMessages } from 'opencad-viewer3d/keysnap';
import { catalogs, languages, registerCatalog, sourceMessage, translate } from '../../site/i18n.mjs';
import { type createDoc, selectionForPick } from '../../src/app/doc';
import { KEY_MEASURE_HINT, KEY_PICK_ITEM, KEY_PICK_TEXT, KeyPick, LIST_TARGETS, PICK_CYCLE, keyPickItems, keyPickMessages, keyPickName, keyPickText, type KeyMeasureHost } from '../../src/app/keypick';
import { KEY_MEASURE_TEXT } from '../../src/app/measure';
import { keyAction } from '../../src/app/keys';
import { PICK_LIST_MAX, pickListItems } from '../../src/app/picklist';
import { SHORTCUTS } from '../../src/app/shortcuts';
import { childrenOf, nodeName } from '../../src/app/tree';
import { type FakeElement, installDom } from '../fakegl/fakedom';
import { rowDoc } from './rowdoc';

const CODES = languages.filter((l) => l.code !== 'ko').map((l) => l.code);
const HANGUL = /[가-힣]/;
/** 이번에 사전에 더한 열쇠: 알림 틀(이미 있던 면·모서리·보조점은 빼고)과 바로 가기 안내의 새 묶음 */
const SHORTCUT_GROUP = SHORTCUTS.find((g) => g.title === '3D 보기 키보드 고르기')!;
const BEFORE = new Set(['면', '모서리', '보조점']);
// 57차 겹친 것 목록 줄(Shift+F10)은 tests/app/picklist.test.ts가 본다
const ADDED = [
  ...new Set([...Object.values(KEY_PICK_TEXT).filter((t) => !BEFORE.has(t)), SHORTCUT_GROUP.title, ...SHORTCUT_GROUP.items.filter((i) => !i.keys.includes('Shift+F10')).map((i) => i.label)]),
];

describe('알림 틀(네 언어 사전 열쇠)', () => {
  it('앱이 주는 틀은 모두 코어 열쇠이고 네 언어 사전에 있으며, 옮긴 틀에 한글이 남지 않는다', () => {
    for (const k of Object.keys(KEY_PICK_TEXT)) expect(Object.keys(KEY_SNAP_MESSAGES), k).toContain(k);
    expect(ADDED.length).toBe(16);
    for (const code of CODES) {
      for (const t of [...Object.values(KEY_PICK_TEXT), ...ADDED]) expect(catalogs[code][t], `${code}: ${t}`).toBeTruthy();
      const m = keyPickMessages((t) => translate(t, code));
      for (const [k, v] of Object.entries(m)) expect(v, `${code}: ${k}`).not.toMatch(HANGUL);
    }
    // 한국어: 키 안내는 코어 기본 글과 바이트까지 같다(앱 키 = 코어 기본 키라 키를 끼운 열쇠)
    const ko = keySnapMessages(keyPickMessages((t) => t));
    expect(keySnapHint(KEY_SNAP_KEYS, 'pick', true, ko)).toBe(keySnapHint(KEY_SNAP_KEYS, 'pick', true));
    expect(keySnapHint(KEY_SNAP_KEYS, 'pick', true, ko)).toBe('옮기기 ←→↑↓ · 후보 Tab · 고르기 Enter · 끄기 Esc');
    for (const k of ['start', 'end', 'only', 'noPick', 'picked', 'pickedNothing', 'pick.mesh', 'pick.section'] as const) expect(ko[k]).toBe(KEY_SNAP_MESSAGES[k]);
    // SketchUp 선분 묶음은 모서리, 점 묶음은 보조점
    expect([ko['pick.line'], ko['pick.point']]).toEqual(['모서리', '보조점']);
  });

  it('한글이 없는 코어 틀(이름 종류·후보·차례·좌표·키 안내 사이)은 사전에 넣지 않는다 — 사전의 {0} 틀은 모든 화면 글에 맞춰 본다', () => {
    const free = (['pickItem', 'candidate', 'order', 'point', 'hintJoin'] as const).map((k) => KEY_SNAP_MESSAGES[k]);
    for (const t of free) expect(HANGUL.test(t), t).toBe(false);
    for (const code of CODES) {
      for (const t of free) expect(catalogs[code][t], `${code}: ${t}`).toBeUndefined();
      // 사전의 모든 틀은 자리 밖에 한글이 있다(아무 글이나 잡는 틀이 없다)
      for (const k of Object.keys(catalogs[code]).filter((x) => /\{\d+\}/.test(x))) expect(k.replace(/\{\d+\}/g, ''), `${code}: ${k}`).toMatch(HANGUL);
    }
  });

  it('새 열쇠를 더해도 화면 번역층이 옮기는 다른 글은 바뀌지 않는다(예전 열쇠의 틀 채운 글·나눔 글·되찾기)', () => {
    const samples = ['A', '3', '벽', '그룹 1', 'Wood · Layer0'];
    const corpus = new Set<string>();
    const keys = Object.keys(catalogs.en).filter((k) => !ADDED.includes(k));
    for (const k of keys) {
      corpus.add(k);
      if (/\{\d+\}/.test(k)) for (const s of samples) corpus.add(k.replace(/\{\d+\}/g, s));
    }
    // 고른 것 줄·측정 줄처럼 조각을 이은 글, 새 틀과 머리가 같은 글
    for (const t of ['면 · 넓이 12.5 m² · 재질 Wood · 태그 Walls', '그룹 Wall · 위치 House · 면 12', '모서리 · 길이 300 mm', '고르기 방식', '후보 3', '끄기', '옮기기', '골랐습니다', '잘린 면 채우기', '빈 곳'])
      corpus.add(t);
    const full = Object.fromEntries(CODES.map((c) => [c, { ...catalogs[c] }]));
    const run = (): Map<string, string> => {
      const out = new Map<string, string>();
      for (const c of CODES) {
        for (const t of corpus) out.set(`${c}\t${t}`, translate(t, c));
        for (const k of keys) out.set(`src\t${c}\t${k}`, sourceMessage(full[c]![k]!));
      }
      return out;
    };
    const after = run();
    try {
      for (const c of CODES) registerCatalog(c, Object.fromEntries(Object.entries(full[c]!).filter(([k]) => !ADDED.includes(k))));
      const before = run();
      expect(before.size).toBe(after.size);
      const diff = [...before].filter(([k, v]) => after.get(k) !== v);
      expect(diff).toEqual([]);
    } finally {
      for (const c of CODES) registerCatalog(c, full[c]!);
    }
    expect(Object.keys(catalogs.en).length).toBe(keys.length + ADDED.length);
  });

  it('고르기 알림 글: 코어와 같은 틀·차례로 앱 이름·좌표를 끼우고, 네 언어 모두 한글이 남지 않는다', () => {
    const pick: Pick3d = { kind: 'mesh', id: 'skp-mesh-0', index: 0, point: [1, 2, 3] };
    const num = (v: number): string => `${v} mm`;
    const ko = keySnapMessages(keyPickMessages((t) => t));
    const items = keyPickItems((t) => t);
    const base = { index: 1, count: 4, pick, text: '' };
    expect(keyPickText({ ...base, reason: 'move' }, ko, items, '그룹 Row', num)).toBe('그룹 Row의 면 2/4: X 1 mm, Y 2 mm, Z 3 mm');
    expect(keyPickText({ ...base, reason: 'start', index: 0 }, ko, items, '그룹 Row', num)).toBe(
      '가상 커서를 켰습니다. 그룹 Row의 면 1/4: X 1 mm, Y 2 mm, Z 3 mm. 옮기기 ←→↑↓ · 후보 Tab · 고르기 Enter · 끄기 Esc',
    );
    expect(keyPickText({ ...base, reason: 'commit' }, ko, items, '그룹 Row', num)).toBe('골랐습니다: 그룹 Row의 면');
    expect(keyPickText({ ...base, reason: 'cycle', index: 0, count: 1 }, ko, items, 'Row', num)).toBe('Row의 면: X 1 mm, Y 2 mm, Z 3 mm (후보 하나)');
    expect(keyPickText({ ...base, reason: 'cycle', pick: { ...pick, kind: 'line' } }, ko, items, 'Row', num)).toBe('Row의 모서리 2/4: X 1 mm, Y 2 mm, Z 3 mm');
    expect(keyPickText({ ...base, reason: 'move', pick: { ...pick, kind: 'point' } }, ko, items, 'Row', num)).toContain('Row의 보조점 2/4');
    expect(keyPickText({ ...base, reason: 'move', pick: { ...pick, section: true } }, ko, items, 'Row', num)).toContain('Row의 잘린 면 2/4');
    // 고른 것이 없으면 코어 글 그대로
    expect(keyPickText({ ...base, reason: 'end', pick: null, text: '가상 커서를 껐습니다' }, ko, items, '', num)).toBe('가상 커서를 껐습니다');
    for (const code of CODES) {
      const M = keySnapMessages(keyPickMessages((t) => translate(t, code)));
      const I = keyPickItems((t) => translate(t, code));
      for (const reason of ['start', 'move', 'cycle', 'commit', 'refresh'] as const)
        for (const kind of ['mesh', 'line', 'edge', 'point'] as const) {
          const t = keyPickText({ ...base, reason, pick: { ...pick, kind } }, M, I, 'Group Row', num);
          expect(t, `${code} ${reason} ${kind}`).not.toMatch(HANGUL);
        }
      for (const k of ['end', 'noPick', 'pickedNothing'] as KeySnapMessageKey[]) expect(M[k], code).not.toMatch(HANGUL);
    }
    const lang = (code: string): [KeySnapMessages, ReturnType<typeof keyPickItems>] => [keySnapMessages(keyPickMessages((t) => translate(t, code))), keyPickItems((t) => translate(t, code))];
    expect(keyPickText({ ...base, reason: 'start', index: 0 }, ...lang('en'), 'Group Row', num)).toBe(
      'Virtual cursor on. Face of Group Row 1/4: X 1 mm, Y 2 mm, Z 3 mm. Move ←→↑↓ · Next candidate Tab · Select Enter · Exit Esc',
    );
    // 58차 말 차례: 이름 뒤에 종류를 붙이던 코어 틀("Group Row Face") 대신 언어마다 자연스러운 차례
    const commit = { ...base, reason: 'commit' } as const;
    expect(keyPickText(commit, ...lang('en'), 'Group Row', num)).toBe('Selected Face of Group Row');
    expect(keyPickText(commit, ...lang('de'), 'Gruppe Row', num)).toBe('Fläche von Gruppe Row ausgewählt');
    expect(keyPickText(commit, ...lang('ja'), 'グループ Row', num)).toBe('選択しました: グループ Rowの面');
    expect(keyPickText(commit, ...lang('zh-CN'), '组 Row', num)).toBe('已选择：组 Row的面');
    expect(keyPickText({ ...base, reason: 'move', pick: { ...pick, kind: 'line' } }, ...lang('en'), 'Group Row', num)).toBe('Edge of Group Row 2/4: X 1 mm, Y 2 mm, Z 3 mm');
  });

  it('58차 "이름 + 종류" 틀: 자리 밖에 한글이 든 사전 열쇠(네 언어), 옮긴 틀에 한글이 없고, 더해도 화면 번역층이 옮기는 다른 글은 바뀌지 않는다', () => {
    const added = [...new Set(Object.values(KEY_PICK_ITEM))];
    expect(added.length).toBe(4);
    for (const t of added) expect(t.replace(/\{\d+\}/g, '')).toMatch(HANGUL);
    for (const code of CODES)
      for (const t of added) {
        expect(catalogs[code][t], `${code}: ${t}`).toBeTruthy();
        expect(translate(t, code), `${code}: ${t}`).not.toMatch(HANGUL);
        expect(translate(t, code), `${code}: ${t}`).toContain('{0}');
      }
    const samples = ['A', '3', '벽', '그룹 1', 'Wood · Layer0'];
    const keys = Object.keys(catalogs.en).filter((k) => !added.includes(k as (typeof added)[number]));
    const corpus = new Set<string>(['면', '모서리', '보조점', '잘린 면', '그룹 Wall · 면', '면 · 넓이 12.5 m² · 재질 Wood · 태그 Walls', '모서리 · 길이 300 mm', '잘린 면 채우기']);
    for (const k of keys) {
      corpus.add(k);
      if (/\{\d+\}/.test(k)) for (const s of samples) corpus.add(k.replace(/\{\d+\}/g, s));
    }
    const full = Object.fromEntries(CODES.map((c) => [c, { ...catalogs[c] }]));
    const run = (): Map<string, string> => {
      const out = new Map<string, string>();
      for (const c of CODES) {
        for (const t of corpus) out.set(`${c}\t${t}`, translate(t, c));
        for (const k of keys) out.set(`src\t${c}\t${k}`, sourceMessage(full[c]![k]!));
      }
      return out;
    };
    const after = run();
    try {
      for (const c of CODES) registerCatalog(c, Object.fromEntries(Object.entries(full[c]!).filter(([k]) => !added.includes(k as (typeof added)[number]))));
      const before = run();
      expect([...before].filter(([k, v]) => after.get(k) !== v)).toEqual([]);
    } finally {
      for (const c of CODES) registerCatalog(c, full[c]!);
    }
  });
});

describe('59차 줄자·각도기 키보드 점 찍기 열쇠', () => {
  it('키 안내·알림 글·바로 가기 줄 열쇠는 네 언어 사전에 있고 한글이 남지 않으며, 더해도 화면 번역층이 옮기는 다른 글은 바뀌지 않는다', () => {
    const rows = SHORTCUTS.flatMap((g) => g.items).filter((i) => i.label.startsWith('줄자·각도기를 켠 동안 3D') || i.label.startsWith('줄자·각도기의 가상 커서'));
    expect(rows.map((r) => r.keys.join(' '))).toEqual(['Enter', '← → ↑ ↓', 'Esc']);
    // 키 안내의 옮기기·끄기는 56차 열쇠 그대로
    expect(KEY_MEASURE_HINT.filter((t) => (Object.values(KEY_PICK_TEXT) as string[]).includes(t))).toEqual(['옮기기 ←→↑↓', '끄기 Esc']);
    const added = [...new Set([...KEY_MEASURE_HINT.filter((t) => !(Object.values(KEY_PICK_TEXT) as string[]).includes(t)), ...Object.values(KEY_MEASURE_TEXT), ...rows.map((r) => r.label)])];
    expect(added.length).toBe(10);
    for (const t of added) expect(t.replace(/\{\d+\}/g, ''), t).toMatch(HANGUL);
    for (const code of CODES)
      for (const t of [...KEY_MEASURE_HINT, ...added]) {
        expect(catalogs[code][t], `${code}: ${t}`).toBeTruthy();
        expect(translate(t, code), `${code}: ${t}`).not.toMatch(HANGUL);
        if (t.includes('{0}')) expect(translate(t, code), `${code}: ${t}`).toContain('{0}');
      }
    expect(translate('시작점을 찍었습니다. {0}', 'en').replace('{0}', 'Endpoint: X 0 mm, Y 0 mm, Z 0 mm')).toBe('Start point placed. Endpoint: X 0 mm, Y 0 mm, Z 0 mm');
    const samples = ['A', '3', '벽', '그룹 1', 'Wood · Layer0', '끝점: X 0 mm, Y 0 mm, Z 0 mm'];
    const keys = Object.keys(catalogs.en).filter((k) => !added.includes(k));
    const corpus = new Set<string>(['찍기', '중심', '시작점', '기준 방향', '끝점 · 100 mm', '거리 100 mm (dx 100 mm · dy 0 mm · dz 0 mm)', '각도 90.0°', '줄자: 끝점을 누르세요 · Esc 취소']);
    for (const k of keys) {
      corpus.add(k);
      if (/\{\d+\}/.test(k)) for (const s of samples) corpus.add(k.replace(/\{\d+\}/g, s));
    }
    const full = Object.fromEntries(CODES.map((c) => [c, { ...catalogs[c] }]));
    const run = (): Map<string, string> => {
      const out = new Map<string, string>();
      for (const c of CODES) {
        for (const t of corpus) out.set(`${c}\t${t}`, translate(t, c));
        for (const k of keys) out.set(`src\t${c}\t${k}`, sourceMessage(full[c]![k]!));
      }
      return out;
    };
    const after = run();
    try {
      for (const c of CODES) registerCatalog(c, Object.fromEntries(Object.entries(full[c]!).filter(([k]) => !added.includes(k))));
      const before = run();
      expect(before.size).toBe(after.size);
      expect([...before].filter(([k, v]) => after.get(k) !== v)).toEqual([]);
    } finally {
      for (const c of CODES) registerCatalog(c, full[c]!);
    }
  });
});

describe('키 겹침', () => {
  it('SKP 키(T·PageUp·PageDown·?·F7·Delete·Backspace)는 가상 커서 키가 아니다', () => {
    for (const key of ['t', 'T', 'PageUp', 'PageDown', '?', 'F7', 'Delete', 'Backspace', 'f', 'F', '1', '7'])
      for (const shiftKey of [false, true]) expect(keySnapAction({ key, shiftKey }, KEY_SNAP_KEYS), key).toBeNull();
    // 앱 키 규칙도 그 키를 제 할 일로 그대로 쓴다(가상 커서가 켜져 있어도)
    const base = { hasDoc: true, hasPages: true, keyCursor: true };
    expect(keyAction({ ...base, key: 'T' })).toEqual({ kind: 'tape' });
    expect(keyAction({ ...base, key: 'PageDown' })).toEqual({ kind: 'page', delta: 1 });
    expect(keyAction({ ...base, key: 'F7' })).toEqual({ kind: 'grid' });
    expect(keyAction({ ...base, key: '?' })).toEqual({ kind: 'help' });
  });

  it('가상 커서 키(화살표·Tab·Shift+Tab·Enter·Esc)는 앱 키 규칙이 뷰어로 넘기고, Esc는 커서가 켜져 있으면 고른 것보다 커서를 먼저 끈다', () => {
    const keys = Object.values(KEY_SNAP_KEYS).flat();
    expect(keys.sort()).toEqual(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter', 'Escape', 'Shift+Tab', 'Tab']);
    for (const k of keys) {
      const key = k.split('+').pop()!;
      expect(keyAction({ key, hasDoc: true, keyCursor: true }), k).toEqual({ kind: 'viewer' });
    }
    expect(keyAction({ key: 'Escape', hasDoc: true })).toEqual({ kind: 'clearSelection' });
    // 측정·걷기의 Esc 차례가 먼저(그때는 키보드 고르기가 꺼져 있거나 코어가 커서를 끈다)
    expect(keyAction({ key: 'Escape', hasDoc: true, keyCursor: true, measureMode: true })).toEqual({ kind: 'measureOff' });
    expect(keyAction({ key: 'Escape', hasDoc: true, keyCursor: true, walking: true })).toEqual({ kind: 'walkOff' });
    // 목록·메뉴의 화살표는 그쪽 것
    expect(keyAction({ key: 'ArrowLeft', hasDoc: true, keyCursor: true, inList: true })).toBeNull();
  });

  it('줄자·각도기 화살표(방향 잠금)와 겹치지 않게 측정 도구를 켜면 키보드 고르기 대신 Enter로 켜는 점 찍기(59차 — 받는 중인 도구는 끈다)', () => {
    const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
    expect(app).toMatch(/const mode = this\.measureModeNow;\n\s*\/\/[^\n]*\n\s*this\.keyPick\?\.follow\(mode\);/);
    expect(app).toMatch(/new keyPicking\.KeyPick\(v, this\.els\.viewHost, \(\) => this\.doc, this\)/);
    // 창 키: 측정 도구를 켠 동안 측정 도구 키는 keypick.ts handleKey로(가상 커서 화살표·Enter·Esc 차례가 먼저)
    expect(app).toMatch(
      /\n(\s*\/\/[^\n]*\n)+\s*if \(this\.keyPick\?\.handleKey\(ev\)\) \{\n\s*ev\.stopPropagation\(\);\n\s*return;\n\s*\}\n\s*\/\/[^\n]*\n\s*if \(tool\?\.active && !isEditableTarget\(ev\.target\) && ev\.key === 'Escape' && !this\.busy\) \{/,
    );
    expect(app).not.toMatch(/tool\.handleKey\(ev\)/);
    // 화살표를 스스로 쓰는 곳 고르개는 앱 창 키의 keys.ts inList와 같다(첫 화면 조각이 함수를 내보내지 않게 키보드 조각에 따로 둔 사본)
    expect(readFileSync(resolve(__dirname, '../../src/app/keys.ts'), 'utf8')).toContain(`el.closest('${LIST_TARGETS}')`);
    const arrows = SHORTCUTS.flatMap((g) => g.items).filter((i) => i.label.startsWith('줄자 끝점·각도기 방향'));
    expect(arrows.flatMap((i) => i.keys).filter((k) => /[←→↑↓]/.test(k)).sort()).toEqual(['←', '↑', '→', '↓']);
    expect(SHORTCUT_GROUP.items[0]!.label).toContain('줄자·각도기를 끈 동안');
  });
});

// ── 가짜 WebGL2 위 코어 뷰어(모형: 감싼 그룹 Row 안 상자 Near·Far — rowdoc.ts) ──

let dom: ReturnType<typeof installDom>;
const views: Viewer3d[] = [];
beforeAll(() => {
  dom = installDom();
});
afterAll(() => {
  for (const v of views) v.dispose();
  dom.restore();
});

function setup(): { v: Viewer3d; kp: KeyPick; d: ReturnType<typeof createDoc>; cv: FakeElement; host: FakeElement; picks: [Pick3d | null, PickEvent][] } {
  const d = rowDoc();
  const host = dom.host();
  const v = new Viewer3d(host as unknown as HTMLElement, { animate: false, keyboard: true, viewCube: false, grid: false });
  views.push(v);
  v.setScene(d.scene);
  v.setView('right', false);
  v.fit(false);
  const picks: [Pick3d | null, PickEvent][] = [];
  v.onPick((p, e) => picks.push([p, e]));
  const kp = new KeyPick(v, host as unknown as HTMLElement, () => d);
  return { v, kp, d, cv: v.canvas as unknown as FakeElement, host, picks };
}
const key = (cv: FakeElement, k: string, shiftKey = false): void => cv.fire('keydown', { key: k, shiftKey, defaultPrevented: false });

describe('가짜 WebGL2 코어 뷰어 — 키보드 고르기', () => {
  it('켜면 코어 setKeyboardSnap에 앱 고르기 선택·틀을 주고, 알림 칸(role=status, 번역층 밖)과 캔버스 키 안내를 단다', () => {
    const { v, kp, host, cv } = setup();
    const live = host.children.find((c) => c.className === 'kp-live')!;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.hasAttribute('data-i18n-skip')).toBe(true);
    expect(v.keyboardSnap).toBeNull();
    kp.set(true);
    const ks = v.keyboardSnap!;
    // 59차: 앱 묶음 열쇠(pickGroupKey — tests/app/pickgroup.test.ts)
    expect(ks.pickCycle).toEqual({ ...PICK_CYCLE, group: expect.any(Function) });
    expect(ks.messages).toEqual(keyPickMessages());
    expect(cv.getAttribute('aria-keyshortcuts')).toBe('ArrowLeft ArrowRight ArrowUp ArrowDown Enter');
    kp.set(false);
    expect(v.keyboardSnap).toBeNull();
    expect(cv.getAttribute('aria-keyshortcuts')).toBeNull();
  });

  it('화살표로 켠 커서 자리의 겹친 면을 Tab으로 돌리고 Enter로 고른다 — 둘째부터 onPick e.cycle, 앱은 펼친 단계를 건너뛰어 그 상자를 고른다', () => {
    const { v, kp, d, cv, picks } = setup();
    kp.set(true);
    const t = d.tree!;
    const row = childrenOf(t, -1)[0]!;
    const [far, near] = childrenOf(t, row);
    expect([nodeName(t, row), nodeName(t, far!), nodeName(t, near!)]).toEqual(['Row', 'Far', 'Near']);
    key(cv, 'ArrowLeft');
    const c = v.keyboardCursor!;
    expect(c.mode).toBe('pick');
    // 가운데 시선: Near 앞·뒤 면, Far 앞·뒤 면
    expect(c.count).toBe(4);
    expect(kp.text).toMatch(/^가상 커서를 켰습니다\. 그룹 Row의 면 1\/4: X [^,]+, Y [^,]+, Z [^.]+\. 옮기기 ←→↑↓ · 후보 Tab · 고르기 Enter · 끄기 Esc$/);
    key(cv, 'Tab');
    expect(v.keyboardCursor!.index).toBe(1);
    // 둘째 후보 이름은 펼친 단계를 건너뛴 가장 안쪽 노드(Near)
    expect(kp.text).toMatch(/^그룹 Near의 면 2\/4: /);
    key(cv, 'Tab');
    expect(kp.text).toMatch(/^그룹 Far의 면 3\/4: /);
    key(cv, 'Enter');
    expect(picks.length).toBe(1);
    const [p, e] = picks[0]!;
    expect(e.cycle).toEqual({ index: 2, count: 4 });
    expect(e.pointerType).toBe('keyboard');
    // 앱 고르기: 보통(펼친 단계) = Row, 돌린 후보(e.cycle) = Far
    expect(selectionForPick(d, p)).toEqual({ kind: 'outline', index: d.outline.findIndex((r) => r.node === row) });
    expect(selectionForPick(d, p, false, true)).toEqual({ kind: 'node', index: far });
    expect(kp.text).toBe('골랐습니다: 그룹 Far의 면');
    // 면·모서리 방식이면 돌린 후보도 그 면
    d.pickMode = 'face';
    expect(selectionForPick(d, p, false, true)?.kind).toBe('face');
    expect(keyPickName(d, p!, true)).toBe('그룹 Far');
    d.pickMode = 'open';
    // 첫째 후보 Enter는 0.46.0처럼 누르기와 같은 고르기(cycle 없음)
    key(cv, 'Tab', true);
    key(cv, 'Tab', true);
    expect(v.keyboardCursor!.index).toBe(0);
    key(cv, 'Enter');
    expect(picks[1]![1].cycle).toBeUndefined();
    expect(kp.text).toBe('골랐습니다: 그룹 Row의 면');
    // Esc는 커서를 끈다(알림), 그 뒤 Tab은 받지 않는다(초점 이동)
    key(cv, 'Escape');
    expect(v.keyboardCursor).toBeNull();
    expect(kp.text).toBe('가상 커서를 껐습니다');
    key(cv, 'Tab');
    expect(v.keyboardCursor).toBeNull();
  });

  it('57차 겹친 것 목록 항목: 같은 자리 코어 pickCandidates를 앱 고르기로 묶는다(첫째 펼친 단계, 둘째부터 가장 안쪽·면 방식은 면마다)', () => {
    const { v, d } = setup();
    const t = d.tree!;
    const row = childrenOf(t, -1)[0]!;
    const [far, near] = childrenOf(t, row);
    const cx = v.canvas.clientWidth / 2 || 400;
    const cy = v.canvas.clientHeight / 2 || 300;
    const picks = v.pickCandidates(cx, cy, { ...PICK_CYCLE, pointerType: 'mouse', max: PICK_LIST_MAX });
    // 가운데 시선: Near 앞·뒤 면, Far 앞·뒤 면(가상 커서 Tab 차례와 같다)
    expect(picks.length).toBe(4);
    const items = pickListItems(d, picks);
    expect(items.map((i) => [i.name, i.kind])).toEqual([
      ['그룹 Row', '면'],
      ['그룹 Near', '면'],
      ['그룹 Far', '면'],
    ]);
    expect(items.map((i) => i.sel)).toEqual([
      { kind: 'outline', index: d.outline.findIndex((r) => r.node === row) },
      { kind: 'node', index: near },
      { kind: 'node', index: far },
    ]);
    // 고를 것은 그 후보로 앱 onPick이 고르는 것과 같다(첫째는 보통, 둘째부터 e.cycle)
    expect(items[0]!.sel).toEqual(selectionForPick(d, items[0]!.pick));
    expect(items[2]!.sel).toEqual(selectionForPick(d, items[2]!.pick, false, true));
    expect(items[2]!.pick).toEqual(picks[2]);
    // 면·모서리 방식: 면마다 하나(넷), 이름은 그 면을 품은 가장 안쪽 그룹
    d.pickMode = 'face';
    const faces = pickListItems(d, picks);
    expect(faces.map((i) => [i.name, i.sel?.kind])).toEqual([
      ['그룹 Near', 'face'],
      ['그룹 Near', 'face'],
      ['그룹 Far', 'face'],
      ['그룹 Far', 'face'],
    ]);
    d.pickMode = 'open';
    // 잘린 면 후보는 뺀다(앱이 고르지 않는다), 종류는 지금 언어
    const en = pickListItems(d, [{ ...picks[0]!, section: true }, ...picks.slice(1)], (x) => translate(x, 'en'));
    expect(en.map((i) => [i.name, i.kind])).toEqual([
      ['그룹 Near', 'Face'],
      ['그룹 Far', 'Face'],
    ]);
    expect(pickListItems(d, [{ ...picks[0]!, kind: 'line' }], (x) => x)[0]!.kind).toBe('모서리');
  });

  it('줄자·각도기를 켜면(set(false)) 켜진 커서도 끄고 화살표를 받지 않는다(측정 도구의 방향 잠금 몫), 다시 켜면 받는다', () => {
    const { v, kp, cv } = setup();
    kp.set(true);
    key(cv, 'ArrowUp');
    expect(v.keyboardCursor).not.toBeNull();
    kp.set(false);
    expect(v.keyboardCursor).toBeNull();
    expect(kp.text).toBe('');
    key(cv, 'ArrowUp');
    expect(v.keyboardCursor).toBeNull();
    kp.set(true);
    key(cv, 'ArrowUp');
    expect(v.keyboardCursor).not.toBeNull();
    // 언어를 다시 맞춰도 켜진 커서는 그대로
    kp.relocalize();
    expect(v.keyboardCursor).not.toBeNull();
    expect(kp.enabled).toBe(true);
  });

  it('59차 줄자·각도기: Enter로만 커서를 켜고(꺼진 동안 화살표는 측정 도구 몫), 켠 동안 화살표는 커서 옮기기·Enter는 측정 도구로 찍기·Esc는 지울 것이 먼저', () => {
    const { v, cv, picks, d, host: el } = setup();
    const calls: string[] = [];
    let clearable = false;
    const host: KeyMeasureHost = {
      active: true,
      handleKey: (e) => {
        calls.push(`key ${e.key}`);
        if (e.key !== 'Escape' || !clearable) return false;
        clearable = false;
        return true;
      },
      keyHover: (x, y) => {
        calls.push(`hover ${x},${y}`);
        return `끝점: ${x},${y}`;
      },
      keyEnd: (keep) => void calls.push(`end ${keep}`),
      keyPlace: (shift) => {
        calls.push(`place ${shift}`);
        return '시작점을 찍었습니다. 끝점';
      },
    };
    /** 앱 창 키 처리기가 handleKey에 넘기는 키 사건(대상 = 3D 보기) */
    const ev = (k: string, o: Record<string, unknown> = {}): KeyboardEvent =>
      ({ key: k, type: 'keydown', target: cv, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, preventDefault() {}, ...o }) as unknown as KeyboardEvent;
    // 측정 도구를 받기 전에는 줄자 방식이 아니라 끈다(측정 도구 키도 없다)
    const app: { measureTool: KeyMeasureHost | null } = { measureTool: null };
    const kp = new KeyPick(v, el as unknown as HTMLElement, () => d, app);
    kp.follow('tape');
    expect(v.keyboardSnap).toBeNull();
    expect(kp.handleKey(ev('ArrowRight'))).toBe(false);
    // 받는 중(측정 도구가 아직 꺼짐)도 끈다
    app.measureTool = { ...host, active: false };
    kp.follow('tape');
    expect(v.keyboardSnap).toBeNull();
    expect(kp.handleKey(ev('ArrowRight'))).toBe(false);
    app.measureTool = host;
    kp.follow('tape');
    expect(v.keyboardSnap!.pickCycle).toBe(false);
    expect(kp.enabled).toBe(false);
    // 커서가 꺼진 동안 화살표: 측정 도구(방향 잠금)만 — 다루지 않았어도 커서를 켜지 않는다. 목록 안의 화살표는 그쪽 것
    expect(kp.handleKey(ev('ArrowRight'))).toBe(true);
    expect(calls).toEqual(['key ArrowRight']);
    expect(v.keyboardCursor).toBeNull();
    expect(kp.handleKey(ev('ArrowRight', { target: { closest: () => ({}) } }))).toBe(false);
    expect(calls).toEqual(['key ArrowRight']);
    // 다른 키는 측정 도구 키 그대로(다루지 않았으면 앱 차례로 — 꺼진 동안 Enter는 앱이 코어로 넘긴다)
    expect(kp.handleKey(ev('Enter'))).toBe(false);
    expect(calls.at(-1)).toBe('key Enter');
    // 코어 Enter: 가운데에 켜고 측정 도구가 그 자리를 추정, 키 안내는 찍기·방향 잠금
    key(cv, 'Enter');
    expect(v.keyboardCursor).toMatchObject({ x: 400, y: 300, mode: 'pick' });
    expect(kp.text).toBe('가상 커서를 켰습니다. 끝점: 400,300. 옮기기 ←→↑↓ · 찍기 Enter · 방향 잠금 Shift · 끄기 Esc');
    // 켠 동안 화살표는 코어 커서 옮기기(Shift는 크게) — 측정 도구의 방향 잠금으로 가지 않는다
    calls.length = 0;
    expect(kp.handleKey(ev('ArrowRight'))).toBe(true);
    expect(kp.handleKey(ev('ArrowDown', { shiftKey: true }))).toBe(true);
    expect(v.keyboardCursor).toMatchObject({ x: 405, y: 350 });
    expect(kp.text).toBe('끝점: 405,350');
    expect(calls).toEqual(['hover 405,300', 'hover 405,350']);
    // Tab은 후보 돌리기가 아니다(측정 도구 키 → 앱 → 코어도 받지 않아 초점 이동 — 측정 도구에는 붙잡기 후보 목록이 없다)
    expect(kp.handleKey(ev('Tab'))).toBe(false);
    expect(v.handleKey(ev('Tab'))).toBe(false);
    // Enter: 커서 자리에 측정 도구로 찍기(코어 고르기 onPick 없이), Shift+Enter는 shift
    expect(kp.handleKey(ev('Enter', { shiftKey: true }))).toBe(true);
    expect(calls.at(-1)).toBe('place true');
    expect(kp.text).toBe('시작점을 찍었습니다. 끝점');
    expect(picks).toEqual([]);
    // 3D 보기가 아닌 곳의 Enter는 찍지 않는다
    expect(kp.handleKey(ev('Enter', { target: null }))).toBe(false);
    // Esc: 측정 도구가 지울 것(점·결과)이 먼저, 없으면 커서 끄기 — 초점이 3D 보기에 있으면 표식을 거둔다
    clearable = true;
    expect(kp.handleKey(ev('Escape'))).toBe(true);
    expect(v.keyboardCursor).not.toBeNull();
    cv.focus();
    expect(kp.handleKey(ev('Escape'))).toBe(true);
    expect(v.keyboardCursor).toBeNull();
    expect(calls.at(-1)).toBe('end false');
    expect(kp.text).toBe('가상 커서를 껐습니다');
    // 초점이 다른 곳(측정값 칸)으로 가서 꺼지면 표식을 그 자리에 둔다(친 길이의 방향)
    key(cv, 'Enter');
    expect(v.keyboardCursor).not.toBeNull();
    dom.doc.activeElement = dom.host();
    cv.fire('blur', {});
    expect(v.keyboardCursor).toBeNull();
    expect(calls.at(-1)).toBe('end true');
    // 각도기로 바꾸면 켜진 커서는 알리지 않고 끈다, 고르기 도구로 돌아오면 고르기 선택
    cv.focus();
    key(cv, 'Enter');
    kp.setMode('protractor');
    expect(v.keyboardCursor).toBeNull();
    expect(v.keyboardSnap!.pickCycle).toBe(false);
    kp.setMode('pick');
    expect(kp.enabled).toBe(true);
    expect(v.keyboardSnap!.pickCycle).toEqual({ ...PICK_CYCLE, group: expect.any(Function) });
    expect(kp.handleKey(ev('ArrowRight'))).toBe(false);
  });
});
