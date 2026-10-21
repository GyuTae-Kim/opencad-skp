import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * 서비스 워커 만들기(빌드만): 다른 플러그인이 언어 쪽까지 다 쓴 뒤(closeBundle) dist의 앱 파일 목록과
 * 그 내용 해시(판)를 tools/sw-template.js에 채워 dist/sw.js로 쓴다. 내용이 같으면 판도 같아 브라우저가 새 판으로 보지 않는다.
 * 미리 담는 것: 앱 쪽(뿌리와 언어 쪽 — 디렉터리 주소로), assets의 스크립트·스타일, 아이콘, 앱 정보. 소스 맵·공유 그림·사이트맵은 뺀다.
 */
export function precacheList(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  const keep = (f) =>
    f !== 'sw.js' &&
    !f.endsWith('.map') &&
    !/(^|\/)(sitemap\.xml|robots\.txt|og-opencad\.jpg)$/.test(f) &&
    (/^assets\/.+\.(js|css|json)$/.test(f) || /\.(png|svg|ico|webmanifest)$/.test(f) || /(^|\/)index\.html$/.test(f));
  // 쪽은 디렉터리 주소로(탐색 요청과 같은 열쇠): index.html → ./, en/index.html → en/
  return files
    .filter(keep)
    .map((f) => (f === 'index.html' ? './' : f.endsWith('/index.html') ? f.slice(0, -'index.html'.length) : f))
    .sort();
}

/** 판 = 미리 담는 파일 이름·내용의 해시 앞 16자리. files: { name, content } */
export function serviceWorkerSource(template, list, files) {
  const h = createHash('sha256');
  for (const f of files) h.update(f.name).update('\0').update(f.content);
  const version = h.digest('hex').slice(0, 16);
  return template.replace("'__VERSION__'", JSON.stringify(version)).replace('__ASSETS__', JSON.stringify(list));
}

export function serviceWorker() {
  let root = 'dist';
  return {
    name: 'opencad-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const list = precacheList(root);
      const files = list.map((f) => {
        const path = f === './' ? 'index.html' : f.endsWith('/') ? f + 'index.html' : f;
        return { name: f, content: readFileSync(join(root, path)) };
      });
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      writeFileSync(join(root, 'sw.js'), serviceWorkerSource(template, list, files));
    },
  };
}
