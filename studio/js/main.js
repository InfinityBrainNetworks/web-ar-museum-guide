/**
 * AR Studio: sign-in, the role gate, the shell, and the router.
 *
 * Who gets in is decided by firestore.rules, not here - this only decides
 * what to SHOW. A Google account that is not on /members sees a request-access
 * screen; the first account into a fresh project is offered ownership.
 *
 * Every screen is a module under views/, loaded the first time it is opened,
 * exporting render(ctx) and returning a cleanup function.
 */
import * as sdk from '../../js/cloud/sdk.js';
import * as data from './data.js';
import { h, clear, icon, toast, explain } from './ui.js';

const CLOUD = window.AR_CLOUD;
const root = document.getElementById('app');

const VIEWS = {
  exhibits: () => import('./views/exhibits.js'),
  exhibit: () => import('./views/editor.js'),
  floor: () => import('./views/floor.js'),
  map: () => import('./views/map.js'),
  publish: () => import('./views/publish.js'),
  photos: () => import('./views/photos.js'),
  feedback: () => import('./views/feedback.js'),
  people: () => import('./views/people.js'),
  settings: () => import('./views/settings.js'),
};

// [route, label, icon, the least role that sees it]
const NAV = [
  ['exhibits', 'Exhibits', 'grid', 'editor'],
  ['map', 'Map', 'floorplan', 'editor'],
  ['publish', 'Publish', 'publish', 'editor'],
  ['photos', 'Photobooth', 'camera', 'moderator'],
  ['feedback', 'Feedback', 'chat', 'moderator'],
  ['people', 'People', 'people', 'admin'],
  ['settings', 'Settings', 'gear', 'editor'],
];

const ctx = {
  user: null,
  member: null,
  role: null,
  can: (wanted) => sdk.roleAtLeast(ctx.role, wanted),
  go: (route) => { location.hash = '#/' + route; },
  data,
  sdk,
};

// ------------------------------------------------------------------ boot
async function boot() {
  if (!CLOUD || !CLOUD.enabled()) { noProject(); return; }
  try {
    await data.init();
  } catch (err) {
    gate([h('h1', 'The Studio could not start'), h('p', explain(err)),
      h('button.btn', { onclick: () => location.reload() }, 'Try again')]);
    return;
  }
  await sdk.onUser((user) => { decide(user).catch(fatal); });
}

function fatal(err) {
  console.error(err);
  gate([h('h1', 'Something went wrong'), h('p', explain(err)),
    h('button.btn', { onclick: () => location.reload() }, 'Reload')]);
}

async function decide(user) {
  if (!user || !sdk.isStaffAccount(user)) { signIn(); return; }
  ctx.user = user;
  let member = null;
  try {
    member = await sdk.memberOf(user);
  } catch (err) {
    if (err.code !== 'permission-denied') throw err;
  }
  if (!member) { notMember(user); return; }
  ctx.member = member;
  ctx.role = member.role;
  data.setMe({ email: user.email.toLowerCase(), role: member.role });
  shell();
}

// ------------------------------------------------------------------ gates
function gate(children) {
  clear(root);
  root.appendChild(h('div.gate', h('div.gate-card',
    h('div.gate-sigil', icon('logo')),
    h('p.eyebrow', 'AR Studio'),
    CLOUD && CLOUD.emulators ? h('span.emu-badge', 'EMULATOR MODE') : null,
    children)));
}

function noProject() {
  gate([
    h('h1', 'Connect a Firebase project'),
    h('p', 'The Studio keeps exhibits, releases and the photobooth in Firebase. ' +
           'This copy of the guide has no project configured yet.'),
    h('p', ['Paste your project’s web config into ', h('code.mono', 'js/cloud/config.js'),
            ', then follow SETUP-FIREBASE.md.']),
    h('a.btn', { href: '../admin.html' }, 'Use the offline portal instead'),
  ]);
}

const G_LOGO = '<svg class="google-g" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.5 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.4 0-11.7-4-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';

