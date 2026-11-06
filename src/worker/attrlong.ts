/**
 * 아주 긴 속성 글 값 늦게 넘기기(47차): 렌더러·플러그인이 속성 사전에 남긴 글 값은 수십 KB~수 MB일 수 있어(로컬 표본 1,287개에서
 * 4,000자 넘는 값 1,431개·93개 파일, 가장 긴 값 322만 자 — 그 파일의 속성 사전 모음은 구조 복제로 11.3 MB), 장면 정보에는 화면이 보이는
 * 앞부분(ATTR_HEAD_CHARS)만 남기고 원래 값은 UTF-8로 이어 붙인 Blob 하나에 담아 넘긴다. Blob은 메시지로 복사하지 않고 넘어가며
 * 큰 모형은 결과 뒤 이 워커를 끝내도(34차) 남는다. 화면은 사용자가 그 값을 펼칠 때 자리(at·bytes)만큼 잘라 읽는다(app/attrview.ts).
 * 글이 아닌 값(수·참거짓·목록)은 그대로 둔다.
 */
import type { SkpAttrDictsMeta } from '../meta';
import { ATTR_HEAD_CHARS, ATTR_LONG_CHARS, type AttrLong, type AttrLongRef } from '../app/protocol';

/** meta.attributes 안의 긴 글 값을 앞부분으로 바꾸고(제자리) 원래 값을 Blob으로 모은다. 긴 값이 없으면 null */
export function splitLongAttrs(attrs: SkpAttrDictsMeta[] | undefined, limit = ATTR_LONG_CHARS, head = ATTR_HEAD_CHARS): AttrLong | null {
  if (!attrs?.length) return null;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const refs: AttrLongRef[] = [];
  let at = 0;
  // 같은 사전 객체를 여러 자리가 함께 가리키면(두 번째부터는 이미 앞부분) 처음 담은 자리를 다시 쓴다
  const done = new Map<object, AttrLongRef[]>();
  attrs.forEach((dicts, i) => {
    if (!dicts || typeof dicts !== 'object') return;
    for (const [d, dict] of Object.entries(dicts)) {
      if (!dict || typeof dict !== 'object') continue;
      const seen = done.get(dict);
      if (seen) {
        for (const r of seen) refs.push({ ...r, i, d });
        continue;
      }
      const mine: AttrLongRef[] = [];
      for (const [k, v] of Object.entries(dict)) {
        if (typeof v !== 'string' || v.length <= limit) continue;
        const b = enc.encode(v);
        parts.push(b);
        mine.push({ i, d, k, at, bytes: b.length, chars: v.length });
        at += b.length;
        dict[k] = v.slice(0, head);
      }
      done.set(dict, mine);
      refs.push(...mine);
    }
  });
  return refs.length ? { blob: new Blob(parts as BlobPart[], { type: 'text/plain;charset=utf-8' }), refs } : null;
}
