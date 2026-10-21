import type { Plugin } from 'vite';
export function siteLocalization(): Plugin;
export function localizeHtml(html: string, language: string): string;
export function localizeManifest<T extends { name: string; short_name: string; description: string; icons: { src: string }[] }>(manifest: T, language: string): T;
