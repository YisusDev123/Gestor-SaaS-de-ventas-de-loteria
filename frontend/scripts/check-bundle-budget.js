import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const assets = path.resolve('dist/assets');
const files = await readdir(assets);
const sizes = await Promise.all(files.map(async (file) => ({ file, bytes: (await stat(path.join(assets, file))).size })));
const javascript = sizes.filter(({ file }) => file.endsWith('.js'));
const css = sizes.filter(({ file }) => file.endsWith('.css'));
const main = javascript.find(({ file }) => file.startsWith('index-'));
const totalJs = javascript.reduce((total, item) => total + item.bytes, 0);
const totalCss = css.reduce((total, item) => total + item.bytes, 0);
const limits = { mainJs: 420 * 1024, totalJs: 540 * 1024, totalCss: 45 * 1024 };
if (!main || main.bytes > limits.mainJs) throw new Error(`Bundle principal fuera de presupuesto: ${main?.bytes ?? 0} bytes.`);
if (totalJs > limits.totalJs) throw new Error(`JavaScript total fuera de presupuesto: ${totalJs} bytes.`);
if (totalCss > limits.totalCss) throw new Error(`CSS fuera de presupuesto: ${totalCss} bytes.`);
console.log(`Presupuesto aprobado: main ${main.bytes} B, JS total ${totalJs} B, CSS ${totalCss} B.`);
