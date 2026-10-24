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
// Her life size, as the bundle sets it; half of it is where her middle is.
const TALL = content.exhibits[QUEEN].model.heightMeters;

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
  // The repo's own bundle, never whatever release the real project has live.
  await page.goto(site.url + '?source=bundle', { waitUntil: 'domcontentloaded' });
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

// A real tap, not el.click(): an invisible full-bleed layer once sat over the
// whole app and every scripted click still went straight through it.
test('a first-time visitor can tap through the language screen and scroll Explore', async () => {
  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  await page.evaluateOnNewDocument(() => {
    localStorage.removeItem('ar-museum-language');
    sessionStorage.setItem('ar-museum-splash', '1');
  });
  await page.goto(site.url + '?source=bundle', { waitUntil: 'domcontentloaded' });
  await until(page, () => window.ARViewer && window.ARViewer.ready(), { what: 'the viewer to boot' });
  await until(page, () => !document.getElementById('langScreen').classList.contains('hidden'),
    { what: 'the language screen' });
  const covered = await page.evaluate(() => {
    const go = document.getElementById('langGo');
    const r = go.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return go.contains(top) ? null : (top.id || top.className || top.tagName);
  });
  assert.equal(covered, null, 'Continue is covered by ' + covered);
  await page.tap('#langGo');
  await until(page, () => document.getElementById('langScreen').classList.contains('hidden'),
    { what: 'the tap to close the language screen' });
  // A first visit offers the download next; "Not now" is a tap too.
  await until(page, () => !document.getElementById('syncScreen').classList.contains('hidden'),
    { what: 'the download screen' });
  const way = await until(page, () => ['syncGo', 'syncSkip'].find((id) => {
    const b = document.getElementById(id);
    return b && b.offsetParent && !b.disabled && !b.classList.contains('hidden');
  }), { what: 'a way past the download screen' });
  await page.tap('#' + way);
  await until(page, () => document.getElementById('syncScreen').classList.contains('hidden'),
    { what: 'the tap to close the download screen' });
  const grid = await until(page, () => {
    const card = document.querySelector('#exhibitGrid > *');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return card.contains(top) ? 'ok' : 'covered by ' + (top.id || top.className || top.tagName);
  }, { what: 'an exhibit card' });
  assert.equal(grid, 'ok');
  await page.close();
});

test('the default anchor stands the queen on her base, centred, at life size', async () => {
  const page = await viewer();
  const s = await placeQueen(page);
  assert.equal(s.engine, 'gyro');
  near(s.figure.min.y, 0, 0.005, 'lowest point');
  near(s.figure.max.y - s.figure.min.y, TALL, 0.01, 'height');
  near((s.figure.min.x + s.figure.max.x) / 2, 0, 0.005, 'centre x');
  near((s.figure.min.z + s.figure.max.z) / 2, 0, 0.005, 'centre z');
  const text = await appLog(page);
  assert.match(text, /anchor at the base centre/);
  await page.close();
});

test('an anchor at her middle puts her middle on the spot', async () => {
  const page = await viewer({ anchor: { x: 0, y: 0.5, z: 0 } });
  const s = await placeQueen(page);
  near(s.figure.min.y, -TALL / 2, 0.01, 'lowest point, half below the floor');
  near(s.figure.max.y, TALL / 2, 0.01, 'highest point');
  await page.close();
});

test('...and lifted by half her height she stands on the floor again', async () => {
  const page = await viewer({ anchor: { x: 0, y: 0.5, z: 0 }, offset: { x: 0, y: TALL / 2, z: 0 } });
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
  near(pinched.figure.max.y - pinched.figure.min.y, TALL, 0.01, 'her height in her own frame');

  const chip = await page.evaluate(() => !document.getElementById('realSizeChip').classList.contains('hidden'));
  assert.ok(chip, 'the Real size chip should show once she is resized');
  await page.evaluate(() => document.getElementById('realSizeChip').click());
  const reset = await page.evaluate(() => window.ARViewer.inspect());
  assert.equal(reset.visitorScale, 1);
  await page.close();
});

/** What is on screen: which view, whether the camera is open, and in which mode. */
const where = (page) => page.evaluate(() => ({
  view: [...document.querySelectorAll('.view.on')].map((v) => v.id).join(),
  inAR: window.ARViewer.inAR(),
  mode: window.ARViewer.inspect().mode,
}));
const back = async (page) => { await page.goBack({ timeout: 3000 }).catch(() => {}); await sleep(600); };

