/**
 * Feedback: what visitors said from the guide's Feedback tab - a rating, a
 * few words, and which exhibit they were looking at. The inbox the old
 * "Feedback needs somewhere for the messages to go" note was waiting for.
 */
import { h, clear, icon, toast, explain, when, confirm, segmented } from '../ui.js';

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('Feedback', 'What visitors said');
  let items = [];
  let filter = 'open';

  const stats = h('div.stat-row');
  const bar = h('div.row');
  const list = h('div.card');
  ctx.page.append(stats, bar, list);

  const stars = (n) => h('span.stars', [1, 2, 3, 4, 5].map((i) => h('span' + (i <= n ? '' : '.off'), icon('star'))));

  const draw = () => {
    clear(stats);
    const avg = items.length ? items.reduce((s, f) => s + (f.rating || 0), 0) / items.length : 0;
    const open = items.filter((f) => !f.done).length;
    const byExhibit = {};
    items.forEach((f) => { if (f.exhibitName) (byExhibit[f.exhibitName] = byExhibit[f.exhibitName] || []).push(f.rating || 0); });
    const best = Object.entries(byExhibit).map(([name, r]) => [name, r.reduce((a, b) => a + b, 0) / r.length, r.length])
      .sort((a, b) => b[1] - a[1] || b[2] - a[2])[0];
    stats.append(
      h('div.stat', h('strong', items.length ? avg.toFixed(1) : '—'), h('span', 'average of ' + items.length + ' rating' + (items.length === 1 ? '' : 's'))),
      h('div.stat', h('strong', String(open)), h('span', 'not yet read')),
      best ? h('div.stat', h('strong', best[1].toFixed(1)), h('span', 'best loved: ' + best[0])) : null);

    clear(bar);
    bar.appendChild(segmented([['open', 'Unread'], ['all', 'Everything']], filter, (v) => { filter = v; draw(); }));

    clear(list);
    const shown = items.filter((f) => filter === 'all' || !f.done);
    if (!shown.length) {
      list.appendChild(h('div.empty', icon('chat'), h('p', items.length ? 'All read.' : 'No feedback yet. It arrives here from the guide’s Feedback tab.')));
      return;
    }
    shown.forEach((f) => list.appendChild(h('div.fb' + (f.done ? '.done' : ''),
      stars(f.rating || 0),
      h('div.stack', { style: { gap: '4px' } },
        h('div.fb-msg', f.message || h('span.faint', 'No words, just the stars')),
        h('div.faint', { style: { fontSize: '12px' } }, [f.exhibitName, f.lang ? f.lang.toUpperCase() : null, when(f.createdAt)].filter(Boolean).join(' · '))),
      h('div.row',
        h('button.btn.sm', { type: 'button', onclick: () => data.markFeedback(f.id, !f.done).catch((e) => toast(explain(e), 'err')) },
          icon('check'), f.done ? 'Unread' : 'Read'),
        h('button.icon-btn', {
          type: 'button', title: 'Delete',
          onclick: async () => { if (await confirm('Delete this feedback?', 'It cannot be brought back.', { ok: 'Delete', danger: true })) data.deleteFeedback(f.id).catch((e) => toast(explain(e), 'err')); },
        }, icon('trash'))))));
  };

  const stop = data.watchFeedback((list) => { items = list; draw(); }, (err) => toast(explain(err), 'err'));
  draw();
  return stop;
}
