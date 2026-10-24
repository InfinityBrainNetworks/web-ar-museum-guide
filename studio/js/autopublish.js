/**
 * Publish on save: an admin's edit goes live a few seconds after it is saved,
 * as a release of its own - so a small adjustment reaches visitors without the
 * three steps on the Publish page.
 *
 * Saves that come close together (a figure nudged five times, a label typed
 * in pieces) wait for each other and make one release. Nothing goes live that
 * Publish would refuse: every exhibit complete, and a tracker compiled for
 * exactly these photos in this order. Changing a target photo or the order
 * still needs Publish, because the tracker has to be recompiled first.
 *
 * Releases stay immutable and listed, so an automatic one can be rolled back
 * like any other. Settings has the switch (config/site.autoPublish, on unless
 * set false). Used by the Studio and, through a dynamic import, by Adjust on
 * a staff phone - the same module instance of js/cloud/sdk.js either way.
 */
import * as data from './data.js';
import { languagesOf, missing, buildManifest, weigh } from './manifest.js';

const WAIT_MS = 3000;

let timer = null;
let running = Promise.resolve();
let waiting = [];
let notes = [];

export function enabled(site) { return !site || site.autoPublish !== false; }

/**
 * Publish soon, folding in any other saves that land in the next few seconds.
 * Resolves with what happened: { release } or { skipped, why }.
 */
export function schedule(what) {
  if (what && !notes.includes(what)) notes.push(what);
  clearTimeout(timer);
  timer = setTimeout(flush, WAIT_MS);
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

/**
 * After a save: publish, then tell the person how it went. `say(message,
 * kind)` is the page's own toast; kind is 'ok', 'info' or 'err'.
 */
export function afterSave(what, say) {
  return schedule(what).then((r) => {
    say(r.release ? 'Live: visitors get it the next time they open the guide.' : r.why, r.release ? 'ok' : 'info');
    return r;
  }, (err) => {
    say('Saved, but it could not go live: ' + ((err && err.message) || err), 'err');
    return { skipped: 'error', why: String((err && err.message) || err) };
  });
}

function flush() {
  const mine = waiting;
  const what = notes.join(', ');
  waiting = [];
  notes = [];
  // One at a time: two releases racing for public/live would be a coin toss.
  running = running.catch(() => {}).then(() => publishNow(what));
  running.then((r) => mine.forEach((w) => w.resolve(r)), (e) => mine.forEach((w) => w.reject(e)));
}

/** Build a release from the draft as it stands and put it live. */
export async function publishNow(what) {
  if (!['owner', 'admin'].includes(data.myRole())) {
    return { skipped: 'role', why: 'An admin puts it live, from Publish.' };
  }
  const [site, tracker, map, exhibits] = await Promise.all([
    data.getSite(), data.getTracker(), data.getMap(), data.listExhibits(),
  ]);
  if (!enabled(site)) return { skipped: 'off', why: 'It reaches visitors with the next release (Publish).' };
  const languages = languagesOf(site);
  const incomplete = exhibits.filter((ex) => missing(ex, languages).length);
  if (!exhibits.length || incomplete.length) {
    return { skipped: 'incomplete', why: 'Not live yet: ' +
      (incomplete.length ? incomplete.map((ex) => ex.name).join(', ') + ' still needs details (see Publish).' : 'there are no exhibits.') };
  }
  if (!tracker || !tracker.url || tracker.signature !== data.trackerSignature(exhibits)) {
    return { skipped: 'tracker', why: 'Not live yet: the photos or their order changed, so Publish has to recompile the tracker first.' };
  }
  const id = data.releaseId();
  const label = 'Auto: ' + (what || 'edits');
  const manifest = buildManifest({ id, notes: label, exhibits, site, tracker, map });
  const w = weigh(exhibits, tracker, languages);
  const url = await data.createRelease(id, manifest, {
    notes: label, auto: true, exhibits: exhibits.length, bytes: w.total,
    trackerSignature: tracker.signature, languages: manifest.languages.map((l) => l.code),
  });
  await data.goLive({ id, manifest: url });
  return { release: id };
}
