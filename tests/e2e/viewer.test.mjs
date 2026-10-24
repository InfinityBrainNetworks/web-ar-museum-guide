/**
 * The viewer, end to end, in headless Chrome against the bundle in the repo:
 * Explore, then the camera finds a painting, its video plays, the floor scene
 * opens on the gyro engine, and the figure is placed - by its anchor.
 *
 *   cd tests/e2e && npm install && node --test viewer.test.mjs
 *
 * The camera is a still of exhibit 8 (the queen) on a wall, so MindAR finds a
 * real target. The gyroscope is faked by dispatching deviceorientation events
 * with the phone tilted 40 degrees down at the floor.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROOT, serve, launch, open, until, cameraOf, appLog, sleep } from './lib.mjs';

const QUEEN = 4;   // exhibit 8 is the fifth target in targets.mind
let site, browser;
const content = JSON.parse(fs.readFileSync(ROOT + 'assets/content/content.json', 'utf8'));

before(async () => {
  site = await serve(8123);
  browser = await launch({ camera: cameraOf(ROOT + 'assets/content/ex08-the-queen-of-kasyapa-target.jpg') });
});
after(async () => {
  await browser.close();
  await site.close();
});

/**
 * The viewer with the language already chosen and the splash already seen,
 * and - optionally - the queen's model settings overridden in content.json
 * on the way in, which is exactly how an exported bundle would carry them.
 */
async function viewer(modelPatch) {
  const page = await browser.newPage();
  // The service worker would answer content.json itself, out of reach of the
  // request interception below. offline.test.mjs is where it gets tested.
  await page.setBypassServiceWorker(true);
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ar-museum-language', 'en');
    sessionStorage.setItem('ar-museum-splash', '1');
  });
  if (modelPatch) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (!req.url().includes('/assets/content/content.json')) { req.continue(); return; }
      const data = JSON.parse(JSON.stringify(content));
      Object.assign(data.exhibits[QUEEN].model, modelPatch);
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
  }
  await page.goto(site.url, { waitUntil: 'domcontentloaded' });
  await until(page, () => window.ARViewer && window.ARViewer.ready(), { what: 'the viewer to boot' });
  return page;
}

/** Start the camera, find the queen, open the floor, and put her down. */
async function placeQueen(page) {
  await page.evaluate(() => window.ARViewer.startAR());
  await until(page, (i) => {
    const s = window.ARViewer.inspect();
    return s.mode === 'scan' && s.activeIndex === i && s.mediaReady;
  }, { arg: QUEEN, timeout: 60000, what: 'the queen to be found and her video to play' });

  await page.evaluate(() => document.getElementById('arBtn').click());
  await page.evaluate(() => {
    window.__tilt = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 50, gamma: 0 }));
    }, 40);
  });
  await until(page, () => window.ARViewer.inspect().floorStable, { timeout: 20000, what: 'a stable floor' });
  await page.evaluate(() => document.getElementById('placeBtn').click());
  return until(page, () => {
    const s = window.ARViewer.inspect();
    return s.figure && s.figure.loaded && s;
  }, { timeout: 30000, what: 'the model to load' });
}

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected} ± ${tolerance}, got ${actual.toFixed(4)}`);

test('Explore lists all nine paintings from the bundle', async () => {
  const page = await viewer();
  const cards = await until(page, () => document.querySelectorAll('#exhibitGrid .exhibit-card, #exhibitGrid > *').length);
  assert.equal(cards, 9);
  const source = await page.evaluate(() => window.ARViewer.bundle().source);
  assert.equal(source, 'bundle');
  await page.close();
});

test('the default anchor stands the queen on her base, centred, at 1.6 m', async () => {
  const page = await viewer();
  const s = await placeQueen(page);
  assert.equal(s.engine, 'gyro');
  near(s.figure.min.y, 0, 0.005, 'lowest point');
  near(s.figure.max.y - s.figure.min.y, 1.6, 0.01, 'height');
  near((s.figure.min.x + s.figure.max.x) / 2, 0, 0.005, 'centre x');
  near((s.figure.min.z + s.figure.max.z) / 2, 0, 0.005, 'centre z');
  const text = await appLog(page);
  assert.match(text, /anchor at the base centre/);
  await page.close();
});

test('an anchor at her middle puts her middle on the spot', async () => {
  const page = await viewer({ anchor: { x: 0, y: 0.5, z: 0 } });
  const s = await placeQueen(page);
  near(s.figure.min.y, -0.8, 0.01, 'lowest point, half below the floor');
  near(s.figure.max.y, 0.8, 0.01, 'highest point');
  await page.close();
});

test('...and lifted by half her height she stands on the floor again', async () => {
  const page = await viewer({ anchor: { x: 0, y: 0.5, z: 0 }, offset: { x: 0, y: 0.8, z: 0 } });
  const s = await placeQueen(page);
  near(s.figure.min.y, 0, 0.01, 'lowest point');
  await page.close();
});

test('she turns about her anchor, not her middle', async () => {
  // Anchored at the front edge of her base and turned half round: the base
  // swings behind the anchor instead of turning on the spot.
  const page = await viewer({ anchor: { x: 0, y: 0, z: 0.1 }, rotation: { x: 0, y: 180, z: 0 } });
  const s = await placeQueen(page);
  const centreZ = (s.figure.min.z + s.figure.max.z) / 2;
  near(centreZ, 0.16, 0.01, 'base centre swung through the anchor');
  await page.close();
});

test('a visitor drags, twists and pinches the figure, and gets real size back', async () => {
  const page = await viewer();
  const before = await placeQueen(page);
  const cdp = await page.createCDPSession();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x, y, id })),
  });

  // One finger, dragged to the right.
  await touch('touchStart', [[206, 600]]);
  for (let x = 206; x <= 326; x += 20) { await touch('touchMove', [[x, 600]]); await sleep(16); }
  await touch('touchEnd', []);
  const dragged = await page.evaluate(() => window.ARViewer.inspect());
  assert.ok(dragged.placedAt.x - before.placedAt.x > 0.1,
    `dragging right should move her right (moved ${(dragged.placedAt.x - before.placedAt.x).toFixed(3)} m)`);

  // Two fingers, spread apart and turned.
  await touch('touchStart', [[156, 600], [256, 600]]);
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * 0.6, r = 50 + i * 12;
    await touch('touchMove', [[206 - r * Math.cos(a), 600 - r * Math.sin(a)], [206 + r * Math.cos(a), 600 + r * Math.sin(a)]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  const pinched = await page.evaluate(() => window.ARViewer.inspect());
  assert.ok(pinched.visitorScale > 1.5, 'pinching out should make her bigger (×' + pinched.visitorScale + ')');
  assert.ok(Math.abs(pinched.faceYaw - dragged.faceYaw) > 0.4, 'twisting should turn her');
  near(pinched.figure.max.y - pinched.figure.min.y, 1.6, 0.01, 'her height in her own frame');

  const chip = await page.evaluate(() => !document.getElementById('realSizeChip').classList.contains('hidden'));
  assert.ok(chip, 'the Real size chip should show once she is resized');
  await page.evaluate(() => document.getElementById('realSizeChip').click());
  const reset = await page.evaluate(() => window.ARViewer.inspect());
  assert.equal(reset.visitorScale, 1);
  await page.close();
});

test('no errors in the log on the way through', async () => {
  const page = await viewer();
  await placeQueen(page);
  const errors = page.logs.filter((l) => /^(error|pageerror)/.test(l) && !/favicon/.test(l));
  assert.deepEqual(errors, []);
  await page.close();
});
