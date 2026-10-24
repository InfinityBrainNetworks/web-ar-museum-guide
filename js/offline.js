/**
 * The gallery, downloaded: the service worker, the download manager, and the
 * "Getting the gallery ready" screen.
 *
 * A museum's wifi is at its worst exactly where the visitor is standing - in
 * front of the artwork, in a room full of other phones. So the first visit
 * downloads the gallery once, with a progress bar, into a cache the service
 * worker (sw.js) answers from: after that the tracker, the videos, the
 * narration and the 3D figures come off the phone, and the guide works with
 * no network at all.
 *
 *   essentials   the tracker and the photographs - what Explore shows and AR
 *                cannot start without. Downloaded first, always.
 *   the rest     videos, stills, 3D models, and the narration in the
 *                visitor's language (plus the fallback language). Downloaded
 *                straight after, in the background, unless the phone asked
 *                to save data - then it is offered, not taken.
 *
 * Nothing here is required. A browser with no service worker or no Cache
 * Storage (some in-app browsers, private windows) streams everything from the
 * network exactly as the guide always did.
 *
 * Every URL this caches is immutable - cloud files are named after a hash of
 * their bytes and the repo bundle's carry its export stamp - so there is no
 * expiry to manage: a new release simply lists new URLs, and the ones no
 * release mentions any more are deleted.
 */
