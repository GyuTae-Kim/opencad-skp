import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderMetadata, metadata } from './site-metadata.mjs';
import { currentLanguage, languages, languageUrl, translate } from '../site/i18n.mjs';
const escape = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const decode = value => value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
export function localizeHtml(html, language) {
  html=html.replace(/<!-- localized-metadata:start -->[\s\S]*?<!-- localized-metadata:end -->/,`<!-- localized-metadata:start -->${renderMetadata(language)}<!-- localized-metadata:end -->`);
  const body=html.indexOf('<body');
  let raw=false;
  html=html.slice(0,body)+html.slice(body).replace(/<[^>]+>|[^<]+/g,token=>{
    if(token.startsWith('<')){
      if(/^<(?:script|style)\b/i.test(token))raw=true;
      if(/^<\/(?:script|style)>/i.test(token))raw=false;
      return raw?token:token.replace(/\b(alt|title|aria-label|placeholder|href)="([^"]*)"/g,(_,name,value)=>`${name}="${escape(name==='href'?languageUrl(decode(value),language):translate(decode(value),language))}"`);
    }
    if(raw)return token;
    const translated=translate(decode(token),language);
    return translated===decode(token)?token:(token.match(/^\s*/)?.[0]??'')+escape(translated)+(token.match(/\s*$/)?.[0]??'');
  });
  const navigation = `<nav data-static-languages aria-label="Language">${languages.map(item => `<a href="${languageUrl(metadata.url,item.code)}" lang="${item.code}" hreflang="${item.code}"${item.code===language?' aria-current="true"':''}>${item.label}</a>`).join(' · ')}</nav>`;
  if (html.includes('data-static-languages')) html=html.replace(/<nav data-static-languages[^>]*>[\s\S]*?<\/nav>/,navigation);
  else html=html.replace(/(<main\b[^>]*>)/,'$1'+navigation);
  html=html.replace(/<html lang="[^"]*"/,`<html lang="${language}"`);
  if(language!=='ko'){
    html=html.replace('<head>','<head>\n    <base href="../">');
    // 홈 화면에 추가하면 그 언어 페이지로 열리게 언어별 앱 정보(localizeManifest)를 가리킨다
    html=html.replace('href="./manifest.webmanifest"',`href="./${language}/manifest.webmanifest"`);
    html=html.replace(/(<meta name="apple-mobile-web-app-title" content=")([^"]*)"/,(_,head,title)=>head+escape(translate(decode(title),language))+'"');
  }
  return html;
}
/**
 * 언어 페이지(<언어>/)의 앱 정보: 이름·설명을 옮기고, 시작 주소는 그 언어 페이지, 범위·아이콘은 앱 뿌리.
 * id는 두지 않는다 — id는 start_url의 출처(https://gyutae-kim.github.io/)를 기준으로 풀려 "./"이면 사이트 루트(포트폴리오·다른 앱과 같은
 * 앱)가 된다. 없으면 start_url이 id라 언어마다 /opencad-skp/<언어>/ 아래의 따로 된 앱이다.
 */
export function localizeManifest(manifest, language) {
  if (language === 'ko') return manifest;
  const up = src => /^[a-z]+:|^\//i.test(src) ? src : '../' + src.replace(/^\.\//, '');
  const { id: _id, ...rest } = manifest;
  return { ...rest, name: translate(manifest.name, language), short_name: translate(manifest.short_name, language),
    description: translate(manifest.description, language), lang: language, start_url: './', scope: '../',
    icons: manifest.icons.map(icon => ({ ...icon, src: up(icon.src) })) };
}
export function siteLocalization(){
 return {
  name:'opencad-localized-pages',enforce:'post',
  transformIndexHtml:{order:'post',handler(html,ctx){return localizeHtml(html,currentLanguage(new URL(ctx.originalUrl??ctx.path,'http://localhost').href));}},
  writeBundle(options){
    const root=options.dir??'dist';const html=readFileSync(join(root,'index.html'),'utf8');
    const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
    for(const{code}of languages.filter(item=>item.code!=='ko')){
      mkdirSync(join(root,code),{recursive:true});writeFileSync(join(root,code,'index.html'),localizeHtml(html,code));
      writeFileSync(join(root,code,'manifest.webmanifest'),JSON.stringify(localizeManifest(manifest,code),null,2)+'\n');
    }
  },
 };
}
