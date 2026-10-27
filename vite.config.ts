import { siteLocalization } from 'opencad-site-kit/i18n/localization-plugin';
import { siteMetadata } from 'opencad-site-kit/seo/site-plugin';
import { serviceWorker } from 'opencad-site-kit/pwa/sw-plugin';
import { defineConfig } from 'vitest/config';
import { offline, site } from './tools/site.mjs';

/**
 * 앱 빌드·개발 서버와 시험 설정을 함께 둔다.
 * base './': GitHub Pages 프로젝트 사이트(https://gyutae-kim.github.io/opencad-skp/)처럼 하위 경로에서도 돌게 상대 경로로 낸다.
 * 언어 페이지·검색 정보·언어별 앱 정보와 빌드 끝의 오프라인 서비스 워커(dist/sw.js)는 공용 도구(opencad-site-kit)가 tools/site.mjs 설정으로 만든다.
 */
export default defineConfig({
  base: './',
  plugins: [siteLocalization(site), siteMetadata(site), serviceWorker(offline)],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  // 워커만 쓰는 earcut을 처음부터 미리 묶어, 첫 해석 때 개발 서버가 페이지를 다시 읽지 않게 한다
  optimizeDeps: {
    include: ['earcut'],
  },
  server: {
    // .runtime/(확인용 표본·임시 파일)이 바뀌어도 페이지를 다시 읽지 않는다
    watch: { ignored: ['**/.runtime/**'] },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
