/**
 * The Firebase project this gallery belongs to - and the switch for whether it
 * has one at all.
 *
 * With `firebase: null` the guide runs exactly as it always has: exhibits come
 * from assets/content/content.json in this repo, and there is no Studio, no
 * photobooth and no feedback inbox. Paste the project's web config below (the
 * Firebase console, Project settings > Your apps > Web app > Config) and the
 * guide reads the live release from the cloud instead, falling back to the
 * bundle in the repo if the cloud cannot be reached.
 *
 * None of these values is a secret. A web app ships its config to every
 * browser that opens it; what protects the data is firestore.rules and
 * storage.rules, not this file.
 *
 * Classic script, not a module, so every page can read it synchronously -
 * the viewer, the Studio and the photobooth wall alike.
 */
(function () {
  'use strict';

  var CLOUD = {
    firebase: null,
    // firebase: {
    //   apiKey: '...',
    //   authDomain: 'your-project.firebaseapp.com',
    //   projectId: 'your-project',
    //   storageBucket: 'your-project.firebasestorage.app',
    //   messagingSenderId: '...',
    //   appId: '...',
    // },

    // Optional: App Check with reCAPTCHA Enterprise, which keeps scripts that
    // are not this site from filling the photobooth and the feedback inbox.
    // Create a key in the console (App Check > Apps > reCAPTCHA Enterprise),
    // paste its site key here, then turn on enforcement once the numbers in
    // the App Check dashboard look right.
    appCheckSiteKey: null,

    // How long the viewer waits for the live release before using what it
    // already has. Museum wifi is the reason this is short.
    liveTimeoutMs: 4000,
  };

  // ------------------------------------------------------------------ emulators
  /*
   * ?emu=1 points every page at the local Firebase emulators instead of the
   * real project, and remembers it for the rest of the tab so links between
   * the viewer, the Studio and the wall keep it. ?emu=0 forgets it. A `demo-`
   * project id is what lets the emulators run with no Google account at all.
   */
  var EMU_KEY = 'ar-museum-emulators';
  var DEMO = {
    apiKey: 'demo-key',
    authDomain: 'demo-museum.firebaseapp.com',
    projectId: 'demo-museum',
    storageBucket: 'demo-museum.appspot.com',
    appId: 'demo-app',
  };

  function readEmu() {
    var flag = /[?&]emu=([01])\b/.exec(location.search);
    try {
      if (flag) sessionStorage.setItem(EMU_KEY, flag[1]);
      return sessionStorage.getItem(EMU_KEY) === '1';
    } catch (e) {
      return !!flag && flag[1] === '1';
    }
  }

  var emulators = readEmu();
  var emulatorHost = location.hostname === 'localhost' ? 'localhost' : '127.0.0.1';

  CLOUD.emulators = emulators ? {
    host: emulatorHost,
    auth: 'http://' + emulatorHost + ':9099',
    firestore: { host: emulatorHost, port: 8080 },
    storage: { host: emulatorHost, port: 9199 },
  } : null;

  /** The config actually in use: the emulators' demo project wins when asked for. */
  CLOUD.config = function () { return emulators ? DEMO : CLOUD.firebase; };
  CLOUD.enabled = function () { return !!CLOUD.config(); };

  // ------------------------------------------------------------------ REST
  /*
   * A visitor needs exactly two small reads from Firestore - which release is
   * live, and that release's record - so the viewer makes them over plain
   * REST rather than downloading the Firestore SDK (a few hundred KB) to a
   * phone on museum wifi. The SDK is loaded only when a visitor actually
   * shares a photo or leaves feedback.
   */
  CLOUD.documentUrl = function (path) {
    var c = CLOUD.config();
    if (!c) return null;
    var root = emulators
      ? 'http://' + emulatorHost + ':8080/v1'
      : 'https://firestore.googleapis.com/v1';
    return root + '/projects/' + encodeURIComponent(c.projectId) +
           '/databases/(default)/documents/' + path +
           (emulators ? '' : '?key=' + encodeURIComponent(c.apiKey));
  };

  /** Firestore's typed REST JSON, flattened back into plain values. */
  CLOUD.fromRest = function decode(value) {
    if (!value || typeof value !== 'object') return value;
    if ('fields' in value) return decodeFields(value.fields);
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('timestampValue' in value) return value.timestampValue;
    if ('nullValue' in value) return null;
    if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    if ('referenceValue' in value) return value.referenceValue;
    return null;
  };

  function decodeFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = CLOUD.fromRest(fields[k]); });
    return out;
  }

  /** GET one document, decoded. Resolves null for a document that does not exist. */
  CLOUD.getDocument = function (path, timeoutMs) {
    var url = CLOUD.documentUrl(path);
    if (!url) return Promise.reject(new Error('no Firebase project is configured'));

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller && timeoutMs
      ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    return fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('Firestore answered HTTP ' + r.status + ' for ' + path);
        return r.json().then(CLOUD.fromRest);
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err && err.name === 'AbortError'
          ? new Error('no answer from Firestore within ' + timeoutMs + 'ms') : err;
      });
  };

  // ------------------------------------------------------------------ the SDK
  /*
   * js/cloud/sdk.js is an ES module, and the viewer's own scripts are classic
   * ones; import() bridges the two. Resolved against this file's own URL, so
   * it works from the viewer, from /studio/ and from /photobooth/ alike.
   */
  var here = (document.currentScript && document.currentScript.src) || location.href;
  var sdkPromise = null;

  CLOUD.sdk = function () {
    if (!CLOUD.enabled()) return Promise.reject(new Error('no Firebase project is configured'));
    if (!sdkPromise) {
      sdkPromise = import(new URL('./sdk.js', here).href).catch(function (err) {
        sdkPromise = null;   // a failed download should be retryable
        throw err;
      });
    }
    return sdkPromise;
  };

  /** Where the guide itself lives, for links from the Studio and the wall. */
  CLOUD.appUrl = new URL('../../', here).href;

  window.AR_CLOUD = CLOUD;
})();
