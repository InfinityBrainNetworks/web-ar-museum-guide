/**
 * Content layer — the one place that knows what an "exhibit" is.
 *
 * An exhibit is everything the gallery holds about one artwork:
 *
 *   image    the target: the picture a visitor points the phone at.   required
 *   media    what is projected onto it — a video OR a still image.    required
 *   details  the written label and the spoken one, per language.      required
 *   model    a 3D object to stand on the floor afterwards.            optional
 *
 * The viewer shows N of them; the admin portal (admin.html) writes them.
 *
 * LANGUAGES. The bundle carries its own list, first one first, and the first is
 * the fallback: every exhibit must have details in it, and a language with no
 * translation shows that one instead of an empty sheet. The list is editable in
 * the portal, so adding a fourth language is not a code change.
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
 *   legacy   synthesised from js/config.js. Only for a checkout whose config
 *            still names a target image; the shipped one does not, so an empty
 *            gallery reports itself as empty rather than inventing an exhibit.
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
    /** One narration per language, so the kind carries the code. */
    audioKind: function (code) { return 'aud-' + code; },
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

  // ------------------------------------------------------------------ languages
  var FALLBACK_LANGUAGE = { code: 'en', name: 'English', native: 'English' };

  /** A language code: lowercase letters and dashes, as in 'en' or 'pt-br'. */
  function languageCode(value) {
    var code = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z-]/g, '');
    return code.slice(0, 12);
  }

  /**
   * Sanitise a language list.
   *
   * Always returns at least one language, because the first is the fallback
   * every exhibit is written in — a bundle with none would have no way to show
   * an exhibit at all. Duplicate codes are dropped rather than merged: two
   * entries claiming 'si' would make which audio file belongs to which
   * undecidable.
   */
  function languageList(value) {
    var seen = {};
    var out = [];
    (Array.isArray(value) ? value : []).forEach(function (entry) {
      var l = entry || {};
      var code = languageCode(l.code);
      if (!code || seen[code]) return;
      seen[code] = true;
      var name = String(l.name || code).trim().slice(0, 40) || code;
      out.push({ code: code, name: name, native: String(l.native || name).trim().slice(0, 40) || name });
    });
    if (!out.length) {
      // Nothing usable was passed - which is different from being handed an
      // empty list on purpose. A draft written before languages existed carries
      // null, and a caller that simply has no opinion passes undefined; both
      // mean "use the gallery's defaults", and only a genuinely empty array
      // falls all the way through to English.
      var cfgList = cfg().languages || [];
      if (!Array.isArray(value) && cfgList.length) return languageList(cfgList);
      return [{ code: FALLBACK_LANGUAGE.code, name: FALLBACK_LANGUAGE.name, native: FALLBACK_LANGUAGE.native }];
    }
    return out;
  }

  /** The code every exhibit is required to carry, and everything falls back to. */
  function baseCode(languages) {
    var list = languageList(languages);
    return list[0].code;
  }

  // ------------------------------------------------------------------ rich text
  /**
   * The only tags a label may contain.
   *
   * Deliberately short. The portal's editor offers exactly these, and anything
   * else — a pasted <script>, a <style> smuggled in from Word, an <img> with an
   * onerror — is stripped on the way in AND again on the way out, because the
   * viewer renders this with innerHTML and a bundle is a file anyone with repo
   * access can hand-edit.
   *
   * No attributes survive at all. There is nothing in the list that needs one,
   * and an allowed attribute is where every sanitiser bug lives.
   */
  var RICH_TAGS = { H2: 1, H3: 1, P: 1, STRONG: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, BR: 1 };

  /** Tags that mean one of the above under a different name. */
  var RICH_REMAP = {
    B: 'STRONG', I: 'EM', INS: 'U', DIV: 'P', H1: 'H2', H4: 'H3', H5: 'H3', H6: 'H3',
    ARTICLE: 'P', SECTION: 'P', BLOCKQUOTE: 'P', PRE: 'P', SPAN: null, FONT: null,
  };

  /** Blocks that cannot nest inside another block. */
  var RICH_BLOCK = { H2: 1, H3: 1, P: 1, UL: 1, OL: 1 };

  /**
   * Elements whose CONTENTS go too, rather than being kept as words.
   *
   * The difference matters: unwrapping <span> should keep the text inside it,
   * but unwrapping <script> would paste the program into the label.
   */
  var RICH_DROP = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1,
    HEAD: 1, TITLE: 1, SVG: 1, MATH: 1, CANVAS: 1, AUDIO: 1, VIDEO: 1,
  };

  function sanitizeRichText(html) {
    if (typeof html !== 'string' || !html) return '';
    if (typeof DOMParser === 'undefined') return '';   // no DOM (a test runner): refuse rather than guess

    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    var out = doc.createElement('div');
    copyRich(doc.body, out, doc, null);
    tidyRich(out, doc);
    return out.innerHTML.trim();
  }

  /**
   * Rebuild a clean tree rather than deleting from the dirty one.
   *
   * Whitelisting by construction: a node only ever reaches the output because
   * it was named, so a tag nobody thought about cannot slip through. `block` is
   * the block currently being filled, which is what keeps an <li> from landing
   * outside a list and a heading from landing inside a paragraph.
   */
  function copyRich(node, into, doc, inBlock) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];

      if (child.nodeType === 3) {                       // text
        var text = child.nodeValue.replace(/\s+/g, ' ');
        if (!text.trim() && !into.childNodes.length) continue;
        into.appendChild(doc.createTextNode(text));
        continue;
      }
      if (child.nodeType !== 1) continue;               // comments, CDATA, the lot

      var tag = child.tagName.toUpperCase();
      if (RICH_DROP[tag]) continue;                     // the element AND its contents
      if (Object.prototype.hasOwnProperty.call(RICH_REMAP, tag)) {
        var mapped = RICH_REMAP[tag];
        if (mapped === null) { copyRich(child, into, doc, inBlock); continue; }  // unwrap, keep the words
        tag = mapped;
      }
      if (!RICH_TAGS[tag]) { copyRich(child, into, doc, inBlock); continue; }

      if (tag === 'LI' && into.tagName !== 'UL' && into.tagName !== 'OL') tag = 'P';
      // A block inside a block is a <div> that was never a paragraph in the
      // first place: keep the words, drop the second wrapper.
      if (RICH_BLOCK[tag] && inBlock) { copyRich(child, into, doc, inBlock); continue; }

      var clean = doc.createElement(tag);               // created bare: no attributes carry over
      into.appendChild(clean);
      if (tag !== 'BR') copyRich(child, clean, doc, inBlock || !!RICH_BLOCK[tag]);
    }
  }

  /**
   * Drop the empties and adopt the orphans.
   *
   * A contenteditable leaves behind blank paragraphs as you edit, and bare text
   * at the top level if the first line was never wrapped. Neither is dangerous;
   * both look like a bug in the sheet.
   */
  function tidyRich(root, doc) {
    // Pass one: anything loose at the top level - bare words, a stray <strong>
    // - joins one paragraph, so a run of inline content stays one sentence
    // instead of being cut into a paragraph per tag.
    var loose = null;
    Array.prototype.slice.call(root.childNodes).forEach(function (node) {
      var isInline = node.nodeType === 3 ||
                     (node.nodeType === 1 && !RICH_BLOCK[node.tagName]);
      if (!isInline) { loose = null; return; }
      if (node.nodeType === 3 && !node.nodeValue.trim() && !loose) {
        root.removeChild(node);
        return;
      }
      if (!loose) { loose = doc.createElement('p'); root.insertBefore(loose, node); }
      loose.appendChild(node);
    });

    // Pass two: drop what an editor leaves behind - blank paragraphs, list
    // items with nothing in them, a list with no items left.
    Array.prototype.slice.call(root.childNodes).forEach(function (node) {
      if (node.nodeType !== 1) { root.removeChild(node); return; }
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        Array.prototype.slice.call(node.childNodes).forEach(function (li) {
          if (li.nodeType !== 1 || li.tagName !== 'LI') node.removeChild(li);
          else if (!li.textContent.trim()) node.removeChild(li);
        });
      }
      if (!node.textContent.trim() && node.tagName !== 'BR' &&
          !node.querySelector('br')) root.removeChild(node);
    });
  }

  /** The words alone — for "is this empty", reading time, and the log. */
  function plainText(html) {
    if (typeof html !== 'string' || !html) return '';
    if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ defaults
  function cfg() { return window.AR_CONFIG || {}; }

  /** 'video' or 'image' — never anything else, whatever the bundle says. */
  function mediaKind(value, fallback) {
    if (value === 'image' || value === 'video') return value;
    return fallback || 'video';
  }

  function mediaDefaults() {
    var v = cfg().media || cfg().video || {};
    return {
      kind: mediaKind(v.kind, 'video'),
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

  /** Everything an exhibit may override on the projected media. */
  var MEDIA_FIELDS = ['kind', 'fit', 'loop', 'restartOnFound', 'scale'];

  /** A {x,y,z} that tolerates a partial or missing object. */
  function vec3(value, fallback) {
    var v = value || {};
    return {
      x: typeof v.x === 'number' ? v.x : fallback.x,
      y: typeof v.y === 'number' ? v.y : fallback.y,
      z: typeof v.z === 'number' ? v.z : fallback.z,
    };
  }

  function modelDefaults() {
    var m = cfg().model || {};
    var f = cfg().floor || {};
    return {
      heightMeters: typeof f.objectHeightMeters === 'number' ? f.objectHeightMeters : 1,
      // Degrees. y is the turn that used to be called yawOffset on its own; a
      // bundle still carrying that is folded in by normalize().
      rotation: vec3(m.rotation, { x: 0, y: m.yawOffset || 0, z: 0 }),
      // Metres from where the figure was put down, in the frame it was placed
      // in: x to your right, y up, z towards you. Relative to the placement
      // rather than the room, so the same numbers mean the same thing wherever
      // in the gallery it is stood up.
      offset: vec3(m.offset, { x: 0, y: 0, z: 0 }),
      // A plain multiplier on heightMeters, so a model can be nudged bigger or
      // smaller without restating the real-world measurement.
      scale: typeof m.scale === 'number' ? m.scale : 1,
      spin: !!m.spin,
      playClip: m.playClip !== false,
      // 'baked' renders the texture exactly as authored (right for scans and
      // anything with baked AO); 'lit' shades it with the scene lights.
      lighting: m.lighting === 'lit' ? 'lit' : 'baked',
      // Peak opacity of the soft contact shadow under the figure. 0 turns it off.
      shadowOpacity: typeof m.shadowOpacity === 'number' ? m.shadowOpacity : 0.5,
      // The shape of that shadow, as soft ellipses on the floor. Empty means
      // one circle sized automatically from the figure, which is what every
      // exhibit did before this existed - so an old bundle keeps its look.
      shadows: shadowList(m.shadows),
      // Whether those ellipses ride on the figure: tied to its size and its
      // turn, so scaling the object scales its shadow with it. Off leaves them
      // fixed on the floor in metres, which is how they behaved before this.
      shadowFollow: !!m.shadowFollow,
      // The figure scale the ellipses were drawn at. Only means anything with
      // shadowFollow on, where the shadow grows by scale / shadowScale.
      shadowScale: typeof m.shadowScale === 'number' && m.shadowScale > 0
        ? m.shadowScale
        : (typeof m.scale === 'number' ? m.scale : 1),
    };
  }

  /**
   * Sanitise a list of shadow ellipses.
   *
   * x/z place the ellipse on the floor and w/d are its width and depth, all in
   * metres from the figure's feet; r turns it, in degrees; o is its own opacity
   * on top of the exhibit's shadowOpacity, and c its colour. Anything missing
   * or non-numeric falls back rather than reaching the renderer as NaN, because
   * a NaN in a matrix silently removes the whole mesh.
   */
  function shadowList(value) {
    if (!Array.isArray(value)) return [];
    var num = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };
    return value.map(function (blob) {
      var b = blob || {};
      return {
        x: num(b.x, 0),
        z: num(b.z, 0),
        w: Math.max(0.01, num(b.w, 0.6)),
        d: Math.max(0.01, num(b.d, 0.6)),
        r: num(b.r, 0),
        o: Math.min(1, Math.max(0, num(b.o, 1))),
        c: hexColour(b.c, '#000000'),
      };
    });
  }

  /**
   * A #rrggbb string, or the fallback.
   *
   * Worth being strict: three.js answers an unparsable colour with a warning
   * and white, and white is the one colour a shadow must never be.
   */
  function hexColour(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var v = value.charAt(0) === '#' ? value : '#' + value;
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
  }

  /** Everything an exhibit may override on top of the model defaults. */
  var MODEL_FIELDS = ['heightMeters', 'rotation', 'offset', 'scale', 'spin',
                      'playClip', 'lighting', 'shadowOpacity', 'shadows',
                      'shadowFollow', 'shadowScale'];

  /** Of those, the ones that are {x,y,z} and must be merged, not replaced. */
  var MODEL_VECTORS = ['rotation', 'offset'];

  /**
   * Lay an exhibit's own model settings over the defaults.
   *
   * rotation and offset are merged component by component, so a bundle that
   * only recorded one axis does not blank the other two.
   */
  function applyModelFields(target, source) {
    MODEL_FIELDS.forEach(function (k) {
      if (source[k] === undefined) return;
      if (k === 'shadows') { target.shadows = shadowList(source.shadows); return; }
      target[k] = MODEL_VECTORS.indexOf(k) === -1 ? source[k] : vec3(source[k], target[k]);
    });
    // An exhibit that sets a scale but never recorded what scale its ellipses
    // were drawn at was drawn at that one - assuming otherwise would double the
    // shadow the moment shadowFollow is hand-edited into content.json.
    if (source.shadowScale === undefined && typeof source.scale === 'number') {
      target.shadowScale = source.scale;
    }
    // Written before the Adjust panel existed: one turn, no other axes.
    if (source.yawOffset !== undefined &&
        (!source.rotation || source.rotation.y === undefined)) {
      target.rotation.y = source.yawOffset;
    }
    return target;
  }

  // ------------------------------------------------------------------ details
  /** One language's label: a heading, the body, and the recording of it. */
  function blankDetail() {
    return { title: '', html: '', audio: { src: null, file: null, fileName: null } };
  }

  function normalizeDetail(value) {
    var d = value || {};
    var audio = d.audio || {};
    return {
      title: String(d.title || '').trim().slice(0, 200),
      html: sanitizeRichText(d.html),
      audio: {
        src: audio.src || null,
        file: audio.file || null,
        fileName: audio.fileName || null,
        // The portal's own bookkeeping about the uploaded file. It means
        // nothing to the viewer, but it has to survive: this function runs on
        // every re-render of a card, and dropping `stamp` there would make a
        // recording that is sitting in storage look like it was never added.
        stamp: audio.stamp || null,
        type: audio.type || null,
        size: audio.size || 0,
        duration: audio.duration || 0,
      },
    };
  }

  /**
   * Sanitise every language's details, keyed by code.
   *
   * Languages the bundle no longer lists are KEPT, not dropped. Removing a
   * language from the list should not silently destroy the translation work;
   * put it back and the words are still there.
   */
  function normalizeDetails(value, languages) {
    var out = {};
    var source = (value && typeof value === 'object') ? value : {};
    Object.keys(source).forEach(function (raw) {
      var code = languageCode(raw);
      if (code) out[code] = normalizeDetail(source[raw]);
    });
    languageList(languages).forEach(function (l) {
      if (!out[l.code]) out[l.code] = blankDetail();
    });
    return out;
  }

  /** Is there anything to read in this language? */
  function hasDetail(detail) {
    if (!detail) return false;
    return !!(String(detail.title || '').trim() || plainText(detail.html));
  }

  /**
   * The details to show for a language, and what actually got used.
   *
   * `fellBack` is the honest bit: the sheet says "shown in English" rather than
   * pretending the Tamil translation exists, so a visitor knows why they are
   * reading a language they did not pick.
   */
  function detailsFor(exhibit, code, languages) {
    var details = (exhibit && exhibit.details) || {};
    var base = baseCode(languages || (exhibit && exhibit.languages));
    var wanted = languageCode(code) || base;
    if (hasDetail(details[wanted])) {
      return { code: wanted, detail: details[wanted], fellBack: false };
    }
    if (hasDetail(details[base])) {
      return { code: base, detail: details[base], fellBack: wanted !== base };
    }
    return { code: wanted, detail: details[wanted] || blankDetail(), fellBack: false };
  }

  /** Languages this exhibit has a recording in — the Listen button's whole rule. */
  function audioLanguages(exhibit) {
    var details = (exhibit && exhibit.details) || {};
    return Object.keys(details).filter(function (code) {
      return !!(details[code].audio && details[code].audio.src);
    });
  }

  function assign(target, source) {
    for (var k in source) if (Object.prototype.hasOwnProperty.call(source, k)) target[k] = source[k];
    return target;
  }

  // ------------------------------------------------------------------ normalize
  /** Fill in everything the portal or an older bundle may have left out. */
  function normalize(exhibit, index, languages) {
    var ex = exhibit || {};
    var image = ex.image || {};
    // Bundles written before a still could be projected called this `video`.
    var media = ex.media || ex.video || {};
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
      media: assign(assign({}, mediaDefaults()), {
        src: media.src || null,
        file: media.file || null,
        width: media.width || 0,
        height: media.height || 0,
      }),
      details: normalizeDetails(ex.details, languages),
      model: null,
    };

    // Per-exhibit overrides win over the config defaults.
    MEDIA_FIELDS.forEach(function (k) {
      if (media[k] !== undefined) out.media[k] = media[k];
    });
    // A record that named its kind is believed; one that did not is read from
    // the file name, which is the only honest clue an older bundle leaves.
    out.media.kind = media.kind ? mediaKind(media.kind, 'video') : guessKind(out.media);
    if (media.offset) {
      out.media.offset = {
        x: media.offset.x || 0,
        y: media.offset.y || 0,
        z: media.offset.z === undefined ? 0.001 : media.offset.z,
      };
    }

    if (model && (model.src || model.file)) {
      out.model = assign(assign({}, modelDefaults()), {
        src: model.src || null,
        file: model.file || null,
      });
      applyModelFields(out.model, model);
    } else if (model) {
      // A model record with no file still carries its sizing, which the
      // built-in placeholder figure should honour.
      out.model = assign(assign({}, modelDefaults()), { src: null, file: null });
      applyModelFields(out.model, model);
    }

    if (!out.model) out.model = assign(modelDefaults(), { src: null, file: null });
    return out;
  }

  /**
   * What kind of media is this, for a record that never said?
   *
   * Only reached by a hand-written or pre-v2 bundle. The file name is the one
   * honest clue; anything unrecognised stays a video, which is what every
   * exhibit was before stills existed.
   */
  function guessKind(media) {
    var name = String(media.file || media.fileName || media.src || '');
    if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(name)) return 'image';
    return 'video';
  }

  function blankExhibit(index, languages) {
    return normalize({
      id: 'exhibit-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      name: 'Exhibit ' + (index + 1),
    }, index, languages);
  }

  // ------------------------------------------------------------------ sources
  function fromLegacyConfig() {
    var c = cfg();
    if (!c.target || !c.target.imageSrc) return null;
    var media = c.media || c.video || {};
    return {
      source: 'legacy',
      mindSrc: c.target.mindSrc,
      languages: languageList(c.languages),
      exhibits: [normalize({
        id: 'legacy',
        name: 'Exhibit 1',
        image: { src: c.target.imageSrc, width: c.target.width, height: c.target.height },
        media: { src: media.src, width: media.width, height: media.height, kind: media.kind },
        model: c.model.src ? { src: c.model.src } : null,
      }, 0, c.languages)],
    };
  }

  function fromBundle() {
    return fetch('./assets/content/content.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.exhibits)) throw new Error('content.json has no exhibits list');
        var languages = languageList(data.languages);
        return {
          source: 'bundle',
          generated: data.generated || null,
          mindSrc: data.mindSrc || './assets/content/targets.mind',
          languages: languages,
          exhibits: data.exhibits.map(function (ex, i) { return normalize(ex, i, languages); }),
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
      var languages = languageList(draft.languages);

      // One flat list of keys, read in one pass, then looked up by key — the
      // count per exhibit is no longer fixed now that each language may bring
      // a recording with it.
      var keys = [MIND_FILE];
      draft.exhibits.forEach(function (ex) {
        keys.push(ARStore.fileKey(ex.id, 'img'));
        keys.push(ARStore.fileKey(ex.id, 'med'));
        keys.push(ARStore.fileKey(ex.id, 'vid'));      // drafts written before stills existed
        keys.push(ARStore.fileKey(ex.id, 'mdl'));
        languages.forEach(function (l) {
          keys.push(ARStore.fileKey(ex.id, ARStore.audioKind(l.code)));
        });
      });

      return Promise.all(keys.map(function (k) { return ARStore.getFile(k); })).then(function (blobs) {
        var at = {};
        keys.forEach(function (k, i) { at[k] = blobs[i]; });

        var mind = at[MIND_FILE];
        if (!mind) throw new Error('the targets have not been compiled yet — press Compile in the portal');

        var exhibits = draft.exhibits.map(function (ex, i) {
          var copy = JSON.parse(JSON.stringify(ex));
          var img = at[ARStore.fileKey(ex.id, 'img')];
          var med = at[ARStore.fileKey(ex.id, 'med')] || at[ARStore.fileKey(ex.id, 'vid')];
          var mdl = at[ARStore.fileKey(ex.id, 'mdl')];

          copy.image = copy.image || {};
          copy.media = copy.media || copy.video || {};
          copy.image.src = img ? keep(img) : null;
          copy.media.src = med ? keep(med) : null;
          if (med && !copy.media.kind) copy.media.kind = /^image\//.test(med.type) ? 'image' : 'video';
          if (mdl) { copy.model = copy.model || {}; copy.model.src = keep(mdl); }
          else if (copy.model) { copy.model.src = null; }

          copy.details = copy.details || {};
          languages.forEach(function (l) {
            var audio = at[ARStore.fileKey(ex.id, ARStore.audioKind(l.code))];
            copy.details[l.code] = copy.details[l.code] || {};
            copy.details[l.code].audio = {
              src: audio ? keep(audio) : null,
              fileName: (copy.details[l.code].audio || {}).fileName || null,
            };
          });

          return normalize(copy, i, languages);
        });

        return {
          source: 'preview',
          generated: draft.updated || null,
          compiled: draft.compiled || null,
          mindSrc: keep(mind),
          languages: languages,
          exhibits: exhibits,
          objectUrls: urls,
        };
      });
    });
  }

  /** One level deeper than assign(), so {x,y,z} merges instead of replacing. */
  function deepAssign(target, source) {
    for (var k in source) {
      if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
      var v = source[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        var into = (target[k] && typeof target[k] === 'object') ? target[k] : {};
        target[k] = assign(into, v);
      } else {
        target[k] = v;
      }
    }
    return target;
  }

  /**
   * Write settings back into the portal's draft, so an adjustment made while
   * standing in front of the real thing survives into the next Export and from
   * there into the repo.
   *
   * Only the draft is touched — never the deployed bundle, which is a file in
   * git and not ours to rewrite from a phone.
   */
  function saveExhibitSettings(id, patch) {
    return ARStore.getDraft().then(function (draft) {
      if (!draft || !draft.exhibits || !draft.exhibits.length) {
        throw new Error('this browser has no portal draft to save into — open ' +
                        'admin.html here first, or use Copy');
      }
      var target = null;
      for (var i = 0; i < draft.exhibits.length; i++) {
        if (draft.exhibits[i].id === id) { target = draft.exhibits[i]; break; }
      }
      if (!target) {
        throw new Error('the draft in this browser has no exhibit "' + id +
                        '" — it holds ' + draft.exhibits.length + ' other one(s)');
      }
      if (patch.model) { target.model = deepAssign(target.model || {}, patch.model); }
      if (patch.media) { target.media = deepAssign(target.media || target.video || {}, patch.media); }
      return ARStore.setDraft(draft).then(function () { return target.name || id; });
    });
  }

  function previewRequested() {
    return /[?&]preview=1\b/.test(location.search);
  }

  /**
   * Resolve the content for this page load.
   *
   * Never rejects for want of exhibits: an empty gallery is a real state, not
   * an error, and the start screen says so. A broken source still falls through
   * to the next one, with the reasons handed back in `notes` so the log shows
   * exactly what happened rather than a silent switch to different content.
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
        if (!legacy) {
          notes.push('js/config.js names no target either — the gallery is empty');
          return {
            source: 'empty',
            mindSrc: (cfg().target || {}).mindSrc || './assets/content/targets.mind',
            languages: languageList(cfg().languages),
            exhibits: [],
          };
        }
        return legacy;
      })
      .then(function (bundle) {
        bundle.notes = notes;
        bundle.languages = languageList(bundle.languages);
        if (wantPreview && bundle.source !== 'preview') bundle.previewFailed = true;
        return bundle;
      });
  }

  window.ARStore = ARStore;
  window.ARContent = {
    load: load,
    MODEL_FIELDS: MODEL_FIELDS,
    MODEL_VECTORS: MODEL_VECTORS,
    MEDIA_FIELDS: MEDIA_FIELDS,
    RICH_TAGS: RICH_TAGS,
    shadowList: shadowList,
    saveExhibitSettings: saveExhibitSettings,
    normalize: normalize,
    blankExhibit: blankExhibit,
    blankDetail: blankDetail,
    mediaDefaults: mediaDefaults,
    modelDefaults: modelDefaults,
    normalizeDetails: normalizeDetails,
    detailsFor: detailsFor,
    hasDetail: hasDetail,
    audioLanguages: audioLanguages,
    languageList: languageList,
    languageCode: languageCode,
    baseCode: baseCode,
    sanitizeRichText: sanitizeRichText,
    plainText: plainText,
    previewRequested: previewRequested,
  };
})();
