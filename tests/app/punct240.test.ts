// @vitest-environment jsdom
/**
 * 240차: 코드가 화면 글을 이어 붙이는 문장부호(WCAG 3.1.2 — 중국어·일본어 화면에서 그 묶음의 사전 다수 꼴과 갈리는지).
 * 번역층(사이트 키트 translate)은 통째·틀 열쇠가 아니면 「 · 」·「 | 」·「 — 」·줄 바꿈으로 조각내 조각만 옮기고 가름 글자는 그대로 두며,
 * 앱이 미리 옮긴 조각을 코드 글자로 이어 번역층 밖 칸에 넣은 글도 코드 글자 그대로다. 그 가운데 묶음 다수 꼴과 갈리던 셋을 틀 열쇠로 옮겼다
 * (중국어 쌍점 — 상태 줄·측정 띠·가상 커서 알림 칸 묶음은 「：」, 232차):
 * 상태 막대 고른 것 칸(「고른 것」·「: 」·설명 세 마디 → 틀 「고른 것: {0}」 — i18n.ts frameNodes), 측정 도구 가상 커서 자리 글(`${tip}: ${at}` → 틀 KEY_AT_TEXT — measure.ts keyAtText),
 * 고르기 도구 가상 커서 후보 글(코어 기본 틀 '{0}: {1}' → KEY_AT_TEXT의 좌표 꼴 자리를 점 글로 둔 틀 — keypick.ts keyCandidateText).
 * 이 시험: 소스에서 이어 붙이는 줄(grep 꼴 — 소스 글로)이 감사 표(AUDIT — 파일마다 조각·판정) 밖에서 새로 생기면 실패, 고친 셋이 다섯 언어에서 묶음 다수 꼴이고 한국어 글은 그대로,
 * 새 열쇠 둘이 화면 번역층이 옮기는 다른 글을 바꾸지 않음. 앱 틀은 그리지 않는다(statustitle181 꼴 — 함수와 앱 원문).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { KEY_SNAP_MESSAGES, formatKeySnapMessage, keySnapText, orderedText, pointText } from 'opencad-viewer3d/keysnap';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogs, registerCatalog, sourceMessage, translate } from '../../site/i18n.mjs';
import { fileText, mix } from '../../src/app/filetext';
import { frameNodes, installLocalization, mixText } from '../../src/app/i18n';
import { keyCandidateText, keyPickMessageFn, keyPickMessages } from '../../src/app/keypick';
import { KEY_MEASURE_TEXT, keyAtText } from '../../src/app/measure';
import { KEY_AT_TEXT } from '../../src/app/units';

const SRC = resolve(__dirname, '../../src');
const read = (f: string): string => readFileSync(resolve(SRC, f), 'utf8');
/** 주석 줄과 줄 끝 주석을 뺀 줄(numform236 codeLines 꼴 — 줄 차례는 그대로) */
const codeLines = (text: string): string[] =>
  text.split('\n').map((l) => (/^\s*(?:\/\/|\/\*|\*)/.test(l) ? '' : l.replace(/(^|[\s;,){])\/\/(?!\/).*$/, '$1')));
/**
 * 이어 붙이는 꼴: 「: 」·「, 」·「 · 」·「 — 」·「 (」 바로 뒤에 `${`, `${…}` 바로 뒤에 그 글자, 그 글자만 든 따옴표 글(이음 마디·join 인자),
 * join 인자 「 · 」·「, 」·「 — 」·「 › 」·「  |  」·「 × 」·줄 바꿈
 */
