/**
 * Exhibits: the gallery in target order.
 *
 * Order is the one thing here that can quietly break the guide: exhibit N is
 * target N in the compiled tracker, so dragging a card changes which video
 * plays on which painting until the tracker is recompiled. The banner at the
 * top says so the moment the two disagree, and Publish refuses to go ahead.
 */
import { h, clear, icon, toast, explain, dialog, busy, bytes, confirm } from '../ui.js';
import { languagesOf, missing, coverage } from '../manifest.js';
import { importBundle, readBundle } from '../importer.js';

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('Exhibits', 'The gallery, in the order the tracker sees it');

  let languages = languagesOf(await data.getSite());
  let exhibits = [];
  let tracker = await data.getTracker();

  const banner = h('div');
  const list = h('div.ex-list');
  ctx.page.append(banner, list);

  ctx.setActions(
    h('button.btn.primary', { type: 'button', onclick: () => addExhibit(ctx, exhibits.length) }, icon('plus'), 'New exhibit'));

  const draw = () => {
    clear(banner);
    clear(list);
    if (!exhibits.length) {
      list.appendChild(emptyState(ctx));
      return;
    }
    const signature = data.trackerSignature(exhibits);
    if (!tracker) {
      banner.appendChild(h('div.banner.info', icon('warn'), h('div',
        h('strong', 'No tracker yet. '), 'Publishing compiles one from these photos, in this order.')));
    } else if (tracker.signature !== signature) {
      banner.appendChild(h('div.banner.warn', icon('warn'), h('div',
        h('strong', 'The tracker no longer matches these exhibits. '),
        'A photo or the order changed since it was compiled. Publish will recompile it first — until then the live guide keeps the old one.')));
    }
    exhibits.forEach((ex, i) => list.appendChild(row(ctx, ex, i, languages, () => exhibits)));
  };

  // The tracker and the languages can change under this list too - an import
  // writes all three at once - so every change re-reads them.
  const stop = data.watchExhibits(async (list) => {
    exhibits = list;
    try {
      const [site, t] = await Promise.all([data.getSite(), data.getTracker()]);
      languages = languagesOf(site);
      tracker = t;
    } catch { /* keep what we had */ }
    draw();
  }, (err) => toast(explain(err), 'err'));
  return stop;
}

