import { describe, expect, it, vi } from 'vitest';
import { acceptEmbeddedFiles, isFramed, type EmbedWindow } from 'opencad-site-kit/embed/app';

/** 다른 웹페이지에 넣은 화면(iframe)의 가짜 창: 부모에게 보낸 글을 모으고, 부모가 보낸 글을 흘려 넣는다 */
function frame(framed = true) {
  const sent: { message: Record<string, unknown>; origin: string }[] = [];
  const parent = { postMessage: (message: unknown, origin: string) => sent.push({ message: message as Record<string, unknown>, origin }) };
  let listener: ((event: MessageEvent) => void) | null = null;
  const attrs: string[] = [];
  const self = {};
  const w: EmbedWindow = {
    self,
    top: framed ? {} : self,
    parent,
    addEventListener: (_type, fn) => (listener = fn),
    document: { documentElement: { setAttribute: (name) => attrs.push(name) } },
  };
  const post = (data: unknown, origin = 'https://blog.example') => listener!({ source: parent, origin, data } as unknown as MessageEvent);
  return { w, sent, attrs, post };
}

describe('다른 웹페이지에 넣기(임베드)', () => {
  it('부모가 넘긴 .skp만 앱 열기에 건네고, 열기를 마치면 그 출처에 done을 보낸다', async () => {
    const { w, sent, attrs, post } = frame();
    const opened: string[] = [];
    let finish: () => void = () => {};
    // main.ts와 같은 꼴: 앱 열기(Promise)를 그대로 돌려준다
    const open = vi.fn((files: File[]) => {
      opened.push(files[0]!.name);
      return new Promise<void>((r) => (finish = r));
    });
    expect(isFramed(w)).toBe(true);
    expect(acceptEmbeddedFiles(open, { accept: ['.skp'] }, w)).toBe(true);
    expect(attrs).toEqual(['data-embedded']);
    expect(sent[0]).toEqual({ message: { type: 'opencad:ready', protocol: 1, accept: ['.skp'] }, origin: '*' });

    post({ type: 'opencad:open', protocol: 1, id: 'a', files: [{ name: 'plan.dwg', data: new ArrayBuffer(3) }, { name: '집.SKP', data: new ArrayBuffer(8) }] });
    expect(opened).toEqual(['집.SKP']);
    await Promise.resolve();
    expect(sent.some((s) => s.message.type === 'opencad:done')).toBe(false);
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.at(-1)).toEqual({ message: { protocol: 1, type: 'opencad:done', id: 'a' }, origin: 'https://blog.example' });

    // 받지 않는 형식만 오면 열지 않고 unsupported
    post({ type: 'opencad:open', protocol: 1, id: 'b', files: [{ name: 'part.step', data: new ArrayBuffer(3) }] });
    expect(open).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toEqual({ message: { protocol: 1, type: 'opencad:error', id: 'b', code: 'unsupported' }, origin: 'https://blog.example' });
  });

  it('넣은 화면이 아니면(맨 위 창) 아무것도 하지 않는다', () => {
    const { w, sent, attrs } = frame(false);
    const open = vi.fn();
    expect(isFramed(w)).toBe(false);
    expect(acceptEmbeddedFiles(open, { accept: ['.skp'] }, w)).toBe(false);
    expect(sent).toEqual([]);
    expect(attrs).toEqual([]);
  });
});
