/**
 * 앱 입구: 스타일을 불러오고, 앱을 붙이고, 주소 인자(?sample, ?open=)를 처리한다.
 * 자동 확인용으로 window.opencadApp을 둔다.
 */
import './styles.css';
import { SkpViewerApp, type AppSnapshot } from './app';
import { parseLaunch } from './launch';

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
}