function row(ctx, ex, i, languages, all) {
  const gaps = missing(ex, languages);
  const cover = coverage(ex, languages);
  const thumb = ex.image && (ex.image.thumbUrl || ex.image.url)
    ? h('img.ex-thumb', { src: ex.image.thumbUrl || ex.image.url, alt: '', loading: 'lazy' })
    : h('div.ex-thumb.none', icon('image'));

  const chips = [
    gaps.length ? h('span.chip.bad', icon('warn'), 'Needs ' + gaps.join(', '))
      : h('span.chip.ok', icon('check'), 'Ready'),
    ex.media && ex.media.url ? h('span.chip', icon(ex.media.kind === 'image' ? 'image' : 'video'),
      ex.media.kind === 'image' ? 'Picture' : 'Video') : null,
    h('span.chip' + (cover.written.length === languages.length ? '.ok' : ''), icon('globe'),
      cover.written.length + '/' + languages.length + ' languages'),
    cover.spoken.length ? h('span.chip', icon('audio'), cover.spoken.join(' · ').toUpperCase()) : null,
    ex.model && ex.model.url ? h('span.chip', icon('cube'), '3D · ' + (ex.model.heightMeters || 1) + ' m') : null,
    ex.image && typeof ex.image.featurePoints === 'number'
      ? h('span.chip' + (ex.image.featurePoints < 400 ? '.warn' : ''), ex.image.featurePoints + ' points') : null,
  ];

  const node = h('div.ex-row', { draggable: true, dataset: { id: ex.id } },
    h('div.ex-grip', { title: 'Drag to reorder' }, icon('grip')),
    h('div.ex-num', String(i + 1)),
    thumb,
    h('div.ex-main', h('strong', ex.name), h('div.ex-chips', chips)),
    h('div.ex-actions',
      ex.model && ex.model.url ? h('a.btn.sm', { href: '#/floor/' + ex.id, title: 'Floor editor' }, icon('floor'), h('span', 'Floor')) : null,
      h('a.btn.sm', { href: '#/exhibit/' + ex.id }, icon('edit'), h('span', 'Edit'))));

  // ---- drag to reorder
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', ex.id);
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => node.classList.remove('dragging'));
  node.addEventListener('dragover', (e) => {
    e.preventDefault();
    const after = e.offsetY > node.offsetHeight / 2;
    node.classList.toggle('drop-after', after);
    node.classList.toggle('drop-before', !after);
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-after', 'drop-before'));
  node.addEventListener('drop', async (e) => {
    e.preventDefault();
    const after = node.classList.contains('drop-after');
    node.classList.remove('drop-after', 'drop-before');
    const moving = e.dataTransfer.getData('text/plain');
    if (!moving || moving === ex.id) return;
    const ids = all().map((x) => x.id).filter((id) => id !== moving);
    ids.splice(ids.indexOf(ex.id) + (after ? 1 : 0), 0, moving);
    try {
      await ctx.data.reorder(ids);
      toast('Order saved. Publish will recompile the tracker.', 'ok');
    } catch (err) { toast(explain(err), 'err'); }
  });
  return node;
}

function emptyState(ctx) {
  const box = h('div.card.empty', icon('grid'),
    h('h2', 'No exhibits yet'),
    h('p', 'Start from the gallery already deployed in the repo, or add exhibits one by one.'));
  readBundle().then(({ bundle }) => {
    const n = (bundle.exhibits || []).length;
    if (!n) return;
    box.appendChild(h('button.btn.primary.lg', {
      type: 'button',
      disabled: !ctx.can('admin'),
      title: ctx.can('admin') ? '' : 'Only an admin can import (it sets the gallery languages)',
      onclick: () => runImport(ctx, n),
    }, icon('upload'), `Import the ${n} deployed exhibits`));
  }).catch(() => {});
  box.appendChild(h('button.btn', { type: 'button', onclick: () => addExhibit(ctx, 0) }, icon('plus'), 'Add an exhibit'));
  return box;
}

async function runImport(ctx, n) {
  const ok = await confirm('Import the deployed gallery',
    `This copies all ${n} exhibits from assets/content — photos, videos, narration, 3D figures, ` +
    'labels in every language, and the compiled tracker — into Firebase. It takes a minute or two.',
    { ok: 'Import' });
  if (!ok) return;
  const job = busy('Importing the gallery', 'Starting…');
  window.__studioDirty = true;
  try {
    const result = await importBundle((f, text) => job.set(f, text));
    toast(`Imported ${result.exhibits} exhibits (${bytes(result.bytes)}).`, 'ok', 6000);
    if (result.skipped.length) {
      toast(`${result.skipped.length} recording(s) could not be read and were left out — add them in each exhibit's Label tab. ` +
            result.skipped.join('; '), 'err', 12000);
    }
  } catch (err) {
    console.error(err);
    toast('Import stopped: ' + explain(err), 'err', 8000);
  } finally {
    window.__studioDirty = false;
    job.done();
  }
}

async function addExhibit(ctx, order) {
  const name = await dialog({
    title: 'New exhibit',
    build: (body) => body.append(
      h('label.field', h('span.field-label', 'Name'),
        h('input', { type: 'text', name: 'name', placeholder: 'e.g. The Lion Flag', maxLength: 200 })),
      h('p', 'This is the Studio’s own name for it. What visitors read is the label, written per language.')),
    buttons: [{ label: 'Cancel', value: null },
      { label: 'Create', kind: 'primary', value: (body) => body.querySelector('input').value.trim(),
        validate: (body) => !!body.querySelector('input').value.trim() }],
  });
  if (!name) return;
  try {
    const id = await ctx.data.createExhibit({
      name, order,
      media: { kind: 'video', fit: 'stretch', loop: true, restartOnFound: false, scale: 1, offset: { x: 0, y: 0, z: 0.001 } },
      details: {},
      model: window.ARContent.modelDefaults(),
    });
    ctx.go('exhibit/' + id);
  } catch (err) { toast(explain(err), 'err'); }
}
