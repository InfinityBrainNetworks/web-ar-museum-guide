/**
 * One exhibit: its target photo, what is projected onto it, its label in
 * every language with the recording of it, and its 3D figure.
 *
 * Every change saves on its own, a moment after you stop typing - there is
 * no Save button to forget. Nothing here reaches visitors until a release is
 * published; the Studio edits the draft.
 */
import {
  h, clear, icon, toast, explain, bytes, debounce, field, numberInput, segmented, toggle,
  pickFile, dropTarget, confirm, copy,
} from '../ui.js';
import { languagesOf, missing } from '../manifest.js';
import {
  prepareTarget, probeVideo, probeAudio, inspectGlb, videoAdvice, audioAdvice,
  FFMPEG_VIDEO, FFMPEG_AUDIO,
} from '../media.js';
import { slimReport } from '../importer.js';
import { afterSave } from '../autopublish.js';

const TABS = [
  ['target', 'Target photo', 'image'],
  ['media', 'Projection', 'video'],
  ['label', 'Label & narration', 'globe'],
  ['model', '3D figure', 'cube'],
];

export async function render(ctx) {
  const { data } = ctx;
  const id = ctx.params[0];
  const tab = ctx.params[1] || 'target';
  let ex = await data.getExhibit(id);
  if (!ex) {
    ctx.setTitle('Exhibit not found');
    ctx.page.appendChild(h('div.card.empty', icon('warn'), h('h2', 'No such exhibit'),
      h('a.btn', { href: '#/exhibits' }, 'Back to the exhibits')));
    return null;
  }
  const site = await data.getSite();
  const languages = languagesOf(site);

  // ---- saving
  const state = h('span.save-state', 'All changes saved');
  let pending = 0;
  const save = async (patch, quiet) => {
    pending++;
    state.className = 'save-state saving';
    state.textContent = 'Saving…';
    window.__studioDirty = true;
    try {
      await data.saveExhibit(id, patch);
      state.className = 'save-state saved';
      state.textContent = 'Saved';
      if (!quiet) refreshHeader();
      // Straight on to visitors, quietly: the label beside the title says
      // how it went, and only a failure gets a toast.
      afterSave(ex.name, (message, kind) => {
        if (pending) return;                 // a newer save is under way
        if (kind === 'err') toast(message, 'err', 8000);
        state.className = 'save-state ' + (kind === 'err' ? 'error' : 'saved');
        state.textContent = kind === 'ok' ? 'Saved · live' : 'Saved · ' + message.replace(/^Not live yet: /, 'not live: ');
      });
    } catch (err) {
      state.className = 'save-state error';
      state.textContent = 'Not saved — ' + explain(err);
      toast(explain(err), 'err');
      throw err;
    } finally {
      pending--;
      if (!pending) window.__studioDirty = false;
    }
  };
  /** Set a dotted path on the local copy too, so redraws show the new value. */
  const setLocal = (path, value) => {
    const keys = path.split('.');
    let o = ex;
    keys.slice(0, -1).forEach((k) => { o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
  };
  const put = (patch, quiet) => {
    Object.entries(patch).forEach(([k, v]) => setLocal(k, v));
    return save(patch, quiet);
  };

  // ---- header
  const nameInput = h('input.title-input', {
    type: 'text', value: ex.name, maxLength: 200,
    style: { fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, background: 'transparent', border: '1px solid transparent', padding: '4px 8px', marginLeft: '-8px' },
    onfocus: (e) => { e.target.style.borderColor = 'var(--line-strong)'; },
    onblur: (e) => { e.target.style.borderColor = 'transparent'; },
    onchange: (e) => {
      const name = e.target.value.trim();
      if (!name) { e.target.value = ex.name; return; }
      put({ name });
    },
  });
  const gaps = h('div');
  const refreshHeader = () => {
    clear(gaps);
    const need = missing(ex, languages);
    if (need.length) {
      gaps.appendChild(h('div.banner.warn', icon('warn'), h('div', h('strong', 'Not ready to publish. '), 'Still needs ' + need.join(', ') + '.')));
    }
  };
  ctx.setTitle('Exhibit ' + ((ex.order || 0) + 1), 'Editing');
  ctx.setActions(state,
    h('a.btn', { href: '#/floor/' + id, attrs: ex.model && ex.model.url ? {} : { 'aria-disabled': 'true' },
      onclick: (e) => { if (!(ex.model && ex.model.url)) { e.preventDefault(); toast('Add a 3D figure first, in its tab.'); } } },
    icon('floor'), 'Floor editor'),
    h('button.btn.danger', { type: 'button', onclick: () => remove(ctx, ex) }, icon('trash')));

  const tabs = h('nav.tabs');
  const body = h('div.stack', { style: { gap: '20px' } });
  ctx.page.append(h('a.faint', { href: '#/exhibits', style: { textDecoration: 'none' } }, '← All exhibits'), nameInput, gaps, tabs, body);
  refreshHeader();

  const dots = {
    target: () => !!(ex.image && ex.image.url),
    media: () => !!(ex.media && ex.media.url),
    label: () => !missing(ex, languages).some((m) => m.startsWith('its label')),
    model: () => !!(ex.model && ex.model.url),
  };
  let current = TABS.some(([t]) => t === tab) ? tab : 'target';
  const show = (t) => {
    current = t;
    history.replaceState(null, '', '#/exhibit/' + id + '/' + t);
    clear(tabs);
    TABS.forEach(([key, label, ico]) => tabs.appendChild(h('button' + (key === t ? '.on' : ''), { type: 'button', onclick: () => show(key) },
      icon(ico), label, h('span.dot' + (dots[key]() ? '.ok' : (key === 'model' ? '' : '.warn'))))));
    clear(body);
    ({ target: targetTab, media: mediaTab, label: labelTab, model: modelTab })[t]({ ctx, ex, id, put, save, body, languages, redraw: () => show(current) });
  };
  show(current);
  return () => { window.__studioDirty = false; };
}

// ------------------------------------------------------------------ shared
function dropZone({ accept, icon: ico, empty, preview, onFile }) {
  const bar = h('div.upload-bar', h('div'));
  const zone = h('div.drop' + (preview ? '.filled' : ''), { tabIndex: 0, attrs: { role: 'button' } },
    preview || [icon(ico), h('strong', empty), h('span.faint', 'Drop a file here, or click to choose')], bar);
  const choose = async () => { const f = await pickFile(accept); if (f) onFile(f, setProgress); };
  const setProgress = (fraction) => {
    bar.firstChild.style.transform = `scaleX(${fraction})`;
    zone.classList.toggle('busy', fraction > 0 && fraction < 1);
  };
  zone.addEventListener('click', (e) => { if (!e.target.closest('video, audio, button')) choose(); });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
  dropTarget(zone, (f) => onFile(f, setProgress));
  return zone;
}

function adviceList(notes) {
  return h('div.report', h('ul', notes.map((n) => {
    const [kind, text] = Array.isArray(n) ? n : [n.kind, n.text];
    return h('li.' + kind, icon(kind === 'ok' ? 'check' : 'warn'), h('span', text));
  })));
}

function facts(rows) {
  return h('dl.facts', rows.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v)]));
}

