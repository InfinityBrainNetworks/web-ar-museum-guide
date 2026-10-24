/**
 * Security rules, tested against the real emulators.
 *
 *   cd tests/rules && npm install && npm test
 *
 * `npm test` starts the Firestore and Storage emulators (Java 21 needed),
 * runs this file, and stops them again. Nothing touches a real project: the
 * `demo-` project id is what keeps the emulators offline.
 */
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, query, where,
  orderBy, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const ROOT = new URL('../../', import.meta.url);
let env;

const google = (email) => ({
  email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
});
const as = {
  anon: (uid = 'visitor-1') => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }),
  google: (email) => env.authenticatedContext('uid-' + email.replace(/\W/g, ''), google(email)),
  nobody: () => env.unauthenticatedContext(),
};
const db = (ctx) => ctx.firestore();

async function seed(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), path), data));
}
async function seedMember(email, role) {
  await seed('members/' + email, { email, role, addedBy: 'seed' });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-museum',
    firestore: { rules: readFileSync(new URL('firestore.rules', ROOT), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync(new URL('storage.rules', ROOT), 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
});

// ------------------------------------------------------------------ ownership
test('the first Google account claims the project, and nobody can after', async () => {
  const first = db(as.google('curator@gmail.com'));
  const claim = writeBatch(first);
  claim.set(doc(first, 'members/curator@gmail.com'), { email: 'curator@gmail.com', role: 'owner', addedBy: 'claim' });
  claim.set(doc(first, 'config/setup'), { owner: 'curator@gmail.com', at: serverTimestamp() });
  await assertSucceeds(claim.commit());

  const second = db(as.google('intruder@gmail.com'));
  const late = writeBatch(second);
  late.set(doc(second, 'members/intruder@gmail.com'), { email: 'intruder@gmail.com', role: 'owner', addedBy: 'claim' });
  late.set(doc(second, 'config/setup'), { owner: 'intruder@gmail.com', at: serverTimestamp() });
  await assertFails(late.commit());
});

test('a claim needs config/setup in the same batch', async () => {
  const d = db(as.google('curator@gmail.com'));
  await assertFails(setDoc(doc(d, 'members/curator@gmail.com'),
    { email: 'curator@gmail.com', role: 'owner', addedBy: 'claim' }));
});

test('an anonymous visitor can never claim', async () => {
  const d = db(as.anon());
  const claim = writeBatch(d);
  claim.set(doc(d, 'members/x@gmail.com'), { email: 'x@gmail.com', role: 'owner' });
  claim.set(doc(d, 'config/setup'), { owner: 'x@gmail.com', at: serverTimestamp() });
  await assertFails(claim.commit());
});

// ------------------------------------------------------------------ people
test('an admin can make another admin, an editor and a moderator', async () => {
  await seedMember('boss@gmail.com', 'admin');
  const d = db(as.google('boss@gmail.com'));
  for (const [email, role] of [['two@gmail.com', 'admin'], ['ed@gmail.com', 'editor'], ['mod@gmail.com', 'moderator']]) {
    await assertSucceeds(setDoc(doc(d, 'members/' + email), { email, role, addedBy: 'boss@gmail.com' }));
  }
});

test('an admin cannot make an owner, or remove one', async () => {
  await seedMember('owner@gmail.com', 'owner');
  await seedMember('boss@gmail.com', 'admin');
  const d = db(as.google('boss@gmail.com'));
  await assertFails(setDoc(doc(d, 'members/new@gmail.com'), { email: 'new@gmail.com', role: 'owner' }));
  await assertFails(deleteDoc(doc(d, 'members/owner@gmail.com')));
  await assertFails(updateDoc(doc(d, 'members/owner@gmail.com'), { role: 'editor' }));
});

test('an owner cannot demote or remove themselves', async () => {
  await seedMember('owner@gmail.com', 'owner');
  const d = db(as.google('owner@gmail.com'));
  await assertFails(updateDoc(doc(d, 'members/owner@gmail.com'), { role: 'admin' }));
  await assertFails(deleteDoc(doc(d, 'members/owner@gmail.com')));
  await assertSucceeds(setDoc(doc(d, 'members/second@gmail.com'), { email: 'second@gmail.com', role: 'owner' }));
});

test('editors and moderators cannot touch the people list', async () => {
  await seedMember('ed@gmail.com', 'editor');
  await seedMember('mod@gmail.com', 'moderator');
  for (const who of ['ed@gmail.com', 'mod@gmail.com']) {
    const d = db(as.google(who));
    await assertFails(setDoc(doc(d, 'members/friend@gmail.com'), { email: 'friend@gmail.com', role: 'moderator' }));
    await assertFails(deleteDoc(doc(d, 'members/' + (who === 'ed@gmail.com' ? 'mod@gmail.com' : 'ed@gmail.com'))));
  }
});

test('a member reads their own record, not anyone else’s', async () => {
  await seedMember('ed@gmail.com', 'editor');
  await seedMember('mod@gmail.com', 'moderator');
  const d = db(as.google('mod@gmail.com'));
  await assertSucceeds(getDoc(doc(d, 'members/mod@gmail.com')));
  await assertFails(getDoc(doc(d, 'members/ed@gmail.com')));
});

test('a member record must be keyed by its own lowercase email', async () => {
  await seedMember('boss@gmail.com', 'admin');
  const d = db(as.google('boss@gmail.com'));
  await assertFails(setDoc(doc(d, 'members/Mixed@gmail.com'), { email: 'Mixed@gmail.com', role: 'editor' }));
  await assertFails(setDoc(doc(d, 'members/a@gmail.com'), { email: 'b@gmail.com', role: 'editor' }));
  await assertFails(setDoc(doc(d, 'members/c@gmail.com'), { email: 'c@gmail.com', role: 'superuser' }));
});

test('a Google account that is not a member is not staff', async () => {
  const d = db(as.google('stranger@gmail.com'));
  await assertFails(getDoc(doc(d, 'exhibits/one')));
  await assertFails(setDoc(doc(d, 'exhibits/one'), { name: 'x', order: 0 }));
});

test('an unverified email is not staff, even if listed', async () => {
  await seedMember('sneaky@gmail.com', 'admin');
  const ctx = env.authenticatedContext('u1', { email: 'sneaky@gmail.com', email_verified: false, firebase: { sign_in_provider: 'password' } });
  await assertFails(getDoc(doc(ctx.firestore(), 'exhibits/one')));
});

test('someone not on the list can ask for access, as themselves only', async () => {
  const d = db(as.google('hopeful@gmail.com'));
  await assertSucceeds(setDoc(doc(d, 'accessRequests/hopeful@gmail.com'),
    { email: 'hopeful@gmail.com', message: 'I run the front desk', at: serverTimestamp() }));
  await assertFails(setDoc(doc(d, 'accessRequests/other@gmail.com'),
    { email: 'other@gmail.com', at: serverTimestamp() }));
});

// ------------------------------------------------------------------ content
test('editors write exhibits; moderators only read them', async () => {
  await seedMember('ed@gmail.com', 'editor');
  await seedMember('mod@gmail.com', 'moderator');
  await assertSucceeds(setDoc(doc(db(as.google('ed@gmail.com')), 'exhibits/one'), { name: 'Lion', order: 0 }));
  await assertFails(setDoc(doc(db(as.google('mod@gmail.com')), 'exhibits/two'), { name: 'Queen', order: 1 }));
  await assertSucceeds(getDoc(doc(db(as.google('mod@gmail.com')), 'exhibits/one')));
  await assertFails(getDoc(doc(db(as.anon()), 'exhibits/one')));
});

test('only an admin puts a release live; everyone can read which one is', async () => {
  await seedMember('ed@gmail.com', 'editor');
  await seedMember('boss@gmail.com', 'admin');
  const ed = db(as.google('ed@gmail.com'));
  await assertSucceeds(setDoc(doc(ed, 'releases/r1'),
    { createdBy: 'ed@gmail.com', createdAt: serverTimestamp(), manifest: 'https://x/m.json' }));
  const live = { release: 'r1', manifest: 'https://x/m.json', at: serverTimestamp() };
  await assertFails(setDoc(doc(ed, 'public/live'), live));
  await assertSucceeds(setDoc(doc(db(as.google('boss@gmail.com')), 'public/live'), live));
  await assertFails(setDoc(doc(db(as.google('boss@gmail.com')), 'public/live'),
    { release: 'nope', manifest: 'x', at: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(db(as.nobody()), 'public/live')));
  await assertSucceeds(getDoc(doc(db(as.nobody()), 'releases/r1')));
});

test('the live release cannot be deleted', async () => {
  await seedMember('boss@gmail.com', 'admin');
  await seed('releases/r1', { manifest: 'm' });
  await seed('releases/r0', { manifest: 'm' });
  await seed('public/live', { release: 'r1', manifest: 'm' });
  const d = db(as.google('boss@gmail.com'));
  await assertFails(deleteDoc(doc(d, 'releases/r1')));
  await assertSucceeds(deleteDoc(doc(d, 'releases/r0')));
});

test('site settings are public to read and admin-only to write', async () => {
  await seedMember('ed@gmail.com', 'editor');
  await seedMember('boss@gmail.com', 'admin');
  await assertSucceeds(getDoc(doc(db(as.nobody()), 'config/site')));
  await assertFails(setDoc(doc(db(as.google('ed@gmail.com')), 'config/site'), { name: 'x' }));
  await assertSucceeds(setDoc(doc(db(as.google('boss@gmail.com')), 'config/site'), { name: 'x' }));
});

// ------------------------------------------------------------------ photobooth
const photo = (uid, id, extra = {}) => ({
  uid, path: `photobooth/${uid}/${id}.jpg`, url: 'https://x/p.jpg', consent: true,
  status: 'pending', createdAt: serverTimestamp(), name: 'Asha', ...extra,
});

test('photos are refused while the photobooth is switched off', async () => {
  await seed('config/site', { photobooth: { enabled: false } });
  await assertFails(setDoc(doc(db(as.anon('v1')), 'photos/abcdefgh1'), photo('v1', 'abcdefgh1')));
});

test('a visitor shares a photo for moderation, with consent, as themselves', async () => {
  await seed('config/site', { photobooth: { enabled: true, autoApprove: false } });
  const d = db(as.anon('v1'));
  await assertSucceeds(setDoc(doc(d, 'photos/abcdefgh1'), photo('v1', 'abcdefgh1')));
  await assertFails(setDoc(doc(d, 'photos/abcdefgh2'), photo('v1', 'abcdefgh2', { status: 'approved' })));
  await assertFails(setDoc(doc(d, 'photos/abcdefgh3'), photo('v1', 'abcdefgh3', { consent: false })));
  await assertFails(setDoc(doc(d, 'photos/abcdefgh4'), photo('v2', 'abcdefgh4')));
  await assertFails(setDoc(doc(d, 'photos/abcdefgh5'), { ...photo('v1', 'abcdefgh5'), path: 'photobooth/v1/other.jpg' }));
  await assertFails(setDoc(doc(d, 'photos/abcdefgh6'), photo('v1', 'abcdefgh6', { name: 'x'.repeat(41) })));
});

test('with auto-approve on, a photo goes straight to the wall', async () => {
  await seed('config/site', { photobooth: { enabled: true, autoApprove: true } });
  const d = db(as.anon('v1'));
  await assertSucceeds(setDoc(doc(d, 'photos/abcdefgh1'), photo('v1', 'abcdefgh1', { status: 'approved' })));
  await assertFails(setDoc(doc(d, 'photos/abcdefgh2'), photo('v1', 'abcdefgh2')));
});

test('the wall sees approved photos only; the taker sees their own', async () => {
  await seed('photos/p1', { uid: 'v1', status: 'approved', createdAt: new Date() });
  await seed('photos/p2', { uid: 'v1', status: 'pending', createdAt: new Date() });
  const wall = db(as.nobody());
  await assertSucceeds(getDocs(query(collection(wall, 'photos'), where('status', '==', 'approved'), orderBy('createdAt', 'desc'))));
  await assertFails(getDocs(collection(wall, 'photos')));
  await assertFails(getDoc(doc(wall, 'photos/p2')));
  await assertSucceeds(getDoc(doc(db(as.anon('v1')), 'photos/p2')));
  await assertFails(getDoc(doc(db(as.anon('v2')), 'photos/p2')));
});

test('moderators approve and hide; a visitor can take their own photo down', async () => {
  await seedMember('mod@gmail.com', 'moderator');
  await seed('photos/p1', { uid: 'v1', status: 'pending', createdAt: new Date() });
  const mod = db(as.google('mod@gmail.com'));
  await assertSucceeds(updateDoc(doc(mod, 'photos/p1'), { status: 'approved', moderatedBy: 'mod@gmail.com' }));
  await assertFails(updateDoc(doc(mod, 'photos/p1'), { uid: 'someone-else' }));
  await assertFails(updateDoc(doc(db(as.anon('v1')), 'photos/p1'), { status: 'approved' }));
  await assertFails(deleteDoc(doc(db(as.anon('v2')), 'photos/p1')));
  await assertSucceeds(deleteDoc(doc(db(as.anon('v1')), 'photos/p1')));
});

// ------------------------------------------------------------------ feedback
test('a visitor leaves feedback; only staff read it', async () => {
  await seedMember('mod@gmail.com', 'moderator');
  const d = db(as.anon('v1'));
  const good = { uid: 'v1', rating: 5, message: 'Loved the lion', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(d, 'feedback/f1'), good));
  await assertFails(setDoc(doc(d, 'feedback/f2'), { ...good, rating: 9 }));
  await assertFails(setDoc(doc(d, 'feedback/f3'), { ...good, rating: 4.5 }));
  await assertFails(setDoc(doc(d, 'feedback/f4'), { ...good, message: 'x'.repeat(2001) }));
  await assertFails(getDoc(doc(d, 'feedback/f1')));
  await assertSucceeds(getDoc(doc(db(as.google('mod@gmail.com')), 'feedback/f1')));
});

// ------------------------------------------------------------------ storage
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test('editors upload exhibit files; anyone downloads them', async () => {
  await seedMember('ed@gmail.com', 'editor');
  const ed = as.google('ed@gmail.com').storage();
  await assertSucceeds(uploadBytes(ref(ed, 'exhibits/one/target-abc.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(as.anon().storage(), 'exhibits/one/x.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(ed, 'exhibits/one/x.exe'), jpeg, { contentType: 'application/x-msdownload' }));
  await assertSucceeds(getBytes(ref(as.nobody().storage(), 'exhibits/one/target-abc.jpg')));
});

test('a visitor uploads a photo to their own folder only', async () => {
  const mine = as.anon('v1').storage();
  await assertSucceeds(uploadBytes(ref(mine, 'photobooth/v1/abcdefgh1.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(mine, 'photobooth/v2/abcdefgh1.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(mine, 'photobooth/v1/abcdefgh2.png'), jpeg, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(mine, 'photobooth/v1/bad.jpg'), jpeg, { contentType: 'image/jpeg' }));
  const big = new Uint8Array(5 * 1024 * 1024 + 10);
  await assertFails(uploadBytes(ref(mine, 'photobooth/v1/abcdefgh3.jpg'), big, { contentType: 'image/jpeg' }));
});

test('photos are private in storage: the taker and staff only', async () => {
  await seedMember('mod@gmail.com', 'moderator');
  await env.withSecurityRulesDisabled((ctx) =>
    uploadBytes(ref(ctx.storage(), 'photobooth/v1/abcdefgh1.jpg'), jpeg, { contentType: 'image/jpeg' }));
  await assertSucceeds(getBytes(ref(as.anon('v1').storage(), 'photobooth/v1/abcdefgh1.jpg')));
  await assertFails(getBytes(ref(as.anon('v2').storage(), 'photobooth/v1/abcdefgh1.jpg')));
  await assertSucceeds(getBytes(ref(as.google('mod@gmail.com').storage(), 'photobooth/v1/abcdefgh1.jpg')));
  await assertSucceeds(deleteObject(ref(as.anon('v1').storage(), 'photobooth/v1/abcdefgh1.jpg')));
});
