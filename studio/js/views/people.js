/**
 * People: who can open the Studio, and as what.
 *
 * Anyone is added by their Google address, before they have ever signed in.
 * Admins add and remove admins, editors and moderators; owners can do that
 * to owners too, and nobody - not even another owner - can remove the last
 * thing standing between the museum and a locked Studio: an owner cannot
 * demote or delete themselves. firestore.rules enforces all of it; this
 * screen just offers what the rules will allow.
 */
import { h, clear, icon, toast, explain, when, confirm, dialog } from '../ui.js';

const ROLES = [
  ['admin', 'Admin', 'Everything: content, going live, and the people on this list.'],
  ['editor', 'Editor', 'Exhibits, the floor editor, compiling and building releases. Cannot go live or manage people.'],
  ['moderator', 'Moderator', 'The photobooth queue and the feedback inbox only — the front desk.'],
];

export async function render(ctx) {
  const { data } = ctx;
  ctx.setTitle('People', 'Who can open the Studio');
  const me = ctx.user.email.toLowerCase();
  let members = [];
  let requests = [];

  const reqCard = h('div');
  const listCard = h('div.card');
  ctx.page.append(reqCard, listCard);
  ctx.setActions(h('button.btn.primary', { type: 'button', onclick: () => add() }, icon('plus'), 'Add a person'));

  const canManage = (m) => m.email !== me && (m.role !== 'owner' || ctx.role === 'owner');

  const draw = () => {
    clear(reqCard);
    if (requests.length) {
      reqCard.appendChild(h('div.card',
        h('div.card-head', icon('people'), h('div.grow', h('h2', 'Asking to join'), h('p', 'Signed in to the Studio and asked for access.'))),
        h('div.table-wrap', h('table.table', h('tbody', requests.map((r) => h('tr',
          h('td', h('strong', r.name || r.email), h('div.faint', r.email)),
          h('td.muted', r.message || '—'),
          h('td.faint', when(r.at)),
          h('td', h('div.row', { style: { justifyContent: 'flex-end' } },
            ROLES.map(([role, label]) => h('button.btn.sm' + (role === 'moderator' ? '' : ''), {
              type: 'button', onclick: () => grant(r.email, role),
            }, 'Add as ' + label.toLowerCase())),
            h('button.btn.sm.danger', { type: 'button', onclick: () => data.dismissRequest(r.email).catch((e) => toast(explain(e), 'err')) }, 'Dismiss'))))))))));
    }

    clear(listCard);
    listCard.appendChild(h('div.card-head', icon('people'), h('div.grow', h('h2', `The team (${members.length})`),
      h('p', 'Roles include everything below them: owner › admin › editor › moderator.'))));
    listCard.appendChild(h('div.table-wrap', h('table.table',
      h('thead', h('tr', h('th', 'Person'), h('th', 'Role'), h('th', 'Added'), h('th'))),
      h('tbody', members.map((m) => h('tr',
        h('td', h('strong', m.name || m.email), m.name ? h('div.faint', m.email) : null, m.email === me ? h('span.chip', 'you') : null),
        h('td', canManage(m)
          ? h('select', {
            style: { width: 'auto' },
            onchange: async (e) => {
              try { await data.setRole(m.email, e.target.value); toast(`${m.email} is now ${e.target.value}.`, 'ok'); }
              catch (err) { toast(explain(err), 'err'); draw(); }
            },
          }, (ctx.role === 'owner' ? [['owner', 'Owner'], ...ROLES] : ROLES).map(([v, label]) => h('option', { value: v, selected: m.role === v }, label)))
          : h('span.role.' + m.role, m.role)),
        h('td.faint', m.addedBy === 'claim' ? 'claimed the Studio' : `${when(m.addedAt)}${m.addedBy ? ' by ' + m.addedBy : ''}`),
        h('td', canManage(m) ? h('button.icon-btn', { type: 'button', title: 'Remove', onclick: () => remove(m) }, icon('trash')) : null)))))));
  };

  async function grant(email, role) {
    try { await data.addMember(email, role); toast(`${email} added as ${role}.`, 'ok'); }
    catch (err) { toast(explain(err), 'err'); }
  }

  async function add() {
    const result = await dialog({
      title: 'Add a person',
      build: (body) => {
        body.append(
          h('label.field', h('span.field-label', 'Google account email'),
            h('input', { type: 'email', name: 'email', placeholder: 'name@gmail.com', autocomplete: 'off' })),
          h('div.field', h('span.field-label', 'Role'),
            h('div.stack', { style: { gap: '8px' } }, ROLES.map(([role, label, what], i) => h('label.check', { style: { cursor: 'pointer' } },
              h('input', { type: 'radio', name: 'role', value: role, checked: i === 1 }),
              h('div', h('strong', label), h('div.muted', what)))))),
          h('label.field', h('span.field-label', 'Note (optional)'), h('input', { type: 'text', name: 'note', maxLength: 200, placeholder: 'e.g. Curator, Sigiriya gallery' })),
          h('p', 'They sign in with that address at this Studio’s link. Nothing is emailed to them — send them the link yourself.'));
      },
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Add', kind: 'primary',
        validate: (body) => {
          const v = body.querySelector('[name=email]').value.trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('That does not look like an email address.', 'err'); return false; }
          return true;
        },
        value: (body) => ({
          email: body.querySelector('[name=email]').value.trim().toLowerCase(),
          role: body.querySelector('[name=role]:checked').value,
          note: body.querySelector('[name=note]').value.trim(),
        }),
      }],
    });
    if (!result) return;
    if (members.some((m) => m.email === result.email)) { toast(result.email + ' is already on the team.', 'err'); return; }
    try { await data.addMember(result.email, result.role, result.note); toast(`${result.email} added as ${result.role}.`, 'ok'); }
    catch (err) { toast(explain(err), 'err'); }
  }

  async function remove(m) {
    if (!(await confirm('Remove ' + m.email + '?', 'They will be signed out of the Studio the next time it checks.', { ok: 'Remove', danger: true }))) return;
    try { await data.removeMember(m.email); toast(m.email + ' removed.', 'ok'); }
    catch (err) { toast(explain(err), 'err'); }
  }

  const stops = [
    data.watchMembers((list) => { members = list; draw(); }, (err) => toast(explain(err), 'err')),
    data.watchRequests((list) => { requests = list; draw(); }, () => {}),
  ];
  return () => stops.forEach((s) => s());
}
