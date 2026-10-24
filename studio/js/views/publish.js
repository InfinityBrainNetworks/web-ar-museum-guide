/**
 * Publish: from the draft to what visitors see, in three deliberate steps.
 *
 *   1. Check    every exhibit complete, and a tracker compiled for exactly
 *               these photos in exactly this order (or compile one now).
 *   2. Build    a release: a frozen manifest in Storage. Visitors do not see
 *               it yet - open it on a phone first, from the QR code.
 *   3. Go live  one document changes (public/live) and every phone that opens
 *               the guide from then on gets it. Any older release can be put
 *               back the same way, in a second.
 */
import { h, clear, icon, toast, explain, bytes, when, busy, dialog, confirm, copy } from '../ui.js';
import { languagesOf, missing, buildManifest, weigh } from '../manifest.js';
import { compileTargets, GOOD_POINTS } from '../compile.js';
import { qrImage } from '../qr.js';

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('Publish', 'From the draft to every visitor’s phone');

  let site = await data.getSite();
  let tracker = await data.getTracker();
  let exhibits = [];
  let releases = [];
  let live = null;
  const languages = languagesOf(site);

  const checks = h('div.card');
  const build = h('div.card');
  const history = h('div.card');
  ctx.page.append(checks, build, history);

  const state = () => {
    const signature = data.trackerSignature(exhibits);
    const incomplete = exhibits.map((ex) => ({ ex, need: missing(ex, languages) })).filter((x) => x.need.length);
    const trackerOk = !!tracker && tracker.signature === signature && !!tracker.url;
    const weak = exhibits.filter((ex) => ex.image && typeof ex.image.featurePoints === 'number' && ex.image.featurePoints < GOOD_POINTS);
    return { signature, incomplete, trackerOk, weak, ready: exhibits.length > 0 && !incomplete.length && trackerOk };
  };

  const drawChecks = () => {
    const s = state();
    clear(checks);
    const list = h('div.checks');
    const item = (kind, title, detail, action) => list.appendChild(h('div.check.' + kind,
      icon(kind === 'ok' ? 'check' : 'warn'), h('div.grow', h('strong', title), detail ? h('div.muted', detail) : null), action || null));

    item(exhibits.length ? 'ok' : 'bad', exhibits.length ? `${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'}` : 'No exhibits yet',
      exhibits.length ? null : 'Add some under Exhibits first.');
    if (s.incomplete.length) {
      item('bad', `${s.incomplete.length} not ready`, h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } },
        s.incomplete.map(({ ex, need }) => h('li', h('a', { href: '#/exhibit/' + ex.id }, ex.name), ' needs ' + need.join(', ')))));
    } else if (exhibits.length) {
      item('ok', 'Every exhibit has its photo, projection and label');
    }
    const compileBtn = h('button.btn.primary.sm', { type: 'button', disabled: !exhibits.length || s.incomplete.some((x) => !x.ex.image || !x.ex.image.url),
      onclick: () => compile() }, s.trackerOk ? 'Recompile' : 'Compile now');
    item(s.trackerOk ? 'ok' : 'warn', s.trackerOk ? 'The tracker matches these exhibits' : 'The tracker needs compiling',
      s.trackerOk
        ? `${bytes(tracker.size)}, compiled ${when(tracker.at)}${tracker.imported ? ' (imported with the gallery)' : ''}.`
        : 'A photo or the order changed since it was built. It runs in this browser and takes a minute or so per few targets.',
      compileBtn);
    if (s.weak.length) item('warn', `${s.weak.length} target${s.weak.length === 1 ? '' : 's'} may track poorly`,
      s.weak.map((ex) => `${ex.name} (${ex.image.featurePoints} points)`).join(', '));

    const w = weigh(exhibits, tracker, languages);
    const max = Math.max(1, ...w.rows.map((r) => r.total), w.tracker);
    const weights = h('div.weights',
      w.rows.map((r) => [h('span', r.name), h('span.mono', bytes(r.total)), h('div.bar', h('div', { style: { width: (100 * r.total / max) + '%' } }))]),
      tracker ? [h('span', 'Artwork recognition (tracker)'), h('span.mono', bytes(w.tracker)), h('div.bar', h('div', { style: { width: (100 * w.tracker / max) + '%' } }))] : null,
      h('strong', 'The whole gallery'), h('strong.mono', bytes(w.total)));

    checks.append(
      h('div.card-head', icon('check'), h('div.grow', h('h2', '1 · Check'), h('p', 'What visitors would get, and whether it is ready.'))),
      h('div.card-body', list,
        exhibits.length ? h('details', h('summary.muted', 'What a visitor downloads — ' + bytes(w.total) + ' for the whole gallery'), h('div', { style: { marginTop: '12px' } }, weights)) : null));
    drawBuild();
  };

  const drawBuild = () => {
    const s = state();
    clear(build);
    const notes = h('input', { type: 'text', placeholder: 'What changed — e.g. "Tamil labels for the apsaras"', maxLength: 300 });
    const go = h('button.btn.primary', { type: 'button', disabled: !s.ready, onclick: () => makeRelease(notes.value.trim()) },
      icon('publish'), 'Build a release');
    build.append(
      h('div.card-head', icon('publish'), h('div.grow', h('h2', '2 · Build a release'),
        h('p', 'A frozen copy of the gallery. Nobody sees it until you put it live — open it on a phone first.'))),
      h('div.card-body', h('div.row', h('div.grow', notes), go),
        !s.ready ? h('p.faint', 'Finish the checks above first.') : null));
  };

  const drawHistory = () => {
    clear(history);
    history.appendChild(h('div.card-head', icon('undo'), h('div.grow', h('h2', '3 · Releases'),
      h('p', 'The live one is what visitors get. Put any earlier one back in a second.'))));
    if (!releases.length) { history.appendChild(h('div.empty', h('p', 'No releases yet.'))); return; }
    releases.forEach((r) => {
      const isLive = live && live.release === r.id;
      history.appendChild(h('div.release' + (isLive ? '.live' : ''),
        h('div.stack', { style: { gap: '4px' } },
          h('div.row', h('span.release-id.mono', r.id), isLive ? h('span.chip.live', 'LIVE') : null,
            r.liveAt && !isLive ? h('span.chip', 'was live') : null),
          h('div', r.notes || h('span.faint', 'No notes')),
          h('div.release-meta', `${r.exhibits || '?'} exhibits · ${bytes(r.bytes)} · built ${when(r.createdAt)} by ${r.createdBy || '?'}` +
            (isLive && live.by ? ` · live since ${when(live.at)} (${live.by})` : ''))),
        h('div.row',
          h('button.btn.sm', { type: 'button', onclick: () => preview(r) }, icon('qr'), 'Preview'),
          ctx.can('admin') && !isLive ? h('button.btn.sm.primary', { type: 'button', onclick: () => goLive(r) },
            live && releases.findIndex((x) => x.id === live.release) < releases.indexOf(r) ? 'Roll back to this' : 'Go live') : null,
          ctx.can('admin') && !isLive ? h('button.icon-btn', { type: 'button', title: 'Delete this release', onclick: () => removeRelease(r) }, icon('trash')) : null)));
    });
    if (!ctx.can('admin')) history.appendChild(h('div.card-body', h('p.faint', 'Only an admin can put a release live.')));
  };

  // ---- actions
  async function compile() {
    const job = busy('Compiling the tracker', 'Starting…');
    window.__studioDirty = true;
    try {
      const result = await compileTargets(exhibits, (f, text) => job.set(f, text));
      job.set(0.99, 'Uploading…');
      const file = new File([result.blob], 'targets.mind', { type: 'application/octet-stream' });
      const got = await data.upload('tracker', 'targets', file);
      const points = {};
      result.points.forEach((p) => { points[p.id] = p.featurePoints; });
      await data.saveTracker({ signature: data.trackerSignature(exhibits), path: got.path, url: got.url, size: got.size, count: exhibits.length, points });
      await Promise.all(result.points.map((p) => data.saveExhibit(p.id, {
        'image.featurePoints': p.featurePoints, 'image.keyframes': p.keyframes,
      })));
      tracker = await data.getTracker();
      toast(`Tracker compiled: ${bytes(got.size)} for ${exhibits.length} targets.`, 'ok');
    } catch (err) {
      console.error(err);
      toast('Compile failed: ' + explain(err), 'err', 8000);
    } finally {
      window.__studioDirty = false;
      job.done();
      drawChecks();
    }
  }

  async function makeRelease(notes) {
    const s = state();
    if (!s.ready) return;
    const job = busy('Building the release', 'Freezing the gallery…');
    try {
      site = await data.getSite();
      const id = data.releaseId();
      const manifest = buildManifest({ id, notes, exhibits, site, tracker });
      const w = weigh(exhibits, tracker, languagesOf(site));
      job.set(0.5, 'Uploading the manifest…');
      const url = await data.createRelease(id, manifest, {
        notes, exhibits: exhibits.length, bytes: w.total, trackerSignature: tracker.signature,
        languages: manifest.languages.map((l) => l.code),
      });
      job.done();
      toast('Release built. Preview it on a phone, then put it live.', 'ok');
      preview({ id, manifest: url, notes, exhibits: exhibits.length, bytes: w.total, fresh: true });
    } catch (err) {
      job.done();
      toast(explain(err), 'err', 8000);
    }
  }

  async function preview(r) {
    const url = window.AR_CLOUD.appUrl + '?release=' + encodeURIComponent(r.id) + (window.AR_CLOUD.emulators ? '&emu=1' : '');
    const qr = h('div.qr', h('div.spinner'));
    qrImage(url).then((img) => qr.replaceChildren(img)).catch(() => qr.replaceChildren(h('p', 'QR unavailable offline')));
    const isLive = live && live.release === r.id;
    const choice = await dialog({
      title: r.fresh ? 'Release built — try it on a phone' : 'Preview ' + r.id,
      build: (body) => body.append(
        h('p', 'Scan with a phone to open the guide with exactly this release — visitors still get the live one until you say otherwise.'),
        qr,
        h('div.row', h('code.mono.grow', { style: { wordBreak: 'break-all' } }, url),
          h('button.btn.sm', { type: 'button', onclick: () => copy(url) }, 'Copy'),
          h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open'))),
      buttons: [{ label: 'Close', value: null },
        ...(ctx.can('admin') && !isLive ? [{ label: 'Go live now', kind: 'primary', value: 'live' }] : [])],
    });
    if (choice === 'live') goLive(r);
  }

  async function goLive(r) {
    const ok = await confirm('Put this release live?', `Every visitor who opens the guide from now on gets ${r.id}` +
      (r.notes ? ` — “${r.notes}”` : '') + '. Phones that already have the gallery fetch only what changed.', { ok: 'Go live' });
    if (!ok) return;
    try {
      const full = releases.find((x) => x.id === r.id) || r;
      await data.goLive({ id: r.id, manifest: full.manifest || r.manifest });
      toast('Live. Visitors get it on their next visit.', 'ok', 6000);
    } catch (err) { toast(explain(err), 'err'); }
  }

  async function removeRelease(r) {
    if (!(await confirm('Delete this release?', 'Its record goes; the files stay, in case another release uses them.', { ok: 'Delete', danger: true }))) return;
    try { await data.deleteRelease(r.id); } catch (err) { toast(explain(err), 'err'); }
  }

  // ---- live data
  const stops = [
    data.watchExhibits((list) => { exhibits = list; drawChecks(); }, (err) => toast(explain(err), 'err')),
    data.watchReleases((list) => { releases = list; drawHistory(); }, (err) => toast(explain(err), 'err')),
    data.watchLive((doc) => { live = doc; drawHistory(); }, () => {}),
  ];
  drawChecks();
  drawHistory();
  return () => stops.forEach((stop) => stop());
}