test('the phone’s Back button walks back through the guide, and out of the camera one layer at a time', async () => {
  const page = await viewer();
  await page.tap('#exhibitGrid > *:nth-child(5)');
  await until(page, () => document.getElementById('viewExhibit').classList.contains('on'), { what: 'her page' });
  await back(page);
  assert.deepEqual(await where(page), { view: 'viewExplore', inAR: false, mode: 'boot' }, 'Back from a painting is Explore, not off the site');

  await page.tap('#exhibitGrid > *:nth-child(5)');
  await until(page, () => document.getElementById('viewExhibit').classList.contains('on'), { what: 'her page again' });
  await page.tap('#exhibitAr');
  await until(page, (i) => { const s = window.ARViewer.inspect(); return s.mode === 'scan' && s.activeIndex === i && s.mediaReady; },
    { arg: QUEEN, timeout: 60000, what: 'the queen found' });
  await page.evaluate(() => document.getElementById('arBtn').click());
  await until(page, () => window.ARViewer.inspect().mode === 'floor', { what: 'the floor scene' });
  await back(page);
  assert.deepEqual(await where(page), { view: 'viewExhibit', inAR: true, mode: 'scan' }, 'first Back leaves the floor, not the camera');
  await back(page);
  assert.deepEqual(await where(page), { view: 'viewExhibit', inAR: false, mode: 'boot' }, 'second Back closes the camera, onto her page');
  await back(page);
  assert.equal((await where(page)).view, 'viewExplore');
  assert.match(page.url(), /source=bundle/, 'still in the guide');
  await page.close();
});

// The rule: no message ever sits on a button.
const coveredButtons = (page) => page.evaluate(() => {
  const out = [];
  document.querySelectorAll('button').forEach((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || b.closest('.hidden')) return;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
    const top = document.elementFromPoint(x, y);
    if (top && !b.contains(top) && top.closest('#shellToast, #errorBanner, #gestureHint, #brandBar, #realSizeChip')) {
      out.push((b.id || b.textContent.trim()) + ' under ' + (top.closest('[id]') || top).id);
    }
  });
  return out;
});

test('a message never covers View in AR, and an error never covers the camera’s close button', async () => {
  const page = await viewer();
  await page.tap('#exhibitGrid > *:nth-child(5)');
  await until(page, () => document.getElementById('viewExhibit').classList.contains('on'), { what: 'her page' });
  await page.evaluate(() => { const t = document.getElementById('shellToast'); t.textContent = 'The camera is not available on this device yet'; t.classList.remove('hidden'); });
  await sleep(500);
  assert.deepEqual(await coveredButtons(page), []);
  await page.evaluate(() => document.getElementById('shellToast').classList.add('hidden'));

  await placeQueen(page);
  await page.evaluate(() => {
    document.getElementById('errorText').textContent = 'The video file could not be loaded. Check the log for details.';
    document.getElementById('errorBanner').classList.remove('hidden');
  });
  await sleep(300);
  assert.deepEqual(await coveredButtons(page), [], 'nothing floating covers a button with the figure placed and an error up');
  await page.close();
});

test('the photo carries the three logos along the bottom, on a light plate', async () => {
  const page = await viewer();
  await placeQueen(page);
  const onScreen = await until(page, () => {
    const imgs = [...document.querySelectorAll('#brandBar img')];
    return imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0) && imgs.map((i) => i.alt);
  }, { what: 'the logo preview' });
  assert.deepEqual(onScreen, ['IBN', 'SLIIT Creative Computing', 'National Museum Colombo']);

  await page.evaluate(() => document.getElementById('shotBtn').click());
  await until(page, () => (document.getElementById('photoPreview').src || '').startsWith('blob:'), { timeout: 20000, what: 'the photo' });
  const plate = await page.evaluate(async () => {
    const img = document.getElementById('photoPreview');
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    // The share of near-white pixels in the bottom tenth vs the top tenth.
    const light = (y0, y1) => {
      const d = g.getImageData(0, y0, c.width, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 232 && d[i + 2] > 225) n++;
      return n / (d.length / 4);
    };
    return { bottom: light(Math.floor(c.height * 0.88), c.height), top: light(0, Math.floor(c.height * 0.12)) };
  });
  assert.ok(plate.bottom > 0.15, 'a light plate along the bottom of the photo (' + plate.bottom.toFixed(2) + ' light)');
  assert.ok(plate.top < 0.05, 'and nothing at the top (' + plate.top.toFixed(2) + ' light)');
  await page.close();
});

test('no errors in the log on the way through', async () => {
  const page = await viewer();
  await placeQueen(page);
  const errors = page.logs.filter((l) => /^(error|pageerror)/.test(l) && !/favicon/.test(l));
  assert.deepEqual(errors, []);
  await page.close();
});
