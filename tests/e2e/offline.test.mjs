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

// The repo's own bundle, never whatever release the real Firebase project has
// live: the test is about the download, not about Google's network that day.
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
  const page = await fresh(`http://127.0.0.1:${PORT}/?source=bundle`);
  await until(page, () => !document.getElementById('syncScreen').classList.contains('hidden'),
    { timeout: 20000, what: 'the download screen' });
  const midway = await until(page, () => {
    const t = document.getElementById('syncBytes').textContent;
    return /of/.test(t) && t;
  }, { timeout: 20000, what: 'a progress readout' });
  assert.match(midway, /\d+(\.\d)? of \d+(\.\d)? MB/);

  // Some Windows machines run a download manager that hooks the OS and answers
  // every .mp3 request with an empty 204 before it reaches the server. The
  // guide rightly refuses to keep an empty recording; so on such a machine
  // the narration is the one thing allowed to be missing.
  const mp3Blocked = await page.evaluate(async () => {
    const audio = window.AROffline.plan(window.ARViewer.bundle(), 'en').find((i) => i.kind === 'narration');
    return (await fetch(audio.url, { cache: 'no-store' })).status !== 200;
  });

  // Long enough for the automatic retry after a failed first pass.
  await until(page, () => window.AROffline.status().missing === 0, { timeout: 30000, what: 'the download to finish' })
    .catch(() => null);
  const status = await page.evaluate(() => window.AROffline.status());
  if (mp3Blocked) {
    const narration = await page.evaluate(async () => {
      const items = window.AROffline.plan(window.ARViewer.bundle(), 'en');
      await window.AROffline.check(items);
      return items.filter((i) => !i.cached).map((i) => i.kind);
    });
    assert.ok(narration.every((k) => k === 'narration'), 'only narration may be missing, got ' + narration.join(', '));
  } else {
    assert.equal(status.missing, 0, 'nothing left to download');
    await until(page, () => document.getElementById('syncScreen').classList.contains('hidden'),
      { timeout: 5000, what: 'the screen to close' });
    const value = await page.evaluate(() => document.getElementById('setOfflineValue').textContent);
    assert.match(value, /Ready offline/);
  }
  assert.ok(status.bytes > 15 * 1048576, 'the gallery is tens of MB, got ' + status.bytes);
  await page.close();
});

test('with the server gone, the guide still opens, finds the lion and plays its video', async () => {
  await site.close();
  site = null;

  const page = await fresh(`http://127.0.0.1:${PORT}/?source=bundle`);
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