// ------------------------------------------------------------------ target
function targetTab({ ctx, ex, id, put, body, redraw }) {
  const img = ex.image || {};
  const zone = dropZone({
    accept: 'image/jpeg,image/png,image/webp',
    icon: 'image',
    empty: 'Add the target photo',
    preview: img.url ? h('img', { src: img.url, alt: '' }) : null,
    onFile: async (file, progress) => {
      if (!/^image\//.test(file.type)) { toast('That is not a photo.', 'err'); return; }
      try {
        const prepared = await prepareTarget(file);
        const folder = 'exhibits/' + id;
        const display = await ctx.data.upload(folder, 'target',
          new File([prepared.display.blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }),
          (f) => progress(f * 0.85));
        const thumb = await ctx.data.upload(folder, 'thumb', new File([prepared.thumb.blob], 'thumb.jpg', { type: 'image/jpeg' }),
          (f) => progress(0.85 + f * 0.15));
        await put({
          image: {
            path: display.path, url: display.url, hash: display.hash, size: display.size, fileName: file.name,
            width: prepared.display.width, height: prepared.display.height,
            thumbPath: thumb.path, thumbUrl: thumb.url, thumbSize: thumb.size,
            originalWidth: prepared.original.width, originalHeight: prepared.original.height,
          },
        });
        toast('Target photo saved. The tracker will be recompiled when you publish.', 'ok');
        redraw();
      } catch (err) { toast(explain(err), 'err'); progress(0); }
    },
  });

  body.appendChild(h('div.slot', zone, h('div.stack',
    h('h2', 'What visitors point their phone at'),
    h('p.muted', 'A photograph of the artwork as it hangs, straight on and evenly lit. It is also the picture on the Explore card and the label page.'),
    img.url ? facts([
      ['Size', `${img.width}×${img.height} px · ${bytes(img.size)}`],
      img.originalWidth ? ['Uploaded', `${img.originalWidth}×${img.originalHeight} px, resized to 1024 for the tracker`] : null,
      ['Tracking', typeof img.featurePoints === 'number'
        ? `${img.featurePoints} feature points` + (img.featurePoints < 400 ? ' — too few to track reliably' : ' — plenty') : 'Measured when the tracker is next compiled'],
    ]) : null,
    adviceList([
      ['ok', 'Busy, high-contrast, non-repeating pictures track best. Under ~400 feature points and the tracker struggles.'],
      ['warn', 'A flat colour, a smooth gradient or a regular pattern gives it nothing to hold on to.'],
      ['warn', 'Replacing the photo or reordering exhibits means recompiling the tracker; Publish does that for you.'],
    ]))));
}

// ------------------------------------------------------------------ projection
function mediaTab({ ctx, ex, id, put, body, redraw }) {
  const media = ex.media || {};
  const isImage = media.kind === 'image';
  const preview = media.url
    ? (isImage ? h('img', { src: media.url, alt: '' })
      : h('video', { src: media.url, controls: true, muted: true, loop: true, playsInline: true, preload: 'metadata' }))
    : null;

  const zone = dropZone({
    accept: 'video/mp4,video/webm,image/jpeg,image/png,image/webp',
    icon: 'video',
    empty: 'Add the video or picture to project',
    preview,
    onFile: async (file, progress) => {
      try {
        const still = /^image\//.test(file.type);
        let meta, upload = file;
        if (still) {
          const p = await prepareTarget(file);          // a still is just a photo, sized like one
          upload = new File([p.display.blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
          meta = { width: p.display.width, height: p.display.height, duration: 0 };
        } else {
          meta = await probeVideo(file);
          const notes = videoAdvice(file, meta);
          if (notes.some(([k]) => k === 'bad') && !(await confirm('This video is heavy',
            notes.map(([, t]) => t).join(' ') + ' Upload it anyway?', { ok: 'Upload anyway' }))) return;
        }
        const got = await ctx.data.upload('exhibits/' + id, 'media', upload, progress);
        await put({
          media: {
            ...(ex.media || {}),
            kind: still ? 'image' : 'video',
            path: got.path, url: got.url, hash: got.hash, size: got.size, type: got.type, fileName: file.name,
            width: meta.width, height: meta.height, duration: meta.duration || 0,
          },
        });
        toast(still ? 'Picture saved.' : 'Video saved.', 'ok');
        redraw();
      } catch (err) { toast(explain(err), 'err'); progress(0); }
    },
  });

  const targetAspect = ex.image && ex.image.width ? ex.image.width / ex.image.height : 0;
  const mediaAspect = media.width && media.height ? media.width / media.height : 0;
  const mismatch = targetAspect && mediaAspect && Math.abs(mediaAspect / targetAspect - 1) > 0.03;

  const opts = h('div.card.card-pad.stack',
    h('h3', 'How it sits on the artwork'),
    field('Fit', segmented([['stretch', 'Stretch'], ['cover', 'Cover'], ['contain', 'Contain']], media.fit || 'stretch',
      (v) => put({ 'media.fit': v })),
    mismatch ? `The ${isImage ? 'picture' : 'video'} is ${mediaAspect.toFixed(2)}:1 and the photo ${targetAspect.toFixed(2)}:1 — Stretch will distort it slightly; Cover crops instead.`
      : 'Stretch fills the painting exactly. Cover crops whatever overflows; Contain shows all of it.'),
    !isImage ? h('div.row', toggle(media.loop !== false, (v) => put({ 'media.loop': v }), 'Loop'),
      toggle(!!media.restartOnFound, (v) => put({ 'media.restartOnFound': v }), 'Restart when found again')) : null,
    h('div.fields',
      field('Size ×', numberInput(media.scale ?? 1, { step: 0.01, min: 0.3, max: 3, onchange: (v) => put({ 'media.scale': v }) })),
      field('Nudge X', numberInput((media.offset || {}).x || 0, { step: 0.005, onchange: (v) => put({ 'media.offset.x': v }) }),
        'In artwork widths: 0.02 is 2%.'),
      field('Nudge Y', numberInput((media.offset || {}).y || 0, { step: 0.005, onchange: (v) => put({ 'media.offset.y': v }) }))),
    h('p.faint', 'Finer alignment is easiest on the phone, in front of the painting: the guide’s Adjust panel saves straight back here when you are signed in.'));

  body.appendChild(h('div.slot', zone, h('div.stack',
    h('h2', 'Projected onto the painting'),
    h('p.muted', 'A video plays mapped exactly onto the artwork once it is recognised; a still — an archival photograph, an underdrawing — costs a fraction of the download.'),
    media.url ? facts([
      ['File', `${media.width || '?'}×${media.height || '?'} · ${bytes(media.size)}` + (media.duration ? ` · ${media.duration.toFixed(1)} s` : '')],
    ]) : null,
    media.url && !isImage ? adviceList(videoAdvice({ size: media.size, type: media.type || 'video/mp4' }, media)) : null,
    !isImage ? h('details', h('summary.faint', 'Make a video light enough'),
      h('p.muted', { style: { margin: '8px 0' } }, '960 px, H.264, no sound track (which is also what lets it autoplay):'),
      h('code.cmd.mono', FFMPEG_VIDEO),
      h('button.btn.sm', { type: 'button', style: { marginTop: '8px' }, onclick: () => copy(FFMPEG_VIDEO) }, 'Copy')) : null,
    opts)));
}

// ------------------------------------------------------------------ label
const RICH = [['H2', 'formatBlock', 'h2'], ['H3', 'formatBlock', 'h3'], ['¶', 'formatBlock', 'p'],
  ['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['•', 'insertUnorderedList'], ['1.', 'insertOrderedList']];

function labelTab({ ctx, ex, id, put, body, languages, redraw }) {
  const details = ex.details || {};
  let code = labelTab.code && languages.some((l) => l.code === labelTab.code) ? labelTab.code : languages[0].code;
  const base = languages[0];

  const tabs = h('div.lang-tabs');
  const pane = h('div.stack');
  body.append(h('div.stack', h('h2', 'What “More details” opens'),
    h('p.muted', `A title and a text per language, and optionally a recording of it. ${base.name} is required — every other language falls back to it.`),
    tabs), pane);

  const written = (c) => {
    const d = details[c];
    return !!(d && (String(d.title || '').trim() || window.ARContent.plainText(d.html)));
  };

  const draw = () => {
    labelTab.code = code;
    clear(tabs);
    languages.forEach((l, i) => tabs.appendChild(h('button.lang-tab' + (l.code === code ? '.on' : ''), {
      type: 'button', lang: l.code, onclick: () => { code = l.code; draw(); },
    }, h('span.dot' + (written(l.code) ? '.ok' : '')), l.native || l.name, i === 0 ? h('span.faint', '· required') : null,
      details[l.code] && details[l.code].audio && details[l.code].audio.url ? icon('audio') : null)));

    clear(pane);
    const d = details[code] || { title: '', html: '', audio: null };
    const lang = languages.find((l) => l.code === code);

    const title = h('input', {
      type: 'text', value: d.title || '', lang: code, maxLength: 200,
      placeholder: 'Title in ' + lang.name,
      oninput: debounce(() => { put({ ['details.' + code + '.title']: title.value.trim() }, true); details[code] = { ...(details[code] || {}), title: title.value.trim() }; }, 700),
      onchange: () => draw(),
    });

    const editor = h('div.rte-body', { contentEditable: 'true', lang: code, attrs: { 'data-placeholder': 'The label text in ' + lang.name } });
    editor.innerHTML = window.ARContent.sanitizeRichText(d.html || '');
    const saveHtml = () => {
      const html = window.ARContent.sanitizeRichText(editor.innerHTML);
      details[code] = { ...(details[code] || {}), html };
      put({ ['details.' + code + '.html']: html }, true);
    };
    const later = debounce(saveHtml, 900);
    editor.addEventListener('input', later);
    editor.addEventListener('blur', () => {
      later.flush();
      editor.innerHTML = window.ARContent.sanitizeRichText(editor.innerHTML);   // show exactly what visitors will get
    });
    const bar = h('div.rte-bar', RICH.map(([label, cmd, arg]) => h('button', {
      type: 'button', title: cmd + (arg ? ' ' + arg : ''),
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { document.execCommand(cmd, false, arg ? '<' + arg + '>' : null); editor.focus(); later(); },
    }, label)));

    pane.append(
      field('Title', title, 'The heading of the label. Also the name on the Explore card in this language.'),
      h('div.field', h('span.field-label', 'Text'), h('div.rte', bar, editor),
        h('span.field-hint', 'Headings, bold, italic, underline and lists. Anything else pasted in is stripped to plain words.')),
      audioRow({ ctx, id, code, lang, audio: d.audio, put, onChange: () => { details[code] = { ...(details[code] || {}) }; redraw(); } }));
  };
  draw();
}

function audioRow({ ctx, id, code, lang, audio, put, onChange }) {
  const has = audio && audio.url;
  const row = h('div.audio-row',
    icon('audio'),
    h('div.stack', { style: { gap: '2px', flex: '0 0 auto' } }, h('strong', 'Narration'),
      h('span.faint', has ? `${bytes(audio.size)}${audio.duration ? ' · ' + Math.round(audio.duration) + ' s' : ''}` : 'None — no Listen button in ' + lang.name)),
    has ? h('audio', { src: audio.url, controls: true, preload: 'none' }) : h('span.spacer'),
    h('button.btn.sm', {
      type: 'button',
      onclick: async () => {
        const file = await pickFile('audio/mpeg,audio/mp4,audio/x-m4a,audio/aac');
        if (!file) return;
        try {
          const meta = await probeAudio(file).catch(() => ({ duration: 0 }));
          const notes = audioAdvice(file, meta);
          if (notes.some(([k]) => k !== 'ok')) toast(notes.map(([, t]) => t).join(' '), 'info', 6000);
          const got = await ctx.data.upload('exhibits/' + id, 'audio-' + code, file);
          await put({ ['details.' + code + '.audio']: { path: got.path, url: got.url, size: got.size, fileName: file.name, duration: meta.duration || 0 } });
          toast('Narration saved.', 'ok');
          onChange();
        } catch (err) { toast(explain(err), 'err'); }
      },
    }, icon('upload'), has ? 'Replace' : 'Add MP3'),
    has ? h('button.btn.sm.danger', {
      type: 'button',
      onclick: async () => {
        if (!(await confirm('Remove the narration?', `Visitors reading ${lang.name} will no longer see a Listen button.`, { ok: 'Remove', danger: true }))) return;
        await put({ ['details.' + code + '.audio']: null });
        onChange();
      },
    }, icon('trash')) : null);
  return h('div.stack', { style: { gap: '6px' } }, row,
    h('details', h('summary.faint', 'Recording tips'),
      h('p.muted', { style: { margin: '8px 0' } }, 'MP3, mono, around 96 kbps, levelled to about −18 LUFS. From a WAV:'),
      h('code.cmd.mono', FFMPEG_AUDIO)));
}

// ------------------------------------------------------------------ model
function modelTab({ ctx, ex, id, put, body, redraw }) {
  const model = { ...window.ARContent.modelDefaults(), ...(ex.model || {}) };
  const has = !!model.url;
  const report = model.report;

  const zone = dropZone({
    accept: '.glb,model/gltf-binary',
    icon: 'cube',
    empty: 'Add a 3D figure (.glb)',
    preview: has ? h('div.stack', { style: { alignItems: 'center' } }, icon('cube'), h('strong', model.fileName || 'model.glb'),
      h('span.faint', bytes(model.size)), h('span.faint', 'Click to replace')) : null,
    onFile: async (file, progress) => {
      try {
        const r = await inspectGlb(file);
        const bad = r.notes.filter(([k]) => k === 'bad');
        if (bad.length && !(await confirm('This model will cause problems',
          bad.map(([, t]) => t).join(' ') + ' Upload it anyway?', { ok: 'Upload anyway', danger: true }))) return;
        const got = await ctx.data.upload('exhibits/' + id, 'model', new File([file], file.name, { type: 'model/gltf-binary' }), progress);
        await put({
          'model.path': got.path, 'model.url': got.url, 'model.size': got.size, 'model.hash': got.hash,
          'model.fileName': file.name, 'model.report': slimReport(r),
        });
        toast('3D figure saved. Open the floor editor to stand it up.', 'ok');
        redraw();
      } catch (err) { toast(explain(err), 'err'); progress(0); }
    },
  });

  const anim = model.playClip === false ? 'hold' : (model.loopClip ? 'loop' : 'once');
  const settings = h('div.card.card-pad.stack',
    h('h3', 'How it stands'),
    h('div.fields',
      field('Real height (m)', numberInput(model.heightMeters, { step: 0.01, min: 0.05, max: 20, onchange: (v) => put({ 'model.heightMeters': v }) }),
        'Whatever units it was exported in, it is shown this tall.'),
      field('Shadow strength', numberInput(model.shadowOpacity, { step: 0.05, min: 0, max: 1, onchange: (v) => put({ 'model.shadowOpacity': v }) }),
        '0 for a model with its own shadow in the texture.')),
    field('Shading', segmented([['baked', 'Baked'], ['lit', 'Lit']], model.lighting || 'baked', (v) => put({ 'model.lighting': v })),
      'Baked shows the texture exactly as authored — right for scans and anything with lighting already painted in.'),
    report && report.animations && report.animations.length
      ? field('Animation', segmented([['once', 'Play once'], ['loop', 'Loop'], ['hold', 'Hold still']], anim,
        (v) => put({ 'model.playClip': v !== 'hold', 'model.loopClip': v === 'loop' })),
        'Once performs after it is placed, then holds the last pose.')
      : null,
    toggle(!!model.spin, (v) => put({ 'model.spin': v }), 'Turntable spin'),
    h('a.btn.primary', { href: '#/floor/' + id, attrs: has ? {} : { 'aria-disabled': 'true' }, style: { alignSelf: 'flex-start' } },
      icon('floor'), 'Open the floor editor'),
    has ? h('button.btn.danger.sm', {
      type: 'button', style: { alignSelf: 'flex-start' },
      onclick: async () => {
        if (!(await confirm('Remove the 3D figure?', 'The exhibit stays; visitors will no longer see “View in 3D”. Its placement settings are kept.', { ok: 'Remove', danger: true }))) return;
        await put({ 'model.url': null, 'model.path': null, 'model.size': 0, 'model.report': null });
        redraw();
      },
    }, icon('trash'), 'Remove the figure') : null);

  body.appendChild(h('div.slot', zone, h('div.stack',
    h('h2', 'Stands on the floor after the painting'),
    h('p.muted', '“View in 3D” closes the painting and puts this figure on the gallery floor, at its real height, facing the visitor.'),
    report ? h('div.stack', { style: { gap: '8px' } },
      facts([
        ['Geometry', `${(report.triangles / 1000).toFixed(0)}k triangles · ${report.meshes} mesh${report.meshes === 1 ? '' : 'es'}${report.skinned ? ' · rigged' : ''}`],
        ['Textures', report.maxTexture ? `${report.textures} up to ${report.maxTexture}² · ~${report.gpuMB} MB GPU` : 'none'],
        report.extensions && report.extensions.length ? ['Extensions', report.extensions.join(', ')] : null,
      ]),
      adviceList(report.notes || [])) : null,
    settings)));
}

async function remove(ctx, ex) {
  if (!(await confirm('Delete this exhibit?', `“${ex.name}” is removed from the draft. Releases already published keep it until a new one goes live.`, { ok: 'Delete', danger: true }))) return;
  try {
    await ctx.data.deleteExhibit(ex.id);
    toast('Exhibit deleted.', 'ok');
    ctx.go('exhibits');
  } catch (err) { toast(explain(err), 'err'); }
}
