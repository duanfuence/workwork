/**
 * Создаёт Open Graph-изображение сайта: скриншот шаблона scripts/og/og-image.html → public/og.png
 * (1200 × 630, PNG). Использование: npm run og:image. Браузер — тот же Playwright, что у ui:check.
 */
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const template = pathToFileURL(fileURLToPath(new URL('./og/og-image.html', import.meta.url)));
const output = fileURLToPath(new URL('../public/og.png', import.meta.url));
const maxBytes = 100 * 1024;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(template.href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: output, type: 'png' });
} finally {
  await browser.close();
}

const { size } = await stat(output);
console.log(`public/og.png: 1200 × 630, ${(size / 1024).toFixed(1)} КБ`);
if (size > maxBytes) {
  console.error(`Изображение больше ${maxBytes / 1024} КБ — упростите шаблон.`);
  process.exit(1);
}
