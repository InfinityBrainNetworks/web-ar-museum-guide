/**
 * The Firebase SDK, loaded on demand, shared by every page.
 *
 * The viewer reaches this through AR_CLOUD.sdk() only when a visitor shares a
 * photo or leaves feedback; the Studio and the photobooth wall import it
 * directly. Each service is fetched the first time something asks for it, so
 * a page that only needs Firestore never downloads Storage.
 *
 * The version is pinned. gstatic serves every release forever, so a pinned URL
 * can only ever be the code it was tested with.
 */
const VERSION = '12.19.0';
const BASE = `https://www.gstatic.com/firebasejs/${VERSION}/`;

const CLOUD = window.AR_CLOUD;
if (!CLOUD) throw new Error('js/cloud/config.js must load before js/cloud/sdk.js');

const once = (fn) => { let p = null; return () => (p = p || fn().catch((e) => { p = null; throw e; })); };

const mod = {
  app: once(() => import(BASE + 'firebase-app.js')),
  auth: once(() => import(BASE + 'firebase-auth.js')),
  firestore: once(() => import(BASE + 'firebase-firestore.js')),
  storage: once(() => import(BASE + 'firebase-storage.js')),
  appCheck: once(() => import(BASE + 'firebase-app-check.js')),
};

export const app = once(async () => {
  const config = CLOUD.config();
  if (!config) throw new Error('No Firebase project is configured in js/cloud/config.js.');
  const { initializeApp, getApps } = await mod.app();
  const instance = getApps()[0] || initializeApp(config);

  // App Check is optional, and never in the emulators, which do not enforce it.
  if (CLOUD.appCheckSiteKey && !CLOUD.emulators) {
    try {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await mod.appCheck();
      initializeAppCheck(instance, {
        provider: new ReCaptchaEnterpriseProvider(CLOUD.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('App Check could not start; carrying on without it:', err);
    }
  }
  return instance;
});

export const auth = once(async () => {
  const [a, m] = await Promise.all([app(), mod.auth()]);
  const instance = m.getAuth(a);
  if (CLOUD.emulators) m.connectAuthEmulator(instance, CLOUD.emulators.auth, { disableWarnings: true });
  return instance;
});

export const db = once(async () => {
  const [a, m] = await Promise.all([app(), mod.firestore()]);
  const instance = m.getFirestore(a);
  if (CLOUD.emulators) {
    m.connectFirestoreEmulator(instance, CLOUD.emulators.firestore.host, CLOUD.emulators.firestore.port);
  }
  return instance;
});

export const storage = once(async () => {
  const [a, m] = await Promise.all([app(), mod.storage()]);
  const instance = m.getStorage(a);
  if (CLOUD.emulators) {
    m.connectStorageEmulator(instance, CLOUD.emulators.storage.host, CLOUD.emulators.storage.port);
  }
  return instance;
});

/** The raw modules, for the calls this file does not wrap. */
export const authApi = mod.auth;
export const firestoreApi = mod.firestore;
export const storageApi = mod.storage;

// ------------------------------------------------------------------ accounts
/**
 * The visitor's anonymous account, made on first use and kept by the browser.
 *
 * It owns the photos that visitor shares, which is what lets them take one
 * back down later from the same phone. A staff member already signed in on
 * this device is used as they are.
 */
export async function visitor() {
  const [a, m] = await Promise.all([auth(), mod.auth()]);
  await a.authStateReady();
  if (a.currentUser) return a.currentUser;
  const cred = await m.signInAnonymously(a);
  return cred.user;
}

/**
 * Staff sign-in with Google.
 *
 * A popup where the browser allows one - it keeps the page and whatever was
 * being edited - and a full-page redirect where it does not, which is most
 * phones' in-app browsers.
 */
export async function signInWithGoogle() {
  const [a, m] = await Promise.all([auth(), mod.auth()]);
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return (await m.signInWithPopup(a, provider)).user;
  } catch (err) {
    const code = err && err.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await m.signInWithRedirect(a, provider);
      return null;
    }
    throw err;
  }
}

export async function signOut() {
  const [a, m] = await Promise.all([auth(), mod.auth()]);
  return m.signOut(a);
}

/** Calls back with the signed-in user (or null) now and on every change. */
export async function onUser(callback) {
  const [a, m] = await Promise.all([auth(), mod.auth()]);
  return m.onAuthStateChanged(a, callback);
}

/** A staff account is a Google one with a verified address, never an anonymous one. */
export function isStaffAccount(user) {
  return !!(user && !user.isAnonymous && user.email && user.emailVerified);
}

/**
 * The member record behind a signed-in staff account, or null.
 *
 * Read by email because that is how staff are keyed: an admin can add someone
 * who has never signed in.
 */
export async function memberOf(user) {
  if (!isStaffAccount(user)) return null;
  const [d, f] = await Promise.all([db(), mod.firestore()]);
  const snap = await f.getDoc(f.doc(d, 'members', user.email.toLowerCase()));
  return snap.exists() ? snap.data() : null;
}

export const ROLES = ['owner', 'admin', 'editor', 'moderator'];

/** Does this role include that one? owner > admin > editor > moderator. */
export function roleAtLeast(role, wanted) {
  const have = ROLES.indexOf(role);
  const need = ROLES.indexOf(wanted);
  return have !== -1 && need !== -1 && have <= need;
}

/** A Firestore-safe id: no slashes, short, unguessable enough for a photo. */
export function newId(prefix = '') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  return prefix + body;
}
