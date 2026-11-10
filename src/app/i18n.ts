import { createLanguageMenu } from 'opencad-site-kit/i18n/language-menu';
// 코어 입구가 다시 내보내는 것과 같은 객체(작은 모듈 — 첫 화면에 코어 전체를 넣지 않는다, core.ts)
import { VIEW_LABELS } from 'opencad-viewer3d/camera';
/** Localize only presentation DOM. CAD data, input values and command keys stay intact. */
import { currentLanguage, languages, languageUrl, metadataForLanguage, registerCatalog, sourceMessage, translate } from '../../site/i18n-core.mjs';
import { isAppName, slotText, type Mixed } from './filetext';
import { errorText } from './protocol';

const loaders: Record<string, () => Promise<{default: Record<string,string>}>> = {
  en: () => import('../../site/locales/en.json'), ja: () => import('../../site/locales/ja.json'),
  'zh-CN': () => import('../../site/locales/zh-CN.json'), de: () => import('../../site/locales/de.json'),
};
async function loadLanguage(language: string): Promise<void> { if (loaders[language]) registerCatalog(language,(await loaders[language]()).default); }

/** 지금 화면 언어(사전을 받은 뒤 installLocalization이 정하고 언어를 바꾸면 따라간다 — 그 전과 닫은 뒤는 한국어) */
let active = 'ko';
/**
 * 앱이 쓰는 한국어 화면 글을 지금 언어로 옮긴다(아래 번역층과 같은 translate). 번역층은 글을 넣은 뒤(다음 마이크로태스크) 바꾸므로,
 * 글 크기를 재어 자리를 정하는 곳(측정 툴팁·도구 막대 메뉴)은 넣기 전에 이것으로 옮기고 그 요소에 data-i18n-skip을 둔다
 * (31차 — 번역 전 한국어 크기로 놓여 휴대폰 폭에서 잘렸다). 한국어면 그대로
 */
export function uiText(text: string): string { return translate(text, active); }
/** 첫 화면 언어 사전을 받아 uiText가 그 언어로 옮기게 될 때(53차 — 주소로 바로 연 예제(?sample)는 이것을 기다린 뒤 화면 언어 이름으로 만든다) */
let installed: Promise<void> = Promise.resolve();
export const uiReady = (): Promise<void> => installed.catch(() => undefined);

/**
 * 파일 글이 섞인 글(filetext.ts)을 지금 언어로(52차): 파일 글 자리를 번역기가 보지 않는 사용 영역 글자(U+E000~)로 바꿔 옮긴 뒤 되돌린다
 * (사전 틀의 {0}이 그 글자를 그대로 잡고, 나눔 글로 조각낼 때도 한글이 없는 조각이라 그대로 둔다).
 * 옮긴 글을 넣은 속성은 data-i18n-keep에, 마디를 담은 요소는 data-i18n-skip으로 번역층에서 빼고, 언어를 바꾸면 다시 그린다(app.ts).
 * 앱 글 조각(ui — 59차 해석기 까닭 글)은 틀의 {0}에 든 글도 앱 글로 옮긴다(번역기 uiParameters)
 */
const activeText = (text: string, ui?: boolean): string => translate(text, active, ui);
function mixed(parts: Mixed): [string, string[]] {
  return slotText(parts, activeText);
}
export function mixText(parts: Mixed): string {
  const [text, files] = mixed(parts);
  return text.replace(/[-]/g, c => files[c.charCodeAt(0) - 0xe000] ?? c);
}
/** 섞은 글 → 화면 마디(파일 글은 translate="no" 묶음). 담는 요소에 data-i18n-skip을 둔다 */
export function mixNodes(parts: Mixed): (string | Node)[] {
  const [text, files] = mixed(parts);
  return text.split(/([-])/).filter(Boolean).map(x => {
    const file = files[x.charCodeAt(0) - 0xe000];
    if (x.length > 1 || file === undefined) return x;
    const el = document.createElement('span'); el.setAttribute('translate', 'no'); el.textContent = file;
    return el;
  });
}
/** 이름 칸 글: 앱 자리 글("(이름 없음)" 등)만 지금 언어로, 파일 글은 그대로(번역층이 건너뛰는 칸에 넣을 때) */
export const uiName = (name: string): string => isAppName(name) ? uiText(name) : name;
/**
 * 실행 중 오류(브라우저·워커·코어가 던진 것 — protocol.ts errorText) → 알림 글(60차): 사전 글이면(지금 언어로 다 옮겨진다 — 사전 열쇠, 틀 자리에 든 까닭 글까지 사전 글)
 * 앱 글 조각(ui — 틀 자리 글도 옮긴다, 59차 해석기 까닭 글과 같은 길)으로 두어 화면 언어를 따르고, 옮긴 글에 한글이 남으면(사전에 없는 한국어 글을 번역기가
 * 나눔 글 조각·틀 머리만 옮긴다) 파일 글로 두어 원문 그대로 보인다. 옮겨지지 않는 글(브라우저의 영어 글·한국어 화면)은 앱 글 조각 — 번역기도 그대로 둔다.
 * 62차: 고르는 때는 그 글을 그릴 때의 화면 언어다(ui를 읽을 때마다 고른다 — 알림을 띄운 채 언어를 바꾸면 알림 띠가 다시 그리며 새 언어로 고른다).
 * 60·61차는 띄울 때 골라, 한국어 화면에서 띄운 알림(앱 글 조각)을 연 채 언어를 바꾸면 사전에 없는 글이 조각마다 옮겨졌다. 번역 함수(slotText·mixNodes)는 그대로다
 */
