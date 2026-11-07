/**
 * 선택 탭의 속성 사전 칸(47차 — 처음 그릴 때 받는 조각): 사전마다 접는 묶음과 열쇠·값 줄을 만들고, 해석 워커가 앞부분만 넘긴
 * 아주 긴 글 값(worker/attrlong.ts — ATTR_LONG_CHARS 넘게)에는 "전체 값 보기" 단추를 두어, 누르면 원래 글을 Blob에서 그 자리만 잘라 읽어
 * 읽기 전용 글 칸에 보인다(고르고 복사할 수 있다). 짧은 값은 예전처럼 2,000자에서 자른 글만.
 */
import type { SkpAttrValueMeta } from '../meta';
import { h } from './dom';
import type { SkpDoc } from './doc';
import type { EntityInfo } from './entity';
import { fmtCount } from './format';
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
  const blocks = e.dicts.map((dict) => {
    const keys = dict.src && refs?.get(dict.src);
    return h(
      'details',
      { class: 'attr-dict', open: e.dicts.length <= 3 ? true : undefined },
      h('summary', {}, dict.name, h('span', { class: 'chip' }, dict.source === 'definition' ? '정의' : '이 항목'), h('span', { class: 'count' }, `${fmtCount(dict.entries.length)}개`)),
      ...dict.entries.map(([k, v]) => {
        const v1 = h('span', { class: 'v', title: v }, v);
        const r = keys?.get(k);
        if (r && long) {
          const more = h('button', { class: 'mini-btn attr-more' }, `전체 값 보기(${fmtCount(r.chars)}자)`);
          more.addEventListener('click', () => {
            more.disabled = true;
            readLong(long, r).then(
              (text) => {
                const box = h('textarea', { class: 'attr-full', readonly: true, rows: 8, spellcheck: 'false', 'aria-label': `${k} 전체 값` });
                box.value = text;
                more.replaceWith(box);
                box.focus();
              },
              () => more.replaceWith(hint('전체 값을 읽지 못했습니다.')),
            );
          });
          v1.append(more);
        }
        return h('div', { class: 'prop-row' }, h('span', { class: 'k' }, k), v1);
      }),
      dict.more ? hint(`열쇠 ${fmtCount(dict.more)}개는 더 있어 줄였습니다.`) : null,
    );
  });
  return h('section', { class: 'psec' }, h('h3', {}, '속성 사전'), ...blocks, e.moreDicts ? hint(`사전 ${fmtCount(e.moreDicts)}개는 줄였습니다.`) : null);
}
