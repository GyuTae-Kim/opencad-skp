export function precacheList(root: string): string[];
export function serviceWorkerSource(template: string, list: string[], files: { name: string; content: Uint8Array | string }[]): string;
export function serviceWorker(): import('vite').Plugin;
