/**
 * The browse half: Explore, the exhibit label as a page, and Settings.
 *
 * Why this exists at all. Until now the app was a viewfinder and nothing else:
 * open the link anywhere but directly in front of a tracked artwork and it
 * could only say "Point at the artwork". The museum's own Android app is the
 * other way round - a catalogue you browse, with AR as a button - and that
 * shape costs us no new content, because the target image IS a photograph of
 * the artwork and the label text already exists per language.
 *
 * The division of labour with js/app.js is one-directional and small:
 *
 *   app.js    owns the camera, the scene, the exhibits and the language.
 *             Publishes window.ARViewer.
 *   shell.js  reads window.ARViewer, draws the browse screens, and asks for
 *             the camera to start or stop. It never touches the scene.
 *
 * Everything here is inside #shell, which is a SIBLING of #overlay rather than
 * a child of it. That is load-bearing - see the note at the top of
 * css/shell.css.
 */
(function () {
  'use strict';

  var MOTION_KEY = 'ar-museum-motion';
  var LOG_KEY = 'ar-museum-log';

  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  /** Which browse screen is showing. The nav and the top bar follow this. */
  var view = 'explore';
  /** The exhibit the label page is showing, or null. */
  var current = null;
  /** Which of Map / Feedback the "not built yet" panel is explaining. */
  var soonTab = 'map';
  var toastTimer = null;

  function cfg() { return window.AR_CONFIG || {}; }
  function V() { return window.ARViewer; }
  function t(key, vars) { return window.ARI18n.t(key, vars); }
  function log() { return (V() && V().log) || window.ARLog || console; }

  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }
  function toggle(node, on) { if (node) node.classList.toggle('hidden', !on); }

  function cacheDom() {
    var missing = [];
    ['shell', 'shellBar', 'shellBack', 'shellTitle', 'shellLang', 'shellLangCode',
     'shellBody', 'shellNav', 'shellToast',
     'viewExplore', 'exploreEyebrow', 'exploreTitle', 'exhibitGrid', 'exploreEmpty',
     'viewExhibit', 'exhibitHero', 'exhibitKicker', 'exhibitTitle', 'exhibitAlts',
     'exhibitFacts', 'exhibitLangs', 'exhibitFallback', 'exhibitText',
     'exhibitListen', 'exhibitListenLabel', 'exhibitAr', 'exhibitAudio',
     'viewSettings', 'setLang', 'setLangValue', 'setMotion', 'setLog', 'settingsAbout',
     'viewSoon', 'soonIcon', 'soonTitle', 'soonText', 'soonNeeds',
     'viewFeedback', 'fbForm', 'fbThanks', 'fbStars', 'fbExhibit', 'fbMessage', 'fbSend', 'fbNote', 'fbAgain',
     'staffGroup', 'setStaff', 'setStaffTitle', 'setStaffValue',
     'viewMap', 'mapEyebrow', 'mapFrame', 'mapStage', 'mapImage', 'mapPins', 'mapIn', 'mapOut',
     'mapCard', 'mapCardImg', 'mapCardTitle', 'mapCardState', 'mapCardGo', 'exhibitOnMap',
     'navAr', 'logToggle'
    ].forEach(function (id) {
      el[id] = $(id);
      // shellBar has no id of its own; it is only ever "the top bar".
      if (!el[id] && id !== 'shellBar') missing.push(id);
    });
    el.shellBar = document.querySelector('.shell-bar');
    return missing;
  }

  /** An <svg><use> pointing at one of the symbols in index.html. */
  function icon(name, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    // Both spellings: href is the modern one, xlink:href is what older WebKit
    // on the phones a museum actually meets still reads.
    use.setAttribute('href', '#' + name);
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + name);
    svg.appendChild(use);
    return svg;
  }

  // ================================================================ navigation
  /*
   * History. Every screen a visitor moves to is an entry in the browser's
   * history, so the phone's own Back button walks back through the guide -
   * painting, Map, Explore - instead of leaving the site, and the arrow in the
   * top bar does the same. The tabs replace one another (Back from Settings
   * goes home to Explore, not through every tab tried), a painting's page is
   * pushed on top of wherever it was opened from, and the camera gets one
   * entry of its own that app.js spends closing whatever is on top in there.
   *
   * Entries are { ibn: 1, v: view, ex: exhibit id, f: map focus, d: depth },
   * depth counting the entries this page has pushed above Explore.
   */
  var TABS = { explore: 1, map: 1, feedback: 1, settings: 1, soon: 1 };
  var depth = 0;
  var leavingAr = false;

  function entry(next, exhibit, extra) {
    var e = { ibn: 1, v: next, ex: exhibit ? exhibit.id : null, f: mapFocus || null, d: depth };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  function record(next, exhibit) {
    if (!window.history || !history.pushState) return;
    if (next === 'explore') {
      // Home: back down to the root rather than another entry on top.
      if (depth > 0) { history.go(-depth); return 'pending'; }
      history.replaceState(entry('explore', null), '');
      return;
    }
    if (TABS[next] && TABS[view] && view !== 'explore') {
      history.replaceState(entry(next, exhibit), '');
      return;
    }
    if (next === view && (exhibit ? exhibit.id : null) === (current ? current.id : null)) return;
    depth++;
    history.pushState(entry(next, exhibit), '');
  }

  function exhibitById(id) {
    var list = (V() && V().exhibits()) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function onPop(e) {
    var st = e.state && e.state.ibn ? e.state : { v: 'explore', d: 0 };
    var viewer = V();
    if (viewer && viewer.inAR && viewer.inAR()) {
      if (leavingAr) {
        viewer.exitAR();
      } else if (viewer.backInAr && viewer.backInAr() === 'layer') {
        // Something in the camera closed, and the camera stays: its entry
        // goes back on, for the next press of Back.
        depth = (st.d || 0) + 1;
        history.pushState({ ibn: 1, v: st.v, ex: st.ex, f: st.f, d: depth, ar: 1 }, '');
        return;
      }
    }
    leavingAr = false;
    depth = st.d || 0;
    if (st.v === 'map') mapFocus = st.f || null;
    go(st.v || 'explore', exhibitById(st.ex), { render: true });
  }

  /** app.js, as the camera opens: one entry for it. */
  function enteredAr() {
    if (!window.history || !history.pushState) return;
    depth++;
    history.pushState(entry(view, current, { ar: 1 }), '');
  }

  /** The camera's close button: through history when it has an entry there. */
  function leaveAr() {
    if (!history.state || !history.state.ar) return false;
    leavingAr = true;
    history.back();
    return true;
  }

  /** The arrow in the top bar: wherever the visitor came from. */
  function back() {
    if (depth > 0 && history.state && history.state.ibn) history.back();
    else go('explore');
  }

  /**
   * how.render: draw `next` without touching history - a redraw, or a step
   * the browser's own Back/Forward already took.
   */
  function go(next, exhibit, how) {
    if (!(how && how.render) && record(next, exhibit) === 'pending') return;
    view = next;
    current = exhibit || (next === 'exhibit' ? current : null);

    toggle2(el.viewExplore, next === 'explore');
    toggle2(el.viewExhibit, next === 'exhibit');
    toggle2(el.viewSettings, next === 'settings');
    toggle2(el.viewSoon, next === 'soon');
    toggle2(el.viewFeedback, next === 'feedback');
    toggle2(el.viewMap, next === 'map');

    // Back replaces nothing - it sits beside the title - so the title stays
    // the wordmark on Explore and becomes the screen's name elsewhere.
    toggle(el.shellBack, next !== 'explore');
    if (el.shellTitle) {
      var titles = { exhibit: '', settings: t('nav.settings'), soon: t('nav.' + soonTab), feedback: t('nav.feedback'), map: t('nav.map') };
      var label = next === 'explore' ? t('app.name') : titles[next];
      el.shellTitle.textContent = label || t('app.name');
    }

    // The nav marks a destination, and the label page is not one: it is
    // reached from Explore, so Explore stays lit underneath it.
    var navFor = next === 'exhibit' ? 'explore' : (next === 'soon' ? soonTab : next);
    Array.prototype.forEach.call(el.shellNav.querySelectorAll('[data-nav]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-nav') === navFor);
    });

    if (next === 'exhibit') renderExhibit();
    if (next === 'settings') renderSettings();
    if (next === 'soon') renderSoon();
    if (next === 'feedback') renderFeedback();
    if (next === 'map') renderMap();

    // A new screen starts at the top, the way a new page would.
    if (el.shellBody) el.shellBody.scrollTop = 0;
    // Leaving the label page stops its recording; nobody wants narration
    // following them back to the grid.
    if (next !== 'exhibit') stopAudio();
  }

  /** `.view.on` rather than `.hidden`, because these are display:none siblings. */
  function toggle2(node, on) { if (node) node.classList.toggle('on', !!on); }

  function toast(text) {
    if (!el.shellToast) return;
    el.shellToast.textContent = text;
    show(el.shellToast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hide(el.shellToast); }, 3200);
  }

  // =================================================================== explore
  function renderExplore() {
    var viewer = V();
    var list = (viewer && viewer.exhibits()) || [];

    if (el.exploreTitle) {
      // Two lines, the second in italic terracotta. Built rather than declared
      // because the <em> has to survive a language change.
      el.exploreTitle.textContent = t('explore.title1');
      var second = document.createElement('em');
      second.textContent = t('explore.title2');
      el.exploreTitle.appendChild(second);
    }

    if (el.exploreEyebrow) {
      // The museum's name as the Studio has it, from the release; the
      // config's is only for a gallery with no cloud behind it.
      var b = viewer && viewer.bundle && viewer.bundle();
      var name = (b && b.site && b.site.name) || (cfg().gallery || {}).name || '';
      var count = list.length === 1 ? t('explore.countOne')
                                    : t('explore.count', { count: list.length });
      var found = list.filter(isFound).length;
      if (found) {
        count += ' · ' + (found === list.length ? t('explore.foundAll') : t('explore.found', { count: found }));
      }
      el.exploreEyebrow.textContent = list.length
        ? (name ? name + ' · ' + count : count)
        : name;
    }

    toggle(el.exploreEmpty, !list.length && viewer && viewer.ready());
    if (!el.exhibitGrid) return;

    el.exhibitGrid.textContent = '';
    list.forEach(function (ex) {
      el.exhibitGrid.appendChild(exhibitCard(ex));
    });
  }

  function exhibitCard(ex) {
    var picked = V().detailsOf(ex);
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'exhibit-card' + (isFound(ex) ? ' found' : '');

    var thumb = document.createElement('div');
    thumb.className = 'exhibit-thumb';
    if (ex.image && ex.image.src) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.addEventListener('error', function () {
        // A missing thumbnail falls back to the full photo before giving up.
        if (ex.image.thumb && img.src !== new URL(ex.image.src, location.href).href) {
          img.src = ex.image.src;
          return;
        }
        thumb.textContent = '';
        thumb.appendChild(noImage());
        log().warn('target image missing for "' + ex.name + '"');
      });
      // The Studio makes a 480 px thumbnail; a card never needs more, and
      // nine of them at 1024 px cost a phone a megabyte for nothing.
      img.src = ex.image.thumb || ex.image.src;
      thumb.appendChild(img);
    } else {
      thumb.appendChild(noImage());
    }

    // One badge, saying the most interesting thing this exhibit can do.
    var badge = document.createElement('span');
    badge.className = 'exhibit-badge';
    badge.appendChild(icon(hasModel(ex) ? 'i-ar'
      : (ex.media.kind === 'image' ? 'i-image' : 'i-video')));
    thumb.appendChild(badge);
    // Already found with the camera: a small seal, the gallery's own
    // passport stamp.
    if (isFound(ex)) {
      var seal = document.createElement('span');
      seal.className = 'exhibit-found';
      seal.appendChild(icon('i-check'));
      seal.appendChild(document.createTextNode(t('explore.foundOne')));
      thumb.appendChild(seal);
    }
    card.appendChild(thumb);

    var title = document.createElement('h3');
    title.textContent = (picked && picked.detail.title) || ex.name;
    if (picked) title.setAttribute('lang', picked.code);
    card.appendChild(title);

    // The one-line summary is the first sentence of the label, so the grid
    // says something real without the portal needing a second field for it.
    var summary = summaryOf(picked);
    if (summary) {
      var p = document.createElement('p');
      p.textContent = summary;
      if (picked) p.setAttribute('lang', picked.code);
      card.appendChild(p);
    }

    card.addEventListener('click', function () { go('exhibit', ex); });
    return card;
  }

  function noImage() {
    var span = document.createElement('span');
    span.className = 'no-image';
    span.textContent = '⬚';
    return span;
  }

  function hasModel(ex) { return !!(ex && ex.model && ex.model.src); }

  function isFound(ex) {
    var found = (V() && V().found && V().found()) || [];
    return !!ex && found.indexOf(ex.id) !== -1;
  }

  /**
   * The first sentence of the label, for the card under the photograph.
   *
   * The first PROSE block, not simply the first words: a label that opens with
   * a heading would otherwise give the grid "The maidensPainted in the fifth
   * century", because textContent runs adjacent blocks together with nothing
   * between them. The html has already been through the sanitiser, so what is
   * parsed here can only be the handful of tags in RICH_TAGS.
   */
  function summaryOf(picked) {
    if (!picked) return '';
    var html = picked.detail.html || '';
    if (!html || typeof DOMParser === 'undefined') return '';

    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    var block = doc.body.querySelector('p, li');
    var text = ((block && block.textContent) || doc.body.textContent || '')
      .replace(/\s+/g, ' ').trim();
    if (!text) return '';
    var stop = text.search(/[.!?।]\s/);
    var first = stop > 20 ? text.slice(0, stop + 1) : text;
    return first.length > 90 ? first.slice(0, 88).replace(/\s+\S*$/, '') + '…' : first;
  }

  // ============================================================ the label page
  function renderExhibit() {
    var ex = current;
    if (!ex) { go('explore'); return; }

    var picked = V().detailsOf(ex);
    var detail = picked.detail;

    // -- the photograph
    el.exhibitHero.textContent = '';
    if (ex.image && ex.image.src) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = ex.image.src;
      el.exhibitHero.appendChild(img);
    }

    // -- the names
    var b = V().bundle && V().bundle();
    el.exhibitKicker.textContent = (b && b.site && b.site.name) || (cfg().gallery || {}).name || '';
    toggle(el.exhibitOnMap, !!(plan() && ex.map));
    el.exhibitTitle.textContent = detail.title || ex.name;
    el.exhibitTitle.setAttribute('lang', picked.code);

    // The same title in the museum's other languages. Someone recognising
    // their own script here is how they find out the app has it at all.
    el.exhibitAlts.textContent = '';
    languages().forEach(function (l) {
      if (l.code === picked.code) return;
      var other = ex.details[l.code];
      if (!other || !other.title || other.title === detail.title) return;
      var span = document.createElement('span');
      span.setAttribute('lang', l.code);
      span.textContent = other.title;
      el.exhibitAlts.appendChild(span);
    });

    renderFacts(ex);
    renderLangs(ex, picked.code);

    // -- honest about which language this actually is
    if (picked.fellBack) {
      el.exhibitFallback.textContent = t('details.fallback', {
        language: window.ARI18n.nameOf(picked.code),
        wanted: window.ARI18n.nameOf(window.ARI18n.code()),
      });
      show(el.exhibitFallback);
    } else {
      hide(el.exhibitFallback);
    }

    // -- the label itself. Sanitised again on the way out: content.json is a
    //    file in a repo, and this is the pass that cannot be skipped by hand
    //    editing it.
    var html = window.ARContent.sanitizeRichText(detail.html);
    el.exhibitText.textContent = '';
    if (html) {
      el.exhibitText.innerHTML = html;
    } else {
      var note = document.createElement('p');
      note.className = 'empty-note';
      note.textContent = t('details.empty');
      el.exhibitText.appendChild(note);
    }
    el.exhibitText.setAttribute('lang', picked.code);

    setAudio(detail.audio && detail.audio.src, picked.code);

    // -- and whether the camera is worth offering
    var viewer = V();
    var canAr = viewer.ready() && !viewer.empty() && !viewer.broken();
    el.exhibitAr.disabled = !canAr;
  }

  function renderFacts(ex) {
    var host = el.exhibitFacts;
    host.textContent = '';

    var still = ex.media.kind === 'image';
    addFact(host, still ? 'i-image' : 'i-video',
            t(still ? 'fact.image' : 'fact.video'),
            t(still ? 'fact.imageSub' : 'fact.videoSub'));

    if (hasModel(ex)) addFact(host, 'i-ar', t('fact.model'), t('fact.modelSub'));

    var spoken = window.ARContent.audioLanguages(ex);
    if (spoken.length) {
      addFact(host, 'i-audio', t('fact.audio'),
              spoken.length === 1 ? t('fact.audioSubOne')
                                  : t('fact.audioSub', { count: spoken.length }));
    }
  }

  function addFact(host, name, title, sub) {
    var box = document.createElement('div');
    box.className = 'fact';
    box.appendChild(icon(name));
    var strong = document.createElement('strong');
    strong.textContent = title;
    box.appendChild(strong);
    var span = document.createElement('span');
    span.textContent = sub;
    box.appendChild(span);
    host.appendChild(box);
  }

  function languages() {
    var b = V() && V().bundle();
    return (b && b.languages) || window.ARI18n.languages();
  }

  /**
   * The language chips.
   *
   * Only languages this exhibit is actually written in, so a chip can never
   * lead to an empty page, and only when there is more than one - a single
   * chip is a label pretending to be a control. Same rule as the AR sheet.
   */
  function renderLangs(ex, activeCode) {
    var host = el.exhibitLangs;
    host.textContent = '';

    var written = languages().filter(function (l) {
      return window.ARContent.hasDetail(ex.details[l.code]);
    });
    if (written.length < 2) return;

    written.forEach(function (l) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'details-lang' + (l.code === activeCode ? ' on' : '');
      chip.setAttribute('lang', l.code);
      chip.textContent = l.native || l.name;
      // Switching here switches the whole app, not just this page.
      chip.addEventListener('click', function () { window.ARI18n.set(l.code, true); });
      host.appendChild(chip);
    });
  }

  // ------------------------------------------------------------- the recording
  /*
   * The same rule as the AR sheet: an uploaded recording or nothing at all.
   * Deliberately not the browser's speech synthesis - on the phones this
   * gallery will meet, Sinhala and Tamil voices are missing or poor, so a
   * Listen button backed by synthesis would work in English and fail in
   * exactly the two languages it was added for.
   */
  function setAudio(src, code) {
    var has = !!src;
    toggle(el.exhibitListen, has);

    var a = el.exhibitAudio;
    if (!a) return;
    if (!has) {
      if (!a.getAttribute('src')) return;
      stopAudio();
      // load() after removing src is what empties the element. Without it
      // Chrome abandons the fetch it was in the middle of and reports that as
      // a network error - a red 🐞 badge every time someone switched from a
      // language with a recording to one without.
      a.removeAttribute('src');
      a.load();
      return;
    }

    if (a.getAttribute('src') !== src) {
      stopAudio();
      a.setAttribute('src', src);
      a.setAttribute('lang', code || window.ARI18n.code());
      a.load();
    }
    audioUI();
  }

  function toggleAudio() {
    var a = el.exhibitAudio;
    if (!a || !a.getAttribute('src')) return;
    if (a.paused) {
      var p = a.play();
      if (p && p.catch) {
        p.catch(function (err) {
          log().error('narration play() rejected: ' + err);
          toast(t('details.empty'));
        });
      }
    } else {
      a.pause();
    }
    audioUI();
  }

  function stopAudio() {
    var a = el.exhibitAudio;
    if (!a) return;
    if (!a.paused) a.pause();
    a.currentTime = 0;
    audioUI();
  }

  function audioUI() {
    var a = el.exhibitAudio;
    if (!a || !el.exhibitListenLabel) return;
    var playing = !a.paused && !a.ended;
    var finished = a.ended || (a.duration && a.currentTime >= a.duration - 0.05);
    el.exhibitListenLabel.textContent =
      t(playing ? 'details.pause' : (finished ? 'details.replay' : 'details.listen'));
  }

  // ================================================================== settings
  function renderSettings() {
    if (el.setLangValue) {
      var lang = window.ARI18n.languages().filter(function (l) {
        return l.code === window.ARI18n.code();
      })[0];
      el.setLangValue.textContent = lang ? (lang.native || lang.name) : window.ARI18n.code();
      el.setLangValue.setAttribute('lang', window.ARI18n.code());
    }

    setSwitch(el.setMotion, motionOff());
    setSwitch(el.setLog, logShown());
    renderStaff();

    if (el.settingsAbout) {
      el.settingsAbout.textContent = '';
      var line = document.createElement('span');
      line.textContent = t('settings.aboutText');
      el.settingsAbout.appendChild(line);
      var note = V() && V().blockNote && V().blockNote();
      if (note) {
        el.settingsAbout.appendChild(document.createElement('br'));
        var warn = document.createElement('strong');
        warn.textContent = note;
        el.settingsAbout.appendChild(warn);
      }
    }
  }

  function setSwitch(row, on) {
    if (!row) return;
    row.classList.toggle('on', !!on);
    row.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* Both preferences are per-device conveniences with nothing to lose, so
     localStorage is right for them - and every read is wrapped, because a
     private window or blocked site data makes the accessor throw rather than
     return nothing. */
  function readPref(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writePref(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* not worth a log line */ }
  }

  function motionOff() { return document.documentElement.getAttribute('data-motion') === 'off'; }

  function applyMotion(off) {
    document.documentElement.setAttribute('data-motion', off ? 'off' : 'on');
    writePref(MOTION_KEY, off ? 'off' : 'on');
  }

  function logShown() { return !!el.logToggle && !el.logToggle.classList.contains('hidden'); }

  function applyLog(on) {
    toggle(el.logToggle, on);
    // The panel goes with its button; leaving it open over the camera with no
    // way to close it would be worse than not offering the switch at all.
    if (!on) hide($('logPanel'));
    writePref(LOG_KEY, on ? 'on' : 'off');
  }

  // ======================================================================= map
  /*
   * The gallery's floor plan, from the release, with a numbered pin where
   * each artwork hangs - jade once found with the camera. Tap a pin for the
   * artwork; "On the map" on a label page comes here with its pin lit.
   */
  var mapZoom = 1;
  var mapFocus = null;

  function plan() {
    var b = V() && V().bundle && V().bundle();
    return b && b.site && b.site.map && b.site.map.src ? b.site.map : null;
  }

  function renderMap() {
    var p = plan();
    if (!p || !el.mapStage) { soonTab = 'map'; go('soon'); return; }
    var b = V().bundle();
    el.mapEyebrow.textContent = (b.site && b.site.name) || (cfg().gallery || {}).name || '';
    if (el.mapImage.getAttribute('src') !== p.src) el.mapImage.src = p.src;
    el.mapStage.style.width = (mapZoom * 100) + '%';

    el.mapPins.textContent = '';
    (V().exhibits() || []).forEach(function (ex, i) {
      if (!ex.map) return;
      var pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'map-pin' + (isFound(ex) ? ' found' : '') + (mapFocus === ex.id ? ' on' : '');
      pin.style.left = (ex.map.x * 100) + '%';
      pin.style.top = (ex.map.y * 100) + '%';
      pin.textContent = String(i + 1);
      var picked = V().detailsOf(ex);
      pin.setAttribute('aria-label', (i + 1) + ': ' + ((picked.detail && picked.detail.title) || ex.name));
      pin.addEventListener('click', function () { mapFocus = ex.id; renderMap(); });
      el.mapPins.appendChild(pin);
    });

    var focus = mapFocus && (V().exhibits() || []).filter(function (ex) { return ex.id === mapFocus; })[0];
    toggle(el.mapCard, !!focus);
    if (focus) {
      var picked = V().detailsOf(focus);
      el.mapCardImg.src = focus.image.thumb || focus.image.src || '';
      el.mapCardTitle.textContent = (picked.detail && picked.detail.title) || focus.name;
      el.mapCardTitle.setAttribute('lang', picked.code);
      el.mapCardState.textContent = isFound(focus) ? t('map.found') : t('map.notFound');
      el.mapCardGo.onclick = function () { go('exhibit', focus); };
      // Bring the lit pin into view when zoomed in.
      requestAnimationFrame(function () {
        var f = el.mapFrame;
        f.scrollLeft = focus.map.x * f.scrollWidth - f.clientWidth / 2;
        f.scrollTop = focus.map.y * f.scrollHeight - f.clientHeight / 2;
      });
    }
  }

  function zoomMap(delta) {
    mapZoom = Math.max(1, Math.min(4, mapZoom * delta));
    renderMap();
  }

  // ================================================================== feedback
  /*
   * A rating and a few words, into the Studio's inbox. The tab only becomes
   * this when the guide has a Firebase project and the museum has feedback
   * switched on; otherwise it stays the honest "not built yet" panel.
   */
  var feedbackOn = false;
  var rating = 0;

  function renderFeedback() {
    if (!el.fbStars) return;
    if (!el.fbStars.childNodes.length) {
      for (var i = 1; i <= 5; i++) {
        (function (n) {
          var star = document.createElement('button');
          star.type = 'button';
          star.className = 'fb-star';
          star.setAttribute('role', 'radio');
          star.setAttribute('aria-label', n + ' / 5');
          star.appendChild(icon('i-star'));
          star.addEventListener('click', function () { rating = n; drawStars(); });
          el.fbStars.appendChild(star);
        })(i);
      }
    }
    drawStars();

    // What it is about: the whole visit, or one artwork, by its title in the
    // visitor's own language.
    var keep = el.fbExhibit.value;
    el.fbExhibit.textContent = '';
    var whole = document.createElement('option');
    whole.value = '';
    whole.textContent = t('feedback.wholeVisit');
    el.fbExhibit.appendChild(whole);
    ((V() && V().exhibits()) || []).forEach(function (ex) {
      var o = document.createElement('option');
      o.value = ex.id;
      var picked = V().detailsOf(ex);
      o.textContent = (picked.detail && picked.detail.title) || ex.name;
      el.fbExhibit.appendChild(o);
    });
    el.fbExhibit.value = keep || (current ? current.id : '');
  }

  function drawStars() {
    Array.prototype.forEach.call(el.fbStars.childNodes, function (star, i) {
      star.classList.toggle('on', i < rating);
      star.setAttribute('aria-checked', i + 1 === rating ? 'true' : 'false');
    });
    el.fbSend.disabled = !rating;
  }

  function sendFeedback() {
    var community = window.ARCommunity;
    if (!community || !rating) return;
    var id = el.fbExhibit.value;
    var option = el.fbExhibit.options[el.fbExhibit.selectedIndex];
    var bundle = V() && V().bundle();
    el.fbSend.disabled = true;
    el.fbSend.textContent = t('feedback.sending');
    community.sendFeedback({
      rating: rating,
      message: el.fbMessage.value,
      exhibitId: id || null,
      exhibitName: id && option ? option.textContent : null,
      lang: window.ARI18n.code(),
      release: bundle && bundle.releaseId,
    }).then(function () {
      el.fbSend.textContent = t('feedback.send');
      hide(el.fbForm);
      show(el.fbThanks);
      rating = 0;
      el.fbMessage.value = '';
    }, function (err) {
      el.fbSend.disabled = false;
      el.fbSend.textContent = t('feedback.send');
      el.fbNote.textContent = t('feedback.failed');
      log().warn('feedback: ' + (err && err.message ? err.message : err));
    });
  }

  // ===================================================================== staff
  function renderStaff() {
    var community = window.ARCommunity;
    if (!el.staffGroup || !community || !community.enabled()) return;
    show(el.staffGroup);
    var s = community.staff.state();
    if (s.signedIn) {
      el.setStaffTitle.textContent = s.email;
      el.setStaffValue.textContent = s.role
        ? t('settings.staffAs', { role: s.role })
        : t('settings.staffNotMember');
    } else {
      el.setStaffTitle.textContent = t('settings.staffSignIn');
      el.setStaffValue.textContent = t('settings.staffSub');
    }
  }

  function staffTap() {
    var community = window.ARCommunity;
    if (!community) return;
    var s = community.staff.state();
    var action = s.signedIn ? community.staff.signOut() : community.staff.signIn();
    action.then(function () {
      renderStaff();
      var now = community.staff.state();
      if (now.signedIn && !now.role) toast(t('settings.staffNotMember'));
      else if (now.signedIn) toast(t('settings.staffReady'));
    }, function (err) {
      toast(String((err && err.message) || err).replace(/^Firebase:\s*/, ''));
    });
  }

  // ============================================== the two tabs not yet built
  function renderSoon() {
    if (el.soonIcon) {
      var href = soonTab === 'map' ? '#i-map' : '#i-feedback';
      el.soonIcon.setAttribute('href', href);
      el.soonIcon.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    }
    el.soonTitle.textContent = t('soon.' + soonTab + '.title');
    el.soonText.textContent = t('soon.' + soonTab + '.text');
    el.soonNeeds.textContent = t('soon.' + soonTab + '.needs');
  }

  // ====================================================================== wire
  function wire() {
    Array.prototype.forEach.call(el.shellNav.querySelectorAll('[data-nav]'), function (b) {
      b.addEventListener('click', function () {
        var target = b.getAttribute('data-nav');
        if (target === 'feedback' && feedbackOn) go('feedback');
        else if (target === 'map' && plan()) { mapFocus = null; go('map'); }
        else if (target === 'map' || target === 'feedback') { soonTab = target; go('soon'); }
        else go(target);
      });
    });

    el.navAr.addEventListener('click', startAR);
    el.exhibitAr.addEventListener('click', startAR);
    el.exhibitListen.addEventListener('click', toggleAudio);
    ['play', 'pause', 'ended', 'timeupdate'].forEach(function (evt) {
      el.exhibitAudio.addEventListener(evt, audioUI);
    });
    el.exhibitAudio.addEventListener('error', function () {
      var e = el.exhibitAudio.error || {};
      log().error('narration failed to load: code=' + e.code);
      setAudio(null);
    });

    el.shellBack.addEventListener('click', back);
    window.addEventListener('popstate', onPop);
    el.shellLang.addEventListener('click', openLanguage);
    el.setLang.addEventListener('click', openLanguage);

    el.setMotion.addEventListener('click', function () {
      applyMotion(!motionOff());
      setSwitch(el.setMotion, motionOff());
    });
    el.setLog.addEventListener('click', function () {
      applyLog(!logShown());
      setSwitch(el.setLog, logShown());
    });

    if (el.mapIn) el.mapIn.addEventListener('click', function () { zoomMap(1.5); });
    if (el.mapOut) el.mapOut.addEventListener('click', function () { zoomMap(1 / 1.5); });
    if (el.exhibitOnMap) el.exhibitOnMap.addEventListener('click', function () {
      if (!current) return;
      mapFocus = current.id;
      if (mapZoom < 1.5) mapZoom = 1.5;
      go('map');
    });
    if (el.fbSend) el.fbSend.addEventListener('click', sendFeedback);
    if (el.fbAgain) el.fbAgain.addEventListener('click', function () { hide(el.fbThanks); show(el.fbForm); renderFeedback(); });
    if (el.setStaff) el.setStaff.addEventListener('click', staffTap);
    var community = window.ARCommunity;
    if (community && community.enabled()) {
      community.feature('feedback').then(function (on) {
        feedbackOn = on;
        var tab = el.shellNav.querySelector('[data-nav="feedback"]');
        if (tab) tab.classList.toggle('dimmed', !on);
      });
      community.staff.onChange(function () {
        renderStaff();
        // The Adjust gear follows who is signed in.
        if (window.ARViewer && window.ARViewer.refreshUi) window.ARViewer.refreshUi();
      });
    }

    // The whole interface redraws when the language changes, including the
    // parts built here rather than declared with data-i18n.
    window.ARI18n.onChange(refresh);
  }

  function openLanguage() {
    if (V() && V().openLanguage) V().openLanguage(true);
  }

  function startAR() {
    var viewer = V();
    if (!viewer || !viewer.ready()) { toast(t('toast.arUnavailable')); return; }
    if (viewer.empty()) { toast(t('toast.noExhibits')); return; }
    if (viewer.broken()) { toast(viewer.blockNote() || t('toast.arUnavailable')); return; }
    stopAudio();
    // This click is the user gesture iOS requires for both the camera and the
    // video element, so it has to reach startAR() without an await in between.
    viewer.startAR();
  }

  /** Everything that has to be redrawn: after content lands, and on a language change. */
  function refresh() {
    if (!el.shell) return;
    if (el.shellLangCode) el.shellLangCode.textContent = window.ARI18n.code().toUpperCase();
    renderExplore();
    // The Map tab lights up once the release has a floor plan.
    var mapTab = el.shellNav && el.shellNav.querySelector('[data-nav="map"]');
    if (mapTab) mapTab.classList.toggle('dimmed', !plan());
    if (view === 'exhibit') renderExhibit();
    if (view === 'settings') renderSettings();
    if (view === 'soon') renderSoon();
    if (view !== 'explore') go(view, null, { render: true });
  }

  window.ARShell = { refresh: refresh, go: go, back: back, enteredAr: enteredAr, leaveAr: leaveAr };

  function init() {
    var missing = cacheDom();
    if (!el.shell) return;               // an older index.html has no shell
    if (missing.length) {
      log().warn('this index.html is older than js/shell.js — it has no ' +
                 missing.join(', ') + '. Those parts of the browse screens are off.');
    }

    // Restore the two preferences before the first paint, so nothing animates
    // in for someone who asked for no animation.
    applyMotion(readPref(MOTION_KEY) === 'off');
    var wantLog = readPref(LOG_KEY);
    if (wantLog) applyLog(wantLog === 'on');
    else if ((cfg().ui || {}).debugButtonByDefault === false) toggle(el.logToggle, false);   // not saved: still the default

    wire();
    go('explore');
    refresh();

    // The grid cannot be drawn until the exhibits have landed — and the splash
    // (index.html) waits for the same moment, so it never lifts onto an empty
    // grid. Both are told after the grid is drawn.
    if (window.ARViewer) {
      window.ARViewer.onReady(function () {
        refresh();
        if (window.ARSplash) window.ARSplash.done();
      });
    } else if (window.ARSplash) {
      window.ARSplash.done();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
