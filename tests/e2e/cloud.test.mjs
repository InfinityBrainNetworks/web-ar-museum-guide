/**
 * The cloud workflow, end to end, against the Firebase emulators:
 *
 *   the Studio is claimed, the deployed gallery imported, a second admin
 *   added who adds a moderator in turn; the queen's anchor is moved and
 *   locked in the floor editor; a release is built and put live; the guide
 *   loads it and stands the queen on that anchor; a visitor shares an AR
 *   photo with consent, a moderator approves it, and it appears on the wall;
 *   a visitor leaves feedback, and it lands in the inbox.
 *
 *   cd tests/e2e && npm run test:cloud
 *
 * which wraps this file in `firebase emulators:exec` (Java 21 needed). The
 * `demo-` project keeps the emulators offline and needs no Google account.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, serve, launch, until, cameraOf, floorPlan, sleep } from './lib.mjs';

const PROJECT = 'demo-museum';
const QUEEN = 'sigiriya-ex08';
let site, browser;

async function resetEmulators() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

before(async () => {
  await resetEmulators();
  site = await serve(8150);
  browser = await launch({ camera: cameraOf(ROOT + 'assets/content/ex08-the-queen-of-kasyapa-target.jpg') });
});
after(async () => {
  if (browser) await browser.close();
  if (site) await site.close();
});

/**
 * The Studio, signed in as `email` through the emulator's own sign-in - in a
 * browser context of its own, like a separate machine, so nobody is already
 * signed in. Closing the page closes the context.
 */
async function studio(email, hash = '') {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const close = page.close.bind(page);
  page.close = async () => { await close(); await context.close(); };
  await page.setViewport({ width: 1400, height: 900 });
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
  await page.goto(site.url + 'studio/?emu=1' + hash);
  await until(page, () => document.getElementById('emuSignIn'), { timeout: 30000, what: 'the sign-in screen' });
  await page.evaluate((address) => {
    document.querySelector('.gate-card input[type=email]').value = address;
    document.getElementById('emuSignIn').click();
  }, email);
  return page;
}

/** SHOTS=<folder> saves a screenshot at the moments worth looking at. */
async function shot(page, name) {
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/' + name + '.png' });
}

/** Click the button saying exactly `text` (or, failing that, containing it) - in the newest dialog if several are open. */
const click = (page, text, scope = 'button') => page.evaluate((t, s) => {
  const all = Array.from(document.querySelectorAll(s)).filter((n) => !n.closest('.backdrop.out'));
  const b = all.reverse().find((n) => n.textContent.trim() === t) || all.find((n) => n.textContent.includes(t));
  if (!b) throw new Error('no ' + s + ' saying ' + t);
  b.click();
}, text, scope);

async function viewer(hash = '') {
  const page = await browser.newPage();
  page.logs = [];
  page.on('console', (m) => page.logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => page.logs.push('pageerror: ' + e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ar-museum-language', 'en');
    sessionStorage.setItem('ar-museum-splash', '1');
    localStorage.setItem('ar-museum-offline', 'later');   // this test is not about the download
  });
  await page.goto(site.url + '?emu=1' + hash);
  await until(page, () => window.ARViewer && window.ARViewer.ready(), { timeout: 30000, what: 'the guide' });
  return page;
}

test('the first account claims the Studio and imports the deployed gallery', async () => {
  const page = await studio('owner@gmail.com');
  await until(page, () => /Claim this Studio/.test(document.body.innerText), { what: 'the claim offer' });
  await click(page, 'Claim this Studio');
  await until(page, () => /Import the 9 deployed exhibits/.test(document.body.innerText), { timeout: 20000, what: 'the empty gallery' });
  await click(page, 'Import the 9 deployed exhibits');
  await until(page, () => Array.from(document.querySelectorAll('.dialog-foot button')).some((b) => b.textContent === 'Import'));
  await click(page, 'Import', '.dialog-foot button');
  await until(page, () => document.querySelectorAll('.ex-row').length === 9 && !document.querySelector('.busy'),
    { timeout: 180000, what: 'nine exhibits' });
  const banner = await page.evaluate(() => document.querySelector('.banner') ? document.querySelector('.banner').textContent : '');
  assert.equal(banner, '', 'the imported tracker should match the imported order');
  await page.close();
});

