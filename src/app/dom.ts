/**
 * 작은 DOM 도우미: 요소 만들기(h)와 선 그림 아이콘.
 */

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | number | null | undefined | false;

/** 요소 만들기. 속성 html은 innerHTML(아이콘 SVG 등 우리가 만든 글만), hidden·disabled 등 참거짓 속성은 true/false */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = String(v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 24×24 선 아이콘(stroke = currentColor) */
const ICONS: Record<string, string> = {
  open: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8h-7.6L10 5.5H4.5A1.5 1.5 0 0 0 3 7v.5Z"/>',
  sample: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  tools: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  github:
    '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  views: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>',
  persp: '<path d="M4 6h16l-3 12H7L4 6Z"/><path d="M9.5 6 10 18M14.5 6 14 18"/>',
  ortho: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M9.3 6v12M14.7 6v12"/>',
  shaded: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" fill="currentColor" fill-opacity=".35"/>',
  shadedEdges: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" fill="currentColor" fill-opacity=".35"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/>',
  wireframe: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" stroke-dasharray="2 2"/><path d="M12 3v9" stroke-dasharray="2 2"/>',
  xray: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" fill="currentColor" fill-opacity=".12"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5M4 16.5 12 12M20 16.5 12 12M12 3v9" stroke-opacity=".6"/>',
  grid: '<path d="M3 8h18M3 16h18M8 3v18M16 3v18"/>',
  cube: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M5 10h14M10 5v14"/>',
  axes: '<path d="M5 19V5M5 19h14M5 19l9-6"/><path d="m3.5 7 1.5-2 1.5 2M17 17.5l2 1.5-2 1.5"/>',
  measure: '<path d="m3.5 16.5 13-13 4 4-13 13-4-4Z"/><path d="m7.5 12.5 2 2M10.5 9.5l1.5 1.5M13.5 6.5l2 2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 3.5 3.5L16 13l4.5 4.5"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  warn: '<path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.3"/>',
  drop: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2.5h16V17"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  logo: '<path d="M12 2.8 20.5 7.6v8.8L12 21.2l-8.5-4.8V7.6L12 2.8Z" fill="currentColor" fill-opacity=".18"/><path d="M12 12 20.5 7.6M12 12v9.2M12 12 3.5 7.6"/>',
};

/** 아이콘 SVG 글 */
export function icon(name: string, size = 18): string {
  const body = ICONS[name] ?? '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
