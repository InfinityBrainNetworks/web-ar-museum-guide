/**
 * Everything the Studio reads and writes, in one place.
 *
 *   /exhibits/{id}       one draft exhibit. Its order is its target index.
 *   /config/site         the gallery's name, languages and features (public)
 *   /config/tracker      which compiled tracker matches which exhibit order
 *   /config/setup        exists once the project has been claimed
 *   /releases/{id}       a frozen snapshot, its manifest in Storage
 *   /public/live         which release visitors get
 *   /members/{email}     the team, by role
 *   /accessRequests/...  people asking to join it
 *   /photos/{id}         the photobooth
 *   /feedback/{id}       what visitors said
 *
 * Files go to Storage under a name made from a hash of their own bytes, so a
 * URL is never reused for different content: a phone can cache it forever,
 * and an older release keeps working after the file is replaced.
 */
import * as sdk from '../../js/cloud/sdk.js';

let F = null;     // firebase/firestore
let S = null;     // firebase/storage
let db = null;
let storage = null;

export async function init() {
  [F, S, db, storage] = await Promise.all([sdk.firestoreApi(), sdk.storageApi(), sdk.db(), sdk.storage()]);
}

export const api = () => ({ F, S, db, storage });

let me = null;      // { email, role }
export function setMe(member) { me = member; }
export function myEmail() { return me ? me.email : null; }

const stamp = () => ({ updatedAt: F.serverTimestamp(), updatedBy: myEmail() });

// ------------------------------------------------------------------ setup
export async function setupClaimed() {
  const snap = await F.getDoc(F.doc(db, 'config/setup'));
  return snap.exists() ? snap.data() : null;
}

/** The first account in becomes the owner - see claimingOwnership() in firestore.rules. */
export async function claimOwnership(user) {
  const email = user.email.toLowerCase();
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, 'members', email), {
    email, role: 'owner', name: user.displayName || '', addedBy: 'claim', addedAt: F.serverTimestamp(),
  });
  batch.set(F.doc(db, 'config/setup'), { owner: email, at: F.serverTimestamp() });
  await batch.commit();
}

export async function requestAccess(user, message) {
  const email = user.email.toLowerCase();
  await F.setDoc(F.doc(db, 'accessRequests', email), {
    email, name: user.displayName || '', message: message || '', at: F.serverTimestamp(),
  });
}

export async function myRequest(user) {
  const snap = await F.getDoc(F.doc(db, 'accessRequests', user.email.toLowerCase()));
  return snap.exists() ? snap.data() : null;
}

// ------------------------------------------------------------------ exhibits
/** Live list, in target order. Calls back with an array on every change. */
export function watchExhibits(callback, onError) {
  return F.onSnapshot(F.query(F.collection(db, 'exhibits'), F.orderBy('order')),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError);
}