function signIn() {
  const button = h('button.btn.lg.white', {
    type: 'button',
    onclick: async () => {
      button.disabled = true;
      try { await sdk.signInWithGoogle(); }
      catch (err) { toast(explain(err), 'err'); }
      button.disabled = false;
    },
  });
  button.innerHTML = G_LOGO + '<span>Sign in with Google</span>';

  const extras = [];
  if (CLOUD.emulators) {
    // The emulator accepts an unsigned Google credential, which is what lets
    // the end-to-end tests - and you, offline - sign in as anyone.
    const email = h('input', { type: 'email', placeholder: 'curator@example.com', value: 'curator@example.com' });
    extras.push(h('div.stack', { style: { width: '100%', marginTop: '6px' } },
      h('p.faint', 'Emulator only: sign in as any address'),
      email,
      h('button.btn', {
        type: 'button', id: 'emuSignIn',
        onclick: async () => {
          const [auth, A] = await Promise.all([sdk.auth(), sdk.authApi()]);
          const address = email.value.trim().toLowerCase();
          const token = JSON.stringify({ sub: 'emu-' + address.replace(/\W/g, ''), email: address, email_verified: true, name: address.split('@')[0] });
          await A.signInWithCredential(auth, A.GoogleAuthProvider.credential(token)).catch((err) => toast(explain(err), 'err'));
        },
      }, 'Sign in (emulator)')));
  }

  gate([
    h('h1', 'Sign in to the Studio'),
    h('p', 'Add exhibits, place them on the floor, publish to visitors, and run the photobooth.'),
    button,
    extras,
    h('p.faint', 'Only accounts the museum has added can get in.'),
  ]);
}

async function notMember(user) {
  const email = user.email.toLowerCase();
  let claimed = null;
  try { claimed = await data.setupClaimed(); } catch (err) { /* treat as claimed */ claimed = {}; }

  if (!claimed) {
    const go = h('button.btn.lg.primary', {
      type: 'button',
      onclick: async () => {
        go.disabled = true;
        try {
          await data.claimOwnership(user);
          toast('This Studio is yours. Welcome.', 'ok');
          await decide(user);
        } catch (err) {
          toast(explain(err), 'err');
          go.disabled = false;
        }
      },
    }, 'Claim this Studio');
    gate([
      h('h1', 'Nobody runs this Studio yet'),
      h('p', ['Claim it with ', h('strong', email), ' and you become its owner: you can add ' +
              'admins, editors and moderators, and nobody can remove you.']),
      go,
      h('button.btn', { type: 'button', onclick: () => sdk.signOut() }, 'Use a different account'),
      h('p.faint', 'Do this straight after deploying the rules. Only the first account can.'),
    ]);
    return;
  }

  let request = null;
  try { request = await data.myRequest(user); } catch { /* none */ }
  const message = h('textarea', { placeholder: 'Who you are and what you need - e.g. "Front desk, photobooth only"', rows: 3 });
  const send = h('button.btn.primary', {
    type: 'button',
    onclick: async () => {
      send.disabled = true;
      try {
        await data.requestAccess(user, message.value.trim().slice(0, 500));
        toast('Request sent. An admin will see it under People.', 'ok');
        notMember(user);
      } catch (err) {
        toast(explain(err), 'err');
        send.disabled = false;
      }
    },
  }, 'Ask for access');

  gate([
    h('h1', 'You are not on the team yet'),
    h('p', ['Signed in as ', h('strong', email), '. An admin has to add this address before it can open the Studio.']),
    request
      ? h('div.banner.ok', icon('check'), h('div', h('strong', 'Request sent. '), 'An admin will see it under People.'))
      : [message, send],
    h('button.btn', { type: 'button', onclick: () => sdk.signOut() }, icon('logout'), 'Sign out'),
  ]);
}

// ------------------------------------------------------------------ shell
let cleanup = null;
let counts = { photos: 0, people: 0, feedback: 0 };
const watchers = [];

