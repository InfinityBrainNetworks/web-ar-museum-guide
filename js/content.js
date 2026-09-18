/**
 * Content layer — the one place that knows what an "exhibit" is.
 *
 * An exhibit is a set: a target image, a video to map onto it, and (optionally)
 * a 3D model to stand on the floor afterwards. The viewer shows N of them; the
 * admin portal (admin.html) creates and edits them.
 *
 * There are three places content can come from, tried in this order:
 *
 *   preview  IndexedDB, the admin portal's working draft. Only when the page is
 *            opened as index.html?preview=1, which is what the portal's Preview
 *            button does. Files become blob: URLs, so nothing has to be deployed
 *            to try it on a phone.
 *
 *   bundle   assets/content/content.json, written by the portal's Export and
 *            committed to the repo. This is what real visitors get.
 *
 *   legacy   synthesised from js/config.js. The fallback for a checkout that has
 *            never had a bundle exported, so the app still runs out of the box.
 *
 * Exhibit order IS target order: exhibits[i] must be the i-th image handed to
 * the MindAR compiler, because that is what targetIndex refers to. The portal
 * records the ids it compiled so it can warn when the two have drifted apart.
 */
(function () {
  'use strict';

  var DB_NAME = 'ar-museum-content';
  var DB_VERSION = 1;
  var STORE_META = 'meta';
  var STORE_FILES = 'files';

  var DRAFT_KEY = 'draft';
  var MIND_FILE = 'mind';

  // ------------------------------------------------------------------ IndexedDB
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('This browser has no IndexedDB.')); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
        if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }

  function tx(store, mode, run) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(store, mode);
        var request = run(transaction.objectStore(store));
        transaction.onerror = function () { reject(transaction.error); };
        transaction.onabort = function () { reject(transaction.error); };
        transaction.oncomplete = function () { resolve(request ? request.result : undefined); };
      });
    });
  }

  var ARStore = {
    getMeta: function (key) { return tx(STORE_META, 'readonly', function (s) { return s.get(key); }); },
    setMeta: function (key, value) { return tx(STORE_META, 'readwrite', function (s) { return s.put(value, key); }); },

    getFile: function (key) { return tx(STORE_FILES, 'readonly', function (s) { return s.get(key); }); },
    putFile: function (key, blob) { return tx(STORE_FILES, 'readwrite', function (s) { return s.put(blob, key); }); },
    delFile: function (key) { return tx(STORE_FILES, 'readwrite', function (s) { return s.delete(key); }); },
    fileKeys: function () { return tx(STORE_FILES, 'readonly', function (s) { return s.getAllKeys(); }); },

    getDraft: function () { return ARStore.getMeta(DRAFT_KEY); },
    setDraft: function (draft) {
      draft.updated = new Date().toISOString();
      return ARStore.setMeta(DRAFT_KEY, draft).then(function () { return draft; });
    },

    /** Asset keys are derived, never stored, so an id rename can never orphan one. */
    fileKey: function (exhibitId, kind) { return kind + ':' + exhibitId; },
    MIND_FILE: MIND_FILE,

    clear: function () {
      return Promise.all([
        tx(STORE_META, 'readwrite', function (s) { return s.clear(); }),
        tx(STORE_FILES, 'readwrite', function (s) { return s.clear(); }),
      ]);
    },

    /** Rough total, so the portal can warn before a browser quota bites. */
    usage: function () {
      if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
      return navigator.storage.estimate().catch(function () { return null; });
    },
  };

  // ------------------------------------------------------------------ defaults
  function cfg() { return window.AR_CONFIG || {}; }

  function videoDefaults() {
    var v = cfg().video || {};
    return {
      fit: v.fit || 'stretch',
      loop: v.loop !== false,
      restartOnFound: !!v.restartOnFound,
      scale: typeof v.scale === 'number' ? v.scale : 1,
      offset: {
        x: v.offset ? v.offset.x : 0,
        y: v.offset ? v.offset.y : 0,
        z: v.offset ? v.offset.z : 0.001,
      },
    };
  }

  function modelDefaults() {
    var m = cfg().model || {};
    var f = cfg().floor || {};
    return {
      heightMeters: typeof f.objectHeightMeters === 'number' ? f.objectHeightMeters : 1,
      yawOffset: m.yawOffset || 0,
      scale: typeof m.scale === 'number' ? m.scale : 1,
      spin: !!m.spin,
      playClip: m.playClip !== false,
    };
  }

  function assign(target, source) {
    for (var k in source) if (Object.prototype.hasOwnProperty.call(source, k)) target[k] = source[k];
    return target;
  }

  /** Fill in everything the portal or an older bundle may have left out. */
  function normalize(exhibit, index) {
    var ex = exhibit || {};
    var image = ex.image || {};
    var video = ex.video || {};
    var model = ex.model || null;

    var out = {
      id: ex.id || ('exhibit-' + (index + 1)),
      name: ex.name || ('Exhibit ' + (index + 1)),
      targetIndex: index,
      image: {
        src: image.src || null,
        file: image.file || null,
        width: image.width || 1,
        height: image.height || 1,
      },
      video: assign(assign({}, videoDefaults()), {
        src: video.src || null,
        file: video.file || null,
        width: video.width || 0,
        height: video.height || 0,
      }),
      model: null,
    };

    // Per-exhibit overrides win over the config defaults.
    ['fit', 'loop', 'restartOnFound', 'scale'].forEach(function (k) {
      if (video[k] !== undefined) out.video[k] = video[k];
    });
    if (video.offset) {
      out.video.offset = {
        x: video.offset.x || 0,
        y: video.offset.y || 0,
        z: video.offset.z === undefined ? 0.001 : video.offset.z,
      };
    }

    if (model && (model.src || model.file)) {
      out.model = assign(assign({}, modelDefaults()), {
        src: model.src || null,
        file: model.file || null,
      });
      ['heightMeters', 'yawOffset', 'scale', 'spin', 'playClip'].forEach(function (k) {
        if (model[k] !== undefined) out.model[k] = model[k];
      });
    } else if (model) {
      // A model record with no file still carries its sizing, which the
      // built-in placeholder figure should honour.
      out.model = assign(assign({}, modelDefaults()), { src: null, file: null });
      ['heightMeters', 'yawOffset', 'scale', 'spin', 'playClip'].forEach(function (k) {
        if (model[k] !== undefined) out.model[k] = model[k];
      });
    }

    if (!out.model) out.model = assign(modelDefaults(), { src: null, file: null });
    return out;
  }

  function blankExhibit(index) {
    return normalize({
      id: 'exhibit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name: 'Exhibit ' + (index + 1),
    }, index);
  }

  // ------------------------------------------------------------------ sources
  function fromLegacyConfig() {
    var c = cfg();
    if (!c.target || !c.target.imageSrc) return null;
    return {
      source: 'legacy',
      mindSrc: c.target.mindSrc,
      exhibits: [normalize({
        id: 'legacy',
        name: 'Exhibit 1',
        image: { src: c.target.imageSrc, width: c.target.width, height: c.target.height },
        video: { src: c.video.src, width: c.video.width, height: c.video.height },
        model: c.model.src ? { src: c.model.src } : null,
      }, 0)],
    };
  }

  function fromBundle() {
    return fetch('./assets/content/content.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.exhibits || !data.exhibits.length) throw new Error('no exhibits in content.json');
        return {
          source: 'bundle',
          generated: data.generated || null,
          mindSrc: data.mindSrc || './assets/content/targets.mind',
          exhibits: data.exhibits.map(normalize),
        };
      });
  }

  function fromDraft() {
    var urls = [];
    var keep = function (blob) {
      var url = URL.createObjectURL(blob);
      urls.push(url);
      return url;
    };

    return ARStore.getDraft().then(function (draft) {
      if (!draft || !draft.exhibits || !draft.exhibits.length) {
        throw new Error('the admin portal has no exhibits saved yet');
      }
      var wanted = [ARStore.getFile(MIND_FILE)];
      draft.exhibits.forEach(function (ex) {
        wanted.push(ARStore.getFile(ARStore.fileKey(ex.id, 'img')));
        wanted.push(ARStore.getFile(ARStore.fileKey(ex.id, 'vid')));
        wanted.push(ARStore.getFile(ARStore.fileKey(ex.id, 'mdl')));
      });

      return Promise.all(wanted).then(function (files) {
        var mind = files[0];
        if (!mind) throw new Error('the targets have not been compiled yet — press Compile in the portal');

        var exhibits = draft.exhibits.map(function (ex, i) {
          var img = files[1 + i * 3], vid = files[2 + i * 3], mdl = files[3 + i * 3];
          var copy = JSON.parse(JSON.stringify(ex));
          copy.image = copy.image || {};
          copy.video = copy.video || {};
          copy.image.src = img ? keep(img) : null;
          copy.video.src = vid ? keep(vid) : null;
          if (mdl) { copy.model = copy.model || {}; copy.model.src = keep(mdl); }
          else if (copy.model) { copy.model.src = null; }
          return normalize(copy, i);
        });

        return {
          source: 'preview',
          generated: draft.updated || null,
          compiled: draft.compiled || null,
          mindSrc: keep(mind),
          exhibits: exhibits,
          objectUrls: urls,
        };
      });
    });
  }

  function previewRequested() {
    return /[?&]preview=1\b/.test(location.search);
  }

  /**
   * Resolve the content for this page load.
   *
   * Never rejects: a broken source falls through to the next one, and the
   * reasons are handed back in `notes` so the log can show exactly what
   * happened rather than a silent switch to different content.
   */
  function load() {
    var notes = [];
    var wantPreview = previewRequested();

    var chain = wantPreview
      ? fromDraft().catch(function (err) {
          notes.push('preview requested but unavailable (' + err.message + ') — falling back');
          return fromBundle();
        })
      : fromBundle();

    return chain
      .catch(function (err) {
        notes.push('no content bundle (' + err.message + ') — using js/config.js');
        var legacy = fromLegacyConfig();
        if (!legacy) throw new Error('no content bundle and js/config.js has no target either');
        return legacy;
      })
      .then(function (bundle) {
        bundle.notes = notes;
        if (wantPreview && bundle.source !== 'preview') bundle.previewFailed = true;
        return bundle;
      });
  }

  window.ARStore = ARStore;
  window.ARContent = {
    load: load,
    normalize: normalize,
    blankExhibit: blankExhibit,
    videoDefaults: videoDefaults,
    modelDefaults: modelDefaults,
    previewRequested: previewRequested,
  };
})();
