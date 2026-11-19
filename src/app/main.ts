import { installLocalization } from './i18n';
/**
 * 앱 입구: 스타일을 불러오고, 앱을 붙이고, 주소 인자(?sample, ?open=)를 처리한다.
 * 자동 확인용으로 window.opencadApp을 둔다.
 */
import './styles.css';
import { initAnalytics } from 'opencad-site-kit/analytics';
import { OPENCAD_ANALYTICS } from 'opencad-site-kit/presets/opencad';
import { acceptEmbeddedFiles } from 'opencad-site-kit/embed/app';
import { SkpViewerApp, type AppSnapshot } from './app';
import { parseLaunch } from './launch';
import { canUseServiceWorker, consumeLaunchFiles, registerServiceWorker, whenVisible, type SwContainer } from 'opencad-site-kit/pwa/client';

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
  initAnalytics(OPENCAD_ANALYTICS, 'skp');
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
  // 데스크톱 설치 앱으로 연 .skp(file_handlers — 여럿이면 읽힌 첫 파일)
  consumeLaunchFiles((files) => void app.openFile(files[0]!));
  // 다른 웹페이지에 넣었을 때(iframe) 부모 페이지가 넘기는 .skp(여럿이면 첫 파일). 열기를 마치면 풀리는 Promise를 돌려줘 부모가 끝을 안다
  acceptEmbeddedFiles((files) => app.openFile(files[0]!), { accept: ['.skp'] });
  // 오프라인·새 판 알림(공용 도구 — 배포 빌드만, 개발 서버는 늘 새 파일을 준다. 앱으로 돌아오면 새 판 확인). 워커는 앱 뿌리(assets의 한 단계 위)의 sw.js
  // (경로를 변수로 둔다 — new URL('…', import.meta.url) 꼴은 Vite가 묶을 파일로 바꾸려 한다)
  const swPath = '../sw.js';
  if (import.meta.env.PROD && canUseServiceWorker(location, navigator))
    void registerServiceWorker(navigator.serviceWorker as unknown as SwContainer, new URL(swPath, import.meta.url), (apply) => app.offerUpdate(apply), undefined, { onVisible: whenVisible });
}

if (root) void installLocalization(root);