function shell() {
  clear(root);
  const nav = h('nav.side-nav');
  const side = h('aside.side',
    h('div.brand', h('div.brand-mark', icon('logo')), h('div', h('strong', 'AR Studio'), h('span', 'IBN AR Museum'))),
    nav,
    h('div.side-foot',
      h('a.nav-item', { href: CLOUD.appUrl + (CLOUD.emulators ? '?emu=1' : ''), target: '_blank', rel: 'noopener' },
        icon('external'), 'Open the guide'),
      h('a.nav-item', { href: CLOUD.appUrl + 'photobooth/' + (CLOUD.emulators ? '?emu=1' : ''), target: '_blank', rel: 'noopener' },
        icon('camera'), 'Open the photo wall'),
      h('div.me',
        ctx.user.photoURL ? h('img', { src: ctx.user.photoURL, alt: '', referrerPolicy: 'no-referrer' })
          : h('div.avatar', (ctx.user.email || '?')[0].toUpperCase()),
        h('div.me-text', h('strong', ctx.user.displayName || ctx.user.email),
          h('span.role.' + ctx.role, ctx.role))),
      h('button.btn.sm', { type: 'button', onclick: () => sdk.signOut() }, icon('logout'), 'Sign out')));

  const title = h('h1');
  const crumb = h('span.crumb');
  const actions = h('div.row');
  const menu = h('button.icon-btn.menu-btn', { type: 'button', onclick: () => frame.classList.toggle('menu-open'), attrs: { 'aria-label': 'Menu' } }, icon('grid'));
  const topbar = h('header.topbar', menu, h('div.grow', crumb, title), actions);
  const page = h('div.page');
  const main = h('main.main', topbar, page);
  const frame = h('div.shell', side, main);
  root.appendChild(frame);

  ctx.page = page;
  ctx.setTitle = (text, sub = '') => { title.textContent = text; crumb.textContent = sub; document.title = text + ' · AR Studio'; };
  ctx.setActions = (...nodes) => { clear(actions); nodes.flat().forEach((n) => n && actions.appendChild(n)); };
  ctx.frame = frame;

  const drawNav = () => {
    clear(nav);
    const current = (location.hash.replace(/^#\/?/, '').split('/')[0]) || home();
    NAV.filter(([, , , least]) => ctx.can(least)).forEach(([route, label, ico]) => {
      const count = counts[route] || 0;
      nav.appendChild(h('a.nav-item' + (current === route || (route === 'exhibits' && /^(exhibit|floor)$/.test(current)) ? '.on' : ''),
        { href: '#/' + route, onclick: () => frame.classList.remove('menu-open') },
        icon(ico), label, count ? h('span.nav-count', String(count)) : null));
    });
  };
  ctx.drawNav = drawNav;

  // Badges: what is waiting for someone.
  watchers.splice(0).forEach((stop) => stop());
  if (ctx.can('moderator')) {
    watchers.push(data.watchPhotos('pending', (list) => { counts.photos = list.length; drawNav(); }, () => {}));
    watchers.push(data.watchFeedback((list) => { counts.feedback = list.filter((f) => !f.done).length; drawNav(); }, () => {}));
  }
  if (ctx.can('admin')) {
    watchers.push(data.watchRequests((list) => { counts.people = list.length; drawNav(); }, () => {}));
  }

  // Leaving a screen with unsaved changes asks first - the floor editor holds
  // a whole placement in memory until Save.
  window.onhashchange = () => {
    if (window.__studioDirty && !window.confirm('This screen has unsaved changes. Leave without saving them?')) {
      history.replaceState(null, '', lastHash);   // put the address back; no second hashchange
      return;
    }
    route();
  };
  route();
}

let lastHash = location.hash;

function home() { return ctx.can('editor') ? 'exhibits' : 'photos'; }

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let name = parts[0] || home();
  if (!VIEWS[name]) name = home();
  const allowed = NAV.find(([r]) => r === name);
  if (allowed && !ctx.can(allowed[3])) name = home();
  if ((name === 'exhibit' || name === 'floor') && !ctx.can('editor')) name = home();

  lastHash = location.hash;
  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  clear(ctx.page);
  ctx.setActions();
  ctx.drawNav();
  ctx.frame.classList.remove('menu-open');
  ctx.frame.classList.toggle('full', name === 'floor');
  ctx.page.appendChild(h('div.empty', h('div.spinner')));

  try {
    const mod = await VIEWS[name]();
    clear(ctx.page);
    cleanup = (await mod.render({ ...ctx, params: parts.slice(1) })) || null;
  } catch (err) {
    console.error(err);
    clear(ctx.page);
    ctx.page.appendChild(h('div.banner.bad', icon('warn'), h('div', h('strong', 'This screen could not open. '), explain(err))));
  }
}

window.addEventListener('beforeunload', (e) => {
  if (window.__studioDirty) { e.preventDefault(); e.returnValue = ''; }
});

boot().catch(fatal);