export async function getExhibit(id) {
  const snap = await F.getDoc(F.doc(db, 'exhibits', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchExhibit(id, callback, onError) {
  return F.onSnapshot(F.doc(db, 'exhibits', id),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError);
}

export async function createExhibit(data) {
  const id = slugId(data.name || 'exhibit');
  await F.setDoc(F.doc(db, 'exhibits', id), {
    ...data, createdAt: F.serverTimestamp(), createdBy: myEmail(), ...stamp(),
  });
  return id;
}

/** Merge a patch into an exhibit. Dotted keys reach inside maps without replacing them. */
export async function saveExhibit(id, patch) {
  await F.updateDoc(F.doc(db, 'exhibits', id), { ...patch, ...stamp() });
}

export async function deleteExhibit(id) {
  await F.deleteDoc(F.doc(db, 'exhibits', id));
}

/** New target order, in one batch: index in the array = target index. */
export async function reorder(ids) {
  const batch = F.writeBatch(db);
  ids.forEach((id, i) => batch.update(F.doc(db, 'exhibits', id), { order: i }));
  await batch.commit();
}

export function slugId(name) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').slice(0, 40) || 'exhibit';
  return base + '-' + sdk.newId().slice(0, 5);
}

// ------------------------------------------------------------------ files
export async function sha256(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/wav': 'wav', 'model/gltf-binary': 'glb',
  'application/json': 'json', 'application/octet-stream': 'bin',
};

/** What to call a file's type, from the browser's guess or its extension. */
export function contentType(file) {
  if (file.type) return file.type === 'audio/x-m4a' ? 'audio/mp4' : file.type;
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  return { glb: 'model/gltf-binary', mind: 'application/octet-stream', mp3: 'audio/mpeg',
           m4a: 'audio/mp4', mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg',
           png: 'image/png', json: 'application/json' }[ext] || 'application/octet-stream';
}

/**
 * Upload a file under a name made from its hash, and report progress.
 * Resolves { path, url, size, type, hash, fileName }.
 */
export async function upload(folder, kind, file, onProgress) {
  const type = contentType(file);
  const hash = await sha256(file);
  const ext = EXT[type] || String(file.name || '').split('.').pop() || 'bin';
  const path = `${folder}/${kind}-${hash.slice(0, 16)}.${ext}`;
  const ref = S.ref(storage, path);
  const metadata = {
    contentType: type,
    // Immutable by construction, so phones and the CDN may keep it forever.
    cacheControl: 'public, max-age=31536000, immutable',
    customMetadata: { fileName: String(file.name || kind).slice(0, 200), uploadedBy: myEmail() || '' },
  };

  if (file.size < SINGLE_SHOT) {
    // Small files in one request: simpler, and immune to the chunked upload
    // that now and then never finishes (seen on flaky wifi and in the emulator).
    if (onProgress) onProgress(0.05, 0, file.size);
    await withTimeout(S.uploadBytes(ref, file, metadata), 120000, 'the upload took over two minutes');
    if (onProgress) onProgress(1, file.size, file.size);
  } else {
    await resumable(ref, file, metadata, onProgress).catch((err) => {
      if (err.code !== 'stalled') throw err;
      return resumable(ref, file, metadata, onProgress);     // one more go from scratch
    });
  }
  const url = await S.getDownloadURL(ref);
  return { path, url, size: file.size, type, hash, fileName: file.name || null };
}

const SINGLE_SHOT = 8 * 1024 * 1024;
const STALL_MS = 30000;

/** A resumable upload that gives up - so it can be retried - when no byte has moved for 30 s. */
function resumable(ref, file, metadata, onProgress) {
  return new Promise((resolve, reject) => {
    const task = S.uploadBytesResumable(ref, file, metadata);
    let last = 0;
    let timer = null;
    const watch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        task.cancel();
        const err = new Error('the upload stalled');
        err.code = 'stalled';
        reject(err);
      }, STALL_MS);
    };
    watch();
    task.on('state_changed', (s) => {
      if (s.bytesTransferred !== last) { last = s.bytesTransferred; watch(); }
      if (onProgress) onProgress(s.bytesTransferred / (s.totalBytes || 1), s.bytesTransferred, s.totalBytes);
    }, (err) => { clearTimeout(timer); if (err.code !== 'storage/canceled') reject(err); },
    () => { clearTimeout(timer); resolve(); });
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]);
}

// ------------------------------------------------------------------ site
export const SITE_DEFAULTS = {
  name: 'National Museum',
  languages: [{ code: 'en', name: 'English', native: 'English' }],
  features: { photobooth: true, feedback: true },
  photobooth: { enabled: false, autoApprove: false, title: 'Our photo wall', note: '' },
};

export async function getSite() {
  const snap = await F.getDoc(F.doc(db, 'config/site'));
  const data = snap.exists() ? snap.data() : {};
  return {
    ...SITE_DEFAULTS, ...data,
    features: { ...SITE_DEFAULTS.features, ...(data.features || {}) },
    photobooth: { ...SITE_DEFAULTS.photobooth, ...(data.photobooth || {}) },
  };
}

export async function saveSite(patch) {
  await F.setDoc(F.doc(db, 'config/site'), { ...patch, ...stamp() }, { merge: true });
}

// ------------------------------------------------------------------ the map
/** The floor plan: { image: { url, path, width, height } }, or null. */
export async function getMap() {
  const snap = await F.getDoc(F.doc(db, 'config/map'));
  return snap.exists() ? snap.data() : null;
}

export async function saveMap(map) {
  await F.setDoc(F.doc(db, 'config/map'), { ...map, ...stamp() });
}

// ------------------------------------------------------------------ tracker
export async function getTracker() {
  const snap = await F.getDoc(F.doc(db, 'config/tracker'));
  return snap.exists() ? snap.data() : null;
}

export async function saveTracker(data) {
  await F.setDoc(F.doc(db, 'config/tracker'), { ...data, at: F.serverTimestamp(), by: myEmail() });
}

