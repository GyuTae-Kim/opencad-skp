import { installLocalization } from './i18n';
/**
 * 앱 입구: 스타일을 불러오고, 앱을 붙이고, 주소 인자(?sample, ?open=)를 처리한다.
 * 자동 확인용으로 window.opencadApp을 둔다.
 */
import './styles.css';
import { initAnalytics } from './analytics';
import { GA4_MEASUREMENT_ID } from './analytics-config';
import { SkpViewerApp, type AppSnapshot } from './app';
import { parseLaunch } from './launch';
import { canUseServiceWorker, consumeLaunchFiles, registerServiceWorker, type SwContainer } from './pwa';

export interface OpencadAppHandle {
  /** 지금 상태(복사본) */
  state(): AppSnapshot;
  readonly ready: boolean;
  readonly busy: boolean;
  /** 문서를 열고 장면을 뷰어에 올렸는지 */
  readonly parsed: boolean;
  readonly docName: string | null;
  openSample(): Promise<void>;
  openUrl(url: string): Promise<void>;
  readonly app: SkpViewerApp;
}

declare global {
  interface Window {
    opencadApp?: OpencadAppHandle;
  }
}

const root = document.getElementById('app');
if (root) {
  initAnalytics(GA4_MEASUREMENT_ID, 'skp');
  const app = new SkpViewerApp(root);
  app.mount();
  window.opencadApp = {
    state: () => app.snapshot(),
    get ready() {
      return app.snapshot().ready;
    },
    get busy() {
      return app.snapshot().busy;
    },
    get parsed() {
      return app.snapshot().parsed;
    },
    get docName() {
      return app.snapshot().docName;
    },
    openSample: () => app.openSample(),
    openUrl: (url: string) => app.openUrl(url),
    app,
  };
  void app.launch(parseLaunch(location.search, location.href));
  // 데스크톱 설치 앱으로 연 .skp(file_handlers)
  consumeLaunchFiles((file) => void app.openFile(file));
  // 오프라인·새 판 알림(배포 빌드만 — 개발 서버는 늘 새 파일을 준다). 워커는 앱 뿌리(assets의 한 단계 위)의 sw.js
  // (경로를 변수로 둔다 — new URL('…', import.meta.url) 꼴은 Vite가 묶을 파일로 바꾸려 한다)
  const swPath = '../sw.js';
  if (import.meta.env.PROD && canUseServiceWorker(location, navigator))
    void registerServiceWorker(navigator.serviceWorker as unknown as SwContainer, new URL(swPath, import.meta.url), (apply) => app.offerUpdate(apply));
}

if (root) void installLocalization(root);