test('an admin can make another admin, who can then add people too', async () => {
  const owner = await studio('owner@gmail.com', '#/people');
  await until(owner, () => /The team/.test(document.body.innerText), { what: 'the people screen' });
  await click(owner, 'Add a person');
  await until(owner, () => document.querySelector('.dialog [name=email]'));
  await owner.evaluate(() => {
    document.querySelector('.dialog [name=email]').value = 'Curator.Two@gmail.com';
    document.querySelector('.dialog [name=role][value=admin]').click();
  });
  await click(owner, 'Add', '.dialog-foot button');
  // The toast, not the list: Firestore lists a pending write at once, and
  // only the toast waits for the server to have it.
  await until(owner, () => /curator\.two@gmail\.com added as admin/.test(document.body.innerText), { what: 'the new admin saved' });
  await owner.close();

  // The second admin, on another machine.
  const second = await studio('curator.two@gmail.com', '#/people');
  await until(second, () => /The team/.test(document.body.innerText), { timeout: 20000, what: 'the second admin in' })
    .catch(async (err) => {
      await second.screenshot({ path: process.env.TEMP + '/second-admin.png' });
      console.log(await second.evaluate(() => document.body.innerText.slice(0, 600)), second.logs.slice(-15).join('\n'));
      throw err;
    });
  await click(second, 'Add a person');
  await until(second, () => document.querySelector('.dialog [name=email]'));
  await second.evaluate(() => {
    document.querySelector('.dialog [name=email]').value = 'frontdesk@gmail.com';
    document.querySelector('.dialog [name=role][value=moderator]').click();
  });
  await click(second, 'Add', '.dialog-foot button');
  await until(second, () => /frontdesk@gmail\.com added as moderator/.test(document.body.innerText), { what: 'the moderator added by the second admin' });
  // ...but an admin cannot touch the owner: no role menu, no remove button on that row.
  const ownerRow = await second.evaluate(() => {
    const row = Array.from(document.querySelectorAll('tr')).find((r) => /owner@gmail\.com/.test(r.textContent));
    return { select: !!row.querySelector('select'), remove: !!row.querySelector('button') };
  });
  assert.deepEqual(ownerRow, { select: false, remove: false });
  await second.close();
});

test('the floor editor moves the anchor without moving the figure, and locks it', async () => {
  const page = await studio('owner@gmail.com', '#/floor/' + QUEEN);
  await until(page, () => !!(window.__stage && window.__stage.holder), { timeout: 60000, what: 'the queen in the floor editor' });
  await page.evaluate(() => document.querySelector('[data-preset=centre]').click());
  const s = await page.evaluate(() => window.__stage.getState());
  assert.deepEqual(s.anchor, { x: 0, y: 0.5, z: 0 });
  assert.ok(Math.abs(s.offset.y - 0.8) < 0.001, 'the offset is solved so she stays put: ' + s.offset.y);
  const box = await page.evaluate(() => { const b = window.__stage.posedBox(); return { min: b.min.y, max: b.max.y }; });
  assert.ok(Math.abs(box.min) < 0.05, 'still standing on the floor, lowest point ' + box.min);

  await page.keyboard.press('l');            // lock it, Blender-style
  const locked = await page.evaluate(() => document.querySelector('[data-preset=base]').disabled);
  assert.equal(locked, true, 'presets are disabled once the anchor is locked');
  await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
  await until(page, () => /Saved/.test(document.querySelector('.save-state').textContent) &&
    !/Unsaved/.test(document.querySelector('.save-state').textContent), { what: 'the save' });
  await page.close();
});

test('a release is built and put live, and the guide reads it from the cloud', async () => {
  const page = await studio('owner@gmail.com', '#/publish');
  await until(page, () => /tracker matches/.test(document.body.innerText), { timeout: 30000, what: 'the checks' });
  await page.evaluate(() => { document.querySelector('.card input[type=text]').value = 'The queen on her anchor'; });
  await click(page, 'Build a release');
  await until(page, () => document.querySelector('.qr img'), { timeout: 30000, what: 'the preview QR' });
  await click(page, 'Go live now', '.dialog-foot button');
  await until(page, () => Array.from(document.querySelectorAll('.dialog-foot button')).some((b) => b.textContent === 'Go live'));
  await click(page, 'Go live', '.dialog-foot button');
  await until(page, () => document.querySelector('.chip.live'), { timeout: 20000, what: 'LIVE' });
  await page.close();

  const guide = await viewer();
  const b = await guide.evaluate(() => {
    const bundle = window.ARViewer.bundle();
    const q = bundle.exhibits.find((e) => e.id === 'sigiriya-ex08');
    return { source: bundle.source, n: bundle.exhibits.length, anchor: q.model.anchor, offset: q.model.offset };
  });
  assert.equal(b.source, 'cloud');
  assert.equal(b.n, 9);
  assert.deepEqual(b.anchor, { x: 0, y: 0.5, z: 0 });
  assert.ok(Math.abs(b.offset.y - 0.8) < 0.001);
  await guide.close();
});

