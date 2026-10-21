import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseLaunch } from '../../src/app/launch';
import { canUseServiceWorker, consumeLaunchFiles, registerServiceWorker, type SwRegistration, type SwWorker } from '../../src/app/pwa';
import { RecentStore, nameOfRecentId, type RecentBackend, type RecentEntry } from '../../src/app/recent';
import { precacheList, serviceWorkerSource } from '../../tools/sw-plugin.mjs';

describe('서비스 워커 등록·새 판 알림', () => {
  const worker = (state = 'installed'): SwWorker & { msgs: unknown[]; fire: () => void } => {
    let fn: () => void = () => {};
    const w = { state, msgs: [] as unknown[], postMessage: (m: unknown) => w.msgs.push(m), addEventListener: (_: string, f: () => void) => (fn = f), fire: () => fn() };
    return w;
  };
  const container = (controller: unknown, reg: SwRegistration) => {
    const listeners: (() => void)[] = [];
    return {
      controller,
      register: vi.fn(async () => reg),
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      change: () => listeners.forEach((f) => f()),
    };
  };

  it('기다리는 새 판이 있으면 알리고, 적용하면 SKIP_WAITING을 보내 바뀐 뒤 한 번만 다시 읽는다', async () => {
    const waiting = worker();
    const reg: SwRegistration = { waiting, installing: null, addEventListener: () => {} };
    const sw = container({}, reg);
    const reload = vi.fn();
    const onUpdate = vi.fn();
    await registerServiceWorker(sw, 'sw.js', onUpdate, reload);
    expect(sw.register).toHaveBeenCalledWith('sw.js', { scope: './' });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    onUpdate.mock.calls[0]![0]();
    expect(waiting.msgs).toEqual([{ type: 'SKIP_WAITING' }]);
    sw.change();
    sw.change();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('처음 설치(맡은 워커 없음)는 알리지 않고, 나중에 받은 새 판은 설치를 마치면 알린다', async () => {
    let found: () => void = () => {};
    const installing = worker('installing');
    const reg: SwRegistration = { waiting: null, installing, addEventListener: (_: string, f: () => void) => (found = f) };
    const first = vi.fn();
    await registerServiceWorker(container(null, { ...reg, waiting: worker() }), 'sw.js', first, vi.fn());
    expect(first).not.toHaveBeenCalled();
    const later = vi.fn();
    await registerServiceWorker(container({}, reg), 'sw.js', later, vi.fn());
    found();
    expect(later).not.toHaveBeenCalled();
    (installing as { state: string }).state = 'installed';
    installing.fire();
    expect(later).toHaveBeenCalledTimes(1);
    // 등록이 막히면 null
    expect(await registerServiceWorker({ controller: null, register: async () => Promise.reject(new Error('x')), addEventListener: () => {} }, 'sw.js', vi.fn())).toBeNull();
    expect(await registerServiceWorker(undefined, 'sw.js', vi.fn())).toBeNull();
  });

  it('보안 맥락·launchQueue', async () => {
    expect(canUseServiceWorker({ protocol: 'https:', hostname: 'a.b' }, { serviceWorker: {} })).toBe(true);
    expect(canUseServiceWorker({ protocol: 'http:', hostname: '127.0.0.1' }, { serviceWorker: {} })).toBe(true);
    expect(canUseServiceWorker({ protocol: 'http:', hostname: 'a.b' }, { serviceWorker: {} })).toBe(false);
    expect(canUseServiceWorker({ protocol: 'https:', hostname: 'a.b' }, {})).toBe(false);
    let consumer: ((p: { files?: { getFile(): Promise<File> }[] }) => void) | null = null;
    const opened: string[] = [];
    expect(consumeLaunchFiles((f) => opened.push(f.name), { launchQueue: { setConsumer: (fn) => (consumer = fn) } })).toBe(true);
    consumer!({ files: [{ getFile: async () => new File([new Uint8Array(2)], '집.skp') }] });
    consumer!({});
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(['집.skp']);
    expect(consumeLaunchFiles(() => {}, {})).toBe(false);
  });
});

describe('공유 받은 파일', () => {
  it('주소 ?shared=<열쇠>', () => {
    expect(parseLaunch('?shared=%EC%A7%91.skp%3A120', 'https://x.test/opencad-skp/')).toEqual({ kind: 'shared', key: '집.skp:120' });
    expect(parseLaunch('?shared=', 'https://x.test/')).toMatchObject({ kind: 'error' });
    expect(parseLaunch('?shared=:none', 'https://x.test/')).toEqual({ kind: 'shared', key: ':none' });
  });

  it('최근 문서 id·한 번 쓸 자리의 이름, 한 번 꺼내면 지운다', async () => {
    expect(nameOfRecentId('집.skp:120')).toBe('집.skp');
    expect(nameOfRecentId('a:b.skp:7')).toBe('a:b.skp');
    expect(nameOfRecentId('shared:1700000000000:큰 집.skp')).toBe('큰 집.skp');
    const data = new Map<string, ArrayBuffer>([['shared:1:x.skp', new ArrayBuffer(4)]]);
    const backend: RecentBackend = {
      entries: async () => [] as RecentEntry[],
      put: async () => {},
      touch: async () => {},
      data: async (id) => data.get(id) ?? null,
      remove: async (ids) => ids.forEach((i) => data.delete(i)),
      clear: async () => data.clear(),
    };
    const store = new RecentStore(backend);
    expect((await store.take('shared:1:x.skp'))!.byteLength).toBe(4);
    expect(await store.take('shared:1:x.skp')).toBeNull();
  });
});

describe('서비스 워커 만들기(빌드)', () => {
  it('앱 쪽은 디렉터리 주소로, 소스 맵·공유 그림·사이트맵은 빼고, 판은 내용 해시', () => {
    const root = join('.runtime', 'tmp', `sw-test-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'en'), { recursive: true });
    for (const [f, c] of [
      ['index.html', '<html>'],
      ['en/index.html', '<html lang=en>'],
      ['en/manifest.webmanifest', '{}'],
      ['manifest.webmanifest', '{}'],
      ['assets/index-1.js', 'a'],
      ['assets/index-1.js.map', 'm'],
      ['assets/index-1.css', 'c'],
      ['icon-192.png', 'p'],
      ['og-opencad.jpg', 'j'],
      ['sitemap.xml', 's'],
      ['sw.js', 'old'],
    ])
      writeFileSync(join(root, f!), c!);
    try {
      const list = precacheList(root);
      expect(list).toEqual(['./', 'assets/index-1.css', 'assets/index-1.js', 'en/', 'en/manifest.webmanifest', 'icon-192.png', 'manifest.webmanifest']);
      const tpl = "const VERSION = '__VERSION__';\nconst ASSETS = __ASSETS__;";
      const a = serviceWorkerSource(tpl, list, [{ name: 'x', content: 'a' }]);
      const b = serviceWorkerSource(tpl, list, [{ name: 'x', content: 'b' }]);
      expect(a).toMatch(/^const VERSION = "[0-9a-f]{16}";\nconst ASSETS = \["\.\/",/);
      expect(a).not.toBe(b);
      expect(serviceWorkerSource(tpl, list, [{ name: 'x', content: 'a' }])).toBe(a);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
