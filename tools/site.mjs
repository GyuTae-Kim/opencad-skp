// 이 앱의 사이트 설정(opencad-site-kit): 검색 정보·언어 페이지·앱 정보와 오프라인 서비스 워커. vite.config.ts와 시험이 같이 쓴다.
import metadata from '../site/metadata.json' with { type: 'json' };
import history from '../site/content-history.json' with { type: 'json' };
import '../site/i18n.mjs';
import { defineSite } from 'opencad-site-kit/seo/site-metadata';
import { templateSource } from 'opencad-site-kit/pwa/sw-plugin';

// 앱 정보 원본은 public/manifest.webmanifest(한국어는 그대로 복사): 언어별 앱 정보만 빌드가 쓰고, 링크·홈 화면 이름은 index.html의 것을 언어마다 바꾼다
export const site = defineSite({ metadata, history, manifest: { source: new URL('../public/manifest.webmanifest', import.meta.url) } });

/** 미리 담을 파일: 앱 쪽(뿌리·언어 쪽), assets의 스크립트·스타일·JSON, 그림·앱 정보. 소스 맵·공유 그림·사이트맵은 뺀다 */
export const precache = (f) =>
  f !== 'sw.js' && !f.endsWith('.map') && !/(^|\/)(sitemap\.xml|robots\.txt|og-opencad\.jpg)$/.test(f) &&
  (/^assets\/.+\.(js|css|json)$/.test(f) || /\.(png|svg|ico|webmanifest)$/.test(f) || /(^|\/)index\.html$/.test(f));

/** serviceWorker(offline): 워커 본문은 tools/sw-template.js. 목록은 주소 차례, 판 이름은 예전처럼 주소·내용(사이에 \0) 지문의 앞 16자리 */
export const offline = {
  source: templateSource(new URL('./sw-template.js', import.meta.url)),
  precache, sortUrls: true, version: { length: 16, key: 'url', separator: '\0', terminator: '' },
};
