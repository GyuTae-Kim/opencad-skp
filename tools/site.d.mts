import type { Site } from 'opencad-site-kit/seo/site-metadata';
import type { Precache, serviceWorker } from 'opencad-site-kit/pwa/sw-plugin';
export const site: Site;
export const precache: Precache;
export const offline: Parameters<typeof serviceWorker>[0];
