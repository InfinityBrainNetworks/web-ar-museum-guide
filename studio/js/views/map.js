/**
 * The map: the gallery's floor plan, with a pin where each exhibit hangs.
 *
 * Visitors get it in the guide's Map tab - every painting as a numbered pin,
 * the ones they have already found marked, a tap away from its label. Pins
 * are stored on each exhibit as a fraction of the plan's width and height,
 * so a replacement plan drawn at another size keeps them where they were.
 *
 * Click an exhibit in the list, then click on the plan to drop its pin; drag
 * a pin to move it. Like everything else here, it reaches visitors with the
 * next release.
 */
import { h, clear, icon, toast, explain, pickFile, dropTarget, confirm, bytes } from '../ui.js';
import { afterSave } from '../autopublish.js';

const PLAN_EDGE = 2400;

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('Map', 'Where every exhibit is in the gallery');

  let map = await data.getMap();
  let exhibits = [];
  let selected = null;

  const stage = h('div.map-edit');
  const list = h('div.map-list');
  ctx.page.append(h('div.map-layout', h('div.card.map-canvas', stage), h('div.card', h('div.card-head', icon('pin'),
    h('div.grow', h('h2', 'Exhibits'), h('p', 'Pick one, then click the plan.'))), list)));
  const actions = () => ctx.setActions(h('button.btn', { type: 'button', onclick: () => choosePlan() },
    icon('upload'), map && map.image ? 'Replace the plan' : 'Upload a floor plan'));

  // ---- the plan
  async function usePlan(file) {
    if (!/^image\//.test(file.type)) { toast('That is not an image.', 'err'); return; }
    try {
      const prepared = await shrink(file);
      const got = await data.upload('site', 'plan', prepared.file);
      map = { image: { url: got.url, path: got.path, width: prepared.width, height: prepared.height, size: got.size } };
      await data.saveMap(map);
      toast('Floor plan saved.', 'ok');
      draw();
    } catch (err) { toast(explain(err), 'err'); }
  }
  async function choosePlan() { const f = await pickFile('image/png,image/jpeg,image/webp'); if (f) usePlan(f); }

  function draw() {
    actions();
    clear(stage);
    if (!map || !map.image) {
      const zone = h('div.drop', { style: { minHeight: '420px' }, onclick: () => choosePlan() },
        icon('floorplan'), h('strong', 'Upload the gallery’s floor plan'),
        h('span.faint', 'A PNG or JPEG of the rooms, as visitors would read it. Drop it here, or click.'));
      dropTarget(zone, usePlan);
      stage.appendChild(zone);
      drawList();
      return;
    }
    const plan = h('div.map-plan');
    const img = h('img', { src: map.image.url, alt: 'Floor plan', draggable: false });
    plan.appendChild(img);
    exhibits.forEach((ex, i) => {
      if (!ex.mapPin) return;
      plan.appendChild(pin(ex, i, plan));
    });
    plan.addEventListener('click', (e) => {
      if (e.target.closest('.map-pin') || !selected) return;
      const r = img.getBoundingClientRect();
      const at = { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
      place(selected, at);
    });
    stage.append(plan, h('p.faint', { style: { padding: '10px 14px 14px' } },
      `${map.image.width}×${map.image.height} px · ${bytes(map.image.size)} · ` +
      (selected ? 'Click where “' + selected.name + '” hangs.' : 'Pick an exhibit on the right to place it.')));
    drawList();
  }

  function pin(ex, i, plan) {
    const node = h('button.map-pin' + (selected && selected.id === ex.id ? '.on' : ''), {
      type: 'button', title: ex.name,
      style: { left: (ex.mapPin.x * 100) + '%', top: (ex.mapPin.y * 100) + '%' },
    }, String(i + 1));
    // Drag to move.
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.setPointerCapture(e.pointerId);
      const r = plan.querySelector('img').getBoundingClientRect();
      let moved = false;
      const move = (ev) => {
        moved = true;
        node.style.left = (clamp01((ev.clientX - r.left) / r.width) * 100) + '%';
        node.style.top = (clamp01((ev.clientY - r.top) / r.height) * 100) + '%';
      };
      const up = (ev) => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        if (moved) place(ex, { x: clamp01((ev.clientX - r.left) / r.width), y: clamp01((ev.clientY - r.top) / r.height) });
        else { selected = ex; draw(); }
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
    return node;
  }

  async function place(ex, at) {
    const rounded = { x: Math.round(at.x * 10000) / 10000, y: Math.round(at.y * 10000) / 10000 };
    // On to the next unplaced exhibit at once, not when the server answers:
    // the pin itself shows up straight away, and a second click made in
    // between used to move this pin again instead of placing the next one.
    const was = ex.mapPin;
    ex.mapPin = rounded;
    selected = exhibits.find((x) => !x.mapPin && x.id !== ex.id) || null;
    draw();
    try {
      await data.saveExhibit(ex.id, { mapPin: rounded });
      afterSave('map pins', toast);
    } catch (err) {
      ex.mapPin = was;
      toast(explain(err), 'err');
      draw();
    }
  }

  function drawList() {
    clear(list);
    const placed = exhibits.filter((e) => e.mapPin).length;
    list.appendChild(h('div.card-body', { style: { gap: '6px', paddingTop: '12px' } },
      h('p.faint', `${placed} of ${exhibits.length} placed`),
      exhibits.map((ex, i) => h('div.map-row' + (selected && selected.id === ex.id ? '.on' : ''), {
        onclick: () => { selected = ex; draw(); },
      },
        h('span.map-num' + (ex.mapPin ? '.placed' : ''), String(i + 1)),
        h('span.grow', ex.name),
        ex.mapPin ? h('button.icon-btn', {
          type: 'button', title: 'Take the pin off the map',
          onclick: async (e) => {
            e.stopPropagation();
            if (!(await confirm('Remove this pin?', `“${ex.name}” will not be on the map.`, { ok: 'Remove', danger: true }))) return;
            await data.saveExhibit(ex.id, { mapPin: null })
              .then(() => afterSave('map pins', toast), (err) => toast(explain(err), 'err'));
            ex.mapPin = null;
            draw();
          },
        }, icon('trash')) : h('span.chip', 'not placed')))));
  }

  const stop = data.watchExhibits((all) => {
    exhibits = all;
    if (selected) selected = exhibits.find((e) => e.id === selected.id) || null;
    if (!selected) selected = exhibits.find((e) => !e.mapPin) || null;
    draw();
  }, (err) => toast(explain(err), 'err'));
  return stop;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** At most 2400 px on the long edge; a PNG stays a PNG (line drawings compress better). */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PLAN_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), hgt = Math.round(bitmap.height * scale);
  if (scale === 1 && /png|jpeg/.test(file.type)) {
    if (bitmap.close) bitmap.close();
    return { file, width: w, height: hgt };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const g = canvas.getContext('2d');
  const png = file.type === 'image/png';
  if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, hgt); }
  g.drawImage(bitmap, 0, 0, w, hgt);
  if (bitmap.close) bitmap.close();
  const type = png ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.88));
  return { file: new File([blob], 'plan.' + (png ? 'png' : 'jpg'), { type }), width: w, height: hgt };
}