/**
 * What the tracker has to match: the exhibits in order, each by its target
 * photo. Change either and the compiled tracker is stale.
 */
export function trackerSignature(exhibits) {
  return exhibits.map((ex) => ex.id + ':' + ((ex.image && ex.image.hash) || 'none')).join('|');
}

// ------------------------------------------------------------------ releases
export function watchReleases(callback, onError) {
  return F.onSnapshot(F.query(F.collection(db, 'releases'), F.orderBy('createdAt', 'desc'), F.limit(40)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function watchLive(callback, onError) {
  return F.onSnapshot(F.doc(db, 'public/live'), (snap) => callback(snap.exists() ? snap.data() : null), onError);
}

export function releaseId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `r${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${sdk.newId().slice(0, 4)}`;
}

/** Upload a manifest and record the release. Not live until goLive(). */
export async function createRelease(id, manifest, summary) {
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const ref = S.ref(storage, `releases/${id}/manifest.json`);
  await S.uploadBytes(ref, blob, { contentType: 'application/json', cacheControl: 'public, max-age=31536000, immutable' });
  const url = await S.getDownloadURL(ref);
  await F.setDoc(F.doc(db, 'releases', id), {
    manifest: url, createdAt: F.serverTimestamp(), createdBy: myEmail(), ...summary,
  });
  return url;
}

export async function goLive(release) {
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, 'public/live'), {
    release: release.id, manifest: release.manifest, at: F.serverTimestamp(), by: myEmail(),
  });
  batch.update(F.doc(db, 'releases', release.id), { liveAt: F.serverTimestamp(), liveBy: myEmail() });
  await batch.commit();
}

export async function deleteRelease(id) {
  await F.deleteDoc(F.doc(db, 'releases', id));
}

// ------------------------------------------------------------------ people
export function watchMembers(callback, onError) {
  return F.onSnapshot(F.collection(db, 'members'), (snap) =>
    callback(snap.docs.map((d) => d.data()).sort((a, b) => a.email.localeCompare(b.email))), onError);
}

export function watchRequests(callback, onError) {
  return F.onSnapshot(F.collection(db, 'accessRequests'), (snap) =>
    callback(snap.docs.map((d) => d.data())), onError);
}

export async function addMember(email, role, note) {
  const key = email.trim().toLowerCase();
  const data = { email: key, role, addedBy: myEmail(), addedAt: F.serverTimestamp() };
  if (note) data.note = String(note).slice(0, 200);
  const batch = F.writeBatch(db);
  batch.set(F.doc(db, 'members', key), data);
  batch.delete(F.doc(db, 'accessRequests', key));
  await batch.commit();
}

export async function setRole(email, role) {
  await F.updateDoc(F.doc(db, 'members', email), { role });
}

export async function removeMember(email) {
  await F.deleteDoc(F.doc(db, 'members', email));
}

export async function dismissRequest(email) {
  await F.deleteDoc(F.doc(db, 'accessRequests', email));
}

// ------------------------------------------------------------------ photobooth
export function watchPhotos(status, callback, onError) {
  const q = status === 'all'
    ? F.query(F.collection(db, 'photos'), F.orderBy('createdAt', 'desc'), F.limit(200))
    : F.query(F.collection(db, 'photos'), F.where('status', '==', status), F.orderBy('createdAt', 'desc'), F.limit(200));
  return F.onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function moderatePhoto(id, patch) {
  await F.updateDoc(F.doc(db, 'photos', id), { ...patch, moderatedBy: myEmail(), moderatedAt: F.serverTimestamp() });
}

export async function deletePhoto(photo) {
  if (photo.path) {
    try { await S.deleteObject(S.ref(storage, photo.path)); }
    catch (err) { if (err.code !== 'storage/object-not-found') throw err; }
  }
  await F.deleteDoc(F.doc(db, 'photos', photo.id));
}

// ------------------------------------------------------------------ feedback
export function watchFeedback(callback, onError) {
  return F.onSnapshot(F.query(F.collection(db, 'feedback'), F.orderBy('createdAt', 'desc'), F.limit(300)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function markFeedback(id, done) {
  await F.updateDoc(F.doc(db, 'feedback', id), { done: !!done, doneBy: myEmail() });
}

export async function deleteFeedback(id) {
  await F.deleteDoc(F.doc(db, 'feedback', id));
}
