/**
 * The offline promise, end to end: a first visit downloads the gallery with a
 * progress bar, and after that the guide opens, recognises a painting and
 * plays its video with the server switched off.
 *
 *   cd tests/e2e && node --test offline.test.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, serve, launch, until, cameraOf } from './lib.mjs';

const PORT = 8131;
let site, browser;

before(async () => {
  site = await serve(PORT);
  browser = await launch({ camera: cameraOf(ROOT + 'assets/content/ex41-the-lion-flag-target.jpg') });
});
after(async () => {
  await browser.close();
  if (site) await site.close();
});

async function fresh(url) {
  const page = await browser.newPage();
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ar-museum-language', 'en');
    sessionStorage.setItem('ar-museum-splash', '1');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}

test('a first visit downloads the whole gallery, with progress, then lets you in', async () => {
  const page = await fresh(`http://127.0.0.1:${PORT}/`);
  await until(page, () => !document.getElementById('syncScreen').classList.contains('hidden'),
    { timeout: 20000, what: 'the download screen' });
  const midway = await until(page, () => {
    const t = document.getElementById('syncBytes').textContent;
    return /of/.test(t) && t;
  }, { timeout: 20000, what: 'a progress readout' });
  assert.match(midway, /\d+(\.\d)? of \d+(\.\d)? MB/);

  await until(page, () => document.getElementById('syncScreen').classList.contains('hidden'),
    { timeout: 120000, what: 'the download to finish and the screen to close' });
  const status = await page.evaluate(() => window.AROffline.status());
  assert.equal(status.missing, 0, 'nothing left to download');
  assert.ok(status.bytes > 15 * 1048576, 'the gallery is tens of MB, got ' + status.bytes);
  const value = await page.evaluate(() => document.getElementById('setOfflineValue').textContent);
  assert.match(value, /Ready offline/);
  await page.close();
});

test('with the server gone, the guide still opens, finds the lion and plays its video', async () => {
  await site.close();
  site = null;

  const page = await fresh(`http://127.0.0.1:${PORT}/`);
  await until(page, () => window.ARViewer && window.ARViewer.ready(), { timeout: 30000, what: 'an offline boot' });
  const cards = await until(page, () => document.querySelectorAll('#exhibitGrid > *').length);
  assert.equal(cards, 9);
  const images = await until(page, () => {
    const imgs = Array.from(document.querySelectorAll('#exhibitGrid img'));
    return imgs.length && imgs.every((i) => i.complete && i.naturalWidth > 0) && imgs.length;
  }, { timeout: 15000, what: 'every card photo to load from the phone' });
  assert.equal(images, 9);

  await page.evaluate(() => window.ARViewer.startAR());
  const s = await until(page, () => {
    const s = window.ARViewer.inspect();
    return s.mode === 'scan' && s.activeIndex === 8 && s.mediaReady && s;
  }, { timeout: 60000, what: 'the lion found and his video playing, offline' });
  assert.equal(s.exhibit.length > 0, true);
  const errors = page.logs.filter((l) => /^pageerror/.test(l));
  assert.deepEqual(errors, []);
  await page.close();
});
