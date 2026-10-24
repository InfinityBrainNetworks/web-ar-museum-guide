/**
 * The floor editor: stand an exhibit's 3D figure on the gallery floor the way
 * it will stand in AR, with a gizmo and with numbers.
 *
 *   Position   metres from the spot the visitor taps: x right, y up, z towards them
 *   Rotation   degrees, turned about the anchor (yaw first, then pitch, roll)
 *   Size       a multiplier on the real height; the readout says what that comes to
 *   Anchor     the point of the figure that stands on the spot and that it turns
 *              about. Move it - by number, preset, gizmo or by clicking the model -
 *              and the figure stays still; lock it, then position, scale and rotate
 *              from there.
 *
 *   Shadow     the contact shadow, built out of shapes - ellipses, rectangles
 *              and pictures (a PNG of a painted shadow). Select one, in the list
 *              or by clicking it on the floor, and the gizmo moves, turns and
 *              sizes it instead of the figure. A white patch of floor goes
 *              under it while you work, because a dark shadow on the dark
 *              stage floor cannot be seen.
 *
 * Keys follow Blender where they can: G move, R rotate, S scale, A edit the
 * anchor, L lock it, X/Y/Z constrain, F frame, 1/3/7 front/side/top, 0 the
 * visitor's view, Space play, Ctrl held flips snapping, Ctrl+Z / Ctrl+Shift+Z,
 * Delete removes the selected shadow shape, Esc lets go of it.
 */
import { h, clear, icon, toast, explain, numberInput, segmented, toggle, round, pickFile, bytes } from '../ui.js';
import { afterSave } from '../autopublish.js';

const FIELDS = ['heightMeters', 'scale', 'rotation', 'offset', 'anchor', 'anchorLocked', 'lighting',
  'shadowOpacity', 'shadows', 'shadowFollow', 'shadowScale', 'spin', 'playClip', 'loopClip'];

