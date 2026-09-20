import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) {
  await access(path.join(dist, file));
}
const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone' || manifest.start_url !== '/') throw new Error('El manifest no es instalable como aplicación standalone.');
if (!manifest.icons.some((icon) => icon.sizes === '192x192') || !manifest.icons.some((icon) => icon.sizes === '512x512')) throw new Error('Faltan iconos PWA requeridos.');
if (!manifest.icons.some((icon) => icon.purpose === 'maskable')) throw new Error('Falta el icono maskable.');
const worker = await readFile(path.join(dist, 'sw.js'), 'utf8');
for (const forbidden of ['BackgroundSyncPlugin', 'NetworkFirst', 'StaleWhileRevalidate', 'CacheFirst']) {
  if (worker.includes(forbidden)) throw new Error(`La política PWA contiene una estrategia runtime no autorizada: ${forbidden}.`);
}
if (!worker.includes('precacheAndRoute')) throw new Error('El service worker no contiene el precache del shell.');
console.log('PWA aprobada: manifest, iconos y precache sin caché runtime ni Background Sync.');
