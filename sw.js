/*
 * OpenCAD SketchUp 뷰어 서비스 워커(빌드가 tools/sw-plugin.mjs로 dist/sw.js를 만든다 — VERSION·ASSETS는 빌드 때 채운다).
 *
 * - 오프라인: 설치할 때 앱 파일(쪽·스크립트·스타일·아이콘·앱 정보)을 이 판의 캐시에 담는다.
 *   쪽(HTML)은 네트워크 먼저(새 배포가 곧바로 보이고 막히지 않게 — 안 되면 캐시, 담는 것은 미리 담을 목록의 쪽만),
 *   캐시 먼저는 미리 담을 목록과 빌드 결과(assets/)뿐이다. 그 밖(?open=으로 받는 같은 출처 모형 파일 등)과 앱 범위 밖 주소는
 *   손대지 않고 네트워크로 보낸다(바뀐 파일이 옛것으로 열리거나 연 모형이 캐시에 쌓이지 않게).
 * - 새 판: 새 워커는 설치만 하고 기다린다. 앱이 "새 버전" 알림에서 새로 고침을 고르면 SKIP_WAITING을 보내 바꾼다(처음 설치는 바로).
 * - 공유 받기(Android share_target): POST …/share-target의 파일을 이 브라우저의 최근 문서 IndexedDB(opencad-skp)에 넣고
 *   그 언어 쪽 ?shared=<id>로 보낸다(파일은 서버로 가지 않는다). 60 MB보다 크면 최근 목록에 넣지 않고 한 번 쓸 자리(shared:…)에 둔다.
 */
const VERSION = "8b7929fdda3ce031";
const ASSETS = ["./","apple-touch-icon.png","assets/de-Bs_qYEXr.js","assets/en-DK_rhchc.js","assets/index-BVJYC5mb.js","assets/index-BtJ-ea_S.css","assets/index-MBXq5V7D.js","assets/ja-VnpYHhEG.js","assets/measure-BXPHrfzA.js","assets/measurelabel-ClV8ltZh.js","assets/parse.worker-CFFC83bc.js","assets/print.worker-DdtuydIs.js","assets/recolor.worker-B2oEX3Ca.js","assets/release-D1FfFq6E.js","assets/sample-BK9JfKJd.js","assets/zh-CN-BgEspbLv.js","de/","de/manifest.webmanifest","en/","en/manifest.webmanifest","favicon.svg","icon-192.png","icon-512.png","icon-maskable-512.png","ja/","ja/manifest.webmanifest","manifest.webmanifest","zh-CN/","zh-CN/manifest.webmanifest"];
const PREFIX = 'opencad-skp-';
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope;
/** 캐시 먼저·쪽 담기를 하는 경로(미리 담을 목록) */
const PRECACHE_PATHS = new Set(ASSETS.map((a) => new URL(a, SCOPE).pathname));
const DB = 'opencad-skp';
const STORE = 'recent';
const DATA = 'recent-data';
const RECENT_MAX = 8;
const RECENT_MAX_BYTES = 60 * 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })));
      // 처음 설치(앞 판이 없음)면 바로 쓴다 — 새 판은 앱의 "새 버전" 알림을 기다린다
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 앱 범위 밖(같은 출처의 다른 앱·파일 — GitHub Pages 프로젝트 사이트는 출처 하나를 함께 쓴다)은 손대지 않는다
  if (!url.href.startsWith(SCOPE)) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(page(req));
    return;
  }
  // 캐시 먼저는 미리 담을 목록(아이콘·앱 정보 등)과 내용 해시 이름의 빌드 결과(assets/)만.
  // 그 밖(?open=으로 받는 모형 파일 등)은 가로채지 않는다 — 브라우저가 네트워크로 받고, 캐시에 담지 않는다
  const rel = url.pathname.slice(new URL(SCOPE).pathname.length);
  if (!PRECACHE_PATHS.has(url.pathname) && !rel.startsWith('assets/')) return;
  event.respondWith(asset(req, url));
});

/** 쪽: 네트워크 먼저(미리 담을 목록의 쪽이면 받은 것으로 캐시를 새로), 안 되면 같은 경로(주소 인자 무시)의 캐시, 그것도 없으면 앱 첫 쪽 */
async function page(req) {
  const url = new URL(req.url);
  const key = url.origin + url.pathname;
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && PRECACHE_PATHS.has(url.pathname)) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(key)) || (await cache.match(key + 'index.html')) || (await cache.match(new URL('./', self.registration.scope).href));
    if (hit) return hit;
    throw e;
  }
}

/** 미리 담을 목록·빌드 결과: 캐시 먼저, 없으면 네트워크(이 판의 캐시에 더한다). 앱 정보(.webmanifest)는 주소 인자를 무시하고 찾는다 */
async function asset(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: url.pathname.endsWith('.webmanifest') });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
  return res;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** 공유 받은 파일 → 최근 문서(새것부터 8개까지) 또는 한 번 쓸 자리 → 그 언어 쪽으로 */
async function receiveShare(req) {
  const back = new URL('./', req.url);
  const go = (q) => Response.redirect(`${back.href}?shared=${encodeURIComponent(q)}`, 303);
  try {
    const form = await req.formData();
    const file = form.getAll('file').find((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');
    if (!file) return go(':none');
    const data = await file.arrayBuffer();
    const name = (file.name || 'shared.skp').replace(/^.*[\\/]/, '');
    const db = await openDb();
    if (data.byteLength > RECENT_MAX_BYTES) {
      const key = `shared:${Date.now()}:${name}`;
      const t = db.transaction(DATA, 'readwrite');
      t.objectStore(DATA).put(data, key);
      await done(t);
      return go(key);
    }
    const id = `${name}:${data.byteLength}`;
    const t = db.transaction([STORE, DATA], 'readwrite');
    t.objectStore(STORE).put({ id, name, size: data.byteLength, time: Date.now() });
    t.objectStore(DATA).put(data, id);
    await done(t);
    // 개수 한도: 오래된 것부터 지운다
    const all = await new Promise((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
    const extra = all.sort((a, b) => b.time - a.time).slice(RECENT_MAX);
    if (extra.length) {
      const d = db.transaction([STORE, DATA], 'readwrite');
      for (const e of extra) {
        d.objectStore(STORE).delete(e.id);
        d.objectStore(DATA).delete(e.id);
      }
      await done(d);
    }
    return go(id);
  } catch (e) {
    return go(':error');
  }
}