export async function render(ctx) {
  const id = ctx.params[0];
  const ex = await ctx.data.getExhibit(id);
  if (!ex || !ex.model || !ex.model.url) {
    ctx.setTitle('Floor editor');
    ctx.page.appendChild(h('div.card.empty', icon('cube'),
      h('h2', ex ? 'This exhibit has no 3D figure yet' : 'No such exhibit'),
      ex ? h('a.btn.primary', { href: '#/exhibit/' + id + '/model' }, 'Add one') : h('a.btn', { href: '#/exhibits' }, 'Back')));
    return null;
  }

  const defaults = window.ARContent.modelDefaults();
  const initial = {};
  FIELDS.forEach((k) => { initial[k] = ex.model[k] !== undefined && ex.model[k] !== null ? ex.model[k] : defaults[k]; });
  initial.anchor = window.ARPlacement.anchor(initial.anchor);

  ctx.setTitle('Floor · ' + ex.name);
  const { Stage } = await import('../stage/stage.js');

  // ---- layout
  const view = h('div.stage-view');
  const panel = h('aside.stage-panel');
  const saveBtn = h('button.btn.primary.sm', { type: 'button', onclick: () => save() }, 'Save');
  const saveState = h('span.save-state', 'Saved');
  const undoBtn = h('button.icon-btn', { type: 'button', title: 'Undo (Ctrl+Z)', onclick: () => undo() }, icon('undo'));
  const redoBtn = h('button.icon-btn', { type: 'button', title: 'Redo (Ctrl+Shift+Z)', onclick: () => redo() }, icon('redo'));
  const top = h('header.stage-top',
    h('a.icon-btn', { href: '#/exhibit/' + id + '/model', title: 'Back to the exhibit' }, icon('close')),
    h('div.grow', h('h1', ex.name), h('span.faint', { style: { fontSize: '12px' } }, 'Floor editor — the figure as it stands in AR')),
    saveState, undoBtn, redoBtn, saveBtn);
  const page = h('div.stage-page', top, view, panel);
  ctx.page.appendChild(page);

  const hud = h('div.stage-hud');
  view.appendChild(hud);

  // ---- stage
  let stage;
  let state = JSON.parse(JSON.stringify(initial));
  let saved = JSON.stringify(state);
  const history = [JSON.stringify(state)];
  let at = 0;
  const loading = h('div.empty', { style: { position: 'absolute', inset: 0, zIndex: 3 } }, h('div.spinner'), h('p', 'Loading the figure…'));
  view.appendChild(loading);

  try {
    stage = new Stage(view, {
      onChange: (s) => { state = s; syncPanel(); dirty(); },
      onCommit: (s) => { state = s; push(); },
      onStatus: (t) => toast(t),
      onPickShadow: (i) => selectShape(i),
    });
    await stage.loadModel(ex.model.url);
  } catch (err) {
    loading.remove();
    view.appendChild(h('div.banner.bad', { style: { margin: '20px' } }, icon('warn'),
      h('div', h('strong', 'The figure could not be loaded. '), explain(err),
        h('p.faint', 'If this is the real project, check that Storage CORS is set (SETUP-FIREBASE.md).'))));
    return () => { if (stage) stage.dispose(); };
  }
  loading.remove();
  stage.setState(state);
  if (stage.mixer) stage.seek(0);
  stage.view('visitor');
  window.__stage = stage;   // for the console, and the end-to-end tests

  // ---- history
  function push() {
    const snap = JSON.stringify(state);
    if (snap === history[at]) return;
    history.splice(at + 1);
    history.push(snap);
    if (history.length > 120) history.shift();
    at = history.length - 1;
    dirty();
  }
  function restore(snap) {
    state = JSON.parse(snap);
    stage.setState(state);
    if (selected !== null && selected >= (state.shadows || []).length) selectShape(null);
    syncPanel();
    dirty();
  }
  function undo() { if (at > 0) restore(history[--at]); }
  function redo() { if (at < history.length - 1) restore(history[++at]); }
  function dirty() {
    const changed = JSON.stringify(state) !== saved;
    window.__studioDirty = changed;
    saveState.className = 'save-state' + (changed ? ' saving' : ' saved');
    saveState.textContent = changed ? 'Unsaved changes' : 'Saved';
    saveBtn.disabled = !changed;
    undoBtn.disabled = at <= 0;
    redoBtn.disabled = at >= history.length - 1;
    drawHud();
  }
  /** A change from the panel: apply it, then record it. */
  function change(mutate) {
    mutate(state);
    stage.setState(state);
    push();
    syncPanel();
  }
  /** A slider being dragged: show it, and record it when it is let go (push). */
  function preview(mutate) {
    mutate(state);
    stage.setState(state);
    dirty();
  }

  async function save() {
    const patch = {};
    FIELDS.forEach((k) => { patch['model.' + k] = state[k]; });
    saveBtn.disabled = true;
    saveState.textContent = 'Saving…';
    try {
      await ctx.data.saveExhibit(id, patch);
      saved = JSON.stringify(state);
      dirty();
      toast('Placement saved.', 'ok');
      afterSave(ex.name + ' placement', toast);
    } catch (err) {
      toast(explain(err), 'err');
      dirty();
    }
  }

  // ---- tools over the viewport
  const toolBtn = (name, ico, title, onclick) => h('button.icon-btn', { type: 'button', title, dataset: { tool: name }, onclick }, icon(ico));
  const modes = h('div.tool-group',
    toolBtn('translate', 'move', 'Move (G)', () => setMode('translate')),
    toolBtn('rotate', 'rotate', 'Rotate (R)', () => setMode('rotate')),
    toolBtn('scale', 'scale', 'Scale (S)', () => setMode('scale')));
  const anchorTool = toolBtn('anchor', 'anchor', 'Edit the anchor (A)', () => setAnchorEdit(!stage.anchorEdit));
  const snapTool = toolBtn('snap', 'grid', 'Snap: 1 cm, 5°, ×0.01 (Ctrl inverts)', () => { stage.setSnap(!stage.snap); drawTools(); });
  const spaceTool = toolBtn('space', 'globe', 'World / local axes', () => { space = space === 'world' ? 'local' : 'world'; stage.setSpace(space); drawTools(); });
  let space = 'world';
  view.appendChild(h('div.stage-tools', modes, h('div.tool-group', anchorTool, snapTool, spaceTool)));

  const viewBtn = (name, label, key) => h('button.btn.sm', { type: 'button', title: label + ' (' + key + ')', onclick: () => stage.view(name) }, label);
  view.appendChild(h('div.stage-views',
    viewBtn('visitor', 'Visitor', '0'), viewBtn('front', 'Front', '1'), viewBtn('side', 'Side', '3'),
    viewBtn('top', 'Top', '7'), viewBtn('persp', '3D', '5'),
    h('button.btn.sm', { type: 'button', title: 'Frame the figure (F)', onclick: () => stage.frameFigure() }, icon('frame'))));

  view.appendChild(h('div.stage-keys',
    h('div', h('kbd', 'G'), ' move ', h('kbd', 'R'), ' rotate ', h('kbd', 'S'), ' scale ', h('kbd', 'A'), ' anchor ', h('kbd', 'L'), ' lock'),
    h('div', h('kbd', 'X'), h('kbd', 'Y'), h('kbd', 'Z'), ' axis ', h('kbd', 'F'), ' frame ', h('kbd', 'Ctrl'), ' snap ', h('kbd', 'Space'), ' play')));

  function setMode(mode) {
    if (stage.anchorEdit) setAnchorEdit(false);
    stage.setMode(mode);
    drawTools();
  }
  function setAnchorEdit(on) {
    if (on && state.anchorLocked) { toast('The anchor is locked. Unlock it first (L).'); return; }
    if (on) selectShape(null);
    stage.setAnchorEdit(on);
    drawTools();
    drawHud();
  }
  function drawTools() {
    modes.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', !stage.anchorEdit && b.dataset.tool === stage.mode));
    anchorTool.classList.toggle('anchor-on', stage.anchorEdit);
    anchorTool.disabled = !!state.anchorLocked;
    snapTool.classList.toggle('on', stage.snap);
    spaceTool.title = (space === 'world' ? 'World' : 'Local') + ' axes — click to switch';
  }

  function drawHud() {
    clear(hud);
    const s = state;
    const height = (s.heightMeters * s.scale).toFixed(2);
    if (stage.anchorEdit) hud.appendChild(h('span.hud-pill.anchor', h('strong', 'Anchor'), ' — drag it; the figure stays put'));
    if (selected !== null) {
      hud.appendChild(h('span.hud-pill.anchor', h('strong', shapeName(selected)),
        ' — G move, R turn, S size; Esc for the figure'));
      return;
    }
    [
      h('span.hud-pill', h('strong', height + ' m'), ' tall'),
      h('span.hud-pill', 'at ', h('strong', `${s.offset.x.toFixed(2)}, ${s.offset.y.toFixed(2)}, ${s.offset.z.toFixed(2)}`), ' m'),
      h('span.hud-pill', 'turned ', h('strong', Math.round(s.rotation.y) + '°')),
      stage.axis ? h('span.hud-pill', 'only ', h('strong', stage.axis.toUpperCase())) : null,
    ].forEach((pill) => { if (pill) hud.appendChild(pill); });
  }

  // ---- the panel
  const xyz = (label, get, set, step, unit) => {
    const inputs = ['x', 'y', 'z'].map((axis) => {
      const input = numberInput(get()[axis], { step, onchange: (v) => set(axis, v) });
      input.title = label + ' ' + axis.toUpperCase() + (unit ? ' (' + unit + ')' : '');
      return input;
    });
    const row = h('div.xyz', h('span', label), inputs.map((input, i) => h('div.axis.' + 'xyz'[i], input)));
    row.sync = () => { const v = get(); inputs.forEach((input, i) => input.setValue(v['xyz'[i]])); };
    row.disable = (off) => inputs.forEach((input) => { input.disabled = off; });
    return row;
  };

  const posRow = xyz('Position', () => state.offset, (a, v) => change((s) => { s.offset[a] = v; }), 0.01, 'm');
  const rotRow = xyz('Rotation', () => state.rotation, (a, v) => change((s) => { s.rotation[a] = v; }), 1, '°');
  const sizeInput = numberInput(state.scale, { step: 0.01, min: 0.05, max: 20, onchange: (v) => change((s) => { s.scale = Math.max(0.05, v); }) });
  const heightInput = numberInput(state.heightMeters, { step: 0.01, min: 0.05, max: 30, onchange: (v) => change((s) => { s.heightMeters = Math.max(0.05, v); }) });
  const sizeNote = h('span.faint', { style: { fontSize: '12px' } });

  const anchorMetres = () => window.ARPlacement.toMetres(state.anchor, state.heightMeters * state.scale);
  const anchorRow = xyz('Anchor', anchorMetres, (a, v) => {
    const m = anchorMetres();
    m[a] = v;
    // Typed in metres at the current size; the figure stays where it is.
    stage.anchorFromMetres({ x: m.x / state.scale, y: m.y / state.scale, z: m.z / state.scale });
  }, 0.01, 'm from the base centre');
  const lockRow = h('div.lock-row');
  const presets = h('div.chips-row', [
    ['base', 'Base centre'], ['centre', 'Centre'], ['top', 'Top'], ['front', 'Front edge'], ['back', 'Back edge'], ['feet', 'Feet (posed)'],
  ].map(([name, label]) => h('button.btn', { type: 'button', dataset: { preset: name }, onclick: () => { if (!state.anchorLocked) stage.anchorPreset(name); } }, label)));
  const pickBtn = h('button.btn.sm', { type: 'button', onclick: () => { if (state.anchorLocked) return; stage.startPick(); toast('Click a point on the figure'); } }, icon('pin'), 'Pick on the figure');

  // ---- the shadow
  let selected = null;           // the shape the gizmo holds, or null for the figure
  const strengthInput = numberInput(state.shadowOpacity, { step: 0.05, min: 0, max: 1,
    onchange: (v) => change((s) => { s.shadowOpacity = Math.max(0, Math.min(1, v)); }) });
  const followToggle = toggle(state.shadowFollow, (v) => change((s) => {
    // Remember the size the shapes are drawn at, so switching this on moves
    // nothing until the figure's size does.
    if (v && !s.shadowFollow) s.shadowScale = s.scale;
    s.shadowFollow = !!v;
  }), 'Follow the figure — sizes and turns with it');

  // The light floor is the editor's, not the exhibit's: kept in this browser.
  const FLOOR_KEY = 'studio.lightFloor';
  let lightFloor = { on: false, w: 2, d: 2, colour: '#f4f1ec' };
  try { Object.assign(lightFloor, JSON.parse(localStorage.getItem(FLOOR_KEY) || '{}')); } catch { /* private window */ }
  const setFloor = (patch) => {
    Object.assign(lightFloor, patch);
    lightFloor.w = Math.max(0.2, Math.min(12, lightFloor.w));
    lightFloor.d = Math.max(0.2, Math.min(12, lightFloor.d));
    try { localStorage.setItem(FLOOR_KEY, JSON.stringify(lightFloor)); } catch { /* not kept */ }
    stage.setPatch(lightFloor);
    drawFloorBox();
  };
  let floorDismissed = false;     // switched off by hand: not put back this visit
  const floorBox = h('div.light-floor');
  function drawFloorBox() {
    clear(floorBox);
    floorBox.append(
      toggle(lightFloor.on, (v) => { if (!v) floorDismissed = true; setFloor({ on: v }); }, 'White floor, to see the shadow by'),
      lightFloor.on ? h('div.light-floor-size',
        h('span', 'Floor'),
        h('div.axis.x', numberInput(lightFloor.w, { step: 0.1, min: 0.2, max: 12, onchange: (v) => setFloor({ w: v }) })),
        h('div.axis.z', numberInput(lightFloor.d, { step: 0.1, min: 0.2, max: 12, onchange: (v) => setFloor({ d: v }) })),
        h('input.swatch-input', { type: 'color', value: lightFloor.colour, title: 'Floor colour',
          oninput: (e) => { lightFloor.colour = e.target.value; stage.setPatch(lightFloor); },
          onchange: (e) => setFloor({ colour: e.target.value }) })) : null,
      lightFloor.on ? h('div.chips-row', [[1, '1 m'], [2, '2 m'], [3, '3 m'], [5, '5 m']].map(([m, label]) =>
        h('button.btn', { type: 'button', onclick: () => setFloor({ w: m, d: m }) }, label))) : null);
  }

  const SHAPE_NAMES = { ellipse: 'Ellipse', rect: 'Rectangle', image: 'Picture' };
  const shapeName = (i) => {
    const b = (state.shadows || [])[i];
    return b ? SHAPE_NAMES[b.s || 'ellipse'] + ' ' + (i + 1) : '';
  };

  function selectShape(i) {
    const list = state.shadows || [];
    selected = i !== null && i >= 0 && i < list.length ? i : null;
    if (selected !== null) {
      if (stage.anchorEdit) { stage.setAnchorEdit(false); }
      // Seeing what you draw: the white floor goes down the first time.
      if (!lightFloor.on && !floorDismissed) setFloor({ on: true });
    }
    stage.setShadowEdit(selected);
    syncPanel();
  }

  /** A new shape's starting point: where the automatic circle lies, or beside the last one. */
  function startShape(kind) {
    const list = state.shadows || [];
    const auto = stage.autoBlob();
    const last = list[list.length - 1];
    const base = last
      ? { x: round(last.x + 0.15, 0.01), z: last.z, w: last.w * 0.6, d: last.d * 0.6, r: last.r, o: last.o, c: last.c }
      : { x: round(auto.x, 0.001), z: round(auto.z, 0.001), w: round(auto.w, 0.01), d: round(auto.d, 0.01), r: 0, o: 1, c: '#000000' };
    if (kind === 'rect') return { s: 'rect', ...base, d: round(base.d * 0.6, 0.01), f: 0.5 };
    return { s: 'ellipse', ...base, f: 1 };
  }

  function addShape(blob) {
    change((s) => {
      s.shadows = s.shadows || [];
      if (!s.shadows.length) s.shadowScale = s.scale;     // the size it is drawn at
      s.shadows.push(blob);
    });
    selectShape(state.shadows.length - 1);
  }

  function removeShape(i) {
    if (i === null || i === undefined) return;
    selectShape(null);
    change((s) => { s.shadows.splice(i, 1); });
  }

  function duplicateShape(i) {
    const b = state.shadows[i];
    addShape({ ...JSON.parse(JSON.stringify(b)), x: round(b.x + 0.1, 0.001) });
  }

  /**
   * A picture of a shadow: scaled down to 1024 px, kept as PNG, uploaded
   * beside the figure. With `into`, it replaces that shape's picture and keeps
   * its place, width, turn and colour.
   */
  async function addPicture(into = null) {
    const file = await pickFile('image/png,image/webp,image/jpeg');
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('That picture is ' + bytes(file.size) + ' — keep it under 8 MB.', 'err'); return; }
    toast('Uploading the shadow picture…');
    try {
      const { blob, width, height } = await shrinkPicture(file, 1024);
      const name = file.name.replace(/\.[a-z0-9]+$/i, '');
      const got = await ctx.data.upload('exhibits/' + id, 'shadow', new File([blob], name + '.png', { type: 'image/png' }));
      if (into !== null) {
        change((s) => { Object.assign(s.shadows[into], { src: got.url, n: name.slice(0, 80), d: round(s.shadows[into].w * (height / width), 0.01) }); });
        toast('Picture replaced.', 'ok');
        return;
      }
      const auto = stage.autoBlob();
      const w = Math.max(0.2, round(auto.w * 1.2, 0.01));
      addShape({ s: 'image', src: got.url, n: name.slice(0, 80), x: round(auto.x, 0.001), z: round(auto.z, 0.001),
        w, d: round(w * (height / width), 0.01), r: 0, o: 1, c: '#000000' });
      toast('Picture added. Move, turn and size it on the floor.', 'ok');
    } catch (err) {
      toast(explain(err), 'err');
    }
  }

  const shapesBox = h('div.shadow-shapes');
  let drawnSig = '';
  const editorSyncs = [];

  /** The list, redrawn only when its make-up changes; values are synced in place. */
  function drawShapes() {
    const list = state.shadows || [];
    const sig = JSON.stringify([selected, list.map((b) => [b.s, b.src || ''])]);
    if (sig === drawnSig) { editorSyncs.forEach((f) => f()); return; }
    drawnSig = sig;
    editorSyncs.length = 0;
    clear(shapesBox);

    if (!list.length) {
      shapesBox.appendChild(h('p.note', 'One soft circle, sized from the figure. Add shapes to draw your own — ' +
        'one for the body, one per foot, a long one under an arm — or a picture of a painted shadow.'));
    }
    list.forEach((b, i) => {
      const on = i === selected;
      const swatch = b.s === 'image'
        ? h('span.shape-swatch.pic', { style: { backgroundImage: 'url("' + b.src.replace(/"/g, '%22') + '")' } })
        : h('span.shape-swatch.' + (b.s === 'rect' ? 'rect' : 'ellipse'), { style: { background: b.c || '#000' } });
      const row = h('div.shape-row' + (on ? '.on' : ''),
        h('button.shape-pick', { type: 'button', onclick: () => selectShape(on ? null : i), title: on ? 'Back to the figure' : 'Edit this shape' },
          swatch, h('span.grow', shapeName(i), b.s === 'image' && b.n ? h('span.faint', ' · ' + b.n) : null)),
        h('button.icon-btn', { type: 'button', title: 'Duplicate', onclick: () => duplicateShape(i) }, icon('plus')),
        h('button.icon-btn', { type: 'button', title: 'Remove (Delete)', onclick: () => removeShape(i) }, icon('trash')));
      shapesBox.appendChild(row);
      if (on) shapesBox.appendChild(shapeEditor(i));
    });

    shapesBox.appendChild(h('div.chips-row',
      h('button.btn', { type: 'button', onclick: () => addShape(startShape('ellipse')) }, icon('plus'), 'Ellipse'),
      h('button.btn', { type: 'button', onclick: () => addShape(startShape('rect')) }, icon('plus'), 'Rectangle'),
      h('button.btn', { type: 'button', onclick: () => addPicture() }, icon('upload'), 'Picture (PNG)'),
      list.length ? h('button.btn.ghost', { type: 'button', title: 'Back to the automatic circle',
        onclick: () => { selectShape(null); change((s) => { s.shadows = []; }); } }, 'Clear') : null));
  }

  /** The selected shape's numbers. */
  function shapeEditor(i) {
    const b = () => state.shadows[i];
    const set = (key) => (v) => change((s) => { s.shadows[i][key] = v; });
    const num = (key, opts) => {
      const input = numberInput(b()[key], { ...opts, onchange: (v) => set(key)(Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, v))) });
      editorSyncs.push(() => input.setValue(b()[key]));
      return input;
    };
    const slider = (label, key, fallback) => {
      const out = h('span.mono.faint');
      const input = h('input', { type: 'range', min: 0, max: 1, step: 0.01,
        oninput: () => { preview((s) => { s.shadows[i][key] = parseFloat(input.value); }); out.textContent = parseFloat(input.value).toFixed(2); },
        onchange: () => push() });
      const sync = () => {
        const v = typeof b()[key] === 'number' ? b()[key] : fallback;
        if (document.activeElement !== input) input.value = String(v);
        out.textContent = v.toFixed(2);
      };
      sync();
      editorSyncs.push(sync);
      return h('div.slider-row', h('span', label), input, out);
    };
    const colour = h('input.swatch-input', { type: 'color', value: b().c || '#000000', title: 'Any colour',
      oninput: (e) => preview((s) => { s.shadows[i].c = e.target.value; }),
      onchange: () => { push(); syncPanel(); } });
    const swatches = h('div.shadow-swatches', window.ARShadows.COLOURS.map(([hex, label]) =>
      h('button.swatch', { type: 'button', title: label, dataset: { hex }, style: { background: hex },
        onclick: () => set('c')(hex) })), colour);
    editorSyncs.push(() => {
      const c = (b().c || '#000000').toLowerCase();
      swatches.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.hex === c));
      if (document.activeElement !== colour) colour.value = c;
    });

    const isPicture = b().s === 'image';
    const editor = h('div.shape-editor',
      isPicture ? null : field2('Shape', segmented([['ellipse', 'Ellipse'], ['rect', 'Rectangle']], b().s || 'ellipse',
        (v) => change((s) => { s.shadows[i].s = v; s.shadows[i].f = window.ARShadows.defaultFeather(v); }))),
      h('div.xyz', h('span', 'Position'), h('div.axis.x', num('x', { step: 0.01, min: -5, max: 5 })), h('div.axis.z', num('z', { step: 0.01, min: -5, max: 5 })),
        h('span.faint', { style: { fontSize: '12px' } }, 'm')),
      h('div.xyz', h('span', 'Size'), h('div.axis.x', num('w', { step: 0.01, min: 0.01, max: 12 })), h('div.axis.z', num('d', { step: 0.01, min: 0.01, max: 12 })),
        h('span.faint', { style: { fontSize: '12px' } }, 'm')),
      h('div.xyz', h('span', 'Turn'), h('div', num('r', { step: 1, min: -360, max: 360 })), h('span.faint', { style: { gridColumn: 'span 2', fontSize: '12px' } }, '° about the vertical')),
      slider('Opacity', 'o', 1),
      isPicture ? null : slider('Softness', 'f', window.ARShadows.defaultFeather(b().s)),
      field2('Colour', swatches),
      isPicture ? h('div.chips-row',
        h('button.btn', { type: 'button', title: 'Depth from the picture\'s own proportions', onclick: () => fitPicture(i) }, 'Picture proportions'),
        h('button.btn', { type: 'button', onclick: () => addPicture(i) }, 'Replace picture')) : null,
      h('p.note', 'Drag it on the floor with the gizmo: G moves, R turns, S sizes. Click another shape to switch, or Esc for the figure.'));
    return editor;
  }

  function fitPicture(i) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => change((s) => { s.shadows[i].d = round(s.shadows[i].w * (img.naturalHeight / img.naturalWidth), 0.01); });
    img.src = state.shadows[i].src;
  }

  const timeline = h('input', { type: 'range', min: 0, max: 1000, value: 0 });
  const timeLabel = h('span.mono.faint', '0.0 s');
  const playBtn = h('button.icon-btn', { type: 'button', title: 'Play / pause (Space)' }, icon('play'));
  const feet = h('p.feet', 'Check where the feet go through the whole clip.');

  panel.append(
    section('Transform', 'move', [
      posRow, rotRow,
      h('div.xyz', h('span', 'Size ×'), h('div', sizeInput), h('span', { style: { gridColumn: 'span 2' } }, sizeNote)),
      h('div.xyz', h('span', 'Height'), h('div', heightInput), h('span.faint', { style: { gridColumn: 'span 2', fontSize: '12px' } }, 'm, before Size — the real figure')),
      h('div.chips-row',
        h('button.btn', { type: 'button', onclick: () => { const d = stage.dropToFloor(); syncPanel(); toast(`Lowest point moved ${(d * 100).toFixed(1)} cm onto the floor.`); } }, 'Drop to floor'),
        h('button.btn', { type: 'button', onclick: () => change((s) => { s.offset = { x: 0, y: s.offset.y, z: 0 }; }) }, 'Centre on the spot'),
        h('button.btn', { type: 'button', onclick: () => change((s) => { s.rotation = { x: 0, y: 0, z: 0 }; }) }, 'Face the visitor')),
      h('p.note', 'Position is in metres from where the visitor taps — x to their right, y up, z towards them.'),
    ]),
    section('Anchor', 'anchor', [
      lockRow, anchorRow, presets,
      h('div.chips-row', pickBtn,
        h('button.btn.sm', { type: 'button', onclick: () => setAnchorEdit(!stage.anchorEdit) }, icon('move'), 'Drag it (A)')),
      h('p.note', 'The anchor is the point that lands on the tapped spot and that everything turns and scales about. Moving it never moves the figure. Lock it once it is right.'),
    ], 'anchor-sec'),
    stage.duration ? section('Animation', 'play', [
      h('div.timeline', playBtn, timeline, timeLabel),
      field2('On the floor', segmented([['once', 'Play once'], ['loop', 'Loop'], ['hold', 'Hold still']],
        state.playClip === false ? 'hold' : (state.loopClip ? 'loop' : 'once'),
        (v) => change((s) => { s.playClip = v !== 'hold'; s.loopClip = v === 'loop'; }))),
      h('button.btn.sm', { type: 'button', onclick: () => checkFloor() }, 'Check the floor through the clip'),
      feet,
    ]) : null,
    section('Shadow', 'shadow', [
      h('div.xyz', h('span', 'Strength'), h('div', strengthInput),
        h('span.faint', { style: { gridColumn: 'span 2', fontSize: '12px' } }, '0 – 1; 0 for a shadow baked into the model')),
      followToggle,
      toggle(true, (v) => stage.showFigure(v), 'Show the figure — hide it to see the shadow from above'),
      floorBox,
      shapesBox,
    ], 'shadow-sec'),
    section('Look', 'eye', [
      field2('Shading', segmented([['baked', 'Baked'], ['lit', 'Lit']], state.lighting, (v) => change((s) => { s.lighting = v; }))),
      toggle(state.spin, (v) => change((s) => { s.spin = v; }), 'Turntable spin'),
    ]),
    section('View', 'frame', [
      toggle(false, (v) => stage.showHuman(v), 'A 1.70 m person, for scale'),
      toggle(true, (v) => stage.showGrid(v), 'Floor grid (10 cm, 1 m)'),
    ]));

  function syncPanel() {
    if (selected !== null && selected >= (state.shadows || []).length) { selected = null; stage.setShadowEdit(null); }
    strengthInput.setValue(state.shadowOpacity);
    followToggle.querySelector('input').checked = !!state.shadowFollow;
    drawShapes();
    posRow.sync(); rotRow.sync(); anchorRow.sync();
    sizeInput.setValue(state.scale);
    heightInput.setValue(state.heightMeters);
    sizeNote.textContent = '= ' + (state.heightMeters * state.scale).toFixed(2) + ' m tall';
    const locked = !!state.anchorLocked;
    anchorRow.disable(locked);
    presets.querySelectorAll('button').forEach((b) => { b.disabled = locked; });
    pickBtn.disabled = locked;
    clear(lockRow);
    lockRow.className = 'lock-row' + (locked ? ' locked' : '');
    lockRow.append(icon(locked ? 'lock' : 'unlock'),
      h('div.grow', h('strong', locked ? 'Anchor locked' : 'Anchor free'),
        h('div.faint', { style: { fontSize: '12px' } }, describeAnchor(state.anchor))),
      h('button.btn.sm', { type: 'button', onclick: () => toggleLock() }, locked ? 'Unlock (L)' : 'Lock (L)'));
    drawTools();
    drawHud();
  }

  function toggleLock() {
    if (!state.anchorLocked && stage.anchorEdit) setAnchorEdit(false);
    change((s) => { s.anchorLocked = !s.anchorLocked; });
    toast(state.anchorLocked ? 'Anchor locked. Position, rotate and scale from it.' : 'Anchor unlocked.');
  }

  function checkFloor() {
    const r = stage.floorCheck(48);
    if (!r) return;
    const cm = (v) => (v * 100 >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' cm';
    const ok = Math.abs(r.end) < 0.015 && r.min > -0.04;
    feet.className = 'feet ' + (ok ? 'ok' : 'warn');
    feet.textContent = `Lowest point: ${cm(r.min)} to ${cm(r.max)} while it plays, ${cm(r.end)} on the pose it holds.` +
      (ok ? ' Feet on the floor.' : r.end > 0.015 ? ' It ends floating — try Drop to floor on the last frame.' : ' It sinks below the floor.');
  }

  // ---- animation controls
  let scrubbing = false;
  playBtn.addEventListener('click', () => togglePlay());
  timeline.addEventListener('input', () => {
    scrubbing = true;
    stage.seek((timeline.value / 1000) * stage.duration);
    playBtn.replaceChildren(icon('play'));
  });
  timeline.addEventListener('change', () => { scrubbing = false; });
  function togglePlay() {
    if (!stage.duration) return;
    if (stage.playing) { stage.pause(); playBtn.replaceChildren(icon('play')); }
    else { stage.play(!!state.loopClip); playBtn.replaceChildren(icon('pause')); }
  }
  const ticker = setInterval(() => {
    if (!stage.duration) return;
    if (!scrubbing) timeline.value = String(Math.round((stage.time() / stage.duration) * 1000));
    timeLabel.textContent = stage.time().toFixed(1) + ' s';
    if (!stage.playing && playBtn.firstChild && playBtn.querySelector('use').getAttribute('href') === '#s-pause') playBtn.replaceChildren(icon('play'));
  }, 100);

  // ---- keys
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 's') { e.preventDefault(); save(); return; }
    if (e.key === 'Control' || e.key === 'Meta') { stage.applySnap(true); return; }
    if (mod) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) { e.preventDefault(); removeShape(selected); return; }
    const map = {
      g: () => setMode('translate'), w: () => setMode('translate'),
      r: () => setMode('rotate'), e: () => setMode('rotate'), s: () => setMode('scale'),
      a: () => setAnchorEdit(!stage.anchorEdit), '.': () => setAnchorEdit(!stage.anchorEdit),
      l: () => toggleLock(), f: () => stage.frameFigure(),
      x: () => axis('x'), y: () => axis('y'), z: () => axis('z'),
      0: () => stage.view('visitor'), 1: () => stage.view('front'), 3: () => stage.view('side'),
      7: () => stage.view('top'), 5: () => stage.view('persp'),
      ' ': () => togglePlay(),
      escape: () => { stage.stopPick(); if (selected !== null) selectShape(null); if (stage.anchorEdit) setAnchorEdit(false); axis(null, true); },
    };
    const fn = map[k] || map[e.code === 'Space' ? ' ' : ''];
    if (fn) { e.preventDefault(); fn(); }
  };
  const onKeyUp = (e) => { if (e.key === 'Control' || e.key === 'Meta') stage.applySnap(false); };
  function axis(a, clearOnly) {
    stage.constrain(clearOnly || stage.axis === a ? null : a);
    drawHud();
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);

  stage.shadowPicking = true;
  stage.setPatch(lightFloor);
  drawFloorBox();
  syncPanel();
  dirty();

  return () => {
    clearInterval(ticker);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('keyup', onKeyUp);
    window.__studioDirty = false;
    delete window.__stage;
    stage.dispose();
  };
}

/** A picture no larger than `max` on its long side, as PNG, alpha kept. */
async function shrinkPicture(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('that file is not a picture this browser can read'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * k));
    const height = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the picture could not be prepared');
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function section(title, ico, children, cls = '') {
  return h('section.panel-sec' + (cls ? '.' + cls : ''), h('h3', icon(ico), title), children);
}

function field2(label, control) {
  return h('div.field', h('span.field-label', label), control);
}

function describeAnchor(a) {
  if (!a || (!a.x && !a.y && !a.z)) return 'At the centre of the base — the default';
  return `${round(a.x * 100, 0.1)}%, ${round(a.y * 100, 0.1)}%, ${round(a.z * 100, 0.1)}% of its height from the base centre`;
}
