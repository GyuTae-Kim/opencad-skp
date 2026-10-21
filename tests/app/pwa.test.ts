import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseLaunch } from '../../src/app/launch';
import { canUseServiceWorker, consumeLaunchFiles, registerServiceWorker, type SwRegistration, type SwWorker } from '../../src/app/pwa';
import { RecentStore, SHARED_MAX_AGE_MS, nameOfRecentId, staleSharedKeys, type RecentBackend, type RecentEntry } from '../../src/app/recent';
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
      dataKeys: async () => [...data.keys()],
      remove: async (ids) => ids.forEach((i) => data.delete(i)),
      clear: async () => data.clear(),
    };
    const store = new RecentStore(backend);
    expect((await store.take('shared:1:x.skp'))!.byteLength).toBe(4);
    expect(await store.take('shared:1:x.skp')).toBeNull();
  });

  it('앱을 열 때 열다 멈춘 탭이 남긴 큰 파일 사본(shared:…)을 지운다: 지금 열 것·방금 받은 것·최근 문서는 둔다', async () => {
    const now = 1_700_000_000_000;
    const old = `shared:${now - SHARED_MAX_AGE_MS - 1}:old.skp`;
    const fresh = `shared:${now - 1000}:fresh.skp`;
    const opening = `shared:${now - 3 * SHARED_MAX_AGE_MS}:opening.skp`;
    const future = `shared:${now + 2 * SHARED_MAX_AGE_MS}:clock.skp`;
    const data = new Map<string, ArrayBuffer>([old, fresh, opening, future, 'shared:bad', '집.skp:120'].map((k) => [k, new ArrayBuffer(4)]));
    const removed: string[] = [];
    const backend: RecentBackend = {
      entries: async () => [{ id: '집.skp:120', name: '집.skp', size: 120, time: now - 1e9 }],
      put: async () => {},
      touch: async () => {},
      data: async (id) => data.get(id) ?? null,
      dataKeys: async () => [...data.keys()],
      remove: async (ids) => ids.forEach((i) => (removed.push(i), data.delete(i))),
      clear: async () => data.clear(),
    };
    const store = new RecentStore(backend);
    expect(await store.sweepShared(opening, now)).toBe(3);
    expect(removed.sort()).toEqual([old, future, 'shared:bad'].sort());
    expect([...data.keys()].sort()).toEqual(['집.skp:120', fresh, opening].sort());
    // 열 것이 없으면(보통 시작) 오래된 것만
    expect(await store.sweepShared(null, now + SHARED_MAX_AGE_MS + 2000)).toBe(2);
    expect([...data.keys()]).toEqual(['집.skp:120']);
    expect(staleSharedKeys(['shared:5:a.skp', 'x:1'], null, 5)).toEqual([]);
    expect(await new RecentStore(null).sweepShared(null)).toBe(0);
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

/** 만든 서비스 워커(tools/sw-template.js)를 가짜 self·caches·fetch로 돌린다(앱 뿌리 https://x.test/app/) */
function runServiceWorker(network: (url: string) => Response | Promise<Response>) {
  const listeners = new Map<string, (e: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: unknown): string => (typeof r === 'string' ? r : (r as { url: string }).url);
  const strip = (u: string): string => u.replace(/\?.*$/, '');
  const caches = {
    open: async (n: string) => {
      let m = stores.get(n);
      if (!m) stores.set(n, (m = new Map()));
      const box = m;
      return {
        put: async (r: unknown, res: Response) => void box.set(key(r), res),
        match: async (r: unknown, o?: { ignoreSearch?: boolean }) => {
          const k = key(r);
          const hit = box.get(k) ?? (o?.ignoreSearch ? [...box].find(([x]) => strip(x) === strip(k))?.[1] : undefined);
          return hit?.clone();
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const self = {
    location: { origin: 'https://x.test' },
    registration: { scope: 'https://x.test/app/', active: {} },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
  };
  const fetched: string[] = [];
  const fetchFn = async (r: unknown) => {
    fetched.push(key(r));
    const res = await network(key(r));
    // 같은 출처 응답(브라우저의 type 'basic')
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const template = readFileSync(new URL('../../tools/sw-template.js', import.meta.url), 'utf8');
  const src = serviceWorkerSource(template, ['./', 'en/', 'assets/index-1.js', 'icon-192.png', 'manifest.webmanifest'], [{ name: 'x', content: 'a' }]);
  new Function('self', 'caches', 'fetch', 'indexedDB', src)(self, caches, fetchFn, {});
  const cacheName = [...src.matchAll(/const VERSION = "([0-9a-f]{16})"/g)][0]![1]!;
  const fire = async (url: string, extra: Record<string, unknown> = {}): Promise<Response | undefined> => {
    let p: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: { url, method: 'GET', mode: 'no-cors', headers: new Headers(), ...extra }, respondWith: (x: Promise<Response>) => (p = x) });
    return p ? await p : undefined;
  };
  const cached = (): string[] => [...stores.values()].flatMap((m) => [...m.keys()]);
  return { fire, cached, stores, fetched, cache: `opencad-skp-${cacheName}` };
}

describe('서비스 워커가 가로채는 범위', () => {
  it('?open= 같은 출처 모형 파일은 가로채지도 담지도 않는다(바뀐 파일이 옛것으로 열리지 않게)', async () => {
    let n = 0;
    const sw = runServiceWorker((url) => new Response(`net ${url} ${++n}`));
    // 같은 앱 범위 안의 모형 파일·GitHub Pages의 다른 저장소 파일(같은 출처)
    expect(await sw.fire('https://x.test/app/models/house.skp')).toBeUndefined();
    expect(await sw.fire('https://x.test/app/models/house.skp?v=2')).toBeUndefined();
    expect(await sw.fire('https://x.test/other-repo/x.skp')).toBeUndefined();
    expect(sw.cached().some((k) => k.endsWith('.skp') || k.includes('.skp?'))).toBe(false);
    expect(sw.fetched).toEqual([]);
  });

  it('앱 범위 밖 주소(같은 출처의 다른 앱)는 쪽도 파일도 손대지 않는다', async () => {
    const sw = runServiceWorker((url) => new Response(`net ${url}`));
    expect(await sw.fire('https://x.test/other/', { mode: 'navigate' })).toBeUndefined();
    expect(await sw.fire('https://x.test/other/assets/a.js')).toBeUndefined();
    expect(await sw.fire('https://x.test/apples/assets/a.js')).toBeUndefined();
    expect(await sw.fire('https://elsewhere.test/app/assets/a.js')).toBeUndefined();
    expect(sw.cached()).toEqual([]);
  });

  it('목록에 없는 쪽은 네트워크 먼저로 열되 담지 않고, 목록의 쪽은 담아 두었다가 오프라인에 쓴다', async () => {
    let online = true;
    const sw = runServiceWorker((url) => (online ? new Response(`net ${url}`) : Promise.reject(new Error('offline'))));
    expect(await (await sw.fire('https://x.test/app/extra.html', { mode: 'navigate' }))!.text()).toBe('net https://x.test/app/extra.html');
    expect(await (await sw.fire('https://x.test/app/en/?open=https%3A%2F%2Fx.test%2Fa.skp', { mode: 'navigate' }))!.text()).toContain('net ');
    expect(sw.cached()).toEqual(['https://x.test/app/en/']);
    online = false;
    expect(await (await sw.fire('https://x.test/app/en/?sample', { mode: 'navigate' }))!.text()).toBe('net https://x.test/app/en/?open=https%3A%2F%2Fx.test%2Fa.skp');
  });

  it('빌드 결과(assets/)와 미리 담을 목록은 캐시 먼저(없으면 받아서 담는다)', async () => {
    let n = 0;
    const sw = runServiceWorker((url) => new Response(`net ${url} ${++n}`));
    sw.stores.set(sw.cache, new Map([['https://x.test/app/assets/index-1.js', new Response('cached js')]]));
    expect(await (await sw.fire('https://x.test/app/assets/index-1.js'))!.text()).toBe('cached js');
    // 새 판의 지연 로딩 조각(목록에 없어도 assets/)
    expect(await (await sw.fire('https://x.test/app/assets/de-2.js'))!.text()).toBe('net https://x.test/app/assets/de-2.js 1');
    await new Promise((r) => setTimeout(r, 0));
    expect(sw.cached()).toContain('https://x.test/app/assets/de-2.js');
    expect(await (await sw.fire('https://x.test/app/assets/de-2.js'))!.text()).toBe('net https://x.test/app/assets/de-2.js 1');
    expect(await (await sw.fire('https://x.test/app/icon-192.png'))!.text()).toBe('net https://x.test/app/icon-192.png 2');
  });
});
