/**
 * 선택 탭의 속성 사전 칸(47차 — 처음 그릴 때 받는 조각): 사전마다 접는 묶음과 열쇠·값 줄을 만들고, 해석 워커가 앞부분만 넘긴
 * 아주 긴 글 값(worker/attrlong.ts — ATTR_LONG_CHARS 넘게)에는 "전체 값 보기" 단추를 두어, 누르면 원래 글을 Blob에서 그 자리만 잘라 읽어
 * 읽기 전용 글 칸에 보인다(고르고 복사할 수 있다). 2,000자에서 자른 글 값 가운데 워커가 떼지 않은 것(4,000자 이하)은 장면 정보의 원래 글을
 * 같은 단추로 보인다(146차). 목록·수 같은 글이 아닌 값은 예전처럼 2,000자에서 자른 글만.
 */
import type { SkpAttrValueMeta } from '../meta';
import { h } from './dom';
import type { SkpDoc } from './doc';
import type { EntityInfo } from './entity';
import { fmtCount } from './format';
import { fileText, mix } from './filetext';
import { mixText } from './i18n';
import type { AttrLong, AttrLongRef } from './protocol';

type Dict = Record<string, SkpAttrValueMeta>;

/** 사전 객체 → 열쇠 → 긴 값 자리(meta.attributes[i][d] — 구조 복제는 한 메시지 안의 같은 객체를 같게 둔다) */
const lookups = new WeakMap<AttrLong, WeakMap<object, Map<string, AttrLongRef>>>();

export function longRefs(long: AttrLong, attributes: readonly unknown[] | undefined): WeakMap<object, Map<string, AttrLongRef>> {
  let m = lookups.get(long);
  if (m) return m;
  m = new WeakMap();
  for (const r of long.refs) {
    const dict = (attributes?.[r.i] as Record<string, Dict> | undefined)?.[r.d];
    if (!dict || typeof dict !== 'object') continue;
    let keys = m.get(dict);
    if (!keys) m.set(dict, (keys = new Map()));
    keys.set(r.k, r);
  }
  lookups.set(long, m);
  return m;
}

/** 긴 값 하나의 원래 글(Blob의 그 자리만 읽는다) */
export function readLong(long: AttrLong, r: AttrLongRef): Promise<string> {
  return long.blob.slice(r.at, r.at + r.bytes).text();
}

/** "속성 사전" 칸 */
export function attrSection(d: SkpDoc, e: EntityInfo): HTMLElement {
  const long = d.attrLong;
  const refs = long ? longRefs(long, (d.scene.meta as { attributes?: unknown[] } | undefined)?.attributes) : null;
  const hint = (text: string): HTMLElement => h('p', { class: 'hint' }, text);
  // 사전 이름·열쇠·값은 파일 글이라 번역층에서 뺀다(52차 — 열쇠 "면"이 "Face"로, 값 "무늬"가 "Texture"로 바뀌었다). 앱 글(칩·개수·단추)은 옮긴다
  const blocks = e.dicts.map((dict) => {
    const keys = dict.src && refs?.get(dict.src);
    return h(
      'details',
      { class: 'attr-dict', open: e.dicts.length <= 3 ? true : undefined },
      h(
        'summary',
        {},
        h('span', { translate: 'no' }, dict.name),
        h('span', { class: 'chip' }, dict.source === 'definition' ? '정의' : '이 항목'),
        h('span', { class: 'count' }, `${fmtCount(dict.entries.length)}개`),
      ),
      // 열쇠·값 줄은 사전마다 dl 하나로(171차 — 패널 이름·값 줄 panel.ts row와 같은 꼴: 줄 칸 div 안 dt·dd)
      h('dl', {}, ...dict.entries.map(([k, v]) => {
        const v1 = h('dd', { class: 'v' }, h('span', { title: v, translate: 'no' }, v));
        const r = keys?.get(k);
        // 146차: 2,000자에서 자른 글 값 가운데 워커가 떼지 않은 것(ATTR_LONG_CHARS 이하 — 장면 정보에 통째로 있음)도 같은 단추로 원래 글을 보인다
        // (전에는 Blob 자리가 있는 값에만 단추가 있어 2,001~4,000자 값은 뒤를 볼 길이 없었다). 글 값은 잘렸을 때만 화면 글과 다르다(entity.ts attributeText)
        const raw = r ? undefined : (dict.src as Dict | undefined)?.[k];
        const full = r && long ? { chars: r.chars, read: () => readLong(long, r) } : typeof raw === 'string' && raw !== v ? { chars: raw.length, read: async () => raw } : null;
        if (full) {
          const more = h('button', { class: 'mini-btn attr-more' }, `전체 값 보기(${fmtCount(full.chars)}자)`);
          more.addEventListener('click', () => {
            more.disabled = true;
            full.read().then(
              (text) => {
                const box = h('textarea', { class: 'attr-full', readonly: true, rows: 8, spellcheck: 'false', 'aria-label': mixText(mix`${fileText(k)} 전체 값`), 'data-i18n-keep': 'aria-label' });
                box.value = text;
                more.replaceWith(box);
                box.focus();
              },
              // 152차: 버튼 자리에 새로 붙는 글이라 role=alert(aria-live 없이 — 새로 붙어도 읽힘, 알림 상자 오류와 같은 꼴). 전에는 화면 읽기 프로그램이 읽지 않았다
              () => more.replaceWith(h('p', { class: 'hint', role: 'alert' }, '전체 값을 읽지 못했습니다.')),
            );
          });
          v1.append(more);
        }
        return h('div', { class: 'prop-row' }, h('dt', { class: 'k', translate: 'no' }, k), v1);
      })),
      dict.more ? hint(`열쇠 ${fmtCount(dict.more)}개는 더 있어 줄였습니다.`) : null,
    );
  });
  return h('section', { class: 'psec' }, h('h3', {}, '속성 사전'), ...blocks, e.moreDicts ? hint(`사전 ${fmtCount(e.moreDicts)}개는 줄였습니다.`) : null);
}
