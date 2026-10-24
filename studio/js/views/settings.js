/**
 * Settings: the gallery's name, its languages, which features visitors get,
 * and a health check of the Firebase project behind it all.
 *
 * Everything here belongs to the whole gallery rather than one exhibit, and
 * travels to visitors inside the next release.
 */
import { h, clear, icon, toast, explain, field, toggle, copy, pickFile, bytes } from '../ui.js';
import { afterSave } from '../autopublish.js';

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('Settings', 'The whole gallery');
  const admin = ctx.can('admin');
  let site = await data.getSite();

  const general = h('div.card');
  const logosCard = h('div.card');
  const langs = h('div.card');
  const health = h('div.card');
  ctx.page.append(general, logosCard, langs, health);
  if (!admin) ctx.page.prepend(h('div.banner.info', icon('lock'), h('div', 'Only an admin can change these. You can see them.')));

  const save = async (patch, msg) => {
    try {
      await data.saveSite(patch);
      site = await data.getSite();
      if (msg) toast(msg, 'ok');
    } catch (err) { toast(explain(err), 'err'); }
  };

  // ---- general
  const drawGeneral = () => {
    clear(general);
    const name = h('input', { type: 'text', value: site.name || '', maxLength: 80, disabled: !admin,
      onchange: () => save({ name: name.value.trim() }, 'Saved. Visitors see it with the next release.') });
    general.append(
      h('div.card-head', icon('gear'), h('div.grow', h('h2', 'The gallery'), h('p', 'Shown at the top of Explore, above the artworks.'))),
      h('div.card-body',
        field('Museum name', name, 'A proper noun, so it is the same in every language.'),
        h('div.stack',
          h('strong', 'What visitors get'),
          toggle(site.features.feedback !== false, (v) => save({ features: { ...site.features, feedback: v } }), 'Feedback — a rating and a few words, from the Feedback tab'),
          toggle(!!site.photobooth.enabled, (v) => save({ photobooth: { ...site.photobooth, enabled: v } }), 'Photobooth — share an AR photo to the wall (moderated under Photobooth)')),
        h('div.stack',
          h('strong', 'Publishing'),
          toggle(site.autoPublish !== false, (v) => save({ autoPublish: v },
            v ? 'An admin’s saved edits now go live by themselves.' : 'Edits now wait for Publish.'),
            'Put saved edits live straight away — a placement, a label or a video reaches visitors seconds after an admin saves it. ' +
            'Off: nothing changes for visitors until someone builds a release on Publish.'))));
    general.querySelectorAll('input[type=checkbox]').forEach((i) => { i.disabled = !admin; });
  };

  // ---- photo logos
  // The strip printed along the bottom of every visitor's photo. Until an
  // admin changes it, the app's built-in logos (js/config.js) are used; the
  // first change saves the whole list into config/site.logos, which then
  // travels with every release.
  const builtIn = () => ((window.AR_CONFIG.branding || {}).logos || []).filter((l) => l.src)
    .map((l) => ({ url: new URL(l.src, window.AR_CLOUD.appUrl).href, name: l.label || '', builtIn: true }));
  const customLogos = () => Array.isArray(site.logos) && site.logos.length > 0;
  const saveLogos = async (list, message) => {
    try {
      await data.saveSite({
        logos: list.map((l) => ({ url: l.url, path: l.path || null, name: l.name || '', width: l.width || 0, height: l.height || 0, size: l.size || 0 })),
      });
      site = await data.getSite();
      toast(message, 'ok');
      afterSave('photo logos', toast);
    } catch (err) { toast(explain(err), 'err'); }
    drawLogos();
  };
  const measure = (file) => new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
  const uploadLogo = async () => {
    const file = await pickFile('image/png,image/webp,image/svg+xml,image/jpeg');
    if (!file) return null;
    if (file.size > 3 * 1024 * 1024) { toast('That file is ' + bytes(file.size) + ' — keep logos under 3 MB (a 400 px tall PNG is plenty).', 'err', 7000); return null; }
    const size = await measure(file);
    const got = await data.upload('site', 'logo', file);
    return { url: got.url, path: got.path, size: got.size, name: file.name.replace(/\.[a-z0-9]+$/i, ''), ...size };
  };
  const drawLogos = () => {
    clear(logosCard);
    const list = (customLogos() ? site.logos : builtIn()).map((l) => ({ ...l }));
    const rows = list.map((l, i) => h('div.logo-row',
      h('div.logo-plate', h('img', { src: l.url, alt: l.name || 'Logo' })),
      h('input', {
        type: 'text', value: l.name || '', maxLength: 60, placeholder: 'Whose logo', disabled: !admin,
        onchange: (e) => { list[i].name = e.target.value.trim(); saveLogos(list, 'Logo renamed.'); },
      }),
      admin ? h('div.row', { style: { flexWrap: 'nowrap' } },
        h('button.icon-btn', { type: 'button', title: 'Move left in the photo', disabled: i === 0,
          onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; saveLogos(list, 'Order saved.'); } }, '↑'),
        h('button.icon-btn', { type: 'button', title: 'Move right in the photo', disabled: i === list.length - 1,
          onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; saveLogos(list, 'Order saved.'); } }, '↓'),
        h('button.btn.sm', { type: 'button', onclick: async () => {
          try { const got = await uploadLogo(); if (got) { list[i] = { ...got, name: list[i].name || got.name }; saveLogos(list, 'Logo replaced.'); } }
          catch (err) { toast(explain(err), 'err'); }
        } }, 'Replace'),
        h('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => { list.splice(i, 1); saveLogos(list, 'Logo removed.'); } }, icon('trash'))) : null));
    logosCard.append(
      h('div.card-head', icon('image'), h('div.grow', h('h2', 'Photo logos'),
        h('p', 'Printed along the bottom of every photo a visitor takes, on a light plate, in this order. ' +
          'A transparent PNG about 400 px tall works best.'))),
      h('div.card-body',
        h('div.logo-preview', list.length ? list.map((l) => h('img', { src: l.url, alt: l.name || 'Logo' })) : h('span.faint', 'No logos — photos carry none.')),
        h('div.logo-list', rows),
        admin ? h('div.row', { style: { marginTop: '12px' } },
          h('button.btn', { type: 'button', disabled: list.length >= 5, onclick: async () => {
            try { const got = await uploadLogo(); if (got) { list.push(got); saveLogos(list, 'Logo added.'); } }
            catch (err) { toast(explain(err), 'err'); }
          } }, icon('plus'), 'Add a logo'),
          h('span.spacer'),
          customLogos() ? h('button.btn', { type: 'button', onclick: () => saveLogos([], 'Back to the built-in logos.') }, 'Use the built-in logos') : h('span.faint', 'Showing the logos built into the app.')) : null));
  };

  // ---- languages
  let working = site.languages.map((l) => ({ ...l }));
  const drawLangs = () => {
    clear(langs);
    const rows = working.map((l, i) => {
      const input = (key, ph, width) => h('input', {
        type: 'text', value: l[key] || '', placeholder: ph, disabled: !admin, style: { width },
        oninput: (e) => { l[key] = e.target.value; },
      });
      return h('tr',
        h('td.faint', i === 0 ? 'Fallback' : String(i + 1)),
        h('td', input('code', 'ta', '80px')),
        h('td', input('name', 'Tamil')),
        h('td', input('native', 'தமிழ்')),
        h('td', admin ? h('div.row', { style: { justifyContent: 'flex-end', flexWrap: 'nowrap' } },
          h('button.icon-btn', { type: 'button', title: 'Move up', disabled: i === 0, onclick: () => { [working[i - 1], working[i]] = [working[i], working[i - 1]]; drawLangs(); } }, '↑'),
          h('button.icon-btn', { type: 'button', title: 'Move down', disabled: i === working.length - 1, onclick: () => { [working[i + 1], working[i]] = [working[i], working[i + 1]]; drawLangs(); } }, '↓'),
          h('button.icon-btn', { type: 'button', title: 'Remove', disabled: working.length === 1, onclick: () => { working.splice(i, 1); drawLangs(); } }, icon('trash'))) : null));
    });
    langs.append(
      h('div.card-head', icon('globe'), h('div.grow', h('h2', 'Languages'),
        h('p', 'The first is the fallback: every exhibit must be written in it. Removing a language never deletes anyone’s translation.'))),
      h('div.table-wrap', h('table.table', h('thead', h('tr', h('th'), h('th', 'Code'), h('th', 'In English'), h('th', 'In itself'), h('th'))), h('tbody', rows))),
      admin ? h('div.card-body', h('div.row',
        h('button.btn', { type: 'button', onclick: () => { working.push({ code: '', name: '', native: '' }); drawLangs(); } }, icon('plus'), 'Add a language'),
        h('span.spacer'),
        h('button.btn.primary', {
          type: 'button',
          onclick: () => {
            const clean = window.ARContent.languageList(working.filter((l) => String(l.code).trim()));
            working = clean.map((l) => ({ ...l }));
            save({ languages: clean }, 'Languages saved.').then(drawLangs);
          },
        }, 'Save languages'))) : null);
  };

  // ---- health
  const drawHealth = async () => {
    clear(health);
    const cfg = window.AR_CLOUD.config();
    const checks = h('div.checks');
    health.append(
      h('div.card-head', icon('check'), h('div.grow', h('h2', 'The Firebase project'), h('p', 'What the Studio is connected to, and whether visitors can reach it.'))),
      h('div.card-body',
        h('dl.facts',
          h('dt', 'Project'), h('dd.mono', cfg.projectId + (window.AR_CLOUD.emulators ? ' (local emulators)' : '')),
          h('dt', 'Storage'), h('dd.mono', cfg.storageBucket || '—'),
          h('dt', 'Signed in'), h('dd', ctx.user.email + ' · ' + ctx.role)),
        checks));

    const item = (kind, title, detail) => checks.appendChild(h('div.check.' + kind, icon(kind === 'ok' ? 'check' : 'warn'),
      h('div.grow', h('strong', title), detail ? h('div.muted', detail) : null)));

    // Storage must answer cross-origin fetches, or phones cannot keep the
    // gallery offline and the video cannot be drawn onto the painting.
    const exhibits = await new Promise((resolve) => {
      const stop = data.watchExhibits((list) => { stop(); resolve(list); }, () => resolve([]));
    });
    const sample = exhibits.map((e) => e.image && e.image.url).find(Boolean);
    if (!sample) {
      item('warn', 'Storage not tested yet', 'Upload a photo to an exhibit, then come back.');
    } else {
      try {
        const r = await fetch(sample, { mode: 'cors', cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        item('ok', 'Storage answers the guide (CORS is set)');
      } catch (err) {
        const cmd = `gsutil cors set storage.cors.json gs://${cfg.storageBucket}`;
        item('bad', 'Storage blocks the guide — CORS is not set',
          h('div', 'Videos will not draw onto paintings and the gallery cannot download. Run this once, from the repo:',
            h('code.cmd.mono', { style: { marginTop: '6px' } }, cmd), h('button.btn.sm', { type: 'button', style: { marginTop: '6px' }, onclick: () => copy(cmd) }, 'Copy')));
      }
    }
    try {
      const live = await window.AR_CLOUD.getDocument('public/live', 5000);
      item(live ? 'ok' : 'warn', live ? 'A release is live: ' + live.release : 'Nothing is live yet',
        live ? 'Visitors read it anonymously, as they should.' : 'Until one is, visitors see the bundle in the repo.');
    } catch (err) {
      item('bad', 'Visitors cannot read the live release', explain(err));
    }
  };

  drawGeneral();
  drawLogos();
  drawLangs();
  drawHealth();
  return null;
}
