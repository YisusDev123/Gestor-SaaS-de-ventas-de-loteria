import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright-core';

const outputDirectory = path.resolve('public/icons');
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#176b4d}body{display:grid;place-items:center;border-radius:${Math.round(size * 0.22)}px;overflow:hidden;font-family:Arial,sans-serif;color:white;font-size:${Math.round(size * 0.27)}px;font-weight:800}span{transform:translateY(-2%)}</style><span>GV</span>`);
    await page.screenshot({ path: path.join(outputDirectory, `icon-${size}.png`) });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent('<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#176b4d}body{display:grid;place-items:center;font-family:Arial,sans-serif;color:white;font-size:126px;font-weight:800}span{display:grid;width:340px;height:340px;place-items:center;border-radius:88px;background:rgba(244,246,241,.12)}</style><span>GV</span>');
  await page.screenshot({ path: path.join(outputDirectory, 'icon-maskable-512.png') });
} finally {
  await browser.close();
}
console.log('Iconos PWA generados: 192, 512 y maskable 512.');