(function () {
  'use strict';

  var CACHE = 'ar-assets-v1';            // sw.js answers from this; keep the names in step
  var CHOICE_KEY = 'ar-museum-offline';  // 'all' | 'later', the visitor's answer
  var CONCURRENCY = 2;

  var log = window.ARLog || console;
  function t(key, vars) { return window.ARI18n ? window.ARI18n.t(key, vars) : key; }
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ support
  function cachesUsable() {
    try { return 'caches' in window && window.isSecureContext; } catch (e) { return false; }
  }

  var registration = null;

  /**
   * Install sw.js. ?sw=0 removes it instead - the escape hatch for a phone
   * that seems stuck on an old copy of the guide.
   */
  function register() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      return Promise.resolve(null);
    }
    if (/[?&]sw=0\b/.test(location.search)) {
      return navigator.serviceWorker.getRegistrations().then(function (list) {
        list.forEach(function (r) { r.unregister(); });
        log.warn('offline: service worker removed (?sw=0) — everything streams from the network');
        return null;
      });
    }
    return navigator.serviceWorker.register('./sw.js').then(function (reg) {
      registration = reg;
      log.info('offline: service worker registered (scope ' + reg.scope + ')');
      return reg;
    }, function (err) {
      log.warn('offline: service worker not registered — ' + (err && err.message ? err.message : err));
      return null;
    });
  }

  // ------------------------------------------------------------------ the plan
  function absolute(src) {
    if (!src || /^(blob|data):/.test(src)) return null;
    try { return new URL(src, location.href).href; } catch (e) { return null; }
  }

  /**
   * Every file the gallery would need on this phone, essentials first.
   *
   * Narration only in the visitor's language and the fallback one: a gallery
   * in six languages should not make everyone carry all six.
   */
  function plan(bundle, lang) {
    var items = [];
    var seen = {};
    var add = function (src, bytes, kind, label, essential) {
      var url = absolute(src);
      if (!url || seen[url]) return;
      seen[url] = true;
      items.push({ url: url, bytes: bytes || 0, kind: kind, label: label, essential: !!essential });
    };
    if (!bundle || !bundle.exhibits) return items;

    var base = window.ARContent ? window.ARContent.baseCode(bundle.languages) : 'en';
    var codes = [lang || base, base];

    // The release's own manifest, which the first visit fetched before the
    // service worker could keep it. Without it an offline visit has every file
    // and no list of them.
    if (bundle.manifestSrc) add(bundle.manifestSrc, 0, 'file', 'manifest', true);
    add(bundle.mindSrc, bundle.mindSize, 'tracker', t('sync.item.tracker'), true);
    var plan = bundle.site && bundle.site.map;
    if (plan && plan.src) add(plan.src, plan.size, 'photo', t('nav.map'), true);
    // The photo strip: a souvenir taken offline still carries the logos.
    if (window.ARContent && window.ARContent.photoLogos) {
      window.ARContent.photoLogos(bundle).forEach(function (l) { add(l.src, 0, 'photo', l.label || 'logo', true); });
    }
    bundle.exhibits.forEach(function (ex) {
      if (ex.image.thumb) add(ex.image.thumb, 0, 'photo', ex.name, true);
      add(ex.image.src, ex.image.size, 'photo', ex.name, true);
    });
    bundle.exhibits.forEach(function (ex) {
      add(ex.media.src, ex.media.size, ex.media.kind === 'image' ? 'still' : 'video', ex.name);
      if (ex.model && ex.model.src) add(ex.model.src, ex.model.size, 'model', ex.name);
      codes.forEach(function (code) {
        var d = ex.details && ex.details[code];
        if (d && d.audio && d.audio.src) add(d.audio.src, d.audio.size, 'narration', ex.name);
      });
    });
    return items;
  }

  /** Every file ANY language of this bundle uses - what pruning must keep. */
  function everyUrl(bundle) {
    var keep = {};
    var mark = function (src) { var u = absolute(src); if (u) keep[u] = true; };
    if (!bundle || !bundle.exhibits) return keep;
    mark(bundle.manifestSrc);
    mark(bundle.mindSrc);
    if (bundle.site && bundle.site.map) mark(bundle.site.map.src);
    if (window.ARContent && window.ARContent.photoLogos) {
      window.ARContent.photoLogos(bundle).forEach(function (l) { mark(l.src); });
    }
    bundle.exhibits.forEach(function (ex) {
      mark(ex.image.src); mark(ex.image.thumb); mark(ex.media.src);
      if (ex.model) mark(ex.model.src);
      Object.keys(ex.details || {}).forEach(function (code) {
        var d = ex.details[code];
        if (d && d.audio) mark(d.audio.src);
      });
    });
    return keep;
  }

  // ------------------------------------------------------------------ the cache
  function openCache() { return caches.open(CACHE); }

  /** Which items are already on the phone, and the sizes of all of them. */
  function check(items) {
    if (!cachesUsable()) return Promise.resolve(items);
    return openCache().then(function (cache) {
      return Promise.all(items.map(function (item) {
        return cache.match(item.url, { ignoreVary: true }).then(function (hit) {
          item.cached = !!hit;
          if (hit && !item.bytes) item.bytes = Number(hit.headers.get('Content-Length')) || 0;
          return item;
        });
      }));
    }).catch(function () { return items; });
  }

  /**
   * Sizes the bundle did not record, asked of the server one HEAD at a time.
   * Only the repo bundle needs this: a cloud release lists every size.
   */
  function measure(items) {
    var unknown = items.filter(function (i) { return !i.cached && !i.bytes; });
    return eachLimited(unknown, 4, function (item) {
      return fetch(item.url, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
        item.bytes = Number(r.headers.get('Content-Length')) || 0;
      }).catch(function () { /* the download will find out */ });
    }).then(function () { return items; });
  }

  function eachLimited(list, limit, fn) {
    var i = 0;
    var next = function () {
      if (i >= list.length) return Promise.resolve();
      var item = list[i++];
      return Promise.resolve(fn(item)).then(next, next);
    };
    var workers = [];
    for (var k = 0; k < Math.min(limit, list.length); k++) workers.push(next());
    return Promise.all(workers);
  }

  /** One URL being downloaded, so two callers asking for it share a download. */
  var inflight = {};

  /** Fetch one file into the cache, reporting bytes as they arrive. */
  function fetchInto(cache, item, onBytes) {
    if (inflight[item.url]) {
      inflight[item.url].listeners.push(onBytes);
      return inflight[item.url].promise;
    }
    var entry = { listeners: [onBytes], promise: null };
    inflight[item.url] = entry;
    var tell = function (n) { entry.listeners.forEach(function (fn) { if (fn) fn(n); }); };

    entry.promise = fetch(item.url, { mode: 'cors', credentials: 'omit', cache: 'no-store' })
      .then(function (response) {
        // A 200 and nothing else. A 204 is "ok" to fetch() but empty, and
        // download managers that hook the OS (IDM, on Windows) answer media
        // requests with exactly that - kept, it would be a silent recording.
        if (response.status !== 200) throw new Error('HTTP ' + response.status);
        var total = Number(response.headers.get('Content-Length')) || item.bytes || 0;
        if (total) item.bytes = total;
        var type = response.headers.get('Content-Type') || 'application/octet-stream';

        if (!response.body || !response.body.getReader) {
          return response.blob().then(function (blob) { tell(blob.size); return { blob: blob, type: type }; });
        }
        var reader = response.body.getReader();
        var chunks = [];
        var read = function () {
          return reader.read().then(function (step) {
            if (step.done) return { blob: new Blob(chunks, { type: type }), type: type };
            chunks.push(step.value);
            tell(step.value.byteLength);
            return read();
          });
        };
        return read();
      })
      .then(function (got) {
        return cache.put(item.url, new Response(got.blob, {
          status: 200,
          headers: { 'Content-Type': got.type, 'Content-Length': String(got.blob.size) },
        })).then(function () {
          item.cached = true;
          item.bytes = got.blob.size;
        });
      })
      .then(function () { delete inflight[item.url]; }, function (err) {
        delete inflight[item.url];
        throw err;
      });
    return entry.promise;
  }

  /**
   * Download every missing item, two at a time, essentials first.
   * onProgress({ done, total, files, filesDone, item }) as bytes arrive.
   */
  function download(items, onProgress) {
    if (!cachesUsable()) return Promise.reject(new Error('this browser cannot keep files offline'));
    var missing = items.filter(function (i) { return !i.cached; });
    var total = 0, done = 0, filesDone = 0, failed = [];
    missing.forEach(function (i) { total += i.bytes || 0; });
    var report = function (item) {
      if (onProgress) onProgress({ done: done, total: Math.max(total, done), files: missing.length,
                                   filesDone: filesDone, item: item, failed: failed.length });
    };

    return openCache().then(function (cache) {
      return eachLimited(missing, CONCURRENCY, function (item) {
        var guessed = item.bytes || 0;
        var got = 0;
        report(item);
        return fetchInto(cache, item, function (n) {
          got += n;
          done += n;
          // A size we did not know until the download began.
          if (got > guessed) { total += got - guessed; guessed = got; }
          report(item);
        }).then(function () {
          filesDone++;
          report(item);
        }, function (err) {
          failed.push({ item: item, error: err });
          log.warn('offline: could not download ' + item.kind + ' for "' + item.label + '" — ' +
                   (err && err.message ? err.message : err));
        });
      });
    }).then(function () {
      if (failed.length) {
        var e = new Error(failed.length + ' file' + (failed.length === 1 ? '' : 's') + ' could not be downloaded');
        e.failed = failed;
        throw e;
      }
      return { bytes: done, files: missing.length };
    });
  }

  /** Make sure one file is on the phone - the tracker, before AR starts. */
  function ensure(src, onProgress) {
    var url = absolute(src);
    if (!url || !cachesUsable() || !state.worker) return Promise.resolve(false);
    var item = { url: url, bytes: 0, kind: 'file', label: '' };
    (state.items || []).forEach(function (i) { if (i.url === url) item = i; });
    return check([item]).then(function () {
      if (item.cached) return true;
      var got = 0;
      return openCache().then(function (cache) {
        return fetchInto(cache, item, function (n) {
          got += n;
          if (onProgress) onProgress(got, item.bytes || 0);
        });
      }).then(function () { refreshUi(); return true; });
    });
  }

  /** Drop every cached file no language of this bundle uses any more. */
  function prune(bundle) {
    if (!cachesUsable()) return Promise.resolve(0);
    var keep = everyUrl(bundle);
    return openCache().then(function (cache) {
      return cache.keys().then(function (requests) {
        var gone = requests.filter(function (r) { return !keep[r.url]; });
        return Promise.all(gone.map(function (r) { return cache.delete(r); })).then(function () {
          if (gone.length) log.info('offline: removed ' + gone.length + ' file(s) no release uses any more');
          return gone.length;
        });
      });
    }).catch(function () { return 0; });
  }

  function clearAll() {
    if (!cachesUsable()) return Promise.resolve();
    return caches.delete(CACHE).then(function () {
      (state.items || []).forEach(function (i) { i.cached = false; });
      writeChoice('later');
      refreshUi();
      log.event('offline: downloaded gallery removed from this phone');
    });
  }

  function readChoice() { try { return localStorage.getItem(CHOICE_KEY); } catch (e) { return null; } }
  function writeChoice(v) { try { localStorage.setItem(CHOICE_KEY, v); } catch (e) {} }

  function saveData() {
    var c = navigator.connection;
    return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
  }

  // ------------------------------------------------------------------ the screen
  var state = {
    bundle: null,
    items: null,
    worker: false,
    running: false,
    progress: null,
    error: null,
  };

  function mb(bytes) {
    var v = (bytes || 0) / 1048576;
    return v >= 10 ? v.toFixed(0) : v.toFixed(1);
  }

  function totals() {
    var all = 0, have = 0, essentialMissing = 0, missing = 0;
    (state.items || []).forEach(function (i) {
      all += i.bytes || 0;
      if (i.cached) have += i.bytes || 0;
      else { missing++; if (i.essential) essentialMissing++; }
    });
    return { all: all, have: have, missing: missing, essentialMissing: essentialMissing };
  }

  function showScreen(on) {
    var screen = $('syncScreen');
    if (!screen) return;
    screen.classList.toggle('hidden', !on);
    if (on) refreshUi();
  }

  function refreshUi() {
    var sum = totals();
    var p = state.progress;
    var running = state.running;
    var screen = $('syncScreen');

    if (screen && !screen.classList.contains('hidden')) {
      var exhibits = state.bundle ? state.bundle.exhibits.length : 0;
      var fill = $('syncFill');
      var fraction = running && p && p.total ? p.done / p.total
        : (sum.all ? sum.have / sum.all : 0);
      if (fill) fill.style.transform = 'scaleX(' + Math.max(0.02, Math.min(1, fraction)) + ')';

      setText('syncLead', state.updating
        ? t('sync.update', { count: sum.missing })
        : t('sync.lead', { count: exhibits, size: mb(sum.all) }));
      setText('syncBytes', running && p
        ? t('sync.bytes', { done: mb(p.done), total: mb(p.total) })
        : (sum.missing ? t('sync.waiting', { size: mb(sum.all - sum.have) }) : t('sync.done')));
      setText('syncItem', running && p && p.item ? kindLabel(p.item) : '');

      var go = $('syncGo');
      if (go) {
        go.disabled = sum.essentialMissing > 0 && running;
        go.textContent = sum.missing === 0 ? t('sync.go')
          : (running ? (sum.essentialMissing ? t('sync.preparing') : t('sync.goBackground')) : t('sync.download', { size: mb(sum.all - sum.have) }));
        go.dataset.action = sum.missing === 0 || running ? 'close' : 'download';
      }
      var skip = $('syncSkip');
      if (skip) {
        skip.classList.toggle('hidden', sum.missing === 0);
        skip.textContent = running ? t('sync.later') : t('sync.notNow');
      }
      setText('syncHint', state.error ? t('sync.failed')
        : (saveData() && !running && sum.missing ? t('sync.saveData') : t('sync.why')));
      var hint = $('syncHint');
      if (hint) hint.classList.toggle('bad', !!state.error);
    }

    // Nothing left to fetch while the visitor is looking at the screen -
    // however that came about, a retry or the worker catching up - lets them in.
    if (screen && !screen.classList.contains('hidden') && !running && state.items &&
        state.items.length && sum.missing === 0 && !state.closing) {
      state.closing = true;
      setTimeout(function () { state.closing = false; showScreen(false); }, 700);
    }

    // The little pill in the top bar while the rest downloads behind Explore.
    var pill = $('syncPill');
    if (pill) {
      var bg = running && (!screen || screen.classList.contains('hidden'));
      pill.classList.toggle('hidden', !bg);
      if (bg && p && p.total) setText('syncPillValue', Math.floor((p.done / p.total) * 100) + '%');
    }

    // Settings > Offline gallery.
    setText('setOfflineValue', !state.worker ? t('settings.offlineNo')
      : (sum.missing === 0 && sum.all ? t('settings.offlineReady', { size: mb(sum.all) })
        : (running ? t('settings.offlineRunning') : t('settings.offlinePartial', { size: mb(sum.all - sum.have) }))));
  }

  function setText(id, text) { var n = $(id); if (n) n.textContent = text; }

  function kindLabel(item) {
    return t('sync.item.' + item.kind) + (item.kind === 'tracker' ? '' : ' · ' + item.label);
  }

  /** Download what is missing, keeping the screen and the pill up to date. */
  function run() {
    if (state.running || !state.items) return state.running || Promise.resolve();
    state.error = null;
    state.running = download(state.items, function (p) {
      state.progress = p;
      refreshUi();
    }).then(function (result) {
      log.ok('offline: gallery downloaded — ' + result.files + ' file(s), ' + mb(result.bytes) + ' MB');
      state.updating = false;
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(function (kept) {
          log.info('offline: storage ' + (kept ? 'is persistent' : 'may be cleared by the browser under pressure'));
        }).catch(function () {});
      }
      return prune(state.bundle);
    }, function (err) {
      state.error = err;
      log.warn('offline: download incomplete — ' + err.message);
      // Worth one more go by itself: museum wifi drops out and comes back,
      // and the service worker taking over can be what was missing.
      if (!state.retried) {
        state.retried = true;
        setTimeout(function () { if (!state.running && totals().missing) run(); }, 3000);
      }
    }).then(function () {
      state.running = false;
      state.progress = null;
      refreshUi();
      var screen = $('syncScreen');
      // Done while the visitor watched: let them in.
      if (!state.error && screen && !screen.classList.contains('hidden') && totals().missing === 0) {
        setTimeout(function () { showScreen(false); }, 600);
      }
    });
    refreshUi();
    return state.running;
  }

  function wire() {
    var go = $('syncGo');
    if (go) go.addEventListener('click', function () {
      if (go.dataset.action === 'download') { writeChoice('all'); run(); return; }
      writeChoice('all');
      showScreen(false);
    });
    var skip = $('syncSkip');
    if (skip) skip.addEventListener('click', function () {
      writeChoice('later');
      showScreen(false);
    });
    var pill = $('syncPill');
    if (pill) pill.addEventListener('click', function () { showScreen(true); });
    var row = $('setOffline');
    if (row) row.addEventListener('click', function () {
      if (!state.worker) return;
      if (totals().missing === 0) {
        if (window.confirm(t('settings.offlineConfirmFree'))) clearAll();
        return;
      }
      writeChoice('all');
      showScreen(true);
      run();
    });
    if (window.ARI18n && window.ARI18n.onChange) {
      window.ARI18n.onChange(function () { replan(); });
    }
    // The worker taking control mid-visit: anything that failed before it
    // could answer gets another try, through it.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (state.items && !state.running && totals().missing && readChoice() !== 'later') {
          log.info('offline: the service worker took over — fetching what is still missing');
          state.retried = false;
          run();
        }
      });
    }
  }

  /** The language changed, or a new release arrived: re-work out what is needed. */
  function replan() {
    if (!state.bundle) return Promise.resolve();
    state.items = plan(state.bundle, window.ARI18n ? window.ARI18n.code() : null);
    return check(state.items).then(function () {
      refreshUi();
      if (state.worker && totals().missing && readChoice() === 'all') run();
    });
  }

  /**
   * Called once the exhibits have loaded: decide whether to show the screen,
   * download in the background, or do nothing at all.
   */
  function start(bundle) {
    state.bundle = bundle;
    // Explore is on screen from here. The check below takes a few seconds, and
    // a full-screen sheet rising over someone who has already started tapping
    // ate their tap (it fades in from transparent) and pulled the page out from
    // under them. So once they have touched anything, the download carries on
    // behind Explore with the pill instead.
    if (!state.watchingTouch) {
      state.watchingTouch = true;
      document.addEventListener('pointerdown', function () { state.touched = true; }, { capture: true, once: true });
    }
    if (!bundle || !bundle.exhibits || !bundle.exhibits.length || bundle.source === 'preview') {
      refreshUi();
      return;
    }
    if (!cachesUsable() || !('serviceWorker' in navigator)) {
      log.info('offline: this browser cannot keep the gallery — streaming from the network');
      refreshUi();
      return;
    }

    // Registered is enough - NOT "in control". On a slow first visit the
    // worker can take many seconds to install (it keeps A-Frame and MindAR
    // too), and the Cache API does not need it: what is downloaded now is
    // served from the phone the moment the worker takes over. Waiting for
    // control here meant a first visit on museum wifi never downloaded at all.
    registered.then(function (reg) {
      state.worker = !!reg;
      if (!reg) {
        log.warn('offline: no service worker — streaming this visit');
        refreshUi();
        return;
      }
      state.items = plan(bundle, window.ARI18n ? window.ARI18n.code() : null);
      return check(state.items).then(measure).then(function () {
        var sum = totals();
        var choice = readChoice();
        log.info('offline: ' + (state.items.length - sum.missing) + ' of ' + state.items.length +
                 ' files on this phone (' + mb(sum.have) + ' of ' + mb(sum.all) + ' MB)');
        if (!sum.missing) { refreshUi(); return prune(bundle); }

        // A returning visitor with most of the gallery already, and a release
        // that changed a little: just fetch the difference, quietly.
        state.updating = choice === 'all' && sum.have > 0;
        var quiet = state.updating && (sum.all - sum.have) < 6 * 1048576;

        if (quiet) { run(); return; }
        // "Not now" means not now: a new release's photos and tracker (small)
        // come down quietly, and nothing flashes up over Explore.
        if (choice === 'later') {
          if (sum.essentialMissing) {
            download(state.items.filter(function (i) { return i.essential; }), function () {})
              .then(function () { refreshUi(); }, function (err) { log.warn('offline: essentials incomplete — ' + err.message); });
          }
          refreshUi();
          return;
        }
        if (state.touched) {
          log.info('offline: the visitor is already browsing — downloading behind Explore');
          if (!saveData() || sum.essentialMissing) run(); else refreshUi();
          return;
        }

        showScreen(true);
        // On a data-saving connection, ask first; everywhere else, start.
        if (!saveData() || sum.essentialMissing) run();
      });
    }).catch(function (err) {
      log.warn('offline: ' + (err && err.message ? err.message : err));
    });
  }

  window.AROffline = {
    register: register,
    start: start,
    ensure: ensure,
    plan: plan,
    check: check,
    download: download,
    prune: prune,
    clear: clearAll,
    open: function () { showScreen(true); },
    status: function () {
      var s = totals();
      return { worker: state.worker, running: !!state.running, files: (state.items || []).length,
               missing: s.missing, bytes: s.all, cachedBytes: s.have };
    },
  };

  // Register as early as possible, so it is in control by the time the
  // gallery has loaded and the visitor starts using it.
  var registered = register();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
