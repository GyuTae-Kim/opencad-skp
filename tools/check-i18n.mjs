import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {languages,catalogs,metadataForLanguage} from '../site/i18n.mjs';
const keys=Object.keys(catalogs.en).sort();
for(const{code}of languages){
 if(code!=='ko'){
  const catalog=catalogs[code];assert.deepEqual(Object.keys(catalog).sort(),keys,code);
  for(const key of keys){assert.ok(catalog[key]?.trim(),`${code}: empty ${key}`);assert.deepEqual((catalog[key].match(/\{\d+\}/g)??[]).sort(),(key.match(/\{\d+\}/g)??[]).sort(),`${code}: parameters ${key}`);}
 }
 const raw=readFileSync(`dist/${code==='ko'?'':code+'/'}index.html`,'utf8');const metadata=metadataForLanguage(code);const dom=new JSDOM(raw,{url:metadata.url});const doc=dom.window.document;
 assert.equal(doc.documentElement.lang,code);assert.equal(doc.title,metadata.title);assert.equal(doc.querySelector('link[rel=canonical]').href,metadata.url);
 assert.equal(doc.querySelectorAll('link[rel=alternate][hreflang]').length,6);
 for(const item of languages)assert.equal(doc.querySelector(`link[hreflang="${item.code}"]`).href,metadataForLanguage(item.code).url);
 for(const script of doc.querySelectorAll('script[src]'))assert.equal(new URL(script.src).pathname.includes(`/${code}/assets/`),false,'nested language assets must resolve to application root');
 // 홈 화면에 추가: 언어 페이지마다 그 언어로 열리는 앱 정보와 있는 아이콘
 const manifestLink=doc.querySelectorAll('link[rel=manifest]');assert.equal(manifestLink.length,1,`${code}: manifest link`);
 const manifestUrl=new URL(manifestLink[0].href);const manifestPath=new URL(metadataForLanguage('ko').url).pathname;
 assert.ok(manifestUrl.pathname.startsWith(manifestPath),`${code}: manifest outside the app`);
 const manifest=JSON.parse(readFileSync('dist/'+manifestUrl.pathname.slice(manifestPath.length),'utf8'));
 assert.equal(manifest.lang,code);assert.equal(manifest.display,'standalone');
 assert.equal(new URL(manifest.start_url,manifestUrl).href,metadata.url,`${code}: manifest start_url`);
 assert.equal(new URL(manifest.scope,manifestUrl).href,metadataForLanguage('ko').url,`${code}: manifest scope`);
 if(code!=='ko')assert.doesNotMatch(manifest.name+manifest.short_name+manifest.description,/[가-힣]/,`${code}: untranslated manifest`);
 for(const icon of manifest.icons){const src=new URL(icon.src,manifestUrl);assert.ok(existsSync('dist/'+src.pathname.slice(manifestPath.length)),`${code}: icon ${icon.src}`);}
 assert.ok(existsSync('dist/'+new URL(doc.querySelector('link[rel=apple-touch-icon]').href).pathname.slice(manifestPath.length)),`${code}: apple-touch-icon`);
 if(code!=='ko'){
  const main=doc.querySelector('main');main.querySelectorAll('[data-static-languages]').forEach(el=>el.remove());
  assert.doesNotMatch(main.textContent,/[가-힣]/,`${code}: untranslated static introduction`);
 }
 dom.window.close();
}
console.log(`i18n check passed: five static language pages, reciprocal alternatives, relative assets and ${keys.length} catalog messages.`);
