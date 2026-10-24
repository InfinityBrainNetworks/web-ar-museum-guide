/**
 * The photobooth: visitors' AR photos, shared with their consent, on their
 * way to the wall at /photobooth.
 *
 * Nothing reaches the wall without a moderator's yes, unless Auto-approve is
 * on. Hide takes a photo off the wall but keeps it; Delete removes the file
 * for good - which is also what a visitor can do to their own photo, any
 * time, from the phone that took it.
 */
import { h, clear, icon, toast, explain, when, confirm, toggle, segmented, field, copy } from '../ui.js';
import { qrImage } from '../qr.js';

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('Photobooth', 'Visitors’ photos, on their way to the wall');
  const wallUrl = window.AR_CLOUD.appUrl + 'photobooth/' + (window.AR_CLOUD.emulators ? '?emu=1' : '');
  let site = await data.getSite();
  let tab = 'pending';
  let stop = null;

  const settings = h('div.card');
  const tabs = h('div');
  const grid = h('div.photo-grid');
  ctx.page.append(settings, h('div.row', tabs), grid);
  ctx.setActions(h('a.btn', { href: wallUrl, target: '_blank', rel: 'noopener' }, icon('external'), 'Open the wall'));

  const drawSettings = () => {
    clear(settings);
    const pb = site.photobooth;
    const admin = ctx.can('admin');
    const set = async (patch) => {
      try {
        await data.saveSite({ photobooth: { ...site.photobooth, ...patch } });
        site = await data.getSite();
        drawSettings();
      } catch (err) { toast(explain(err), 'err'); }
    };
    const title = h('input', { type: 'text', value: pb.title || '', maxLength: 80, disabled: !admin,
      onchange: () => set({ title: title.value.trim() }) });
    const note = h('input', { type: 'text', value: pb.note || '', maxLength: 160, disabled: !admin,
      placeholder: 'e.g. Share yours from the AR guide', onchange: () => set({ note: note.value.trim() }) });
    const qr = h('div.qr', { style: { margin: 0 } }, h('div.spinner'));
    qrImage(wallUrl, { cell: 4 }).then((img) => { img.style.width = img.style.height = '120px'; qr.replaceChildren(img); }).catch(() => qr.remove());

    settings.append(
      h('div.card-head', icon('camera'), h('div.grow', h('h2', 'The wall'),
        h('p', pb.enabled ? 'Visitors can share photos from the AR guide.' : 'Switched off: the guide does not offer sharing.'))),
      h('div.card-body', h('div.row', { style: { alignItems: 'flex-start', gap: '24px' } },
        h('div.stack.grow',
          h('div.row',
            toggle(pb.enabled, (v) => set({ enabled: v }), 'Visitors can share to the wall'),
            toggle(pb.autoApprove, (v) => set({ autoApprove: v }), 'Auto-approve (no moderation)')),
          pb.autoApprove ? h('div.banner.warn', icon('warn'), h('div', 'Shared photos go straight onto the public wall. Keep an eye on it.')) : null,
          h('div.fields', field('Wall title', title), field('Line under it', note)),
          h('div.row', h('code.mono.faint', wallUrl), h('button.btn.sm', { type: 'button', onclick: () => copy(wallUrl) }, 'Copy link')),
          !admin ? h('p.faint', 'Only an admin can change these.') : null),
        qr)));
  };

  const drawTabs = () => {
    clear(tabs);
    tabs.appendChild(segmented([['pending', 'Waiting'], ['approved', 'On the wall'], ['hidden', 'Hidden']], tab, (v) => { tab = v; watch(); }));
  };

  const card = (p) => {
    const act = (patch, msg) => data.moderatePhoto(p.id, patch).then(() => toast(msg, 'ok')).catch((err) => toast(explain(err), 'err'));
    return h('div.photo' + (p.featured ? '.featured' : ''),
      h('img', { src: p.url, alt: p.name ? 'Photo by ' + p.name : 'Visitor photo', loading: 'lazy' }),
      h('div.photo-meta',
        h('strong', p.name || 'Anonymous'),
        h('span.faint', [p.exhibitName, when(p.createdAt)].filter(Boolean).join(' · '))),
      h('div.photo-actions',
        p.status !== 'approved' ? h('button.btn.sm.ok', { type: 'button', onclick: () => act({ status: 'approved' }, 'On the wall.') }, icon('check'), 'Approve') : null,
        p.status === 'approved' ? h('button.btn.sm', { type: 'button', onclick: () => act({ featured: !p.featured }, p.featured ? 'No longer featured.' : 'Featured on the wall.') },
          icon('star'), p.featured ? 'Unfeature' : 'Feature') : null,
        p.status !== 'hidden' ? h('button.btn.sm', { type: 'button', onclick: () => act({ status: 'hidden', featured: false }, 'Hidden from the wall.') }, icon('eye-off'), 'Hide') : null,
        h('button.icon-btn', {
          type: 'button', title: 'Delete for good',
          onclick: async () => {
            if (!(await confirm('Delete this photo?', 'The file is removed for good.', { ok: 'Delete', danger: true }))) return;
            data.deletePhoto(p).then(() => toast('Deleted.', 'ok')).catch((err) => toast(explain(err), 'err'));
          },
        }, icon('trash'))));
  };

  const watch = () => {
    drawTabs();
    if (stop) stop();
    clear(grid);
    grid.appendChild(h('div.empty', h('div.spinner')));
    stop = data.watchPhotos(tab, (list) => {
      clear(grid);
      if (!list.length) {
        grid.appendChild(h('div.empty', { style: { gridColumn: '1 / -1' } }, icon('camera'),
          h('p', { pending: 'Nothing waiting. New photos appear here the moment they are shared.', approved: 'The wall is empty.', hidden: 'Nothing hidden.' }[tab])));
        return;
      }
      list.forEach((p) => grid.appendChild(card(p)));
    }, (err) => { clear(grid); grid.appendChild(h('div.banner.bad', icon('warn'), explain(err))); });
  };

  drawSettings();
  watch();
  return () => { if (stop) stop(); };
}