const JOIN = /(?:: |, | · | — | \()\$\{|\$\{[^}]*\}(?:: |, | · | — | \()|(?:^|[(,=+?:] *)['"`](?:: |, | · | — | \(|\)| {2}\| {2})['"`]|join\(['"`](?: · |, | — | › | {2}\| {2}| × |\\n)['"`]\)/;

/**
 * 판정: dict — 한국어 원문을 이어 번역층·ui 조각에 두고 그 글이 사전 통째·틀 열쇠라 zh·ja 꼴은 사전 값이 정한다(코드 글자가 아니다),
 * same — 코드 가름 글자(「 · 」·「 — 」·「  |  」 — 번역층이 조각만 옮기거나 앱이 옮긴 조각을 잇는다)가 zh·ja 화면에도 그대로이고 그 묶음 사전 다수 꼴과 같다
 * (원문 「 · 」 72열쇠 가운데 ja 53·zh 69, 「 — 」 32 가운데 ja 25·zh 27이 값에 그대로 — 상태 줄·측정 띠·패널 줄·풍선 글),
 * num — 수·좌표·색·크기(수 꼴 — 236차, 화면 언어를 따르지 않음), file — 파일 글만 잇는다(이름·태그·설명·속성 값·판 번호 — 괄호 안 글자 갈래를 모름, 232차 「자리 값 ({0})」 둠과 같은 까닭),
 * code — 화면 글이 아니다(미디어 쿼리·CSS·조각내기·괄호 짝 셈·시험 도우미·줄 바꿈으로 줄 잇기).
 * 셋째 칸은 같은 조각이 든 줄 수(없으면 1).
 */
type Verdict = 'dict' | 'same' | 'num' | 'file' | 'code';
const AUDIT: Record<string, [snippet: string, verdict: Verdict, lines?: number][]> = {
  'app/annotations.ts': [
    ['`rgb(${b[0]}, ${b[1]}, ${b[2]})`', 'code'],
    ['const transform = `translate(', 'code'],
  ],
  'app/app.ts': [
    ['const NARROW_MQ = `(max-width: ${', 'code'],
    ['phoneQuery = media(`${NARROW_MQ}, (pointer: coarse) and', 'code'],
    ['bandQuery = media(`${NARROW_MQ}, (pointer: coarse)`)', 'code'],
    ['`그리기: ${label}`', 'dict'],
    ["formatBytes(e.size), ' · ', h('span'", 'same'],
    ['`최근 문서에서 지우기: ${e.name}`', 'dict'],
    ['`${formatBytes(file.size)} — 이 뷰어는 ${formatBytes(MAX_FILE_BYTES)}까지 엽니다.`', 'dict'],
    ["uiText(measureLine(m, d.units, mm))).join('\\n')", 'code'],
    ["title: [name, pg.description].filter(Boolean).join('\\n')", 'file'],
    ['`앱 설정 · 테마: ${label}', 'dict'],
    ['`${stage} · ${pct}%`', 'same'],
    ['`${d.name} (${docLabel(d.info)})`', 'file'],
    ["`모서리 ${fmtCount(info.edges)}`].filter(Boolean).join(' · ')", 'dict'],
    ["e.stMain.textContent = parts.join('  |  ')", 'same'],
    ["e.stMain.title = parts.join(' · ')", 'same'],
    ["h('span', {}, sel), ' · ', h('span', { class: 'st-lock' }, lock)", 'same'],
    ["axes.split(' · ')", 'code'],
  ],
  'app/doc.ts': [
    ['`${model} · 좌표 ${coord}`', 'dict'],
    ['`${releaseName(info.version)} · ${info.version}`', 'file'],
    ["(m.name ?? '').split(' · ')", 'code'],
    ['`면 ${fmtCount(m.faces)} · ${back}`', 'dict'],
    ['mix` (${fileText(def)})`', 'file'],
    ['mix`컴포넌트 정의 ${fileText(sel.name)} · 놓인 수', 'dict'],
    ["'모서리'} · 길이 ${formatLength(", 'dict'],
    ['`RGB ${m.color.slice(0, 3)', 'num'],
    ['`${measureText(m, units, mmPerUnit)} (${axes})`', 'num'],
    ['`dx ${f(m.dx)} · dy ${f(m.dy)} · dz ${f(m.dz)}`', 'num'],
  ],
  'app/entity.ts': [
    ["names.join(' › ')", 'file'],
    ["attributeText(x)).join(', ')}]`", 'file'],
    ["const value = parts.join(' × ')", 'num'],
    ["withLengthUnit(p, units)).join(' × ')", 'num'],
    ["e.locked === true ? '잠김' : ''].filter(Boolean).join(' · ')", 'same'],
  ],
  'app/exporter.ts': [['`${title} · ${new Date().toLocaleDateString(', 'same']],
  'app/filetext.ts': [["sep = ' · '", 'same']],
  'app/format.ts': [
    ['`${fmtNum(p[0], digits)}, ${fmtNum(p[1], digits)}, ${fmtNum(p[2], digits)}`', 'num'],
    ['`rgb(${ch(c[0])}, ${ch(c[1])}, ${ch(c[2])})`', 'num'],
  ],
  'app/i18n.ts': [['(lock ? ` · ${uiText(lock)}`', 'same']],
  'app/infotab.ts': [
    ['`${info.version} (${releaseName(info.version)})`', 'file'],
    ["d.classifications.join(' · ')", 'file'],
    ["[loc.city, loc.country].filter((x) => x && x !== 'N/A').join(', ')", 'file'],
    ['`${sh.light ??', 'num'],
    ['`${fmtNum(sun.elevation, 1)}° · ${fmtNum(sun.azimuth, 1)}°`', 'num'],
    ["fmtPt(a, 3)).join(' · ')", 'num'],
    ["title: [name, pg.description].filter(Boolean).join('\\n')", 'file'],
    ['hint(`그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}. 누르면', 'dict'],
    ["r.kind !== 'loose' ? r.tag : null].filter(Boolean).join(' · ')", 'file'],
    ['`그룹 ${fmtCount(groups)} · 컴포넌트 ${fmtCount(comps)}${images', 'dict'],
    ["hint(notes.join('\\n'))", 'code'],
    ["const sub = [def && def !== name ? def : null, tag].filter(Boolean).join(' · ')", 'file', 2],
    ['${path ? ` — ${path}`', 'same'],
    ["${sub ? ` (${sub})` : ''} — ${uiText(", 'same'],
  ],
  'app/joystick.ts': [['`translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`', 'code']],
  'app/keypick.ts': [["parts.indexOf(' · ')", 'code']],
  'app/launch.ts': [['mix`열 파일 주소를 읽지 못했습니다: ${fileText(open)}`', 'dict']],
  'app/measure.ts': [
    ['`${GUIDE_KEY_NAMES[key]}: ${guide ?', 'dict'],
    ["[label, value].filter((s) => !!s).join(' · ')", 'same'],
    ['`${at} · 길이를 치면 그 거리에 · Esc 취소`', 'dict'],
    ['`${LOCK_HINTS[lock]} · ${LOCK_NONE_HINT}`', 'same'],
    ['`${hint} · ${t}`', 'same'],
    ['`${t} · ${GUIDE_DELETE_KEY_HINT}`', 'same'],
    ['b.title = `${t} (Delete)`', 'dict'],
    ['const at = `X ${xyz[0]}, Y ${xyz[1]}, Z ${xyz[2]}`', 'num'],
  ],
  'app/panel.ts': [
    ['`면 ${fmtCount(x.hiddenFaces)} · 선분 ${fmtCount(x.hiddenSegments)}`', 'dict'],
    ['mix`${name}: 그릴 것이 없는 태그`', 'dict'],
    ['mix`선 종류: ${F(t.lineStyle)} — 이 태그의', 'dict'],
    ['mix`태그 폴더 ${name} — 숨기면', 'dict'],
    ['mix`무늬 그림: ${F(', 'dict'],
    ['mix`${nameText(m.name)} — 누르면 이 재질의 면을 강조합니다`', 'dict'],
  ],
  'app/picklist.ts': [["c.textContent ?? '').join(' · ')", 'code']],
  'app/placetext.ts': [['`${Math.abs(lat).toFixed(4)}° ${ns}, ', 'num']],
  'app/search.ts': [["names.reverse().join(' › ')", 'file']],
  'app/snap.ts': [['} · ${', 'same', 8]],
  'app/units.ts': [
    ['`${name} · ${fmt} · 소수', 'dict'],
    ['`${fmt} · 소수 ${precisionOf(d.lengthPrecision, 2)}자리`', 'dict'],
    ['`${fmt} · 1/${2 **', 'same'],
  ],
  'app/vcb.ts': [['this.delBtn.title = `${t} (Delete)`', 'dict']],
  'app/warntext.ts': [
    ["head.endsWith('(') && text.endsWith(')') ? ')' : ''", 'code'],
    ["name.endsWith(')') && head.split('(')", 'code'],
    ["tail = ')'", 'code'],
  ],
  'index.ts': [
    ['`SketchUp 파일을 읽지 못했습니다: ${e instanceof Error', 'dict', 5],
    ['`장면을 만들지 못했습니다: ${e', 'dict'],
    ['`SketchUp 꾸러미(ZIP)가 깨졌습니다: ${found.error}`', 'dict'],
    ['`스타일 파일이 너무 커서 건너뛰었습니다: ${item.name}`', 'dict'],
    ['`스타일 파일을 읽지 못했습니다: ${item.name}`', 'dict'],
    ['`재질 파일을 읽지 못했습니다: ${item.name}`', 'dict'],
  ],
  'mfcmodel.ts': [
    ['파일의 형식(모형 스키마 ${model}, 렌더링 스키마', 'dict'],
    ['`${key} (${index + 1})`', 'file'],
    ["`${m} (${k.toLocaleString('en-US')}개)`", 'dict'],
    ['`형상 앞에서 읽기를 멈췄습니다: ${why(e, at)}`', 'dict'],
    ['`형상을 읽다 멈췄습니다 — 그 앞까지만 그립니다: ${why(e, at)}`', 'dict'],
    ['`형상 뒤의 장면·스타일을 읽지 못했습니다(형상은 다 읽었습니다): ${why(e, at)}`', 'dict'],
  ],
  'model.ts': [["`${m} (${k.toLocaleString('en-US')}개)`", 'dict']],
  'range.ts': [['`ZIP 항목이 잘렸습니다: ${item.name}`', 'dict']],
  'scene-meta.ts': [
    ['const triple = (v: readonly number[], k = 1): string => `(${num(', 'num'],
    [".join(', ')}${v.length > 256", 'file'],
    ["`rgba(${v.rgba.join(', ')})`", 'num'],
  ],
  'scene.ts': [
    ['`숨긴 형상 · ${matName} · ${tag}`', 'dict'],
    ['name: `${matName} · ${tag}`', 'file'],
    ['`장면에서 보이는 숨긴 개체 · ${matName} · ${tag}`', 'same'],
    ['`부드러운 모서리 · ${tag}`', 'dict'],
    ['`숨긴 모서리 · ${tag}`', 'dict'],
    ['name: `모서리 · ${tag}`', 'dict'],
    ['`장면에서 보이는 숨긴 개체 모서리 · ${tag}`', 'same'],
    ['${ANNOTATION_LABEL[sk.kind]} · ${sk.tag}`', 'same'],
    ['보조점 · ${sk.tag}`', 'dict'],
  ],
  'worker/notice.ts': [['`아직 읽지 못하는 판입니다: ${releaseName(old)} (${old})`', 'dict']],
  'zip.ts': [
    ['`ZIP 지역 머리가 깨졌습니다: ${item.name}`', 'dict'],
    ['`ZIP 항목이 잘렸습니다: ${item.name}`', 'dict'],
    ['`지원하지 않는 ZIP 압축 방식 ${item.method}: ${item.name}`', 'dict', 2],
  ],
};

const LANGS = ['en', 'ja', 'zh-CN', 'de'] as const;
/** 중국어는 「：」(상태 줄·측정 띠·가상 커서 알림 칸 묶음 다수 — 232차), 일본어(그 묶음 「: 」 — 231차)·영어·독일어는 「: 」 */
const COLON: Record<(typeof LANGS)[number], string> = { en: ': ', ja: ': ', 'zh-CN': '：', de: ': ' };
const tr = (code: string) => (t: string): string => (code === 'ko' ? t : translate(t, code));

describe('240차: 소스에서 화면 글을 이어 붙이는 문장부호(감사 표)', () => {
  it('이어 붙이는 줄은 모두 표에 있고(표 밖 새 줄이면 실패 — 판정을 더한다), 표 줄은 모두 쓰이며, 고친 셋의 옛 꼴은 없다', () => {
    const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => f.split(sep).join('/'));
    const outside: string[] = [];
    const used = new Map<string, number>();
    for (const file of files)
      codeLines(read(file)).forEach((line, i) => {
        if (!JOIN.test(line)) return;
        const hit = (AUDIT[file] ?? []).filter(([s]) => line.includes(s));
        if (hit.length !== 1) outside.push(`${file}:${i + 1} (표 줄 ${hit.length}) ${line.trim()}`);
        else used.set(`${file}\t${hit[0]![0]}`, (used.get(`${file}\t${hit[0]![0]}`) ?? 0) + 1);
      });
    expect(outside).toEqual([]);
    const counts: Record<Verdict, number> = { dict: 0, same: 0, num: 0, file: 0, code: 0 };
    for (const [file, rows] of Object.entries(AUDIT))
      for (const [s, verdict, n = 1] of rows) {
        expect(used.get(`${file}\t${s}`) ?? 0, `${file}: ${s}`).toBe(n);
        counts[verdict] += n;
      }
    // 셈이 비지 않는 대조(240차 뒤 124줄): 사전 51 · 같음 27 · 수 14 · 파일 글 17 · 화면 글 아님 15
    expect(counts).toEqual({ dict: 51, same: 27, num: 14, file: 17, code: 15 });
    // 고친 셋의 옛 꼴: 옮긴 추정 이름 + 반각 쌍점 + 좌표, 「고른 것」·「: 」·설명 세 마디(고르기 후보 글은 코어 기본 틀 — 아래 셋째 it)
    expect(read('app/measure.ts')).not.toContain('`${tr(tip)}: ${at}`');
    expect(read('app/app.ts')).not.toContain("h('span', {}, '고른 것'), ': '");
  });
});

describe('240차: 고친 자리 — 다섯 언어에서 묶음 다수 꼴, 한국어 글은 그대로', () => {
  it('측정 도구 가상 커서 자리 글(keyAtText — keyText·keyPlace가 쓴다): 중국어 「：」, 그 밖 「: 」, 한국어는 바이트까지 옛 글', () => {
    const xyz = ['0 mm', '50 mm', '0 mm'] as const;
    // 한국어: 옛 꼴 `${tip}: X …, Y …, Z …` 그대로
    expect(keyAtText('끝점', xyz, tr('ko'))).toBe('끝점: X 0 mm, Y 50 mm, Z 0 mm');
    expect(keyAtText('끝점 · 100 mm', xyz)).toBe('끝점 · 100 mm: X 0 mm, Y 50 mm, Z 0 mm');
    // 추정이 없으면(빈 곳) 좌표만
    expect(keyAtText('', xyz, tr('zh-CN'))).toBe('X 0 mm, Y 50 mm, Z 0 mm');
    for (const code of LANGS) {
      const t = tr(code);
      expect(keyAtText('끝점', xyz, t), code).toBe(`${t('끝점')}${COLON[code]}X 0 mm, Y 50 mm, Z 0 mm`);
      expect(keyAtText('끝점 · 100 mm', xyz, t), code).toBe(`${t('끝점 · 100 mm')}${COLON[code]}X 0 mm, Y 50 mm, Z 0 mm`);
      // 찍기 알림(keyPlace — 틀 「시작점을 찍었습니다. {0}」에 자리 글)
      expect(t(KEY_MEASURE_TEXT.start).replace('{0}', () => keyAtText('끝점', xyz, t)), code).toContain(`${COLON[code]}X 0 mm`);
    }
    expect(keyAtText('끝점', xyz, tr('zh-CN'))).toBe('端点：X 0 mm, Y 50 mm, Z 0 mm');
    expect(keyAtText('끝점', xyz, tr('ja'))).toBe(`${translate('끝점', 'ja')}: X 0 mm, Y 50 mm, Z 0 mm`);
  });

  it('고르기 도구 가상 커서 후보 글(keyPickMessages의 candidate — 코어 orderedText): 중국어 「：」, 그 밖 「: 」, 한국어는 코어 기본 틀 그대로', () => {
    const num = (v: number): string => `${v} mm`;
    const body = (code: string, name: string): string => {
      const M = keyPickMessageFn(tr(code));
      const label = keySnapText(M, 'pickItem', [name, keySnapText(M, 'pick.mesh')]);
      return orderedText(label, 1, 4, pointText([1, 2, 3], num, M), null, M);
    };
    expect(keyPickMessages(tr('ko')).candidate).toBe(KEY_SNAP_MESSAGES.candidate);
    expect(body('ko', '그룹 Row')).toBe('그룹 Row의 면 2/4: X 1 mm, Y 2 mm, Z 3 mm');
    expect(body('zh-CN', '组 Row')).toBe('组 Row的面 2/4：X 1 mm, Y 2 mm, Z 3 mm');
    expect(body('ja', 'グループ Row')).toBe('グループ Rowの面 2/4: X 1 mm, Y 2 mm, Z 3 mm');
    expect(body('en', 'Group Row')).toBe('Face of Group Row 2/4: X 1 mm, Y 2 mm, Z 3 mm');
    for (const code of LANGS) expect(keyPickMessages(tr(code)).candidate, code).toBe(`{0}${COLON[code]}{1}`);
    // 사전 값이 좌표 꼴로 끝나지 않으면 코어 기본 틀
    expect(keyCandidateText(() => '{0} — {1} {2} {3}')).toBe(KEY_SNAP_MESSAGES.candidate);
    expect(formatKeySnapMessage(keyCandidateText(tr('zh-CN')), ['端点', 'X 1, Y 2, Z 3'])).toBe('端点：X 1, Y 2, Z 3');
  });

  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = '';
  });

  it('상태 막대 고른 것 칸(frameNodes — 틀 「고른 것: {0}」): 다섯 언어 번역층 아래 틀 머리가 그 언어, 설명 파일 글은 그대로, 앱 원문이 그 칸을 이 함수로 채운다', async () => {
    const picked = mix`그룹 ${fileText('무늬 · 이')} · 면 ${6}`;
    const head: Record<string, string> = { ko: '고른 것: ', en: 'Selected: ', ja: '選んだもの: ', 'zh-CN': '已选：', de: 'Ausgewählt: ' };
    for (const code of ['ko', ...LANGS]) {
      dispose?.();
      document.body.innerHTML = '';
      history.replaceState(null, '', code === 'ko' ? '/opencad-skp/' : `/opencad-skp/${code}/`);
      dispose = await installLocalization(document.body);
      // 앱 refreshStatus 꼴: 칸 안 한 마디(data-i18n-skip — 언어를 바꾸면 앱이 다시 그린다)
      const cell = document.createElement('span');
      cell.setAttribute('data-i18n-skip', '');
      cell.append(...frameNodes('고른 것: {0}', picked));
      document.body.append(cell);
      expect(cell.textContent, code).toBe(`${head[code]}${mixText(picked)}`);
      expect(cell.querySelector('[translate="no"]')?.textContent, code).toBe('무늬 · 이');
      // 한국어는 옛 세 마디(「고른 것」·「: 」·설명)를 이은 글 그대로
      if (code === 'ko') expect(cell.textContent).toBe('고른 것: 그룹 무늬 · 이 · 면 6');
    }
    const app = read('app/app.ts');
    expect(app).toContain("if (picked.length) e.stSel.replaceChildren(h('span', { 'data-i18n-skip': '' }, ...frameNodes('고른 것: {0}', picked)));");
    // 언어를 바꾸면 다시 그린다(번역층 밖 칸)
    expect(app).toMatch(/addEventListener\('languagechange'[\s\S]*?this\.refreshStatus\(\);/);
  });

  it('새 열쇠 둘(「고른 것: {0}」·KEY_AT_TEXT): 네 사전에 묶음 다수 꼴로 있고, 더해도 화면 번역층이 옮기는 다른 글은 바뀌지 않으며, KEY_AT_TEXT는 좌표 꼴 글만 잡는다', () => {
    const added = ['고른 것: {0}', KEY_AT_TEXT];
    expect(KEY_AT_TEXT).toBe('{0}: X {1}, Y {2}, Z {3}');
    // 218차가 쓰는 곳이 없어 지웠던 열쇠를 그때 값 그대로 되살림(git 9729f90^)
    expect(LANGS.map((c) => catalogs[c]!['고른 것: {0}'])).toEqual(['Selected: {0}', '選んだもの: {0}', '已选：{0}', 'Ausgewählt: {0}']);
    // 좌표 꼴(코어 점 글 'X {0}, Y {1}, Z {2}'과 같은 수 꼴)은 그대로, 이름 뒤 쌍점만 언어마다
    for (const c of LANGS) expect(catalogs[c]![KEY_AT_TEXT], c).toBe(`{0}${COLON[c]}X {1}, Y {2}, Z {3}`);
    expect(KEY_SNAP_MESSAGES.point).toBe('X {0}, Y {1}, Z {2}');
    const samples = ['A', '벽', '그룹 1'];
    const keys = Object.keys(catalogs.en!).filter((k) => !added.includes(k));
    const corpus = new Set<string>(['끝점 · 100 mm', '거리 100 mm (dx 100 mm · dy 0 mm · dz 0 mm)', '면 · 넓이 12.5 m² · 재질 Wood · 태그 Walls', '고른 것', '고른 것만 보기 — 다시 누르면 모두 보입니다']);
    for (const k of keys) {
      corpus.add(k);
      if (/\{\d+\}/.test(k)) for (const s of samples) corpus.add(k.replace(/\{\d+\}/g, s));
    }
    // 번역층이 그 틀을 맞춰 보는 꼴(사이트 키트 translate — 자리 밖 조각을 그대로, 자리는 아무 글): 좌표 꼴이 아닌 말뭉치 글은 하나도 잡지 않는다
    const frame = new RegExp(`^${KEY_AT_TEXT.split(/\{\d+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)')}$`);
    expect([...corpus].filter((t) => frame.test(t))).toEqual([]);
    expect(frame.test('끝점: X 0 mm, Y 0 mm, Z 0 mm')).toBe(true);
    const full = Object.fromEntries(LANGS.map((c) => [c, { ...catalogs[c]! }]));
    const run = (): Map<string, string> => {
      const out = new Map<string, string>();
      for (const c of LANGS) {
        for (const t of corpus) out.set(`${c}\t${t}`, translate(t, c));
        for (const k of keys) out.set(`src\t${c}\t${k}`, sourceMessage(full[c]![k]!));
      }
      return out;
    };
    const after = run();
    try {
      for (const c of LANGS) registerCatalog(c, Object.fromEntries(Object.entries(full[c]!).filter(([k]) => !added.includes(k))));
      const before = run();
      expect(before.size).toBe(after.size);
      expect([...before].filter(([k, v]) => after.get(k) !== v)).toEqual([]);
    } finally {
      for (const c of LANGS) registerCatalog(c, full[c]!);
    }
  });
});