export function errorParts(e: unknown): Mixed {
  const t = errorText(e);
  return [{ file: t, get ui() { const s = activeText(t, true); return s === t || !/[가-힣]/.test(s); } }];
}

/**
 * 뷰 큐브 면 글(코어 viewcube의 CUBE_FACES — 코어가 그 객체의 label로 그린다). 54차: 코어 0.44.0부터 viewcube 모듈이 커져(손가락 큐브)
 * 첫 화면에서 바로 가져오지 않고 코어 조각과 함께 받는다(core.ts loadViewerCore). 받으면 지금 언어로 옮기고, 언어를 바꾸거나 번역층을 닫으면 따라간다
 */
let cubeFaces: readonly { label: string }[] = [];
let cubeOriginal: string[] = [];
export function localizeCubeFaces(faces: readonly { label: string }[]): void {
  if (faces === cubeFaces) return;
  cubeFaces = faces;
  cubeOriginal = faces.map(face => face.label);
  faces.forEach((face,index) => { face.label=translate(cubeOriginal[index]!,active); });
}

type RecordValue = { source: string; rendered: string };
// Scene names come from the model; playback controls beside them are authored UI.
const SKIP = '[data-static-languages], [translate="no"], [data-i18n-skip], script, style, [contenteditable]:not([contenteditable="false"]), textarea, input, code, pre, canvas, svg, .anno-layer, .pmi-layer, .docname, .doc-name, .code-list, .cmd-input, .file-name, .tree .name, .tree-name, .boot-recent-list button, .plist .name, .def-cell, .scene-tabs .scene-tab, .scene-cap, .group-item:not(.opt) .name';
export async function installLocalization(root: HTMLElement): Promise<() => void> {
  let language = currentLanguage(location.href);
  await (installed = loadLanguage(language).then(() => { active = language; }));
  const originalViews = Object.entries(VIEW_LABELS);
  function canvasLabels(): void {
    for (const [view,label] of originalViews) VIEW_LABELS[view as keyof typeof VIEW_LABELS] = translate(label,language);
    cubeFaces.forEach((face,index) => { face.label=translate(cubeOriginal[index]!,language); });
  }
  canvasLabels();
  const presentationRoot = document.body;
  const texts = new WeakMap<Node, RecordValue>();
  const attributes = new WeakMap<Element, Map<string, RecordValue>>();
  const control = createLanguageMenu(languages, language, changeLanguage);
  function value(current: string, record?: RecordValue): RecordValue {
    const source = record && current === record.rendered ? record.source : sourceMessage(current);
    const rendered = translate(source, language);
    // Keep spacing around split text nodes and inline elements.
    return { source, rendered: rendered === source ? source : (source.match(/^\s*/)?.[0] ?? '') + rendered + (source.match(/\s*$/)?.[0] ?? '') };
  }
  function element(el: Element): void {
    if ((el.matches(SKIP) && !el.matches('input, textarea, canvas, [contenteditable]')) || el.closest('[translate="no"], [data-i18n-skip]')) return;
    const records = attributes.get(el) ?? new Map<string, RecordValue>(); attributes.set(el, records);
    // data-i18n-keep: 파일 글이거나 앱이 이미 옮겨 넣은 속성(mixText — 52차)
    const keep = el.getAttribute('data-i18n-keep')?.split(' ');
    for (const name of ['title','aria-label','aria-description','placeholder','alt']) {
      if (!el.hasAttribute(name) || keep?.includes(name)) continue;
      const record = value(el.getAttribute(name)!, records.get(name)); records.set(name, record);
      if (el.getAttribute(name) !== record.rendered) el.setAttribute(name, record.rendered);
    }
    if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) {
      const current = el.getAttribute('href')!; const old = records.get('href');
      const source = old && current === old.rendered ? old.source : current;
      const rendered = languageUrl(new URL(source, document.baseURI).href, language);
      records.set('href',{source,rendered}); if (el.getAttribute('href') !== rendered) el.setAttribute('href',rendered);
    }
  }
  function update(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.parentElement || node.parentElement.closest(SKIP)) return;
      const record = value(node.nodeValue ?? '', texts.get(node)); texts.set(node, record);
      if (node.nodeValue !== record.rendered) node.nodeValue = record.rendered;
      return;
    }
    if (!(node instanceof Element) || node.parentElement?.closest(SKIP)) return;
    if (node.matches(SKIP)) { if (node.matches('input, textarea, canvas, [contenteditable]')) element(node); return; }
    element(node);
    for (const child of Array.from(node.childNodes)) update(child);
  }
  function mountSelector(): void {
    // The shared widget preserves native language names with translate="no".
    // Its own accessible name still follows the selected UI language.
    const label = translate('언어 선택', language);
    const trigger = control.element.querySelector('button');
    const menu = document.getElementById(trigger?.getAttribute('aria-controls') ?? '');
    for (const el of [trigger, menu]) if (el && el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    if (trigger && trigger.title !== label) trigger.title = label;
    const host = root.querySelector('.titlebar, .topbar, header');
    if (host) { control.element.classList.remove('language-control-floating'); if (control.element.parentNode !== host) host.append(control.element); }
    if (!control.element.isConnected) { control.element.classList.add('language-control-floating'); root.append(control.element); }
  }
  let titleSource = sourceMessage(document.title);
  function metadata(): void {
    const data = metadataForLanguage(language);
    document.documentElement.lang = language;
    const previous = titleSource;
    document.title = translate(previous,language);
    const originalName = metadataForLanguage('ko').siteName;
    if (previous.endsWith(originalName)) document.title = previous.slice(0,-originalName.length) + translate(originalName,language);
    const fields: [string,string][] = [
      ['meta[name="description"]',data.description],['meta[name="author"]',data.author.name],['meta[property="og:locale"]',data.locale],
      ['meta[property="og:title"]',data.title],['meta[property="og:description"]',data.description],['meta[property="og:url"]',data.url],
      ['meta[property="og:site_name"]',data.siteName],['meta[property="og:image"]',data.image.url],['meta[property="og:image:secure_url"]',data.image.url],['meta[property="og:image:alt"]',data.image.alt],
      ['meta[name="twitter:title"]',data.title],['meta[name="twitter:description"]',data.description],['meta[name="twitter:image"]',data.image.url],['meta[name="twitter:image:alt"]',data.image.alt],
    ];
    for (const [query,content] of fields) document.querySelector(query)?.setAttribute('content',content);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href',data.url);
    const graph = document.querySelector('script[type="application/ld+json"]');
    if (graph?.textContent) {
      const existing = JSON.parse(graph.textContent);
      for (const item of existing['@graph'] ?? []) {
        if (item['@type'] === 'WebApplication') Object.assign(item,{...data.application,'@id':data.url+'#app',url:data.url,description:data.description,inLanguage:language,image:data.image.url,author:data.author});
        if (item['@type'] === 'BreadcrumbList') item.itemListElement=data.breadcrumbs;
      }
      graph.textContent=JSON.stringify(existing).replace(/</g,'\\u003c');
    }
  }
  async function changeLanguage(next: string): Promise<void> {
    try { await loadLanguage(next); } catch { return; }
    const url = new URL(languageUrl(location.href,next));
    // Dev servers use /en/; published apps use /opencad-<format>/en/.
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      const base = location.pathname.match(/^\/(?:2dcad-viewer|opencad-(?:dwgdxf|skp|step|nc))\//)?.[0] ?? '/';
      url.pathname = base + (next === 'ko' ? '' : next + '/');
    }
    language = next;
    active = next;
    control.setLanguage(language);
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
    metadata(); canvasLabels(); update(presentationRoot);
    mountSelector();
    root.dispatchEvent(new CustomEvent('languagechange',{detail:language}));
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') for (const node of Array.from(record.addedNodes)) update(node);
      else update(record.target);
    }
    mountSelector();
  });
  metadata(); update(presentationRoot); mountSelector();
  root.dispatchEvent(new CustomEvent('languagechange',{detail:language}));
  const title = document.querySelector('title');
  const titleObserver = new MutationObserver(() => {
    const current = document.title;
    const originalName = metadataForLanguage('ko').siteName;
    const translatedName = translate(originalName,language);
    if (current === translate(titleSource,language) || (titleSource.endsWith(originalName) && current === titleSource.slice(0,-originalName.length)+translatedName)) return;
    titleSource=sourceMessage(current);
    if (current.endsWith(originalName)) document.title=current.slice(0,-originalName.length)+translatedName;
    else document.title=translate(current,language);
  });
  if (title) titleObserver.observe(title,{childList:true,subtree:true,characterData:true});
  observer.observe(presentationRoot,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','aria-description','placeholder','alt','href']});
  return () => {
    active = 'ko';
    observer.disconnect(); titleObserver.disconnect(); control.dispose();
    for (const [view,label] of originalViews) VIEW_LABELS[view as keyof typeof VIEW_LABELS]=label;
    cubeFaces.forEach((face,index) => { face.label=cubeOriginal[index]!; });
  };
}
