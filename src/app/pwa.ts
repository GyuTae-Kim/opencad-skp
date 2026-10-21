/**
 * 홈 화면 앱 도움(브라우저 기능 — 시험은 가짜를 넘긴다):
 * - 서비스 워커(dist/sw.js, tools/sw-plugin.mjs가 만든다) 등록과 "새 버전" 알림: 새 워커가 설치되어 기다리면 onUpdate(적용 함수)를 부른다.
 *   적용하면 기다리는 워커에 SKIP_WAITING을 보내고, 바뀐 뒤 한 번만 다시 읽는다.
 * - 데스크톱 파일 열기(file_handlers + launchQueue): 설치한 앱으로 .skp를 열면 그 파일을 넘긴다.
 */

export interface SwContainer {
  readonly controller: unknown;
  register(url: string | URL, opts?: { scope?: string }): Promise<SwRegistration>;
  addEventListener(type: 'controllerchange', fn: () => void): void;
}

export interface SwWorker {
  readonly state: string;
  postMessage(msg: unknown): void;
  addEventListener(type: 'statechange', fn: () => void): void;
}

export interface SwRegistration {
  readonly waiting: SwWorker | null;
  readonly installing: SwWorker | null;
  addEventListener(type: 'updatefound', fn: () => void): void;
  update?(): Promise<unknown>;
}

/**
 * 서비스 워커를 등록한다. 기다리는 새 판이 있으면(이미 앞 판이 이 쪽을 맡고 있을 때만) onUpdate(apply)를 부른다.
 * apply는 새 판으로 바꾸고 바뀌면 reload를 부른다. 등록하지 못하면 조용히 null
 */
export async function registerServiceWorker(
  sw: SwContainer | undefined,
  url: string | URL,
  onUpdate: (apply: () => void) => void,
  reload: () => void = () => location.reload(),
): Promise<SwRegistration | null> {
  if (!sw) return null;
  let reg: SwRegistration;
  try {
    reg = await sw.register(url, { scope: './' });
  } catch {
    return null;
  }
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    reload();
  });
  const offer = (w: SwWorker | null): void => {
    // 처음 설치(맡은 워커가 없음)는 알리지 않는다 — 워커가 스스로 바로 쓴다
    if (!w || !sw.controller) return;
    onUpdate(() => w.postMessage({ type: 'SKIP_WAITING' }));
  };
  if (reg.waiting) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') offer(reg.waiting ?? w);
    });
  });
  return reg;
}

/** 데스크톱 설치 앱의 파일 열기(launchQueue): 넘겨받은 첫 파일을 연다 */
export function consumeLaunchFiles(open: (file: File) => void, w: { launchQueue?: { setConsumer(fn: (p: { files?: readonly { getFile(): Promise<File> }[] }) => void): void } } = globalThis as never): boolean {
  const q = w.launchQueue;
  if (!q || typeof q.setConsumer !== 'function') return false;
  q.setConsumer((params) => {
    const h = params.files?.[0];
    if (h) void h.getFile().then(open, () => undefined);
  });
  return true;
}

/** 서비스 워커를 쓸 수 있는 곳인지(보안 맥락 — https 또는 localhost) */
export function canUseServiceWorker(loc: Pick<Location, 'protocol' | 'hostname'>, nav: { serviceWorker?: unknown }): boolean {
  if (!nav.serviceWorker) return false;
  return loc.protocol === 'https:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
}