test('on the phone she stands where the Studio put her, then a photo goes to the wall', async () => {
  // Switch the photobooth on, as an admin would in Settings.
  const admin = await studio('owner@gmail.com', '#/photos');
  await until(admin, () => /Visitors can share to the wall/.test(document.body.innerText), { what: 'the photobooth screen' });
  await admin.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.toggle')).find((n) => /Visitors can share/.test(n.textContent));
    t.querySelector('input').click();
  });
  await until(admin, () => /Visitors can share photos from the AR guide/.test(document.body.innerText), { what: 'photobooth on' });

  const guide = await viewer();
  await guide.evaluate(() => window.ARViewer.startAR());
  await until(guide, () => { const s = window.ARViewer.inspect(); return s.mode === 'scan' && s.activeIndex === 4 && s.mediaReady; },
    { timeout: 60000, what: 'the queen found' });
  await guide.evaluate(() => document.getElementById('arBtn').click());
  await guide.evaluate(() => { window.__tilt = setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: 50, gamma: 0 })), 40); });
  await until(guide, () => window.ARViewer.inspect().floorStable, { timeout: 20000, what: 'the floor' });
  await guide.evaluate(() => document.getElementById('placeBtn').click());
  const placed = await until(guide, () => { const s = window.ARViewer.inspect(); return s.figure && s.figure.loaded && s; }, { timeout: 30000, what: 'her model' });
  assert.deepEqual(placed.anchor, { x: 0, y: 0.5, z: 0 });
  assert.ok(Math.abs(placed.figure.min.y) < 0.01, 'anchored at her middle and lifted 0.8 m: feet on the floor, got ' + placed.figure.min.y);

  // The photo, and the two steps to the wall.
  await guide.evaluate(() => document.getElementById('shotBtn').click());
  await until(guide, () => !document.getElementById('photoSheet').classList.contains('hidden'), { timeout: 20000, what: 'the photo' });
  await until(guide, () => !document.getElementById('photoShare').classList.contains('hidden'), { timeout: 10000, what: 'the share offer' });
  await guide.evaluate(() => document.getElementById('photoShare').click());
  const blocked = await guide.evaluate(() => document.getElementById('photoSend').disabled);
  assert.equal(blocked, true, 'nothing can be sent before consent is given');
  await guide.evaluate(() => {
    document.getElementById('photoAgree').click();
    document.getElementById('photoName').value = 'Asha';
    document.getElementById('photoSend').click();
  });
  await until(guide, () => !document.getElementById('photoShared').classList.contains('hidden'), { timeout: 30000, what: 'shared' });
  const said = await guide.evaluate(() => document.getElementById('photoSharedText').textContent);
  assert.match(said, /once the museum staff have seen it/);

  // The moderator's yes.
  await until(admin, () => document.querySelectorAll('.photo').length === 1, { timeout: 20000, what: 'the photo waiting' });
  await click(admin, 'Approve');
  await until(admin, () => document.querySelectorAll('.photo').length === 0, { what: 'it leaves the queue' });

  const wall = await browser.newPage();
  await wall.setViewport({ width: 1600, height: 900 });
  await wall.goto(site.url + 'photobooth/?emu=1');
  await until(wall, () => document.querySelectorAll('.tile').length === 1 && document.querySelector('.hero-slide'),
    { timeout: 30000, what: 'the photo on the wall' });
  const cap = await wall.evaluate(() => document.querySelector('.tile span').textContent);
  assert.match(cap, /^Asha · /);
  await wall.close();
  await admin.close();
  await guide.close();
});

