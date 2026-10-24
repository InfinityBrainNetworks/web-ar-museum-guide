/**
 * The photo wall: approved photos from the AR guide, live.
 *
 * Reads /photos where status == 'approved', newest first, and keeps reading -
 * a photo a moderator approves in the Studio appears here within a second or
 * two, and one they hide disappears. Featured photos lead the big slideshow;
 * otherwise it walks through the latest ones. Nothing here needs signing in:
 * the rules let anyone read approved photos, and only approved ones.
 */
import * as sdk from '../js/cloud/sdk.js';

const CLOUD = window.AR_CLOUD;
const $ = (id) => document.getElementById(id);
const SLIDE_MS = 8000;
const GRID = 8;

let photos = [];
let slide = 0;
let seen = new Set();
let first = true;

function ago(ts) {
  const d = ts && ts.toDate ? ts.toDate() : null;
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function caption(p) {
  return {
    who: p.name ? p.name : 'A visitor',
    what: [p.exhibitName, ago(p.createdAt)].filter(Boolean).join(' · '),
  };
}

function message(text, spinner) {
  const hero = $('wallHero');
  hero.replaceChildren();
  const box = document.createElement('div');
  box.className = 'wall-empty';
  if (spinner) { const s = document.createElement('div'); s.className = 'wall-spinner'; box.appendChild(s); }
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(p);
  hero.appendChild(box);
}

/** The big one: featured photos first, then the newest, one after another. */
function heroOrder() {
  const featured = photos.filter((p) => p.featured);
  return featured.length ? featured.concat(photos.filter((p) => !p.featured).slice(0, 6)) : photos.slice(0, 10);
}

function showSlide() {
  const order = heroOrder();
  if (!order.length) { message('The wall is waiting for its first photo. Take one with the AR guide!'); return; }
  const p = order[slide % order.length];
  const hero = $('wallHero');
  const node = document.createElement('div');
  node.className = 'hero-slide';
  const bg = new Image(); bg.className = 'bg'; bg.alt = ''; bg.src = p.url;
  const fg = new Image(); fg.className = 'fg'; fg.alt = p.name ? 'Photo by ' + p.name : 'A visitor’s photo'; fg.src = p.url;
  const c = caption(p);
  const cap = document.createElement('div');
  cap.className = 'hero-caption';
  const who = document.createElement('strong'); who.textContent = c.who;
  const what = document.createElement('span'); what.textContent = c.what;
  cap.append(who, what);
  node.append(bg, fg, cap);
  if (p.featured) { const b = document.createElement('span'); b.className = 'hero-badge'; b.textContent = 'Featured'; node.appendChild(b); }
  hero.querySelectorAll('.wall-empty').forEach((n) => n.remove());
  hero.appendChild(node);
  const reveal = () => {
    requestAnimationFrame(() => node.classList.add('on'));
    // The previous slide fades out under the new one, then goes.
    const old = Array.from(hero.querySelectorAll('.hero-slide')).filter((n) => n !== node);
    setTimeout(() => old.forEach((n) => n.remove()), 1500);
  };
  if (fg.complete) reveal(); else { fg.onload = reveal; fg.onerror = reveal; }
}

function drawGrid() {
  const grid = $('wallGrid');
  const shown = photos.slice(0, GRID);
  grid.replaceChildren(...shown.map((p) => {
    const tile = document.createElement('figure');
    tile.className = 'tile' + (!first && !seen.has(p.id) ? ' new' : '');
    tile.style.margin = '0';
    const img = new Image();
    img.src = p.url;
    img.alt = p.name ? 'Photo by ' + p.name : 'A visitor’s photo';
    img.loading = 'lazy';
    const label = document.createElement('span');
    const c = caption(p);
    label.textContent = c.who + (p.exhibitName ? ' · ' + p.exhibitName : '');
    tile.append(img, label);
    return tile;
  }));
  photos.forEach((p) => seen.add(p.id));
  first = false;
}

async function start() {
  if (!CLOUD || !CLOUD.enabled()) {
    message('The photo wall needs the museum’s Firebase project, and this copy has none configured.');
    return;
  }
  const qrTarget = CLOUD.appUrl + (CLOUD.emulators ? '?emu=1' : '');
  import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm').then((m) => {
    const qrcode = m.default || m;
    const qr = qrcode(0, 'M');
    qr.addData(qrTarget);
    qr.make();
    const img = new Image();
    img.src = qr.createDataURL(4, 1);
    img.alt = '';
    $('wallQr').replaceChildren(img);
  }).catch(() => { $('wallQr').remove(); });

  const site = await CLOUD.getDocument('config/site', 6000).catch(() => null);
  const pb = (site && site.photobooth) || {};
  if (site && site.name) $('wallMuseum').textContent = site.name;
  if (pb.title) { $('wallTitle').textContent = pb.title; document.title = pb.title; }
  if (pb.note) $('wallNote').textContent = pb.note;
  if (site && !pb.enabled) {
    message('The photo wall is resting for now. Come back soon.');
    return;
  }

  const [F, db] = await Promise.all([sdk.firestoreApi(), sdk.db()]);
  const q = F.query(F.collection(db, 'photos'), F.where('status', '==', 'approved'),
    F.orderBy('createdAt', 'desc'), F.limit(40));
  F.onSnapshot(q, (snap) => {
    const before = photos.length ? photos[0].id : null;
    photos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.url);
    drawGrid();
    // A new photo jumps straight to the big screen - that is the moment the
    // visitor who took it is looking up at the wall.
    if (photos.length && photos[0].id !== before) slide = heroOrder().indexOf(photos[0]);
    if (slide < 0) slide = 0;
    showSlide();
  }, (err) => {
    console.error(err);
    message('The wall cannot reach the museum right now. It will keep trying.', true);
    setTimeout(() => location.reload(), 30000);
  });

  setInterval(() => { slide++; if (photos.length > 1) showSlide(); }, SLIDE_MS);
  // Captions say "5 min ago"; keep them honest.
  setInterval(drawGrid, 60000);
}

// ---- a screen on a wall: hide the cursor and the button when nobody is touching
let idle = null;
const wake = () => {
  $('wall').classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => $('wall').classList.add('idle'), 3000);
};
['mousemove', 'pointerdown', 'keydown'].forEach((e) => document.addEventListener(e, wake));
wake();
$('wallFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

start().catch((err) => {
  console.error(err);
  message('The wall could not start: ' + (err && err.message ? err.message : err));
});
