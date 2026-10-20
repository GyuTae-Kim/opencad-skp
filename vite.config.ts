import { siteLocalization } from './tools/localization-plugin.mjs';
import { defineConfig } from 'vitest/config';
import { siteMetadata } from './tools/site-plugin.mjs';

/**
 * 앱 빌드·개발 서버와 시험 설정을 함께 둔다.
 * base './': GitHub Pages 프로젝트 사이트(https://gyutae-kim.github.io/opencad-skp/)처럼 하위 경로에서도 돌게 상대 경로로 낸다.
 */
export default defineConfig({
  base: './',
  plugins: [siteLocalization(), siteMetadata()],
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