test('the floor plan and its pins reach the guide’s Map tab, with found ones marked', async () => {
  const page = await studio('owner@gmail.com', '#/map');
  await until(page, () => /Upload the gallery/.test(document.body.innerText), { what: 'the empty map' });
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.map-edit .drop')]);
  await chooser.accept([floorPlan()]);
  await until(page, () => { const i = document.querySelector('.map-plan img'); return i && i.complete && i.naturalWidth > 0; },
    { timeout: 30000, what: 'the plan uploaded' });

  // Three pins: the first three exhibits, each auto-selected in turn.
  for (const [fx, fy] of [[0.2, 0.3], [0.3, 0.6], [0.7, 0.4]]) {
    const box = await page.evaluate(() => { const r = document.querySelector('.map-plan img').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const before = await page.evaluate(() => document.querySelectorAll('.map-plan .map-pin').length);
    await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
    await until(page, (n) => document.querySelectorAll('.map-plan .map-pin').length === n + 1, { arg: before, what: 'a pin dropped' });
  }
  // The queen too - she has been found on this phone already.
  await page.evaluate(() => Array.from(document.querySelectorAll('.map-row')).find((r) => /Queen of Kasyapa/.test(r.textContent)).click());
  const box = await page.evaluate(() => { const r = document.querySelector('.map-plan img').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.8, box.y + box.h * 0.7);
  await until(page, () => document.querySelectorAll('.map-plan .map-pin').length === 4, { what: 'the queen pinned' });
  await shot(page, 'studio-map');
  await page.close();

  // A new release carries it.
  const pub = await studio('owner@gmail.com', '#/publish');
  await until(pub, () => /tracker matches/.test(document.body.innerText), { timeout: 30000, what: 'the checks' });
  await pub.evaluate(() => { document.querySelector('.card input[type=text]').value = 'The map'; });
  await click(pub, 'Build a release');
  await until(pub, () => document.querySelector('.qr img'), { timeout: 30000, what: 'the release' });
  await click(pub, 'Go live now', '.dialog-foot button');
  await until(pub, () => Array.from(document.querySelectorAll('.dialog-foot button')).some((b) => b.textContent === 'Go live'));
  await click(pub, 'Go live', '.dialog-foot button');
  await until(pub, () => /The map/.test((document.querySelector('.release.live') || {}).textContent || ''), { timeout: 20000, what: 'the map release live' });
  await pub.close();

  const guide = await viewer();
  await until(guide, () => !document.querySelector('[data-nav=map]').classList.contains('dimmed'), { what: 'the Map tab' });
  await guide.evaluate(() => document.querySelector('[data-nav=map]').click());
  await until(guide, () => { const i = document.getElementById('mapImage'); return i.complete && i.naturalWidth > 0; }, { what: 'the plan in the guide' });
  const pins = await guide.evaluate(() => Array.from(document.querySelectorAll('#mapPins .map-pin')).map((p) => ({ n: p.textContent, found: p.classList.contains('found') })));
  assert.equal(pins.length, 4);
  assert.deepEqual(pins.filter((p) => p.found).map((p) => p.n), ['5'], 'the queen (exhibit 5) is marked found');
  await guide.evaluate(() => Array.from(document.querySelectorAll('#mapPins .map-pin')).find((p) => p.textContent === '5').click());
  const card = await until(guide, () => !document.getElementById('mapCard').classList.contains('hidden') && document.getElementById('mapCardTitle').textContent);
  assert.match(card, /Queen of Kasyapa/);
  if (process.env.SHOTS) {
    await until(guide, () => document.getElementById('syncScreen').classList.contains('hidden'), { timeout: 20000 }).catch(() => {});
    await shot(guide, 'guide-map');
  }
  await guide.evaluate(() => document.getElementById('mapCardGo').click());
  await until(guide, () => document.getElementById('viewExhibit').classList.contains('on'), { what: 'her label page' });
  await guide.close();
});

test('a visitor leaves feedback, and it reaches the inbox', async () => {
  const guide = await viewer();
  await until(guide, () => !document.querySelector('[data-nav=feedback]').classList.contains('dimmed'), { what: 'feedback on' });
  await guide.evaluate(() => document.querySelector('[data-nav=feedback]').click());
  await until(guide, () => document.querySelectorAll('.fb-star').length === 5, { what: 'the stars' });
  await guide.evaluate(() => {
    document.querySelectorAll('.fb-star')[3].click();
    document.getElementById('fbMessage').value = 'The dancing queen was wonderful';
    document.getElementById('fbSend').click();
  });
  await until(guide, () => !document.getElementById('fbThanks').classList.contains('hidden'), { timeout: 20000, what: 'thanks' })
    .catch((err) => { console.log(guide.logs.slice(-30).join('\n')); throw err; });
  await guide.close();

  const inbox = await studio('frontdesk@gmail.com', '#/feedback');
  await until(inbox, () => /The dancing queen was wonderful/.test(document.body.innerText), { timeout: 20000, what: 'the message, read by the moderator' });
  const nav = await inbox.evaluate(() => Array.from(document.querySelectorAll('.nav-item')).map((n) => n.textContent.replace(/\d+$/, '').trim()));
  assert.ok(!nav.includes('Exhibits') && !nav.includes('People'), 'a moderator sees only the photobooth and the feedback: ' + nav.join(', '));
  await inbox.close();
});
