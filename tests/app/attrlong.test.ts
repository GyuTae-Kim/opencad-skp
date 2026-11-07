// @vitest-environment jsdom
/**
 * 아주 긴 속성 글 값 늦게 넘기기(47차): 해석 워커가 앞부분만 장면 정보에 남기고 원래 글을 Blob으로 넘기며(worker/attrlong.ts),
 * 선택 탭의 속성 사전 칸(app/attrview.ts)은 "전체 값 보기"를 누르면 그 자리만 읽어 원래 글을 보인다.
 */
import { describe, expect, it } from 'vitest';
import { splitLongAttrs } from '../../src/worker/attrlong';
import { attrSection, longRefs } from '../../src/app/attrview';
import { ATTR_VALUE_CHARS, attributeDicts, attributeText } from '../../src/app/entity';
import { ATTR_HEAD_CHARS, ATTR_LONG_CHARS, type AttrLong, type AttrLongRef } from '../../src/app/protocol';
import type { SkpAttrDictsMeta } from '../../src/meta';
import type { SkpDoc } from '../../src/app/doc';

/** Blob 바이트(jsdom Blob에는 arrayBuffer·text가 없어 FileReader로 읽는다) */
async function blobBytes(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === 'function') return new Uint8Array(await b.arrayBuffer());
  return new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => fail(fr.error);
    fr.readAsArrayBuffer(b);
  });
}
async function sliceText(long: AttrLong, r: AttrLongRef): Promise<string> {
  const all = await blobBytes(long.blob);
  return new TextDecoder().decode(all.subarray(r.at, r.at + r.bytes));
}

const big = (n: number, s = 'ab가') => s.repeat(Math.ceil(n / s.length)).slice(0, n);

describe('해석 워커: 긴 글 값을 앞부분으로 바꾸고 원래 글은 Blob으로', () => {
  it('문턱보다 긴 글만 앞부분(화면이 자르는 글자 + 1)으로, 짧은 글·수·목록은 그대로', async () => {
    const long1 = big(ATTR_LONG_CHARS + 1);
    const long2 = big(250_000, '값😀z');
    const attrs: SkpAttrDictsMeta[] = [{ r: { a: long1, b: 'short', n: 3 } }, { s: { c: big(ATTR_LONG_CHARS), d: long2, e: [1, 2] as never } }];
    const res = splitLongAttrs(attrs)!;
    expect(ATTR_HEAD_CHARS).toBe(ATTR_VALUE_CHARS + 1);
    expect(res.refs.map((r) => [r.i, r.d, r.k, r.chars])).toEqual([
      [0, 'r', 'a', long1.length],
      [1, 's', 'd', long2.length],
    ]);
    expect(attrs[0]!.r!.a).toBe(long1.slice(0, ATTR_HEAD_CHARS));
    expect(attrs[0]!.r!.b).toBe('short');
    expect(attrs[1]!.s!.c).toHaveLength(ATTR_LONG_CHARS);
    expect(attrs[1]!.s!.e).toEqual([1, 2]);
    // 원래 글은 Blob의 그 자리(UTF-8 — 한글·서로게이트 짝 포함)
    expect(await sliceText(res, res.refs[0]!)).toBe(long1);
    expect(await sliceText(res, res.refs[1]!)).toBe(long2);
    // 화면 글은 예전과 같다(2,000자 + …)
    expect(attributeText(attrs[0]!.r!.a)).toBe(attributeText(long1));
  });

  it('같은 사전 객체를 여러 자리가 가리키면 같은 Blob 자리를 함께 쓴다, 긴 값이 없으면 null', async () => {
    const shared = { k: big(10_000) };
    const attrs: SkpAttrDictsMeta[] = [{ a: shared }, { b: shared }];
    const res = splitLongAttrs(attrs)!;
    expect(res.refs.map((r) => [r.i, r.d, r.k, r.at])).toEqual([
      [0, 'a', 'k', 0],
      [1, 'b', 'k', 0],
    ]);
    expect(await sliceText(res, res.refs[1]!)).toBe(big(10_000));
    expect(splitLongAttrs([{ a: { k: 'x' } }])).toBeNull();
    expect(splitLongAttrs(undefined)).toBeNull();
  });
});

describe('속성 사전 칸: 전체 값 보기', () => {
  it('긴 값 줄에만 단추, 누르면 원래 글을 읽기 전용 글 칸에', async () => {
    const original = big(50_000, '렌더 설정;');
    const attrs: SkpAttrDictsMeta[] = [{ Render: { conf: original, mode: 'fast' } }];
    const long = splitLongAttrs(attrs)!;
    // 화면 쪽 Blob(jsdom)에는 text()가 없을 수 있어 같은 바이트로 감싼다
    const bytes = await blobBytes(long.blob);
    long.blob = { slice: (a: number, b: number) => ({ text: async () => new TextDecoder().decode(bytes.subarray(a, b)) }) } as unknown as Blob;
    const doc = { attrLong: long, scene: { meta: { attributes: attrs } } } as unknown as SkpDoc;
    const dicts = attributeDicts(attrs[0]);
    expect(longRefs(long, attrs).get(dicts[0]!.src!)?.get('conf')?.chars).toBe(original.length);
    const el = attrSection(doc, { title: '', rows: [], dicts, moreDicts: 0 });
    document.body.append(el);
    const btns = el.querySelectorAll<HTMLButtonElement>('button.attr-more');
    expect(btns).toHaveLength(1);
    expect(btns[0]!.textContent).toBe(`전체 값 보기(${original.length.toLocaleString('ko-KR')}자)`);
    expect(btns[0]!.type).toBe('button');
    // 줄 글은 예전처럼 2,000자 + …
    // 값(파일 글)은 번역층에서 뺀 묶음 안에(52차), 단추는 그 밖이라 옮겨진다
    expect(el.querySelector('.prop-row .v [translate="no"]')!.getAttribute('title')).toBe(attributeText(original));
    expect(btns[0]!.closest('[translate="no"]')).toBeNull();
    btns[0]!.click();
    await new Promise((r) => setTimeout(r, 0));
    const box = el.querySelector<HTMLTextAreaElement>('textarea.attr-full')!;
    expect(box.value).toBe(original);
    expect(box.readOnly).toBe(true);
    // 누른 단추가 사라져도 키보드 초점은 글 칸으로
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-label')).toBe('conf 전체 값');
    expect(el.querySelector('button.attr-more')).toBeNull();
    el.remove();
  });

  it('긴 값이 없는 문서는 예전 칸 그대로(단추 없음)', () => {
    const attrs: SkpAttrDictsMeta[] = [{ A: { k: 'v' } }];
    const doc = { scene: { meta: { attributes: attrs } } } as unknown as SkpDoc;
    const el = attrSection(doc, { title: '', rows: [], dicts: attributeDicts(attrs[0], 'definition'), moreDicts: 2 });
    expect(el.querySelector('h3')!.textContent).toBe('속성 사전');
    expect(el.querySelector('summary')!.textContent).toBe('A정의1개');
    expect(el.querySelector('button')).toBeNull();
    expect(el.querySelector('.hint')!.textContent).toBe('사전 2개는 줄였습니다.');
  });
});
