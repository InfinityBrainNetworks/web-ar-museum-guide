/**
 * Web AR Museum Guide
 *
 * Three scenes, deliberately independent:
 *
 *   1. SCAN   image tracking. MindAR finds the artwork and the exhibit's media
 *             — a video, or a still image — is mapped exactly onto it. Once it
 *             is up, "More details" and (if the exhibit has a 3D object)
 *             "View in 3D" appear, and they STAY, whether or not the artwork is
 *             still in frame: they are doorways, not properties of the target.
 *
 *   2. FLOOR  floor mapping. Image tracking and the video are stopped. The user
 *             points the phone at the floor; when a surface has held still long
 *             enough, "Place AR figure on the floor" appears.
 *
 *   3. PLACED the figure stands where it was put.
 *
 * The only link between them is the one-way door out of scene 1. Nothing in
 * scene 2 or 3 depends on the painting, so walking away from it changes nothing.
 *
 * The page shows one or more EXHIBITS, each a set of three: a target image, the
 * video mapped onto it, and the 3D model that follows it onto the floor. They
 * come from js/content.js, which reads a bundle written by the admin portal
 * (admin.html). Exhibit order is target order: exhibits[i] is target i inside
 * the .mind file, and MindAR reports finds by that index.
 *
 * Units differ per scene — every engine reports its own unitsPerMetre:
 *   scene 1        - 1 unit = the target image's width (MindAR scales the anchor)
 *   scene 2/3 XR   - 1 unit = 1 metre (WebXR's own convention)
 *   scene 2/3 gyro - 1 unit = 1/552 m. MindAR's camera keeps a near plane of 10
 *                    and a far plane of 1e5 in those units, so metres would be
 *                    clipped away entirely. The absolute scale is arbitrary for a
 *                    perspective camera; only the ratios matter.
 */
(function () {
  'use strict';

  var cfg = window.AR_CONFIG;
  var THREE = null; // filled in at init, once A-Frame is up
  var log = window.ARLog;

  log.setMax(cfg.ui.maxLogEntries);

  // ---------------------------------------------------------------- camera
  /**
   * MindAR requests its own camera resolution and does not expose it as an
   * A-Frame schema property, so the only place to influence it is here: wrap
   * getUserMedia before mindar-image-system calls it in start().
   */
  (function patchCameraConstraints() {
    var wanted = {
      width:  { ideal: 1280, max: 1920 },
      height: { ideal: 720,  max: 1080 },
      frameRate: { ideal: 30, max: 30 }
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    var original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = function (constraints) {
      if (constraints && constraints.video === true) {
        constraints.video = wanted;
      } else if (constraints && typeof constraints.video === 'object' &&
                 constraints.video.facingMode !== undefined) {
        constraints.video = Object.assign({}, constraints.video, wanted);
      }
      return original(constraints);
    };
  })();

  var MODE = { BOOT: 'boot', SCAN: 'scan', FLOOR: 'floor', PLACED: 'placed' };

  // ---------------------------------------------------------------- state
  var S = {
    mode: MODE.BOOT,
    started: false,
    arReady: false,
    targetFound: false,
    // The exhibit's media is up on the artwork: a video that has genuinely
    // started, or a still whose texture has decoded. The gate on "More details"
    // and "View in 3D", and it stays true once earned.
    mediaReady: false,
    xrSupported: false,

    // Has the visitor been asked what language they read? Answered before the
    // start screen on a first visit, remembered afterwards.
    langOpen: false,
    detailsOpen: false,
    empty: false,          // a deployment with no exhibits in it
    fatal: false,          // something stopped the camera from ever starting
    blockNote: '',         // ...and the one sentence to show a visitor about it

    // Which exhibit is on screen, or was last seen. Scene 2 keeps using it
    // after the painting leaves the frame, which is the whole point of the door.
    activeIndex: -1,
    // Which exhibit's file the shared <video> element currently holds.
    loadedVideo: -1,

    // Seeded from the active exhibit each time one is found; the debug panel's
    // nudges then live here until another exhibit is scanned.
    mediaKind: 'video',
    fit: 'stretch',
    videoScale: 1,
    videoOffset: { x: 0, y: 0, z: 0.001 },

    // floor scene
    engine: null,          // the active floor engine, or null
    floorFound: false,     // a candidate surface is being tracked right now
    floorStable: false,    // ...and it has held still long enough to place on
    cameraHeight: cfg.floor.cameraHeightMeters,
    modelScale: 1,
    // Live per-exhibit look, seeded by adoptExhibit() and tunable from the
    // debug menu so it can be dialled in on the device.
    lighting: 'baked',
    shadowOpacity: 0.5,
    // Soft ellipses on the floor. Empty = one circle sized from the figure.
    shadows: [],
    shadowFollow: false,   // do they ride on the figure? (see updateFloorShadow)
    shadowScale: 1,        // the figure scale they were drawn at
    spin: false,
    playClip: true,
    loopClip: false,       // false = play the clip once and hold the last pose
    faceYaw: 0,            // radians, set at placement so the figure faces you
    placedAt: null,        // where it was put down, in floor-scene units
    // Live transform, seeded per exhibit and edited by the Adjust panel.
    modelRot: { x: 0, y: 0, z: 0 },      // degrees
    modelOffset: { x: 0, y: 0, z: 0 },   // metres from the placement point
    // The point of the model that stands on the placement spot and that it
    // turns about, as a fraction of its height. See js/placement.js.
    modelAnchor: { x: 0, y: 0, z: 0 },
    // The visitor's own pinch, on top of the exhibit's real size. Reset by the
    // "Real size" chip, and never saved: it is theirs, not the museum's.
    visitorScale: 1,
    // Where the figure's base sits in its own model space, for centring the
    // automatic shadow under it whatever the anchor is. Set when it loads.
    figureBase: null,

    tStart: 0,
  };

  /**
   * MindAR's camera clips below 10 units and past 1e5, so the gyro floor engine
   * cannot work in metres. A perspective camera has no absolute scale — only
   * ratios matter — so this is simply a number comfortably inside that frustum.
   * It is deliberately independent of any exhibit's size.
   */
  var GYRO_UNITS_PER_METRE = 552;

  // ---------------------------------------------------------------- exhibits
  /** Order is target order: exhibits[i] is target i inside the .mind file. */
  var exhibits = [];
  var bundle = null;
  var videoTexture = null;

  /** The exhibit on screen, or the last one seen. */
  function EX() { return exhibits[S.activeIndex] || exhibits[0] || null; }

  /** Its model settings, or the config defaults before any content has loaded. */
  function modelCfg() {
    var ex = EX();
    return (ex && ex.model) || window.ARContent.modelDefaults();
  }

  /**
   * Does this exhibit have a 3D object of its own?
   *
   * The gate on "View in 3D". A model record with no file means the exhibit was
   * given settings but never a .glb, which is not something to offer a visitor
   * — the placeholder figure is a development aid, not an exhibit.
   */
  function hasModel(exhibit) {
    var ex = exhibit || EX();
    return !!(ex && ex.model && ex.model.src);
  }

  /** The exhibit's media record — what is projected onto the artwork. */
  function mediaCfg(exhibit) {
    var ex = exhibit || EX();
    return (ex && ex.media) || window.ARContent.mediaDefaults();
  }

  /**
   * A painting's height in target units.
   *
   * MindAR scales an anchor by its target's width, so the width is 1 by
   * definition and only the aspect ratio has to be carried here.
   */
  function planeH(exhibit) {
    var ex = exhibit || EX();
    if (!ex || !ex.image.width) return 1;
    return ex.image.height / ex.image.width;
  }

  /** Keep a URL readable in the log without dumping a whole blob: address. */
  function shortSrc(src) {
    if (!src) return 'none';
    return /^blob:/.test(src) ? 'blob (admin draft)' : src;
  }

  // ---------------------------------------------------------------- dom
  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  /**
   * Cache every element, and say which ones are not there.
   *
   * A page held in the browser cache is older than the script that came with
   * it, so ids added in a later release are simply absent. That must read as
   * one clear line in the log, not as "cannot read properties of null" three
   * functions away.
   */
  function cacheDom() {
    var missing = [];
    ['scene', 'floorScene', 'reticle', 'modelSlot', 'floorShadow',
     'arVideo', 'loadingScreen',
     'loadingText', 'scanScreen', 'floorScreen', 'floorText', 'statusChip', 'statusText',
     'actionBar', 'arBtn', 'detailsBtn', 'placeBtn', 'placeBtnLabel', 'moveBtn',
     'removeBtn', 'backBtn', 'langScreen', 'langList', 'langGo', 'exitAR',
     // The browse half's root. It is a sibling of #overlay, not a child - see
     // the note at the top of css/shell.css - but this is still the one place
     // that decides whether it or the camera owns the screen.
     'shell',
     'detailsSheet', 'detailsTitle', 'detailsLangs', 'detailsFallback', 'detailsBody',
     'detailsPlay', 'detailsPlayLabel', 'detailsProgress', 'detailsProgressFill',
     'detailsAudio', 'detailsClose',
     'errorBanner', 'errorText', 'errorRetry', 'logToggle', 'logBadge', 'logPanel',
     'logList', 'logCount', 'logCopy', 'logDownload', 'logClear', 'logClose', 'logTools',
     'logToolsToggle', 'copyToast', 'dumpState', 'reloadBtn', 'overlay',
     'brandBar', 'shotBtn', 'shutterFlash', 'photoSheet', 'photoPreview',
     'photoHint', 'photoSave', 'photoClose', 'adjustToggle', 'adjustPanel',
     'adjustWho', 'adjustTabs', 'adjustBody', 'adjustClose', 'adjustSave',
     'adjustCopy', 'adjustReset', 'adjustNote'
    ].forEach(function (id) {
      el[id] = $(id);
      if (!el[id]) missing.push(id);
    });
    // The one element with no id of its own: it is only ever addressed as
    // "the footer of the sheet", so an id would be a second name for it.
    el.detailsFoot = el.detailsSheet ? el.detailsSheet.querySelector('.details-foot') : null;
    return missing;
  }

  /** addEventListener that shrugs when the element is not in this page. */
  function on(node, event, handler) {
    if (node) node.addEventListener(event, handler);
  }

  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }
  function toggle(node, on) { if (node) node.classList[on ? 'remove' : 'add']('hidden'); }

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.statusChip.className = 'status-chip ' + (kind || '');
  }

  function showError(message, retryable) {
    el.errorText.textContent = message;
    show(el.errorBanner);
    el.errorRetry.style.display = retryable === false ? 'none' : '';
    log.error('UI error shown: ' + message);
    if (cfg.ui.autoOpenLogOnError) openLog(true);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** Keep an angle in -180..180 so the sliders and the readout agree. */
  function wrapDegrees(d) {
    d = d % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return Math.round(d * 100) / 100;
  }

  // ---------------------------------------------------------------- log panel
  function openLog(open) {
    if (open) {
      el.logPanel.classList.remove('hidden');
      el.logPanel.setAttribute('aria-hidden', 'false');
      el.logList.scrollTop = el.logList.scrollHeight;
    } else {
      el.logPanel.classList.add('hidden');
      el.logPanel.setAttribute('aria-hidden', 'true');
    }
  }

  function toast(message) {
    el.copyToast.textContent = message;
    el.copyToast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.copyToast.classList.add('hidden'); }, 1800);
  }

  function wireLogPanel() {
    log.bind({
      list: el.logList, count: el.logCount, badge: el.logBadge,
      panel: el.logPanel, toggle: el.logToggle,
    });

    el.logToggle.addEventListener('click', function () {
      openLog(el.logPanel.classList.contains('hidden'));
    });
    el.logClose.addEventListener('click', function () { openLog(false); });
    el.logClear.addEventListener('click', function () { log.clear(); });
    el.logDownload.addEventListener('click', function () { log.download(); toast('Saved as .txt'); });
    el.logCopy.addEventListener('click', function () {
      log.copy().then(function (ok) {
        toast(ok ? 'Copied to clipboard' : 'Copy blocked — use Save instead');
      });
    });
    el.reloadBtn.addEventListener('click', function () { location.reload(); });
    el.dumpState.addEventListener('click', dumpState);

    // Collapsed by default so the log itself gets the whole panel.
    if (!cfg.ui.showDebugTools) {
      hide(el.logToolsToggle);
    } else {
      el.logToolsToggle.addEventListener('click', function () {
        el.logTools.classList.toggle('hidden');
        el.logToolsToggle.classList.toggle('btn-ghost');
      });
      wireDebugTools();
    }
  }

  // ---------------------------------------------------------------- boot checks
  function preflight() {
    // The full device block is prepended to every Copy/Save, so the on-screen
    // log only needs the headline facts.
    var lines = log.envLines();
    log.info(lines[3]);                                   // secure context
    log.info(lines.filter(function (l) { return /^webgl/.test(l); })[0] || 'webgl: ?');
    log.info('device info is included automatically when you press Copy or Save');

    var fatal = false;

    if (!window.isSecureContext) {
      showError('This page must be served over https (or localhost). The camera is blocked otherwise.', false);
      S.blockNote = 'Blocked: open this page over https. Cameras do not work on plain http.';
      fatal = true;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError('This browser has no camera API. Use Safari on iOS, or Chrome on Android.', false);
      fatal = true;
    }
    if (!window.AFRAME) {
      showError('A-Frame failed to load. Check the network connection and reload.', true);
      fatal = true;
    } else if (!window.AFRAME.systems['mindar-image-system']) {
      showError('MindAR failed to load. Check the network connection and reload.', true);
      fatal = true;
    }

    // iOS only gives getUserMedia to Safari's own UI; in-app browsers fail silently.
    var ua = navigator.userAgent;
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter/i.test(ua)) {
      S.blockNote = 'Open this link in Safari — in-app browsers block the camera on iOS.';
      log.warn('iOS in-app browser detected; camera will likely be blocked');
    }
    log.info('platform: iOS=' + isIOS + ' android=' + /Android/.test(ua));

    // Which floor engine will run. Asked now so the answer is in the log even if
    // the user never reaches the floor scene.
    probeWebXR();

    if (fatal) S.fatal = true;
    return !fatal;
  }

  function probeWebXR() {
    if (!cfg.floor.useWebXR) {
      log.info('floor engine: gyro (WebXR disabled in config)');
      return;
    }
    if (!navigator.xr || !navigator.xr.isSessionSupported) {
      log.info('floor engine: gyro (this browser has no WebXR — expected on iOS)');
      return;
    }
    navigator.xr.isSessionSupported('immersive-ar').then(function (ok) {
      S.xrSupported = !!ok;
      log.info('floor engine: ' + (ok
        ? 'webxr hit-test (real plane detection, 6DoF)'
        : 'gyro (WebXR present but immersive-ar is not supported here)'));
    }).catch(function (e) {
      log.warn('floor engine: gyro (WebXR probe failed: ' + e + ')');
    });
  }

  // ---------------------------------------------------------------- media plane
  /**
   * Textures for the exhibits whose media is a still image, by exhibit id.
   *
   * A video is different: there is exactly ONE <video> element and therefore one
   * video texture, because iOS grants playback to an element and swapping src
   * is the only way to keep that grant. Images have no such constraint, so each
   * gets its own texture and they can all be resident at once.
   */
  var imageTextures = {};

  function imageTextureFor(ex) {
    if (!ex || !ex.media.src) return null;
    if (imageTextures[ex.id] && imageTextures[ex.id].__src === ex.media.src) {
      return imageTextures[ex.id];
    }
    if (imageTextures[ex.id]) imageTextures[ex.id].dispose();

    var texture = new THREE.TextureLoader().load(
      ex.media.src,
      function () {
        log.ok('still image decoded for "' + ex.name + '"');
        // Only now are its real dimensions known, and 'cover'/'contain' need them.
        if (EX() === ex) { applyMediaFit(); confirmStill(ex.targetIndex); }
      },
      undefined,
      function () {
        log.error('still image failed to load for "' + ex.name + '": ' + shortSrc(ex.media.src));
        showError('This exhibit\u2019s image could not be loaded.', false);
      }
    );
    texture.__src = ex.media.src;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    imageTextures[ex.id] = texture;
    return texture;
  }

  /** The texture an exhibit's plane should be drawing. */
  function textureFor(ex) {
    if (!ex) return null;
    return ex.media.kind === 'image' ? imageTextureFor(ex) : videoTexture;
  }

  /** Build the media textures and hang one on every exhibit's plane. */
  function setupVideoPlanes() {
    // A MindAR restart fires arReady a second time; the texture is still good.
    if (!videoTexture) {
      videoTexture = new THREE.VideoTexture(el.arVideo);
      videoTexture.minFilter = THREE.LinearFilter;
      videoTexture.magFilter = THREE.LinearFilter;
      videoTexture.generateMipmaps = false;
      if ('colorSpace' in videoTexture && THREE.SRGBColorSpace) {
        videoTexture.colorSpace = THREE.SRGBColorSpace;      // three >= r152
      } else if (THREE.sRGBEncoding !== undefined) {
        videoTexture.encoding = THREE.sRGBEncoding;
      }
    }

    // Every video exhibit draws the same <video>, because MindAR tracks one
    // target at a time. They still need a material each: a material is the
    // mesh's draw state, not just a texture reference.
    var attached = 0;
    var stills = 0;
    exhibits.forEach(function (ex) {
      var mesh = ex.planeEl && ex.planeEl.getObject3D('mesh');
      if (!mesh) return;
      var texture = textureFor(ex);
      if (!texture) return;
      if (ex.media.kind === 'image') stills++;
      if (!mesh.material || mesh.material.map !== texture) {
        mesh.material = new THREE.MeshBasicMaterial({
          map: texture,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        mesh.material.needsUpdate = true;
      }
      attached++;
    });

    if (!attached) {
      log.error('no exhibit planes are ready — cannot attach the media textures');
      return;
    }
    applyMediaFit();
    log.ok('media textures attached to ' + attached + ' exhibit plane' +
           (attached === 1 ? '' : 's') +
           (stills ? ' (' + stills + ' still image' + (stills === 1 ? '' : 's') + ')' : ''));
  }

  /**
   * Size the plane to the painting and crop the texture to match.
   *
   * MindAR scales the anchor so 1 unit = the target image's width, so a plane
   * 1 x (imageHeight / imageWidth) at the anchor origin covers the painting
   * exactly, at any distance or angle.
   */
  function applyMediaFit() {
    var ex = EX();
    if (!ex || !ex.planeEl) return;

    var texture = textureFor(ex);
    var mediaAspect;
    if (ex.media.kind === 'image') {
      // The decoded image once it has arrived; the bundle's numbers until then.
      var img = texture && texture.image;
      mediaAspect = (img && img.width && img.height)
        ? img.width / img.height
        : ((ex.media.width && ex.media.height) ? ex.media.width / ex.media.height : 1);
    } else {
      var v = el.arVideo;
      // The element's own numbers once it has metadata; the bundle's until then.
      mediaAspect = (v.videoWidth && v.videoHeight)
        ? v.videoWidth / v.videoHeight
        : ((ex.media.width && ex.media.height) ? ex.media.width / ex.media.height : 1);
    }
    var videoAspect = mediaAspect;

    var ph = planeH(ex);
    var imageAspect = 1 / ph;

    var w = 1, h = ph;                    // plane size, target units
    var rx = 1, ry = 1, ox = 0, oy = 0;   // texture repeat/offset

    if (S.fit === 'contain') {
      if (videoAspect > imageAspect) { w = 1; h = 1 / videoAspect; }
      else { h = ph; w = ph * videoAspect; }
    } else if (S.fit === 'cover') {
      if (videoAspect > imageAspect) { rx = imageAspect / videoAspect; ox = (1 - rx) / 2; }
      else { ry = videoAspect / imageAspect; oy = (1 - ry) / 2; }
    }

    w *= S.videoScale;
    h *= S.videoScale;

    ex.planeEl.setAttribute('width', w.toFixed(5));
    ex.planeEl.setAttribute('height', h.toFixed(5));
    ex.planeEl.setAttribute('position', {
      x: S.videoOffset.x, y: S.videoOffset.y, z: S.videoOffset.z,
    });

    // repeat/offset live on the texture. For video that texture is shared by
    // every exhibit — safe only because MindAR tracks one target at a time, so
    // one plane is ever visible. A still has its own, so the crop is its own too.
    if (texture) {
      texture.repeat.set(rx, ry);
      texture.offset.set(ox, oy);
      texture.needsUpdate = true;
    }

    log.debug(ex.media.kind + ' fit=' + S.fit + ' plane=' + w.toFixed(3) + 'x' + h.toFixed(3) +
              ' ("' + ex.name + '" is 1.000 x ' + ph.toFixed(3) + ')' +
              ' crop=' + rx.toFixed(3) + 'x' + ry.toFixed(3));
  }

  /**
   * Point the shared <video> at an exhibit's file.
   *
   * iOS grants playback permission to an ELEMENT, not to a URL, so the one
   * element unlocked by the Start tap is reused for every exhibit. Swapping src
   * keeps that permission; a second element would not have it.
   */
  function loadExhibitMedia(index) {
    var ex = exhibits[index];
    if (!ex || !ex.media.src) return false;

    if (ex.media.kind === 'image') {
      // Nothing to hand the <video>; the texture is built on demand and the
      // element is left holding whatever it had, ready for the next video
      // exhibit without losing its playback grant.
      imageTextureFor(ex);
      log.info('still source —> "' + ex.name + '" (' + shortSrc(ex.media.src) + ')');
      return true;
    }

    if (S.loadedVideo === index) return true;
    var v = el.arVideo;
    S.loadedVideo = index;
    v.loop = ex.media.loop !== false;
    v.src = ex.media.src;
    v.load();
    log.info('video source —> "' + ex.name + '" (' + shortSrc(ex.media.src) + ')');
    return true;
  }

  /** Re-seed the live tunables from an exhibit and load its video. */
  function adoptExhibit(ex) {
    if (!ex) return;
    S.mediaKind = ex.media.kind === 'image' ? 'image' : 'video';
    S.fit = ex.media.fit;
    S.videoScale = ex.media.scale;
    S.videoOffset = { x: ex.media.offset.x, y: ex.media.offset.y, z: ex.media.offset.z };
    S.modelScale = ex.model.scale;
    S.modelRot = { x: ex.model.rotation.x, y: ex.model.rotation.y, z: ex.model.rotation.z };
    S.modelOffset = { x: ex.model.offset.x, y: ex.model.offset.y, z: ex.model.offset.z };
    S.modelAnchor = window.ARPlacement.anchor(ex.model.anchor);
    S.spin = !!ex.model.spin;
    S.playClip = ex.model.playClip !== false;
    S.loopClip = !!ex.model.loopClip;
    S.shadows = copyShadows(ex.model.shadows);
    S.shadowFollow = !!ex.model.shadowFollow;
    S.shadowScale = ex.model.shadowScale > 0 ? ex.model.shadowScale : ex.model.scale;
    S.lighting = ex.model.lighting === 'lit' ? 'lit' : 'baked';
    S.shadowOpacity = typeof ex.model.shadowOpacity === 'number' ? ex.model.shadowOpacity : 0.5;

    loadExhibitMedia(ex.targetIndex);
    applyMediaFit();

    var fitBtn = el.logTools && el.logTools.querySelector('[data-tool="fit"]');
    if (fitBtn) fitBtn.textContent = S.fit;
  }

  // ---------------------------------------------------------------- media playback
  /** Called from the Start tap, which is the gesture iOS needs to allow playback. */
  function primeVideo() {
    var p = el.arVideo.play();
    if (p && p.then) {
      p.then(function () {
        el.arVideo.pause();
        el.arVideo.currentTime = 0;
        log.ok('video primed by the start gesture');
      }).catch(function (err) {
        log.warn('video priming was rejected: ' + err + ' (will retry on target found)');
      });
    }
  }

  function playMedia() {
    var ex = EX();
    if (ex && ex.media.kind === 'image') { confirmStill(S.activeIndex); return; }

    var v = el.arVideo;
    if (ex && ex.media.restartOnFound) v.currentTime = 0;
    var p = v.play();
    if (p && p.catch) {
      p.catch(function (err) {
        log.error('video play() rejected: ' + err);
        showError('The video could not start. Tap Retry.', true);
      });
    }
    confirmPlayback(S.activeIndex);
  }

  /**
   * The same gate as confirmPlayback, for an exhibit whose media is a still.
   *
   * There is no playback to wait for — only the decode, which is what
   * texture.image being set means. Until then the plane would draw nothing and
   * the buttons would sit over a blank rectangle.
   */
  function confirmStill(index) {
    var ex = exhibits[index];
    if (!ex || ex.media.kind !== 'image') return;
    var texture = imageTextures[ex.id];
    if (!texture || !texture.image) return;
    if (S.mediaReady) return;

    S.mediaReady = true;
    log.ok('still image shown for "' + ex.name + '" — unlocking the details');
    applyModeUI();
    maybeAutoOpenDetails();
  }

  /**
   * The gate on "View in 3D".
   *
   * Not the 'playing' event: some devices fire it while the decoder is still
   * delivering nothing, which would show the button over a frozen frame. This
   * waits until currentTime has actually advanced.
   */
  function confirmPlayback(index) {
    var v = el.arVideo;
    var startTime = v.currentTime;
    var deadline = performance.now() + 6000;
    var name = exhibits[index] ? exhibits[index].name : 'the video';

    (function check() {
      // Another exhibit took the element over; this watch is stale.
      if (S.loadedVideo !== index) return;

      if (v.readyState >= 2 && !v.paused && v.currentTime > startTime + 0.05) {
        var first = !S.mediaReady;
        S.mediaReady = true;
        log.ok('playback confirmed for "' + name + '" at t=' + v.currentTime.toFixed(2) + 's' +
               (first ? ' — unlocking the details' : ''));
        // Once unlocked the door stays open, so only the first one moves the UI.
        if (first) { applyModeUI(); maybeAutoOpenDetails(); }
        return;
      }
      if (performance.now() > deadline) {
        log.error('"' + name + '" did not start within 6s — paused=' + v.paused +
                  ' readyState=' + v.readyState + ' networkState=' + v.networkState +
                  ' currentTime=' + v.currentTime.toFixed(2) +
                  ' error=' + (v.error ? v.error.code : 'none'));
        showError('The video is not playing. Open the log (🐞) and send it.', true);
        return;
      }
      requestAnimationFrame(check);
    })();
  }

  // ================================================================ SCENE MACHINE
  /**
   * Every screen and button is a pure function of the current scene, so there is
   * exactly one place to look when something shows up at the wrong time.
   */
  function applyModeUI() {
    var m = S.mode;

    // Three things can own the screen, and exactly one does: the language
    // question, the browse shell, or the camera. S.started rather than the
    // mode, because starting the camera takes a second or two during which the
    // mode is still BOOT and the shell must already be out of the way.
    var browsing = m === MODE.BOOT && !S.started;
    toggle(el.langScreen, browsing && S.langOpen);
    toggle(el.shell, browsing && !S.langOpen);
    toggle(el.exitAR, !browsing && !S.detailsOpen);
    // The debug button keeps the top-right corner over the camera and gives it
    // up to the shell's own controls while browsing. See .log-toggle.browsing.
    if (el.logToggle) el.logToggle.classList.toggle('browsing', browsing);
    toggle(el.scanScreen, m === MODE.SCAN && !S.targetFound);
    toggle(el.floorScreen, m === MODE.FLOOR && !S.floorStable);
    toggle(el.statusChip, m !== MODE.BOOT);

    // These survive losing the artwork on purpose: once its media is up, moving
    // on is always available, and scene 2 does not need the target. They are
    // hidden behind the details sheet only because the sheet covers them.
    var ready = m === MODE.SCAN && S.mediaReady && !S.detailsOpen;
    toggle(el.detailsBtn, ready);
    // Only an exhibit that actually has a 3D object offers to show one.
    toggle(el.arBtn, ready && hasModel());
    toggle(el.placeBtn, m === MODE.FLOOR && S.floorStable);
    toggle(el.moveBtn, m === MODE.PLACED);
    toggle(el.removeBtn, m === MODE.PLACED);
    toggle(el.backBtn, m === MODE.FLOOR || m === MODE.PLACED);
    // The photo is of the figure standing on the floor, so it only makes sense
    // once there is one.
    var shutter = m === MODE.PLACED && (cfg.photo || {}).enabled !== false &&
                  !!el.shotBtn;
    toggle(el.shotBtn, shutter);
    el.actionBar.classList.toggle('with-shutter', shutter);

    // The logo strip frames the shot, so it is on screen for the whole of the
    // floor scene rather than only at the moment of pressing the shutter.
    var onFloor = m === MODE.FLOOR || m === MODE.PLACED;
    var framing = onFloor && (cfg.branding || {}).showOnScreen !== false &&
                  !!el.brandBar && el.brandBar.childNodes.length > 0;
    toggle(el.brandBar, framing);
    if (el.overlay) {
      var low = (cfg.branding || {}).position !== 'top';
      el.overlay.classList.toggle('framing-top', framing && !low);
      el.overlay.classList.toggle('framing-bottom', framing && low);
    }
    // Leaving the floor scene while looking at a photo drops the sheet too,
    // rather than leaving it floating over scene 1.
    if (!onFloor) hide(el.photoSheet);

    // Adjust is for an exhibit that is actually on screen - and for the
    // people who tune exhibits: staff signed in on this phone, or anyone with
    // the debug log switched on in Settings. A visitor with neither never
    // sees the gear.
    var community = window.ARCommunity;
    var tuner = (community && community.staff.state().signedIn) ||
                (el.logToggle && !el.logToggle.classList.contains('hidden')) ||
                window.ARContent.previewRequested();
    var canAdjust = m !== MODE.BOOT && !S.detailsOpen && !!el.adjustToggle && tuner;
    toggle(el.adjustToggle, canAdjust);
    if (!canAdjust && el.adjustToggle) {
      hide(el.adjustPanel);
      el.adjustToggle.classList.remove('on');
    }

    var anyButton = (m === MODE.SCAN && S.mediaReady) ||
                    (m === MODE.FLOOR) || (m === MODE.PLACED);
    // The Adjust sheet and the details sheet both cover the bottom of the
    // screen; the bar underneath would only be half-visible and unreachable.
    if (el.adjustPanel && !el.adjustPanel.classList.contains('hidden')) anyButton = false;
    if (S.detailsOpen) anyButton = false;
    toggle(el.actionBar, anyButton);
    if (anyButton) requestAnimationFrame(function () { el.actionBar.classList.add('up'); });
    else el.actionBar.classList.remove('up');

    // Only the exhibit being tracked shows its video.
    exhibits.forEach(function (ex, i) {
      if (ex.planeEl) {
        ex.planeEl.setAttribute('visible',
          m === MODE.SCAN && S.targetFound && i === S.activeIndex);
      }
    });
    el.floorScene.setAttribute('visible', m === MODE.FLOOR || m === MODE.PLACED);
    el.reticle.setAttribute('visible', m === MODE.FLOOR && S.floorFound);
    el.modelSlot.setAttribute('visible', m === MODE.PLACED);

    // The touch layer only takes the screen while there is a figure to
    // handle; the rest of the time it must not swallow a single tap.
    var layer = $('gestureLayer');
    if (layer) layer.classList.toggle('on', m === MODE.PLACED);
    realSizeChip();
  }

  function setMode(next) {
    if (S.mode === next) return;
    log.event('scene: ' + S.mode + ' -> ' + next);
    S.mode = next;
    applyModeUI();
    var btn = el.logTools && el.logTools.querySelector('[data-tool="mode"]');
    if (btn) btn.textContent = next;
  }

  // ---------------------------------------------------- scene 1 -> scene 2
  function enterFloorScene() {
    if (S.mode === MODE.FLOOR || S.mode === MODE.PLACED) return;

    // Scene 1 is over: stop the video and the image tracking before anything
    // else, so there is no chance of them fighting the floor scene for the camera.
    el.arVideo.pause();
    exhibits.forEach(function (ex) {
      if (ex.planeEl) ex.planeEl.setAttribute('visible', false);
    });
    S.targetFound = false;

    setMode(MODE.FLOOR);
    setStatus(ARI18n.t('status.floor'), 'warn');
    resetFloorSearch();

    var useXr = cfg.floor.useWebXR && S.xrSupported;
    startEngine(useXr ? xrEngine() : gyroEngine());
  }

  function startEngine(engine) {
    S.engine = engine;
    log.event('floor scene: starting the ' + engine.name + ' engine');

    engine.start().then(function () {
      buildReticle();
      buildFloorShadow();
      log.ok('floor scene: ' + engine.name + ' engine running, 1 unit = ' +
             (1 / engine.unitsPerMetre).toFixed(4) + 'm');
      el.floorText.textContent = engine.hint;
    }).catch(function (err) {
      log.error('floor scene: ' + engine.name + ' engine failed to start: ' +
                (err && err.message ? err.message : err));

      // A failed WebXR start is recoverable — the gyro fallback is the very same
      // path iOS always takes, so drop to it rather than dead-ending the user.
      if (engine.name === 'webxr') {
        log.warn('floor scene: falling back to the gyro engine');
        engine.stop();
        S.xrSupported = false;
        startEngine(gyroEngine());
        return;
      }
      showError('The floor scene could not start. ' +
                (err && err.message ? err.message : ''), true);
      leaveFloorScene();
    });
  }

  // ---------------------------------------------------- scene 2/3 -> scene 1
  function leaveFloorScene() {
    if (S.mode !== MODE.FLOOR && S.mode !== MODE.PLACED) return;

    removeModel();
    resetFloorSearch();

    var engine = S.engine;
    S.engine = null;
    if (!engine) { setMode(MODE.SCAN); return; }

    log.event('floor scene: stopping the ' + engine.name + ' engine');
    engine.stop();

    setMode(MODE.SCAN);
    setStatus(ARI18n.t('status.searching'), 'warn');

    engine.resumeScanning();
  }

  function resetFloorSearch() {
    S.floorFound = false;
    S.floorStable = false;
    stability.reset();
    applyModeUI();
  }

  // ================================================================ FLOOR ENGINES
  /*
   * Both engines answer one question per frame: "where on the floor is the
   * phone pointing, if anywhere?" — as a matrix in #floorScene's space.
   *
   * They differ in how much they know. WebXR genuinely senses the surface and
   * tracks the camera through the room in 6DoF. The gyro engine knows only
   * which way is down, and assumes the floor is a fixed distance below the
   * phone. Everything above this line treats them identically.
   */

  /**
   * Hand the camera's clip planes over to the engine that is about to use them.
   *
   * This is the sharpest edge in the whole file. MindAR sets near=10 / far=1e5
   * on the A-Frame camera, which is right in ITS units (552 per metre, so near
   * is 1.8cm). WebXR is in metres, and three.js pushes whatever it finds on the
   * camera straight into the session:
   *
   *     session.updateRenderState({ depthNear: camera.near, depthFar: camera.far })
   *
   * So entering an immersive session without touching these puts the near plane
   * at 10 METRES. The passthrough and the DOM overlay still draw, so everything
   * looks alive — but every bit of 3D content is clipped away, reticle included.
   */
  // Room scale in metres. Deliberately not A-Frame's 0.005/10000 default: a
  // 2,000,000:1 depth range invites z-fighting, and 5cm to 200m covers any
  // gallery you can walk through.
  var XR_NEAR = 0.05, XR_FAR = 200;

  function setCameraClip(near, far, why) {
    var cam = el.scene.camera;
    if (!cam) { log.warn('no camera yet — clip planes not set'); return; }

    var before = cam.near + '/' + cam.far;
    if (savedClip === null) savedClip = { near: cam.near, far: cam.far };

    // Only the three.js camera, never the A-Frame `camera` component. MindAR
    // writes near/far onto the object3D directly, so putting different numbers
    // in the component would leave the two disagreeing — and the component
    // wins the next time anything touches it, clipping scene 1 at 1.8m.
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();

    log.info('camera clip planes ' + before + ' -> ' + near + '/' + far + ' (' + why + ')');
  }

  var savedClip = null;
  var clipFights = 0;

  /**
   * Hold the metre clip planes against anything that puts MindAR's back.
   *
   * MindAR's _resize() writes near=10 / far=1e5 onto the camera, and its window
   * resize listener OUTLIVES stop() — MindAR calls removeEventListener nowhere,
   * and registers the handler as `this._resize.bind(this)`, an anonymous bound
   * function that cannot be removed after the fact. Entering an immersive
   * session resizes the canvas, so that listener fires and undoes the swap.
   *
   * three.js reads camera.near every XR frame in updateCamera(), and A-Frame
   * runs tick() before renderer.render(), so correcting it here lands in the
   * same frame it would be used.
   */
  function enforceXrClip() {
    var cam = el.scene.camera;
    if (!cam || (cam.near === XR_NEAR && cam.far === XR_FAR)) return;

    cam.near = XR_NEAR;
    cam.far = XR_FAR;
    cam.updateProjectionMatrix();
    clipFights++;
    if (clipFights === 1 || clipFights % 300 === 0) {
      log.warn('camera clip planes were reset to the MindAR values (' + clipFights +
               'x so far) and re-forced to ' + XR_NEAR + '/' + XR_FAR + ' — the MindAR ' +
               'resize listener survives stop(), and entering XR fires a resize');
    }
  }

  /**
   * Wrap MindAR's _resize BEFORE it binds its listener, so the bound copy picks
   * up the wrapper. Patching afterwards would not work: bind() captures the
   * function value, not the property.
   */
  function patchMindarResize(system) {
    if (!system || system.__resizePatched) return;
    var original = system._resize;
    if (typeof original !== 'function') return;

    system._resize = function () {
      try { original.apply(this, arguments); }
      catch (e) { log.debug('MindAR _resize threw (harmless once stopped): ' + e); }
      if (S.engine && S.engine.worldTracked) enforceXrClip();
    };
    system.__resizePatched = true;
    log.debug('MindAR _resize wrapped — its resize listener outlives stop() and would ' +
              'restore near=10 during a WebXR session');
  }

  /** Put MindAR's own clip planes back before scene 1 restarts. */
  function restoreCameraClip() {
    var cam = el.scene.camera;
    if (!cam || !savedClip) return;
    cam.near = savedClip.near;
    cam.far = savedClip.far;
    cam.updateProjectionMatrix();
    log.info('camera clip planes restored to ' + savedClip.near + '/' + savedClip.far +
             ' for image tracking');
    savedClip = null;
  }

  /** Real plane detection. Chrome on Android; absent from every iOS browser. */
  function xrEngine() {
    var source = null;
    var session = null;
    var enterHandler = null;

    return {
      name: 'webxr',
      unitsPerMetre: 1,
      worldTracked: true,
      hint: 'Point your phone at the floor and move it slowly',

      start: function () {
        var system = el.scene.systems['mindar-image-system'];
        // ARCore wants the camera to itself, so MindAR has to let go of it
        // completely. stop() is destructive — going back means a full restart.
        if (system && system.video) {
          try { system.stop(); log.info('floor scene: MindAR stopped, camera released'); }
          catch (e) { log.warn('floor scene: MindAR stop() threw: ' + e); }
        }

        // Before enterAR, so the very first XR frame already has metres.
        setCameraClip(XR_NEAR, XR_FAR, 'WebXR works in metres');

        return new Promise(function (resolve, reject) {
          var failed = setTimeout(function () {
            reject(new Error('the immersive-ar session did not start within 12s'));
          }, 12000);

          enterHandler = function () {
            clearTimeout(failed);
            session = el.scene.renderer.xr.getSession();
            if (!session) { reject(new Error('no XRSession after enter-vr')); return; }

            // Again now the session exists: three.js only pushes a render state
            // when the values CHANGE, so this is what guarantees the correction
            // lands even if something reset the camera on the way in.
            setCameraClip(XR_NEAR, XR_FAR, 'WebXR works in metres');
            reportRenderState(session);
            session.addEventListener('end', function () {
              log.info('floor scene: the immersive-ar session ended');
            });
            session.requestReferenceSpace('viewer').then(function (viewer) {
              return session.requestHitTestSource({ space: viewer });
            }).then(function (s) {
              source = s;
              resolve();
            }).catch(reject);
          };
          el.scene.addEventListener('enter-vr', enterHandler, { once: true });

          try {
            el.scene.enterAR();
          } catch (e) {
            clearTimeout(failed);
            reject(e);
          }
        });
      },

      sample: function (out) {
        var frame = el.scene.frame;
        if (!frame || !source) return false;

        var refSpace = el.scene.renderer.xr.getReferenceSpace();
        if (!refSpace) return false;

        var results = frame.getHitTestResults(source);
        if (!results.length) return false;

        var pose = results[0].getPose(refSpace);
        if (!pose) return false;
        out.fromArray(pose.transform.matrix);

        // Keep only near-horizontal surfaces well below the camera, so a table
        // or a windowsill does not get mistaken for the floor.
        var up = new THREE.Vector3(out.elements[4], out.elements[5], out.elements[6]).normalize();
        if (up.y < 0.85) return false;

        var cam = el.scene.camera;
        if (cam) {
          var camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
          if (camPos.y - out.elements[13] < cfg.floor.minDropMeters) return false;
        }
        return true;
      },

      stop: function () {
        if (source) { try { source.cancel(); } catch (e) { /* already gone */ } source = null; }
        if (enterHandler) el.scene.removeEventListener('enter-vr', enterHandler);
        try { if (el.scene.is('vr-mode') || el.scene.is('ar-mode')) el.scene.exitVR(); }
        catch (e) { log.warn('floor scene: exitVR threw: ' + e); }
      },

      /** MindAR was torn down for this engine, so scene 1 has to be rebuilt. */
      resumeScanning: function () {
        restoreCameraClip();
        log.info('floor scene: restarting MindAR from scratch (WebXR took the camera)');
        show(el.loadingScreen);
        el.loadingText.textContent = 'Returning to the painting…';
        S.arReady = false;
        var system = el.scene.systems['mindar-image-system'];
        try {
          system.start();
        } catch (e) {
          log.error('could not restart image tracking: ' + e);
          showError('Could not go back to the painting. Reload the page.', false);
        }
      },
    };
  }

  /** Read back what the session actually accepted, for the log. */
  function reportRenderState(session) {
    [1500, 5000].forEach(function (delay) {
      setTimeout(function () {
        var rs = session && session.renderState;
        if (!rs) { log.warn('no XR renderState to report'); return; }
        var cam = el.scene.camera;
        var line = 'XR render state @' + (delay / 1000) + 's: depthNear=' + rs.depthNear +
                   'm depthFar=' + rs.depthFar + 'm (camera ' +
                   (cam ? cam.near + '/' + cam.far : '?') +
                   ', clip corrections: ' + clipFights + ')';
        if (rs.depthNear > 1) {
          log.error(line + ' — anything nearer than ' + rs.depthNear +
                    'm is invisible. Send this log.');
        } else {
          log.ok(line);
        }
      }, delay);
    });
  }

  /**
   * Gravity + an assumed phone height.
   *
   * No surface is sensed — there is nothing on iOS Safari to sense it with. What
   * the gyroscope does give is which way is down, exactly, so the floor is taken
   * to be the horizontal plane cameraHeightMeters below the phone. Pointing the
   * phone at it and holding still is then a real, checkable condition.
   */
  function gyroEngine() {
    var origin = null, dir = null, inv = null, hit = null;

    return {
      name: 'gyro',
      unitsPerMetre: GYRO_UNITS_PER_METRE,
      worldTracked: false,
      hint: 'Point your phone down at the floor and hold still',

      start: function () {
        var self = this;
        return ensureCamera().then(function () { return self._waitForGyro(); });
      },

      _waitForGyro: function () {
        if (!gyro.q) initGyro();
        if (!gyro.active) {
          // The reading usually lands within a frame or two of the first move.
          return new Promise(function (resolve, reject) {
            var deadline = performance.now() + 4000;
            (function poll() {
              if (gyro.active) { resolve(); return; }
              if (performance.now() > deadline) {
                reject(new Error('no gyroscope readings — motion access may be denied'));
                return;
              }
              requestAnimationFrame(poll);
            })();
          }).then(captureReference);
        }
        captureReference();
        return Promise.resolve();
      },

      sample: function (out) {
        if (!gyro.active) return false;
        if (!origin) { origin = new THREE.Vector3(); dir = new THREE.Vector3(); inv = new THREE.Matrix4(); hit = new THREE.Vector3(); }

        // #floorScene is counter-rotated by the gyroscope, so inside it +Y is
        // true up. Cast the screen-centre ray from the camera into that space.
        inv.copy(el.floorScene.object3D.matrix).invert();
        origin.set(0, 0, 0).applyMatrix4(inv);
        dir.set(0, 0, -1).transformDirection(inv).normalize();

        var upm = this.unitsPerMetre;
        var floorY = origin.y - S.cameraHeight * upm;
        if (dir.y > -1e-3) return false;          // not pointed downward at all

        var t = (floorY - origin.y) / dir.y;
        if (!(t > 0)) return false;

        hit.copy(origin).addScaledVector(dir, t);
        var metres = t / upm;
        if (metres < cfg.floor.minDistanceMeters || metres > cfg.floor.maxDistanceMeters) return false;

        out.makeTranslation(hit.x, hit.y, hit.z);
        return true;
      },

      stop: function () { origin = null; },

      resumeScanning: function () {
        var system = el.scene.systems['mindar-image-system'];
        try {
          system.unpause();
          log.info('floor scene: image tracking resumed');
        } catch (e) {
          log.error('could not resume image tracking: ' + e);
          showError('Could not go back to the painting. Reload the page.', false);
        }
      },
    };
  }

  /**
   * Make sure a camera picture is on screen before the gyro engine runs.
   *
   * Normally that is just pause(true): MindAR keeps showing the feed and only
   * stops its processing loop. But if WebXR was tried first it called stop(),
   * which tears the video element and the controller down — so a WebXR failure
   * would otherwise drop the user into a floor scene with a black screen.
   */
  function cameraIsLive(system) {
    var v = system && system.video;
    if (!v || !v.isConnected || !v.srcObject || !v.srcObject.getVideoTracks) return false;
    var track = v.srcObject.getVideoTracks()[0];
    return !!(track && track.readyState === 'live');
  }

  function ensureCamera() {
    var system = el.scene.systems['mindar-image-system'];
    if (!system) return Promise.reject(new Error('MindAR system is missing'));

    // NOT `system.video && system.controller`: MindAR's stop() detaches the
    // video element and stops its track but leaves both properties assigned, so
    // a truthiness check cannot tell a torn-down system from a live one.
    if (cameraIsLive(system)) {
      try {
        system.pause(true);
        log.info('floor scene: image tracking paused, camera kept');
      } catch (e) {
        log.warn('floor scene: MindAR pause() threw: ' + e);
      }
      return Promise.resolve();
    }

    restoreCameraClip();   // a failed WebXR attempt may have left metres behind
    log.warn('floor scene: the camera was released for WebXR — restarting MindAR to get it back');
    return new Promise(function (resolve, reject) {
      var settled = false;
      el.scene.addEventListener('arReady', function () {
        settled = true;
        try { system.pause(true); } catch (e) { /* running is enough */ }
        log.ok('floor scene: camera is back');
        resolve();
      }, { once: true });

      try { system.start(); } catch (e) { reject(e); return; }
      setTimeout(function () {
        if (!settled) reject(new Error('the camera did not come back within 15s'));
      }, 15000);
    });
  }

  /**
   * The floor scene's "world": gravity's up, and the heading the phone had
   * when the scene opened.
   *
   * ONLY the heading. This used to keep the phone's whole orientation at that
   * moment, which made the floor plane perpendicular to wherever the top of
   * the phone pointed - right while it was held upright at the painting, and
   * tilted by however far it was not. Opened with the phone already angled
   * down, the floor came out angled too: the figure leaned, and stood nearer
   * or further than the reticle. The device's orientation already carries
   * gravity exactly, so only the compass part is taken from the moment, and
   * up is always up.
   */
  function captureReference() {
    var v = new THREE.Vector3(0, 0, -1).applyQuaternion(gyro.q);   // where the camera looks
    if (Math.hypot(v.x, v.z) < 0.2) {
      // Pointed almost straight down: the camera's heading is undefined, but
      // the top edge of the phone points the way the visitor is facing.
      v.set(0, 1, 0).applyQuaternion(gyro.q);
    }
    var yaw = Math.atan2(-v.x, -v.z);
    gyro.ref.setFromAxisAngle(WORLD_UP, yaw);
    gyro.hasRef = true;
    log.debug('floor scene: gyro reference captured — heading ' +
              (yaw * 180 / Math.PI).toFixed(0) + '°, up from gravity');
  }

  // ---------------------------------------------------- how steady is steady
  var stability = {
    anchor: null,
    since: 0,

    reset: function () { this.anchor = null; this.since = 0; },

    /** True once the point has stayed inside one small ball for long enough. */
    feed: function (point, unitsPerMetre) {
      var now = performance.now();
      var tol = cfg.floor.stableToleranceMeters * unitsPerMetre;

      if (!this.anchor) {
        this.anchor = point.clone();
        this.since = now;
        return false;
      }
      if (point.distanceTo(this.anchor) > tol) {
        this.anchor.copy(point);
        this.since = now;
        return false;
      }
      return (now - this.since) >= cfg.floor.stableSeconds * 1000;
    },

    heldFor: function () { return this.since ? (performance.now() - this.since) / 1000 : 0; },
  };

  // ---------------------------------------------------- per-frame driver
  function registerFloorDriver() {
    if (AFRAME.components['floor-driver']) return;

    AFRAME.registerComponent('floor-driver', {
      init: function () {
        this.o = this.el.object3D;
        this.pose = new THREE.Matrix4();
        this.point = new THREE.Vector3();
        this.q = new THREE.Quaternion();
      },

      tick: function () {
        // A photo taken during a WebXR session can only read the passthrough
        // picture from inside an XRFrame, and this is the only place that has
        // one. Outside XR scene.frame is null and the shot is already done.
        if (window.ARCapture) window.ARCapture.tick(el.scene.frame);

        var engine = S.engine;
        if (!engine || (S.mode !== MODE.FLOOR && S.mode !== MODE.PLACED)) return;

        // Where the scene's own frame sits. WebXR tracks the camera for us, so
        // the scene is simply the world. The gyro engine has to counter-rotate
        // by hand, or everything would be glued to the phone.
        if (engine.worldTracked) {
          this.o.matrixAutoUpdate = true;
          enforceXrClip();
        } else {
          this.o.matrixAutoUpdate = false;
          if (gyro.active && gyro.hasRef) {
            this.q.copy(gyro.q).invert().multiply(gyro.ref);
            this.o.matrix.makeRotationFromQuaternion(this.q);
          }
        }

        if (S.mode !== MODE.FLOOR) return;   // already placed; stop hunting

        var found = engine.sample(this.pose);
        if (found !== S.floorFound) {
          S.floorFound = found;
          el.reticle.setAttribute('visible', found);
          if (!found) {
            stability.reset();
            if (S.floorStable) { S.floorStable = false; applyModeUI(); }
            setStatus(ARI18n.t('status.floor'), 'warn');
          }
        }
        if (!found) return;

        el.reticle.object3D.matrixAutoUpdate = false;
        el.reticle.object3D.matrix.copy(this.pose);

        this.point.setFromMatrixPosition(this.pose);
        var stable = stability.feed(this.point, engine.unitsPerMetre);

        if (stable !== S.floorStable) {
          S.floorStable = stable;
          setReticleLocked(stable);
          applyModeUI();
          if (stable) {
            var d = this.point.length() / engine.unitsPerMetre;
            log.ok('floor locked by the ' + engine.name + ' engine — steady for ' +
                   cfg.floor.stableSeconds + 's, ' + d.toFixed(2) + 'm away. ' +
                   '"Place AR figure on the floor" is now available.');
            setStatus(ARI18n.t('status.floorReady'), 'ok');
          } else {
            setStatus(ARI18n.t('status.floor'), 'warn');
          }
        } else if (!stable) {
          setStatus(ARI18n.t('status.hold', { seconds: stability.heldFor().toFixed(1) }), 'warn');
        }
      },
    });
  }

  // ---------------------------------------------------------------- reticle
  function buildReticle() {
    var upm = S.engine ? S.engine.unitsPerMetre : 1;

    // The scale goes on the INNER group, never on el.reticle.object3D: the frame
    // driver copies the engine's pose matrix straight into that object's matrix,
    // which would wipe any scale set on it. In the gyro engine's units that
    // difference is 552x — the reticle would render a third of a millimetre wide.
    var existing = el.reticle.getObject3D('mesh');
    if (existing) { existing.scale.setScalar(upm); return; }

    var group = new THREE.Group();
    group.scale.setScalar(upm);        // geometry below is authored in metres

    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.09, 0.11, 48),
      new THREE.MeshBasicMaterial({
        color: 0x7fd4ff, transparent: true, opacity: 0.95,
        side: THREE.DoubleSide, depthTest: false, toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 10;

    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 48),
      new THREE.MeshBasicMaterial({
        color: 0x7fd4ff, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthTest: false, toneMapped: false,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.renderOrder = 9;

    group.add(ring);
    group.add(disc);
    el.reticle.setObject3D('mesh', group);
    el.reticle.object3D.matrixAutoUpdate = false;
    log.debug('reticle built');
  }

  function setReticleLocked(locked) {
    var g = el.reticle.getObject3D('mesh');
    if (!g) return;
    var colour = locked ? 0x67e08a : 0x7fd4ff;
    g.children.forEach(function (child) {
      if (child.material) child.material.color.setHex(colour);
    });
  }

  // ---------------------------------------------------------------- gyroscope
  var gyro = { active: false, q: null, ref: null, hasRef: false, requested: false };
  var gyroZ = null, gyroEuler = null, gyroFlip = null, gyroTwist = null;

  function initGyro() {
    if (gyro.requested) return;
    gyro.requested = true;
    gyro.q = new THREE.Quaternion();
    gyro.ref = new THREE.Quaternion();

    var D = window.DeviceOrientationEvent;
    if (!D) {
      log.warn('no DeviceOrientationEvent — the gyro floor engine cannot run here');
      return;
    }
    var listen = function () {
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
      log.info('gyro: listening for orientation');
    };
    // iOS 13+ gates motion behind a permission prompt that must come from a user
    // gesture — this runs inside the Start button's click.
    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then(function (res) {
        log.info('gyro: motion permission = ' + res);
        if (res === 'granted') listen();
        else log.warn('gyro: motion denied — the floor scene will not work on this device ' +
                      'until Settings > Safari > Motion & Orientation Access is on');
      }).catch(function (e) {
        log.warn('gyro: motion permission request failed: ' + e);
      });
    } else {
      listen();
    }
  }

  /** alpha/beta/gamma -> a quaternion, the standard three.js device conversion. */
  function onDeviceOrientation(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    if (!gyroZ) {
      gyroZ = new THREE.Vector3(0, 0, 1);
      gyroEuler = new THREE.Euler();
      gyroFlip = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
      gyroTwist = new THREE.Quaternion();
    }
    var d2r = Math.PI / 180;
    var orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;

    gyroEuler.set(e.beta * d2r, e.alpha * d2r, -e.gamma * d2r, 'YXZ');
    gyro.q.setFromEuler(gyroEuler);
    gyro.q.multiply(gyroFlip);
    gyro.q.multiply(gyroTwist.setFromAxisAngle(gyroZ, -orient * d2r));

    if (!gyro.active) {
      gyro.active = true;
      log.ok('gyro: first reading received');
    }
  }

  // ---------------------------------------------------------------- the figure
  function placeFigure() {
    if (S.mode !== MODE.FLOOR || !S.floorStable) return;

    var engine = S.engine;
    var pose = el.reticle.object3D.matrix;
    var p = new THREE.Vector3().setFromMatrixPosition(pose);

    S.placedAt = p.clone();
    S.faceYaw = faceViewerYaw(p);

    S.visitorScale = 1;
    buildFigure();
    applyFigureTransform();
    setMode(MODE.PLACED);
    updateFloorShadow();     // after setMode: it only draws in the placed scene
    setStatus(ARI18n.t('status.placed'), 'ok');
    gestureHint(true);
    log.event('AR figure placed on the floor at ' +
              (p.length() / engine.unitsPerMetre).toFixed(2) + 'm, ' +
              'using the ' + engine.name + ' engine');
  }

  function degToRad(d) { return d * Math.PI / 180; }

  /**
   * Where the figure stands, which way it faces, and how it is tilted.
   *
   * Split across two entities on purpose:
   *
   *   #modelSlot       the spot on the floor. Carries the placement point, the
   *                    horizontal part of the offset, and the facing yaw — and
   *                    nothing else, because #floorShadow hangs here and has to
   *                    stay lying flat on the floor.
   *   #modelTransform  the figure's own pose: lifted by the vertical offset and
   *                    turned/tilted on all three axes. Raising the figure
   *                    therefore leaves its shadow on the ground, which is what
   *                    a raised object does.
   *
   * The offset is read in the frame the figure was placed in — x to your right,
   * z towards you — so a saved value means the same thing next time, wherever
   * in the room it gets stood up.
   */
  function applyFigureTransform() {
    var upm = S.engine ? S.engine.unitsPerMetre : 1;
    var slot = el.modelSlot.object3D;

    // The visitor's pinch scales the whole slot, shadow and all, and the
    // offset with it - as if the room's furniture had been drawn bigger.
    var k = S.visitorScale || 1;
    if (S.placedAt) {
      var flat = new THREE.Vector3(S.modelOffset.x, 0, S.modelOffset.z)
        .multiplyScalar(upm * k)
        .applyAxisAngle(WORLD_UP, S.faceYaw);
      slot.position.copy(S.placedAt).add(flat);
    }
    slot.rotation.set(0, S.faceYaw, 0);
    slot.scale.setScalar(k);

    var inner = $('modelTransform');
    if (!inner) return;
    inner.object3D.position.set(0, S.modelOffset.y * upm, 0);
    // YXZ: turn about world up first, then pitch, then roll — the order the
    // three sliders read in, and the Studio's. All of it about the anchor,
    // which normalizeModel() put on this entity's origin.
    inner.object3D.rotation.order = window.ARPlacement.ORDER;
    inner.object3D.rotation.set(
      degToRad(S.modelRot.x), degToRad(S.modelRot.y), degToRad(S.modelRot.z));
  }

  var WORLD_UP = null;   // filled in at init, once THREE exists

  /** Turn the figure so its front faces wherever the camera is standing. */
  function faceViewerYaw(at) {
    if (!cfg.floor.faceViewer) return 0;
    var cam = el.scene.camera;
    if (!cam) return 0;

    var camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    el.floorScene.object3D.updateMatrixWorld();
    el.floorScene.object3D.worldToLocal(camPos);      // into the scene's own frame
    return Math.atan2(camPos.x - at.x, camPos.z - at.z);
  }

  function buildFigure() {
    if ($('modelPivot')) return;

    var model = modelCfg();
    var pivot = document.createElement('a-entity');
    pivot.id = 'modelPivot';
    if (S.spin) {
      pivot.setAttribute('animation', {
        property: 'rotation', from: '0 0 0', to: '0 360 0',
        loop: true, dur: 14000, easing: 'linear',
      });
    }

    if (model.src) {
      var holder = document.createElement('a-entity');
      holder.id = 'modelHolder';
      holder.setAttribute('gltf-model', 'url(' + model.src + ')');
      holder.addEventListener('model-loaded', function () {
        normalizeModel(holder);
        applyModelLighting(holder);
        if (S.playClip) holder.setAttribute('clip-player', '');
        updateFloorShadow();
        log.ok('3D model loaded for "' + (EX() ? EX().name : '?') + '": ' + shortSrc(model.src));
      });
      holder.addEventListener('model-error', function () {
        log.error('3D model failed to load: ' + shortSrc(model.src));
        showError('The 3D model could not be loaded — showing a placeholder instead.', true);
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        pivot.appendChild(buildPlaceholder());
        updateFloorShadow();
      });
      pivot.appendChild(holder);
      log.info('loading 3D model: ' + shortSrc(model.src));
    } else {
      pivot.appendChild(buildPlaceholder());
      log.info('"' + (EX() ? EX().name : '?') + '" has no 3D model — placed the ' +
               'built-in placeholder (add a .glb to this exhibit in admin.html)');
    }

    // Its own pose lives here rather than on #modelSlot, so the contact shadow
    // next door keeps lying flat on the floor however the figure is tilted.
    var inner = document.createElement('a-entity');
    inner.id = 'modelTransform';
    inner.appendChild(pivot);
    el.modelSlot.appendChild(inner);
  }

  function removeModel() {
    var inner = $('modelTransform');
    if (inner && inner.parentNode) inner.parentNode.removeChild(inner);
    var pivot = $('modelPivot');
    if (pivot && pivot.parentNode) pivot.parentNode.removeChild(pivot);
    el.modelSlot.setAttribute('visible', false);
    el.floorShadow.setAttribute('visible', false);
    var model = modelCfg();
    S.modelScale = model.scale;
    S.lighting = model.lighting === 'lit' ? 'lit' : 'baked';
    S.shadowOpacity = typeof model.shadowOpacity === 'number' ? model.shadowOpacity : 0.5;
    S.modelRot = { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z };
    S.modelOffset = { x: model.offset.x, y: model.offset.y, z: model.offset.z };
    S.modelAnchor = window.ARPlacement.anchor(model.anchor);
    S.spin = !!model.spin;
    S.playClip = model.playClip !== false;
    S.loopClip = !!model.loopClip;
    S.shadows = copyShadows(model.shadows);
    S.shadowFollow = !!model.shadowFollow;
    S.shadowScale = model.shadowScale > 0 ? model.shadowScale : model.scale;
    S.faceYaw = 0;
    S.placedAt = null;
    S.figureFootprint = 0;
    S.figureBase = null;
    S.visitorScale = 1;
    gestureHint(false);
  }

  // ---------------------------------------------------------------- touch
  /*
   * Once the figure is standing, the visitor can handle it:
   *
   *   one finger    drag it across the floor
   *   two fingers   twist to turn it, pinch to make it bigger or smaller
   *
   * The drag follows the floor itself, not the screen: the finger's ray is cast
   * onto the floor plane the figure stands on, so it stays under the finger
   * however far away it is. Both floor engines share the code, because both
   * keep that plane in #floorScene's own space.
   *
   * None of it is saved. The museum decides where the figure stands and how
   * big it is; this is the visitor arranging it for a photo. "Real size" puts
   * the scale back, and Move starts over.
   */
  var touch = { pointers: {}, count: 0, last: null, angle: 0, spread: 0, scale: 1 };
  var VISITOR_SCALE_MIN = 0.4, VISITOR_SCALE_MAX = 2.5;

  function gesturesOn() {
    return S.mode === MODE.PLACED && !!S.placedAt &&
           (!el.photoSheet || el.photoSheet.classList.contains('hidden')) &&
           (!el.adjustPanel || el.adjustPanel.classList.contains('hidden'));
  }

  /** Where a point on the screen meets the floor, in #floorScene's space. */
  var floorRay = null;
  function floorPointAt(clientX, clientY, out) {
    var cam = el.scene.camera;
    if (!cam || !S.placedAt) return false;
    if (!floorRay) floorRay = { caster: new THREE.Raycaster(), ndc: new THREE.Vector2(), inv: new THREE.Matrix4() };

    // WebXR draws full-screen through the compositor. The gyro path draws into
    // MindAR's canvas, which is sized to cover the screen and may overhang it.
    var rect = S.engine && S.engine.worldTracked
      ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      : el.scene.canvas.getBoundingClientRect();
    floorRay.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1,
                     -((clientY - rect.top) / rect.height) * 2 + 1);
    cam.updateMatrixWorld();
    floorRay.caster.setFromCamera(floorRay.ndc, cam);

    var scene = el.floorScene.object3D;
    scene.updateMatrixWorld(true);
    var ray = floorRay.caster.ray.clone().applyMatrix4(floorRay.inv.copy(scene.matrixWorld).invert());
    if (Math.abs(ray.direction.y) < 1e-4) return false;
    var t = (S.placedAt.y - ray.origin.y) / ray.direction.y;
    if (!(t > 0)) return false;
    out.copy(ray.origin).addScaledVector(ray.direction, t);
    return true;
  }

  function twoFinger() {
    var ids = Object.keys(touch.pointers);
    var a = touch.pointers[ids[0]], b = touch.pointers[ids[1]];
    return { angle: Math.atan2(b.y - a.y, b.x - a.x), spread: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  function onGestureDown(e) {
    if (!gesturesOn()) return;
    e.preventDefault();
    touch.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    touch.count = Object.keys(touch.pointers).length;
    if (e.target.setPointerCapture) { try { e.target.setPointerCapture(e.pointerId); } catch (err) {} }

    if (touch.count === 1) {
      var hit = new THREE.Vector3();
      touch.last = floorPointAt(e.clientX, e.clientY, hit) ? hit : null;
    } else if (touch.count === 2) {
      var g = twoFinger();
      touch.angle = g.angle;
      touch.spread = g.spread || 1;
      touch.scale = S.visitorScale;
      touch.last = null;      // a second finger ends the drag; lifting it does not restart one
    }
    gestureHint(false);
  }

  function onGestureMove(e) {
    var p = touch.pointers[e.pointerId];
    if (!p || !gesturesOn()) return;
    e.preventDefault();
    p.x = e.clientX;
    p.y = e.clientY;

    if (touch.count === 1 && touch.last) {
      var hit = new THREE.Vector3();
      if (!floorPointAt(e.clientX, e.clientY, hit)) return;
      S.placedAt.x += hit.x - touch.last.x;
      S.placedAt.z += hit.z - touch.last.z;
      touch.last = hit;
      applyFigureTransform();
    } else if (touch.count === 2) {
      var g = twoFinger();
      // Screen angles grow clockwise; a turn about +y is counter-clockwise
      // seen from above. Hence the minus: the figure turns the way the
      // fingers do.
      var d = g.angle - touch.angle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      S.faceYaw -= d;
      touch.angle = g.angle;
      S.visitorScale = clamp(touch.scale * (g.spread / touch.spread), VISITOR_SCALE_MIN, VISITOR_SCALE_MAX);
      applyFigureTransform();
      realSizeChip();
    }
  }

  function onGestureUp(e) {
    if (!touch.pointers[e.pointerId]) return;
    delete touch.pointers[e.pointerId];
    touch.count = Object.keys(touch.pointers).length;
    if (touch.count < 2) {
      touch.last = null;
      if (Math.abs(S.visitorScale - 1) < 0.04) { S.visitorScale = 1; applyFigureTransform(); }
      realSizeChip();
      log.debug('figure handled by the visitor: ' +
                (S.visitorScale === 1 ? 'real size' : '×' + S.visitorScale.toFixed(2)));
    }
  }

  function realSizeChip() {
    var chip = $('realSizeChip');
    if (!chip) return;
    var scaled = S.mode === MODE.PLACED && Math.abs(S.visitorScale - 1) > 0.001;
    toggle(chip, scaled);
    if (scaled) {
      var label = $('realSizeValue');
      if (label) label.textContent = '×' + S.visitorScale.toFixed(1);
    }
  }

  /** "Drag to move · twist to turn", once per visit, until the first touch. */
  var hintShown = false;
  function gestureHint(on) {
    var hint = $('gestureHint');
    if (!hint) return;
    if (!on) { hint.classList.remove('on'); return; }
    if (hintShown) return;
    hintShown = true;
    hint.classList.add('on');
    clearTimeout(gestureHint._t);
    gestureHint._t = setTimeout(function () { hint.classList.remove('on'); }, 5200);
  }

  function wireGestures() {
    var layer = $('gestureLayer');
    if (!layer || !window.PointerEvent) return;
    layer.addEventListener('pointerdown', onGestureDown, { passive: false });
    layer.addEventListener('pointermove', onGestureMove, { passive: false });
    layer.addEventListener('pointerup', onGestureUp);
    layer.addEventListener('pointercancel', onGestureUp);
    on($('realSizeChip'), 'click', function () {
      S.visitorScale = 1;
      applyFigureTransform();
      realSizeChip();
      log.event('figure back to real size');
    });
  }

  /** Back to hunting for a spot, keeping the scene and the engine running. */
  function moveFigure() {
    if (S.mode !== MODE.PLACED) return;
    removeModel();
    resetFloorSearch();
    setMode(MODE.FLOOR);
    setStatus(ARI18n.t('status.floor'), 'warn');
    log.event('figure picked up — looking for a new spot');
  }

  /**
   * Scale the glTF to its real height and hang it from its anchor.
   *
   * js/placement.js does the measuring and the arithmetic, and the Studio's
   * floor editor calls the very same function - which is the whole guarantee
   * that a figure stands here exactly as it stood there. With the default
   * anchor this is what it always was: centred, base on the floor.
   */
  function normalizeModel(holder) {
    var obj = holder.getObject3D('mesh');
    if (!obj) { log.warn('model has no mesh to normalize'); return; }

    // Measured the first time only: see fit() on why a re-measure mid-clip
    // would resize the figure.
    var fit = window.ARPlacement.fit(THREE, obj, figureHeightUnits(), S.modelAnchor,
                                     obj.userData.__measure || null);
    if (fit) obj.userData.__measure = fit.measure;
    if (!fit) {
      log.warn('model bounding box is empty (no geometry, or skinned-only meshes) — ' +
               'leaving it at its authored scale');
      return;
    }

    S.figureFootprint = fit.footprint;
    S.figureBase = { object: obj, point: fit.measure.base.clone() };

    var size = fit.measure.size;
    var a = S.modelAnchor;
    log.info('model normalized: source size ' +
             size.x.toFixed(2) + ' x ' + size.y.toFixed(2) + ' x ' + size.z.toFixed(2) +
             ' -> scale ' + fit.scale.toFixed(4) + ' (' +
             (modelCfg().heightMeters * S.modelScale).toFixed(2) + 'm tall on the floor), ' +
             'anchor ' + (a.x || a.y || a.z
               ? a.x.toFixed(3) + ', ' + a.y.toFixed(3) + ', ' + a.z.toFixed(3) + ' of its height'
               : 'at the base centre'));
  }

  /**
   * Shading mode for a loaded glTF.
   *
   * A scan or a baked model already carries its lighting and ambient occlusion
   * in the texture. A-Frame's default directional light then shades it a SECOND
   * time, and because that light is fixed in world space while you walk around
   * the figure, whole sides drop into darkness that is not in the source asset
   * at all.
   *
   * 'baked' swaps each material for an unlit one, so the texture renders exactly
   * as authored from every angle. The originals are kept on the mesh so 'lit'
   * can put them back without reloading the model.
   */
  function applyModelLighting(holder) {
    var root = holder && holder.getObject3D('mesh');
    if (!root) return;

    var wantBaked = S.lighting !== 'lit';
    var changed = 0;

    root.traverse(function (node) {
      if (!node.isMesh || !node.material) return;

      if (wantBaked) {
        if (node.userData.__litMaterial) return;          // already unlit
        node.userData.__litMaterial = node.material;
        node.material = mapMaterial(node.material, toUnlitMaterial);
        changed++;
      } else {
        if (!node.userData.__litMaterial) return;
        mapMaterial(node.material, function (m) { m.dispose(); return m; });
        node.material = node.userData.__litMaterial;
        delete node.userData.__litMaterial;
        changed++;
      }
    });

    if (changed) {
      log.info('figure shading: ' + (wantBaked
        ? 'baked — ' + changed + ' material(s) switched to unlit, so the texture ' +
          'renders as authored and does not darken as you walk around'
        : 'lit — ' + changed + ' material(s) restored to the glTF originals'));
    }
  }

  /** glTF meshes may carry one material or an array of them. */
  function mapMaterial(material, fn) {
    return Array.isArray(material) ? material.map(fn) : fn(material);
  }

  function toUnlitMaterial(source) {
    var basic = new THREE.MeshBasicMaterial({
      map: source.map || null,
      color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      alphaMap: source.alphaMap || null,
      side: source.side,
      vertexColors: source.vertexColors,
      depthWrite: source.depthWrite,
      // The texture is the finished look; tone mapping would grade it again.
      toneMapped: false,
    });
    // A model that puts everything in an emissive map would otherwise go black.
    if (!basic.map && source.emissiveMap) basic.map = source.emissiveMap;
    basic.name = source.name;
    return basic;
  }

  /** The figure's height in whatever units the running engine uses. */
  function figureHeightUnits() {
    var upm = S.engine ? S.engine.unitsPerMetre : 1;
    return modelCfg().heightMeters * S.modelScale * upm;
  }

  /** Stand-in object so the whole flow works before a real .glb exists. */
  function buildPlaceholder() {
    var g = document.createElement('a-entity');
    g.id = 'modelHolder';
    g.setAttribute('data-placeholder', '');

    // Authored around its own centre, then lifted so its base is on the floor
    // - and shifted by the anchor, so a placeholder obeys the same rule a real
    // model does.
    var h = figureHeightUnits();
    var f = h * 0.92;
    var a = S.modelAnchor;
    g.setAttribute('position', (-a.x * h) + ' ' + (-a.y * h) + ' ' + (-a.z * h));
    var lift = document.createElement('a-entity');
    lift.setAttribute('position', '0 ' + (f * 0.46) + ' 0');
    S.figureFootprint = f * 0.84;
    S.figureBase = { object: g.object3D, point: new THREE.Vector3(0, 0, 0) };

    var base = document.createElement('a-cylinder');
    base.setAttribute('radius', f * 0.42);
    base.setAttribute('height', f * 0.08);
    base.setAttribute('position', '0 ' + (-f * 0.42) + ' 0');
    base.setAttribute('material', 'color: #1d222c; metalness: 0.2; roughness: 0.8');

    var gem = document.createElement('a-octahedron');
    gem.setAttribute('radius', f * 0.36);
    gem.setAttribute('position', '0 0 0');
    gem.setAttribute('material', 'color: #d4a12a; metalness: 0.6; roughness: 0.25');
    gem.setAttribute('animation', {
      property: 'object3D.position.y', from: -f * 0.03, to: f * 0.03,
      dir: 'alternate', loop: true, dur: 2000, easing: 'easeInOutSine',
    });

    var label = document.createElement('a-text');
    label.setAttribute('value', 'PLACEHOLDER');
    label.setAttribute('align', 'center');
    label.setAttribute('color', '#9aa4b5');
    label.setAttribute('width', f * 3);
    label.setAttribute('position', '0 ' + (f * 0.62) + ' 0');

    lift.appendChild(base);
    lift.appendChild(gem);
    lift.appendChild(label);
    g.appendChild(lift);
    return g;
  }

  /** Re-applies size/turn to whichever kind of figure is currently standing. */
  function refreshFigure() {
    var holder = $('modelHolder');
    if (!holder) return;

    if (holder.hasAttribute('data-placeholder')) {
      // Built at a fixed size, so rebuild it rather than trying to patch it.
      var pivot = $('modelPivot');
      if (pivot) {
        while (pivot.firstChild) pivot.removeChild(pivot.firstChild);
        pivot.appendChild(buildPlaceholder());
      }
    } else if (holder.getObject3D('mesh')) {
      normalizeModel(holder);
      applyModelLighting(holder);
    }

    applyFigureTransform();
    updateFloorShadow();
  }

  // ---------------------------------------------------------------- contact shadow
  /*
   * One soft shape per entry in S.shadows - an ellipse, a rectangle or a
   * picture (js/shadows.js) - so the shadow can be built up to roughly the
   * shape of the thing casting it: a body blob, one per foot, a long thin one
   * under an outstretched arm, or a shadow painted as a PNG.
   *
   * An empty list keeps the original behaviour exactly: a single circle sized
   * from the figure's own footprint. That is what every exhibit written before
   * this had, and what a new one still gets until someone says otherwise.
   *
   * The geometry is shared by every shape and each texture by every shape that
   * looks the same; the material is not, because each one carries its own
   * colour, opacity and texture.
   */
  var shadowKit = null;

  /** The colours a shadow can be tinted, in the order the swatches appear. */
  var SHADOW_COLOURS = window.ARShadows.COLOURS;

  function shadowResources() {
    if (shadowKit) return shadowKit;
    shadowKit = { geometry: new THREE.PlaneGeometry(1, 1), textures: {}, pictures: {} };
    return shadowKit;
  }

  /**
   * The texture for one shape: white, and tinted by material.color -
   * MeshBasicMaterial multiplies the two, so a black map would swallow every
   * colour. The mask is alpha only and runs to full strength, scaled down by
   * material.opacity, so the number in the panel IS the opacity you see.
   *
   * A picture is null until it has loaded; the shadow redraws when it lands.
   */
  function shadowTexture(blob) {
    var kit = shadowResources();
    if (blob.s === 'image') {
      var got = kit.pictures[blob.src];
      if (got) return got.texture;
      got = kit.pictures[blob.src] = { texture: null };
      window.ARShadows.loadMask(blob.src).then(function (canvas) {
        got.texture = new THREE.CanvasTexture(canvas);
        updateFloorShadow();
      }, function (err) {
        log.warn('shadow picture failed: ' + (err && err.message));
      });
      return null;
    }
    var shape = blob.s === 'rect' ? 'rect' : 'ellipse';
    var feather = window.ARShadows.featherOf(blob);
    var key = shape + '|' + feather.toFixed(2);
    if (!kit.textures[key]) kit.textures[key] = new THREE.CanvasTexture(window.ARShadows.mask(shape, feather));
    return kit.textures[key];
  }

  function shadowMaterial() {
    return new THREE.MeshBasicMaterial({
      map: null,
      color: 0x000000,
      transparent: true, depthWrite: false, toneMapped: false,
      opacity: S.shadowOpacity,
    });
  }

  function buildFloorShadow() {
    if (!cfg.floor.shadow) return;
    if (!el.floorShadow.getObject3D('mesh')) {
      el.floorShadow.setObject3D('mesh', new THREE.Group());
      el.floorShadow.setAttribute('position', '0 0 0');
      el.floorShadow.setAttribute('scale', '1 1 1');
    }
  }

  /**
   * The circle an exhibit gets when it has not been given a shadow shape.
   *
   * Centred under the figure's base rather than under the slot: with the
   * anchor anywhere but the base centre - a statue anchored at the front edge
   * of its plinth, say - the two are not the same spot.
   */
  function autoShadowBlob() {
    var upm = S.engine ? S.engine.unitsPerMetre : 1;
    var spread = Math.max(0.1 * upm, (S.figureFootprint || 0.5 * upm) * 2.1) / upm;
    var at = figureBaseOnFloor();
    return { s: 'ellipse', x: at.x, z: at.z, w: spread, d: spread, r: 0, o: 1, c: '#000000', f: 1 };
  }

  /** Where the figure's base centre is, in metres in the slot's frame. */
  function figureBaseOnFloor() {
    var base = S.figureBase;
    if (!base || !base.object) return { x: 0, z: 0 };
    var slot = el.modelSlot.object3D;
    slot.updateMatrixWorld(true);
    var p = base.object.localToWorld(base.point.clone());
    slot.worldToLocal(p);
    var upm = S.engine ? S.engine.unitsPerMetre : 1;
    if (!isFinite(p.x) || !isFinite(p.z)) return { x: 0, z: 0 };
    return { x: p.x / upm, z: p.z / upm };
  }

  function copyShadows(list) {
    return (list || []).map(function (b) {
      var copy = { s: b.s || 'ellipse', x: b.x, z: b.z, w: b.w, d: b.d, r: b.r,
                   o: typeof b.o === 'number' ? b.o : 1,
                   c: b.c || '#000000' };
      if (copy.s === 'image') { copy.src = b.src; copy.n = b.n || ''; }
      else copy.f = window.ARShadows.featherOf(b);
      return copy;
    });
  }

  /** Grow or shrink the pool of ellipse meshes to match the list. */
  function syncShadowMeshes(group, wanted) {
    var kit = shadowResources();
    while (group.children.length < wanted) {
      // A wrapper turns the ellipse on the floor; the plane inside it keeps the
      // fixed lie-flat tilt. Two objects, so no Euler-order guesswork.
      var wrapper = new THREE.Object3D();
      var mesh = new THREE.Mesh(kit.geometry, shadowMaterial());
      mesh.rotation.x = -Math.PI / 2;
      wrapper.add(mesh);
      group.add(wrapper);
    }
    while (group.children.length > wanted) {
      var gone = group.children[group.children.length - 1];
      group.remove(gone);
      gone.children[0].material.dispose();   // its own, so nothing else loses it
    }
  }

  function updateFloorShadow() {
    var opacity = clamp(S.shadowOpacity, 0, 1);
    // A model with its own grounding shadow baked into the texture wants this
    // at 0, or it gets a second shadow stacked under the first.
    var on = cfg.floor.shadow && opacity > 0 && S.mode === MODE.PLACED;
    el.floorShadow.setAttribute('visible', on);
    if (!on) return;

    buildFloorShadow();
    var group = el.floorShadow.getObject3D('mesh');
    if (!group) return;

    var auto = !S.shadows.length;
    var blobs = auto ? [autoShadowBlob()] : S.shadows;
    syncShadowMeshes(group, blobs.length);

    // Riding on the figure means two things: the layout grows with the Size
    // slider, measured against the scale the ellipses were drawn at, and it
    // turns with the figure's own yaw. Pitch, roll and lift are left out on
    // purpose — a shadow stays flat on the floor whatever the thing above it is
    // doing. The auto circle is sized from the live footprint and so already
    // follows, hence the factor is for hand-drawn ellipses only.
    var follow = S.shadowFollow && !auto;
    var k = follow && S.shadowScale > 0 ? S.modelScale / S.shadowScale : 1;
    group.rotation.set(0, follow ? degToRad(S.modelRot.y) : 0, 0);

    var upm = S.engine ? S.engine.unitsPerMetre : 1;
    var lift = 0.002 * upm;          // just clear of the floor, to avoid z-fighting
    blobs.forEach(function (blob, i) {
      var wrapper = group.children[i];
      var material = wrapper.children[0].material;
      wrapper.position.set(blob.x * k * upm, lift + i * 0.0002 * upm, blob.z * k * upm);
      wrapper.rotation.set(0, degToRad(blob.r), 0);
      wrapper.scale.set(Math.max(0.01, blob.w * k) * upm, 1,
                        Math.max(0.01, blob.d * k) * upm);
      var map = shadowTexture(blob);
      if (material.map !== map) {
        material.map = map;
        material.needsUpdate = true;
      }
      wrapper.visible = !!map;
      material.color.set(blob.c || '#000000');
      material.opacity = opacity * clamp(typeof blob.o === 'number' ? blob.o : 1, 0, 1);
    });
  }

  /**
   * Plays a glTF's own animation clips. Core A-Frame's gltf-model loads the
   * clips but never runs them, and aframe-extras' animation-mixer is a whole
   * extra dependency for this one job.
   */
  function registerClipPlayer() {
    if (AFRAME.components['clip-player']) return;
    AFRAME.registerComponent('clip-player', {
      init: function () {
        var model = this.el.getObject3D('mesh');
        if (!model || !model.animations || !model.animations.length) {
          log.info('model has no animation clips');
          return;
        }
        this.mixer = new THREE.AnimationMixer(model);
        // Once, by default: the figure performs after it is placed and then
        // holds its last pose. clampWhenFinished is what holds it - without
        // it a finished action snaps the figure back to its bind pose.
        var loop = !!S.loopClip;
        model.animations.forEach(function (clip) {
          var action = this.mixer.clipAction(clip);
          if (!loop) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          }
          action.play();
        }, this);
        log.ok('playing ' + model.animations.length + ' animation clip(s) ' +
               (loop ? 'on a loop' : 'once, then holding the last pose'));
      },
      tick: function (time, delta) {
        if (this.mixer) this.mixer.update(delta / 1000);
      },
      remove: function () {
        if (this.mixer) this.mixer.stopAllAction();
      },
    });
  }

  // ---------------------------------------------------------------- AR lifecycle
  function startAR() {
    if (S.started) return;
    S.started = true;
    S.tStart = performance.now();
    // One history entry for the camera, so the phone's Back button closes
    // things in here instead of leaving the site (js/shell.js owns history).
    if (window.ARShell && window.ARShell.enteredAr) window.ARShell.enteredAr();

    hide(el.errorBanner);
    hide(el.shell);
    hide(el.langScreen);
    show(el.loadingScreen);
    el.loadingText.textContent = 'Starting camera…';

    primeVideo();
    // Must ride this same click: iOS only grants motion access from a gesture,
    // and the gyro floor engine is useless without it.
    initGyro();

    var system = el.scene.systems['mindar-image-system'];
    if (!system) { showError('MindAR system is missing. Reload the page.', true); return; }

    // Must happen before start(): _startAR binds its resize listener in there.
    patchMindarResize(system);

    // The mindar-image component reads its schema once, in init, so tuning from
    // config.js is applied to the system here instead — start() reads it.
    var t = cfg.tracking;
    if (t.filterMinCF !== -1) system.filterMinCF = t.filterMinCF;
    if (t.filterBeta !== -1) system.filterBeta = t.filterBeta;
    if (t.missTolerance !== -1) system.missTolerance = t.missTolerance;
    if (t.warmupTolerance !== -1) system.warmupTolerance = t.warmupTolerance;

    // The scene attribute is only a placeholder. The real tracker comes from the
    // content bundle, and can be a blob: URL when previewing the portal's draft.
    // start() reads this property directly, so setting it here is enough.
    if (bundle && bundle.mindSrc) system.imageTargetSrc = bundle.mindSrc;

    var shown = function (v) { return v === null || v === undefined ? 'library default' : v; };
    log.event('starting AR — mind: ' + shortSrc(system.imageTargetSrc) +
              ', filterMinCF=' + shown(system.filterMinCF) +
              ', filterBeta=' + shown(system.filterBeta) +
              ', missTolerance=' + shown(system.missTolerance) +
              ', warmupTolerance=' + shown(system.warmupTolerance));

    var go = function () {
      if (!S.started) return;          // they left while it downloaded
      try {
        system.start();
      } catch (e) {
        onArError(e);
      }
    };

    // The tracker is the one file AR cannot start without, and at several MB
    // the slowest. If the gallery download has not reached it yet, fetch it
    // now - into the offline cache, so this is the only time - and say how far
    // along it is, rather than spinning in silence.
    if (window.AROffline && bundle && bundle.mindSrc) {
      var mb = function (n) { return (n / 1048576).toFixed(1); };
      window.AROffline.ensure(bundle.mindSrc, function (got, total) {
        el.loadingText.textContent = total
          ? ARI18n.t('loading.tracker', { done: mb(got), total: mb(total) })
          : ARI18n.t('loading.trackerSome', { done: mb(got) });
      }).then(go, function (err) {
        log.warn('the tracker could not be kept offline (' + (err && err.message ? err.message : err) +
                 ') — MindAR will fetch it itself');
        go();
      });
    } else {
      go();
    }

    // MindAR has no timeout of its own; without this the user just watches a
    // spinner forever when something goes wrong after getUserMedia succeeds.
    setTimeout(function () {
      if (!S.arReady) {
        log.warn('arReady has not fired after 20s');
        el.loadingText.textContent = 'Still starting… open the debug log (🐞).';
      }
    }, 20000);
  }

  /**
   * Put the camera down and go back to browsing.
   *
   * MindAR's stop() releases the camera track and removes its video element;
   * start() builds a new one, which is the library's own restart path. The
   * anchors are NOT rebuilt - they were registered before the first start()
   * and survive the stop/start cycle the gyro fallback already puts MindAR
   * through, so a second visit to the viewfinder tracks exactly as the first.
   */
  /**
   * The phone's Back button while the camera is open: close the topmost
   * thing, the way Back closes a sheet in any app. 'layer' when something
   * closed and the camera stays open; 'exit' when the camera itself closed.
   */
  function backInAr() {
    var open = function (node) { return !!node && !node.classList.contains('hidden'); };
    if (open(el.logPanel)) { openLog(false); return 'layer'; }
    if (open(el.photoSheet)) { closePhoto(); return 'layer'; }
    if (open(el.adjustPanel)) { openAdjust(false); return 'layer'; }
    if (S.detailsOpen) { openDetails(false); return 'layer'; }
    if (S.mode === MODE.FLOOR || S.mode === MODE.PLACED) {
      leaveFloorScene();
      log.event('back: left the floor scene');
      return 'layer';
    }
    exitAR();
    return 'exit';
  }

  function exitAR() {
    if (!S.started) return;

    openDetails(false);
    leaveFloorScene();          // no-op unless the floor scene is open
    stopNarration();
    if (el.arVideo) { try { el.arVideo.pause(); } catch (e) {} }

    var system = el.scene.systems['mindar-image-system'];
    if (system) {
      try { system.stop(); }
      catch (e) { log.warn('MindAR stop() threw: ' + e); }
    }

    S.started = false;
    S.arReady = false;
    S.targetFound = false;
    S.mediaReady = false;
    // S.activeIndex and S.loadedVideo are deliberately LEFT ALONE. The <video>
    // element still holds the right file and, on iOS, the playback grant that
    // came with the first tap — throwing either away would make the second
    // visit to the viewfinder worse than the first. It also has to stay
    // consistent with onTargetFound, which reloads only when the exhibit
    // changes: clearing loadedVideo here made confirmPlayback() treat its own
    // watch as stale, so the buttons never came back.

    hide(el.loadingScreen);
    hide(el.errorBanner);
    setMode(MODE.BOOT);
    applyModeUI();
    if (window.ARShell) window.ARShell.refresh();
    log.event('left AR — camera released');
  }

  function onArError(err) {
    var message = String((err && (err.message || err.error)) || err);
    log.error('AR error: ' + message);
    hide(el.loadingScreen);

    var friendly = 'The camera could not be started.';
    if (/NotAllowed|Permission/i.test(message)) {
      friendly = 'Camera permission was denied. Allow camera access in your browser settings, then retry.';
    } else if (/NotFound|DevicesNotFound/i.test(message)) {
      friendly = 'No camera was found on this device.';
    } else if (/NotReadable|TrackStart/i.test(message)) {
      friendly = 'The camera is busy in another app. Close it and retry.';
    } else if (/VIDEO_FAIL/i.test(message)) {
      friendly = 'The camera could not be started — permission denied, camera in use, or the page is not on https.';
    }
    showError(friendly, true);
    S.started = false;
  }

  function onTargetFound(index) {
    if (S.mode !== MODE.SCAN) return;     // scene 2/3 does not care about the painting

    var ex = exhibits[index];
    if (!ex) {
      log.warn('MindAR found target ' + index + ', which no exhibit claims — the ' +
               'deployed targets.mind and content.json have drifted apart. ' +
               'Re-export from admin.html.');
      return;
    }

    if (S.activeIndex !== index) {
      log.event('exhibit —> "' + ex.name + '" (target ' + index + ')');
      S.activeIndex = index;
      adoptExhibit(ex);
    }
    markFound(ex);

    S.targetFound = true;
    setStatus(exhibits.length > 1 ? ex.name : ARI18n.t('status.tracking'), 'ok');
    applyModeUI();
    playMedia();
    log.event('targetFound: "' + ex.name + '" (+' +
              ((performance.now() - S.tStart) / 1000).toFixed(2) + 's)');
  }

  /*
   * Which paintings this phone has found with the camera - the visit's own
   * passport. Explore stamps their cards and counts them, and the Map marks
   * them. Kept on the phone only; nothing about it is sent anywhere.
   */
  var FOUND_KEY = 'ar-museum-found';

  function foundList() {
    try {
      var list = JSON.parse(localStorage.getItem(FOUND_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function markFound(ex) {
    var list = foundList();
    if (list.indexOf(ex.id) !== -1) return;
    list.push(ex.id);
    try { localStorage.setItem(FOUND_KEY, JSON.stringify(list)); } catch (e) { /* private window */ }
    log.event('discovered "' + ex.name + '" — ' + list.length + ' of ' + exhibits.length + ' found on this phone');
  }

  function onTargetLost(index) {
    if (S.mode !== MODE.SCAN) return;
    if (index !== S.activeIndex) return;  // a target we were not showing anyway

    S.targetFound = false;
    el.arVideo.pause();
    setStatus(ARI18n.t('status.searching'), 'warn');
    applyModeUI();
    log.event('targetLost: "' + (exhibits[index] ? exhibits[index].name : index) + '"' +
              (S.mediaReady
                ? ' (the details stay available — they do not need the artwork)' : ''));
  }

  // ---------------------------------------------------------------- the photo
  /*
   * Scene 3's souvenir. js/capture.js does the compositing; everything here is
   * the button, the flash and what happens to the picture afterwards.
   */
  var lastShot = null;

  /**
   * Dashed "LOGO 1" boxes for slots with no artwork - a layout aid for whoever
   * is setting the strip up, which here means the debug log is on. Visitors
   * see real logos or none, on screen and in their photos.
   */
  function placeholdersWanted() {
    return !!el.logToggle && !el.logToggle.classList.contains('hidden');
  }

  /**
   * Keep --bar-h at the action bar's real height. It wraps to two rows on a
   * narrow phone, and everything that floats above it (the logo preview, the
   * gesture hint, Real size) is placed from this, not from a guess.
   */
  function watchActionBar() {
    var bar = el.actionBar;
    if (!bar) return;
    var set = function () {
      document.documentElement.style.setProperty('--bar-h', (bar.offsetHeight || 0) + 'px');
    };
    set();
    if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
    else window.addEventListener('resize', set);
  }

  /** The logo row over the camera feed, mirroring what the photo will print. */
  function renderBrandBar() {
    var host = el.brandBar;
    var brand = cfg.branding || {};
    if (!host) return;

    host.textContent = '';
    if (brand.showOnScreen === false) return;

    var slot = function (label) {
      var span = document.createElement('span');
      span.className = 'brand-slot';
      span.textContent = label;
      return span;
    };

    host.classList.toggle('bottom', brand.position !== 'top');
    host.classList.toggle('plate', brand.plate !== false);
    window.ARContent.photoLogos(bundle).forEach(function (entry) {
      var label = entry.label || 'LOGO';
      if (!entry.src) { if (placeholdersWanted()) host.appendChild(slot(label)); return; }
      var img = document.createElement('img');
      img.alt = label;
      // No file there yet: show the same dashed box the photo will draw, so the
      // strip is never a silent gap.
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.replaceChild(slot(label), img);
      });
      img.src = entry.src;
      host.appendChild(img);
    });
  }

  function flash() {
    var f = el.shutterFlash;
    if (!f) return;
    f.classList.remove('fire');
    void f.offsetWidth;            // forces the animation to restart
    f.classList.add('fire');
    // Back to display:none afterwards, so it is never in the way between shots.
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { f.classList.remove('fire'); }, 400);
  }

  /** Whether the share sheet - the only way into the camera roll - is open to us. */
  function canShareFiles() {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      return navigator.canShare({ files: [new File([], 'p.jpg', { type: 'image/jpeg' })] });
    } catch (e) {
      return false;
    }
  }

  function takePhoto() {
    if (!window.ARCapture) { log.error('js/capture.js did not load'); return; }

    el.shotBtn.disabled = true;
    el.shotBtn.classList.add('busy');
    flash();
    log.event('photo: shutter pressed in the ' +
              (S.engine ? S.engine.name : 'no') + ' engine');

    var done = function () {
      el.shotBtn.disabled = false;
      el.shotBtn.classList.remove('busy');
    };

    window.ARCapture.request().then(function (shot) {
      done();
      showPhoto(shot);
    }, function (err) {
      done();
      log.error('photo failed: ' + (err && err.message ? err.message : err));
      showError('The photo could not be taken. Open the log and send it.', false);
    });
  }

  function showPhoto(shot) {
    if (lastShot) URL.revokeObjectURL(lastShot.url);
    lastShot = { blob: shot.blob, url: URL.createObjectURL(shot.blob) };
    el.photoPreview.src = lastShot.url;

    var notes = [];
    if (!shot.hasFeed) {
      notes.push('This device would not hand over the camera picture, so there ' +
                 'is no room behind the figure.');
    }
    if (!shot.hasLayer) notes.push('The figure could not be drawn into this one.');
    if (!notes.length) {
      notes.push(canShareFiles()
        ? 'Save opens the share sheet - pick Photos to put it in your gallery.'
        : 'Save downloads the picture. You can also press and hold it to save it.');
    }
    el.photoHint.textContent = notes.join(' ');
    resetShare();
    show(el.photoSheet);
    // Offered only when the museum has the wall switched on; asked of the
    // museum's live settings, not the release, so turning it off in the
    // Studio takes effect at once.
    if (window.ARCommunity && $('photoShare')) {
      window.ARCommunity.feature('photobooth').then(function (on) {
        if (on && lastShot && !el.photoSheet.classList.contains('hidden')) show($('photoShare'));
      });
    }
  }

  function closePhoto() {
    hide(el.photoSheet);
    el.photoSave.disabled = false;
    el.photoSave.textContent = ARI18n.t('photo.save');
    resetShare();
  }

  // ---------------------------------------------------------------- the photo wall
  /*
   * Sharing is two deliberate steps: "Share to the photo wall", then a box
   * to tick saying yes, it may be shown publicly - and only then does the
   * picture leave the phone. The rules refuse a photo without that consent
   * on record, so it is not just this UI that insists.
   */
  var lastShared = null;

  function resetShare() {
    hide($('photoShare'));
    hide($('photoConsent'));
    hide($('photoShared'));
    var agree = $('photoAgree');
    if (agree) agree.checked = false;
    var send = $('photoSend');
    if (send) { send.disabled = true; send.textContent = ARI18n.t('photo.send'); }
  }

  function shareText(status) {
    var wall = window.ARCommunity.wallUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
    return ARI18n.t(status === 'approved' ? 'photo.sharedLive' : 'photo.sharedPending', { wall: wall });
  }

  function sharePhoto() {
    if (!lastShot || !window.ARCommunity) return;
    var send = $('photoSend');
    send.disabled = true;
    send.textContent = ARI18n.t('photo.sending');
    var ex = EX();
    var detail = ex ? window.ARContent.detailsFor(ex, ARI18n.code(), bundle && bundle.languages) : null;
    window.ARCommunity.sharePhoto(lastShot.blob, {
      consent: !!$('photoAgree').checked,
      name: $('photoName').value,
      exhibitId: ex ? ex.id : null,
      exhibitName: detail && detail.detail.title ? detail.detail.title : (ex ? ex.name : null),
      lang: ARI18n.code(),
    }).then(function (result) {
      lastShared = result.id;
      hide($('photoConsent'));
      $('photoSharedText').textContent = shareText(result.status);
      show($('photoShared'));
    }, function (err) {
      log.error('photobooth: could not share — ' + (err && err.message ? err.message : err));
      send.disabled = false;
      send.textContent = ARI18n.t('photo.send');
      el.photoHint.textContent = ARI18n.t('photo.shareFailed');
    });
  }

  function unsharePhoto() {
    if (!lastShared) return;
    var btn = $('photoUnshare');
    btn.disabled = true;
    window.ARCommunity.removePhoto(lastShared).then(function () {
      $('photoSharedText').textContent = ARI18n.t('photo.unshared');
      hide(btn);
      lastShared = null;
    }, function (err) {
      btn.disabled = false;
      log.error('photobooth: could not remove — ' + (err && err.message ? err.message : err));
    });
  }

  function wireShare() {
    on($('photoShare'), 'click', function () {
      hide($('photoShare'));
      show($('photoConsent'));
    });
    on($('photoAgree'), 'change', function () { $('photoSend').disabled = !$('photoAgree').checked; });
    on($('photoSend'), 'click', sharePhoto);
    on($('photoCancel'), 'click', function () { resetShare(); show($('photoShare')); });
    on($('photoUnshare'), 'click', unsharePhoto);
  }

  function savePhoto() {
    if (!lastShot) return;
    el.photoSave.disabled = true;
    window.ARCapture.save(lastShot.blob).then(function (how) {
      el.photoSave.disabled = false;
      if (how === 'cancelled') return;
      if (how === 'downloaded') {
        el.photoSave.textContent = 'Saved';
        el.photoHint.textContent = 'Saved to this device. Android files it under ' +
                                   'Downloads, which your gallery picks up.';
        return;
      }
      closePhoto();
    }, function (err) {
      el.photoSave.disabled = false;
      log.error('saving the photo failed: ' + err);
      el.photoHint.textContent = 'That could not be saved. Press and hold the ' +
                                 'picture instead.';
    });
  }

  // ---------------------------------------------------------------- language
  /*
   * Which language the visitor reads. Asked once, before the start screen,
   * because every word after that point depends on the answer — and asked at
   * all because a museum cannot know who walked in.
   *
   * Two separate things move when it changes: the INTERFACE (js/i18n.js) and
   * the EXHIBIT TEXT (written per language in the portal). The first is always
   * available; the second may not be, and the sheet says so rather than
   * pretending.
   */
  function renderLanguages() {
    var host = el.langList;
    if (!host) return;

    host.textContent = '';
    ARI18n.languages().forEach(function (lang) {
      var native = lang.native || lang.name;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-option' + (lang.code === ARI18n.code() ? ' on' : '');
      // Marked up in its own language, so the browser picks the right font and
      // a screen reader the right voice.
      button.setAttribute('lang', lang.code);

      var names = document.createElement('span');
      var nativeEl = document.createElement('span');
      nativeEl.className = 'native';
      nativeEl.textContent = native;
      names.appendChild(nativeEl);
      // The English name only when it says something the native one does not.
      if (native !== lang.name) {
        var latin = document.createElement('span');
        latin.className = 'latin';
        latin.textContent = lang.name;
        names.appendChild(document.createElement('br'));
        names.appendChild(latin);
      }
      button.appendChild(names);

      var tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = '✓';
      button.appendChild(tick);

      button.addEventListener('click', function () { ARI18n.set(lang.code, true); });
      host.appendChild(button);
    });
  }

  function openLanguagePicker(open) {
    S.langOpen = !!open;
    if (open) renderLanguages();
    applyModeUI();
  }

  /**
   * Everything that has to be redrawn when the language changes.
   *
   * ARI18n.apply() has already refilled every element carrying a key; this is
   * for the text the app builds itself, which no attribute can reach.
   */
  function refreshChrome() {
    renderLanguages();
    if (window.ARShell) window.ARShell.refresh();
    if (S.detailsOpen) renderDetails();
    log.info('language: ' + ARI18n.code() +
             (ARI18n.translated(ARI18n.code()) ? '' :
              ' (the interface has no translation for this one — showing English ' +
              'around the museum’s own words)'));
  }

  /** A deployment with no exhibits in it. Not an error — just nothing to scan. */
  function showEmptyGallery() {
    S.empty = true;
    log.warn('this deployment has no exhibits — add them in admin.html, compile ' +
             'the targets and export the bundle');
  }

  // ---------------------------------------------------------------- details
  /*
   * The label: what the museum wrote about this exhibit, and the recording of
   * it. A bottom sheet rather than a page, so the artwork stays visible above
   * it — reading it here rather than at home is the entire point.
   *
   * The body is authored HTML. It is sanitised in the portal on the way in AND
   * again here on the way out, because content.json is a file in a repo and
   * the second pass is the one that cannot be skipped by hand-editing it.
   */
  function detailsOf(exhibit) {
    var ex = exhibit || EX();
    if (!ex) return null;
    return window.ARContent.detailsFor(ex, ARI18n.code(), bundle && bundle.languages);
  }

  function openDetails(open) {
    var wanted = !!open && !!EX();
    if (wanted === S.detailsOpen) return;
    S.detailsOpen = wanted;

    toggle(el.detailsSheet, wanted);
    if (el.detailsSheet) el.detailsSheet.setAttribute('aria-hidden', wanted ? 'false' : 'true');

    if (wanted) renderDetails();
    else stopNarration();

    // The video is behind the sheet and unwatchable there, and its sound would
    // fight the narration. A still has nothing to pause.
    if ((cfg.details || {}).pauseMediaWhileOpen !== false && S.mediaKind === 'video') {
      if (wanted) el.arVideo.pause();
      else if (S.mode === MODE.SCAN && S.targetFound) playMedia();
    }

    applyModeUI();
    log.event('details ' + (wanted ? 'opened' : 'closed') +
              (wanted ? ' for "' + EX().name + '" in ' + ARI18n.code() : ''));
  }

  function maybeAutoOpenDetails() {
    if (!(cfg.details || {}).autoOpen) return;
    var picked = detailsOf();
    if (picked && window.ARContent.hasDetail(picked.detail)) openDetails(true);
  }

  function renderDetails() {
    var ex = EX();
    var picked = detailsOf(ex);
    if (!ex || !picked || !el.detailsBody) return;
    var detail = picked.detail;

    el.detailsTitle.textContent = detail.title || ex.name;
    el.detailsTitle.setAttribute('lang', picked.code);

    renderDetailLangs(ex, picked.code);

    // Say which language this actually is whenever it is not the one asked
    // for. Silently showing English would read as a bug in the translation.
    if (picked.fellBack) {
      el.detailsFallback.textContent = ARI18n.t('details.fallback', {
        language: ARI18n.nameOf(picked.code),
        wanted: ARI18n.nameOf(ARI18n.code()),
      });
      show(el.detailsFallback);
    } else {
      hide(el.detailsFallback);
    }

    var html = window.ARContent.sanitizeRichText(detail.html);
    el.detailsBody.textContent = '';
    if (html) {
      el.detailsBody.innerHTML = html;
    } else {
      var note = document.createElement('p');
      note.className = 'empty-note';
      note.textContent = ARI18n.t('details.empty');
      el.detailsBody.appendChild(note);
    }
    el.detailsBody.setAttribute('lang', picked.code);
    el.detailsBody.scrollTop = 0;

    setNarration(detail.audio && detail.audio.src, picked.code);
  }

  /**
   * The language chips inside the sheet.
   *
   * Only languages this exhibit is actually written in, so a chip can never
   * lead to an empty sheet, and only when there is more than one — a single
   * chip is a label pretending to be a control.
   */
  function renderDetailLangs(ex, activeCode) {
    var host = el.detailsLangs;
    if (!host) return;
    host.textContent = '';

    var written = (bundle ? bundle.languages : []).filter(function (l) {
      return window.ARContent.hasDetail(ex.details[l.code]);
    });
    if (written.length < 2) return;

    written.forEach(function (l) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'details-lang' + (l.code === activeCode ? ' on' : '');
      chip.setAttribute('lang', l.code);
      chip.textContent = l.native || l.name;
      // Switching here switches the whole app, not just this sheet: someone who
      // reaches for Tamil once wants Tamil at the next artwork too.
      chip.addEventListener('click', function () { ARI18n.set(l.code, true); });
      host.appendChild(chip);
    });
  }

  // ---------------------------------------------------- the spoken label
  /**
   * Narration is an uploaded recording or nothing at all.
   *
   * Deliberately not the browser's speech synthesis: on the phones this gallery
   * will actually meet, Sinhala and Tamil voices are missing or poor, so a
   * Listen button backed by speech synthesis would work in English and fail in
   * exactly the two languages it was added for. A silent exhibit is honest; a
   * button that reads nothing aloud is not.
   */
  function setNarration(src, code) {
    var has = !!src;
    if (el.detailsFoot) el.detailsFoot.classList.toggle('has-audio', has);
    toggle(el.detailsPlay, has);
    toggle(el.detailsProgress, has);

    var a = el.detailsAudio;
    if (!a) return;
    if (!has) { stopNarration(); a.removeAttribute('src'); return; }

    if (a.getAttribute('src') !== src) {
      stopNarration();
      a.setAttribute('src', src);
      a.setAttribute('lang', code || ARI18n.code());
      a.load();
    }
    narrationUI();
  }

  function toggleNarration() {
    var a = el.detailsAudio;
    if (!a || !a.getAttribute('src')) return;

    if (a.paused) {
      var p = a.play();
      if (p && p.catch) {
        p.catch(function (err) {
          log.error('narration play() rejected: ' + err);
          adjustNoteSafe('The recording could not be played.');
        });
      }
      log.event('narration: playing ' + shortSrc(a.getAttribute('src')));
    } else {
      a.pause();
    }
    narrationUI();
  }

  function stopNarration() {
    var a = el.detailsAudio;
    if (!a) return;
    if (!a.paused) a.pause();
    a.currentTime = 0;
    narrationUI();
  }

  function narrationUI() {
    var a = el.detailsAudio;
    if (!a || !el.detailsPlayLabel) return;

    var playing = !a.paused && !a.ended;
    var finished = a.ended || (a.duration && a.currentTime >= a.duration - 0.05);
    el.detailsPlayLabel.textContent =
      ARI18n.t(playing ? 'details.pause' : (finished ? 'details.replay' : 'details.listen'));

    var icon = el.detailsPlay && el.detailsPlay.querySelector('.btn-icon');
    if (icon) icon.textContent = playing ? '⏸' : '▶';

    if (el.detailsProgressFill) {
      var fraction = (a.duration && isFinite(a.duration)) ? (a.currentTime / a.duration) : 0;
      el.detailsProgressFill.style.width = (Math.max(0, Math.min(1, fraction)) * 100).toFixed(1) + '%';
    }
  }

  /** The adjust panel's note line, when it happens to be on screen. */
  function adjustNoteSafe(text) {
    if (el.adjustPanel && !el.adjustPanel.classList.contains('hidden')) adjustNote(text, 'err');
  }

  function wireDetails() {
    on(el.detailsBtn, 'click', function () { openDetails(true); });
    on(el.detailsClose, 'click', function () { openDetails(false); });

    // Tapping the dimmed area above the card closes it, the way every other
    // bottom sheet on a phone behaves.
    on(el.detailsSheet, 'click', function (e) {
      if (e.target === el.detailsSheet) openDetails(false);
    });

    on(el.detailsPlay, 'click', toggleNarration);
    on(el.detailsAudio, 'timeupdate', narrationUI);
    on(el.detailsAudio, 'play', narrationUI);
    on(el.detailsAudio, 'pause', narrationUI);
    on(el.detailsAudio, 'ended', narrationUI);
    on(el.detailsAudio, 'error', function () {
      var a = el.detailsAudio;
      var e = a.error || {};
      log.error('narration failed to load: code=' + e.code + ' src=' + shortSrc(a.currentSrc));
      setNarration(null);
    });
  }

  // ---------------------------------------------------------------- adjust panel
  /*
   * Tuning the exhibit in front of the real thing, then keeping it.
   *
   * The debug log is the wrong place for this: it is a wall of text covering
   * the figure you are trying to look at. So this is its own sheet, half the
   * screen at most, with no log in it - the log carries on recording exactly as
   * before, this simply does not show it.
   *
   * Every control is declared once, in adjustSpec(). A row knows how to read
   * and write the live state, what its limits are and how to print itself; the
   * DOM is generated from that, so adding a control is one entry and nothing
   * else.
   *
   * Save writes back into the admin portal's draft, which is what Export turns
   * into assets/content/content.json - so an adjustment made while standing in
   * the gallery survives into the repo.
   */
  var ADJUST = null;          // built on first open
  var adjustTab = 'transform';

  function metresOf(v) { return (Math.round(v * 1000) / 1000) + 'm'; }
  function degreesOf(v) { return Math.round(v) + '\u00b0'; }
  function timesOf(v) { return '\u00d7' + v.toFixed(2); }

  function adjustSpec() {
    return [
      {
        id: 'transform',
        label: 'Transform',
        hint: 'Size multiplies the exhibit\u2019s real height. Move is in metres ' +
              'from where you put it down, in the direction you were facing: ' +
              'X to your right, Y up, Z towards you.',
        rows: [
          { label: 'Size', min: 0.1, max: 5, step: 0.01,
            get: function () { return S.modelScale; },
            set: function (v) { S.modelScale = v; },
            print: function (v) {
              return timesOf(v) + ' \u00b7 ' +
                     (modelCfg().heightMeters * v).toFixed(2) + 'm';
            } },

          { label: 'Rotate X', min: -180, max: 180, step: 1, wrap: true,
            get: function () { return S.modelRot.x; },
            set: function (v) { S.modelRot.x = v; }, print: degreesOf },
          { label: 'Rotate Y', min: -180, max: 180, step: 1, wrap: true,
            get: function () { return S.modelRot.y; },
            set: function (v) { S.modelRot.y = v; }, print: degreesOf },
          { label: 'Rotate Z', min: -180, max: 180, step: 1, wrap: true,
            get: function () { return S.modelRot.z; },
            set: function (v) { S.modelRot.z = v; }, print: degreesOf },

          { label: 'Move X', min: -2, max: 2, step: 0.01,
            get: function () { return S.modelOffset.x; },
            set: function (v) { S.modelOffset.x = v; }, print: metresOf },
          { label: 'Move Y', min: -1, max: 2, step: 0.01,
            get: function () { return S.modelOffset.y; },
            set: function (v) { S.modelOffset.y = v; }, print: metresOf },
          { label: 'Move Z', min: -2, max: 2, step: 0.01,
            get: function () { return S.modelOffset.z; },
            set: function (v) { S.modelOffset.z = v; }, print: metresOf },
        ],
      },
      {
        id: 'effects',
        label: 'Effects',
        hint: 'Leave shading on Baked for a scan, or anything with its lighting ' +
              'already in the texture. Set the shadow to 0 when the model ' +
              'carries its own.',
        rows: [
          { label: 'Shading', choice: [['baked', 'Baked'], ['lit', 'Lit']],
            get: function () { return S.lighting; },
            set: function (v) { S.lighting = v; } },
          { label: 'Spin', choice: [[false, 'Off'], [true, 'On']],
            get: function () { return !!S.spin; },
            set: function (v) { S.spin = v; }, rebuild: true },
          { label: 'Animation', choice: [['once', 'Once'], ['loop', 'Loop'], ['hold', 'Hold']],
            get: function () { return S.playClip === false ? 'hold' : (S.loopClip ? 'loop' : 'once'); },
            set: function (v) { S.playClip = v !== 'hold'; S.loopClip = v === 'loop'; }, rebuild: true },
        ],
      },
      {
        id: 'shadow',
        label: 'Shadow',
        hint: 'One circle, sized from the figure, until you add your own. Then ' +
              'build the shape up out of ellipses: one for the body, one per ' +
              'foot, a long thin one under an outstretched arm. Follow ties ' +
              'them to the figure, so resizing or turning it takes the whole ' +
              'shadow with it.',
        rows: [
          { label: 'Strength', min: 0, max: 1, step: 0.05,
            get: function () { return S.shadowOpacity; },
            set: function (v) { S.shadowOpacity = v; },
            print: function (v) { return v <= 0 ? 'off' : v.toFixed(2); } },
          { label: 'Follow', choice: [[false, 'Off'], [true, 'Object']],
            get: function () { return !!S.shadowFollow; },
            set: function (v) {
              // Remember the size the ellipses are at right now, so switching
              // this on changes nothing until the Size slider moves.
              if (v && !S.shadowFollow) S.shadowScale = S.modelScale;
              S.shadowFollow = !!v;
            }, shadow: true },
        ],
        list: {
          items: function () { return S.shadows; },
          add: function () {
            // The first one matches what was already on the floor, so nothing
            // jumps the moment you take control of it.
            if (!S.shadows.length) {
              S.shadows.push(autoShadowBlob());
              S.shadowScale = S.modelScale;      // the size it was drawn at
              return;
            }
            // Colour and opacity carry over, so a shadow set once stays of a
            // piece however many ellipses it ends up being made of.
            var last = S.shadows[S.shadows.length - 1];
            S.shadows.push({ s: 'ellipse', x: last.x + 0.15, z: last.z, w: last.w * 0.6,
                             d: last.d * 0.6, r: last.r, o: last.o, c: last.c, f: 1 });
          },
          remove: function (i) { S.shadows.splice(i, 1); },
          rows: [
            { label: 'X', key: 'x', min: -1.5, max: 1.5, step: 0.01, print: metresOf },
            { label: 'Z', key: 'z', min: -1.5, max: 1.5, step: 0.01, print: metresOf },
            { label: 'Width', key: 'w', min: 0.02, max: 4, step: 0.01, print: metresOf },
            { label: 'Depth', key: 'd', min: 0.02, max: 4, step: 0.01, print: metresOf },
            { label: 'Turn', key: 'r', min: -180, max: 180, step: 1, wrap: true,
              print: degreesOf },
            { label: 'Softness', key: 'f', min: 0, max: 1, step: 0.05, notFor: 'image',
              print: function (v) { return v.toFixed(2); } },
            { label: 'Opacity', key: 'o', min: 0, max: 1, step: 0.05,
              print: function (v) { return v <= 0 ? 'off' : v.toFixed(2); } },
            { label: 'Colour', key: 'c', swatch: SHADOW_COLOURS },
          ],
        },
      },
      {
        id: 'media',
        label: 'Media',
        hint: 'How the video or still sits on the artwork in scene 1. Nudge is in ' +
              'target units, where 1 is the full width of the artwork.',
        rows: [
          { label: 'Fit', choice: [['stretch', 'Stretch'], ['cover', 'Cover'],
                                   ['contain', 'Contain']],
            get: function () { return S.fit; },
            set: function (v) { S.fit = v; }, video: true },
          { label: 'Size', min: 0.5, max: 2, step: 0.01,
            get: function () { return S.videoScale; },
            set: function (v) { S.videoScale = v; }, video: true, print: timesOf },
          { label: 'Nudge X', min: -0.5, max: 0.5, step: 0.01,
            get: function () { return S.videoOffset.x; },
            set: function (v) { S.videoOffset.x = v; }, video: true,
            print: function (v) { return v.toFixed(2); } },
          { label: 'Nudge Y', min: -0.5, max: 0.5, step: 0.01,
            get: function () { return S.videoOffset.y; },
            set: function (v) { S.videoOffset.y = v; }, video: true,
            print: function (v) { return v.toFixed(2); } },
        ],
      },
    ];
  }

  /** Push a row's new value into the scene, as cheaply as that row allows. */
  function applyRow(row) {
    if (row.video) { applyMediaFit(); return; }
    if (row.shadow) { updateFloorShadow(); return; }
    if (row.rebuild) { rebuildFigure(); return; }
    refreshFigure();
  }

  /** Spin and clip playback are decided when the figure is built, so rebuild. */
  function rebuildFigure() {
    if (S.mode !== MODE.PLACED) return;
    var inner = $('modelTransform');
    if (inner && inner.parentNode) inner.parentNode.removeChild(inner);
    buildFigure();
    applyFigureTransform();
    updateFloorShadow();
  }

  /** Round to the row's own step, so repeated clicks never drift to 1e-16. */
  function roundToStep(value, step) {
    var places = (String(step).split('.')[1] || '').length;
    return parseFloat(value.toFixed(places));
  }

  function buildAdjustRow(row) {
    var node = document.createElement('div');
    node.className = 'adj-row' + (row.choice || row.swatch ? ' wide' : '');

    var label = document.createElement('label');
    label.textContent = row.label;
    node.appendChild(label);

    if (row.choice) {
      var group = document.createElement('div');
      group.className = 'adj-choice';
      row.buttons = row.choice.map(function (pair) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = pair[1];
        b.addEventListener('click', function () {
          row.set(pair[0]);
          applyRow(row);
          syncAdjust();
          markDirty();
        });
        group.appendChild(b);
        return b;
      });
      node.appendChild(group);
      row.node = node;
      return node;
    }

    if (row.swatch) {
      // Swatches rather than <input type="color">: a native colour picker is
      // not guaranteed to open over an immersive WebXR session, and one tap
      // beats a dialog when you are holding a phone up at an exhibit.
      var swatches = document.createElement('div');
      swatches.className = 'adj-swatch';
      row.buttons = row.swatch.map(function (pair) {
        var s = document.createElement('button');
        s.type = 'button';
        s.title = pair[1];
        s.setAttribute('aria-label', pair[1]);
        s.style.background = pair[0];
        s.addEventListener('click', function () {
          row.set(pair[0]);
          applyRow(row);
          syncAdjust();
          markDirty();
        });
        swatches.appendChild(s);
        return s;
      });
      node.appendChild(swatches);
      row.node = node;
      return node;
    }

    var nudge = function (dir) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'adj-step';
      b.textContent = dir < 0 ? '\u2212' : '+';
      b.addEventListener('click', function () {
        var next = row.get() + dir * row.step;
        row.set(row.wrap ? wrapDegrees(next)
                         : clamp(roundToStep(next, row.step), row.min, row.max));
        applyRow(row);
        syncAdjust();
        markDirty();
      });
      return b;
    };

    node.appendChild(nudge(-1));

    var range = document.createElement('input');
    range.type = 'range';
    range.min = row.min;
    range.max = row.max;
    range.step = row.step;
    range.addEventListener('input', function () {
      row.set(parseFloat(range.value));
      applyRow(row);
      row.out.textContent = (row.print || String)(row.get());
      markDirty();
    });
    node.appendChild(range);
    node.appendChild(nudge(1));

    var out = document.createElement('output');
    node.appendChild(out);

    row.range = range;
    row.out = out;
    row.node = node;
    return node;
  }

  /**
   * The shadow list, rebuilt only when its length changes.
   *
   * Regenerating on every sync would replace the very button being tapped, so
   * values are updated in place and the DOM is only thrown away when an
   * ellipse is added or removed.
   */
  var shadowRendered = -1;

  function renderShadowList(tab) {
    var host = tab.listEl;
    host.textContent = '';
    tab.listRows = [];

    var blobs = tab.list.items();
    blobs.forEach(function (blob, index) {
      var head = document.createElement('div');
      head.className = 'adj-group';

      var title = document.createElement('span');
      title.textContent = ({ rect: 'Rectangle', image: 'Picture' }[blob.s] || 'Ellipse') + ' ' + (index + 1);
      head.appendChild(title);

      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'adj-drop';
      drop.textContent = 'Remove';
      drop.addEventListener('click', function () {
        tab.list.remove(index);
        updateFloorShadow();
        shadowRendered = -1;
        renderShadowList(tab);
        syncAdjust();
        markDirty();
      });
      head.appendChild(drop);
      host.appendChild(head);

      tab.list.rows.forEach(function (spec) {
        if (spec.notFor && spec.notFor === blob.s) return;
        var row = {
          label: spec.label,
          min: spec.min, max: spec.max, step: spec.step, wrap: spec.wrap,
          swatch: spec.swatch,
          print: spec.print,
          get: function () { return blob[spec.key]; },
          set: function (v) { blob[spec.key] = v; },
          shadow: true,
        };
        host.appendChild(buildAdjustRow(row));
        tab.listRows.push(row);
      });
    });

    if (!blobs.length) {
      var note = document.createElement('p');
      note.className = 'adj-hint';
      note.textContent = 'No ellipses of your own yet, so one circle is being ' +
                         'sized from the figure. Add one to take over.';
      host.appendChild(note);
    }

    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-sm adj-add';
    add.textContent = '+ Add ellipse';
    add.addEventListener('click', function () {
      tab.list.add();
      updateFloorShadow();
      shadowRendered = -1;
      renderShadowList(tab);
      syncAdjust();
      markDirty();
    });
    host.appendChild(add);

    shadowRendered = blobs.length;
  }

  function buildAdjust() {
    if (ADJUST) return;
    ADJUST = adjustSpec();

    el.adjustTabs.textContent = '';
    el.adjustBody.textContent = '';

    ADJUST.forEach(function (tab) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'adjust-tab';
      button.textContent = tab.label;
      button.addEventListener('click', function () { showAdjustTab(tab.id); });
      tab.tabEl = button;
      el.adjustTabs.appendChild(button);

      var page = document.createElement('div');
      page.className = 'adjust-page hidden';
      tab.rows.forEach(function (row) { page.appendChild(buildAdjustRow(row)); });
      if (tab.list) {
        tab.listEl = document.createElement('div');
        tab.listEl.className = 'adj-list';
        page.appendChild(tab.listEl);
        renderShadowList(tab);
      }
      if (tab.hint) {
        var hint = document.createElement('p');
        hint.className = 'adj-hint';
        hint.textContent = tab.hint;
        page.appendChild(hint);
      }
      tab.pageEl = page;
      el.adjustBody.appendChild(page);
    });
  }

  function showAdjustTab(id) {
    adjustTab = id;
    ADJUST.forEach(function (tab) {
      tab.tabEl.classList.toggle('on', tab.id === id);
      tab.pageEl.classList.toggle('hidden', tab.id !== id);
    });
    el.adjustBody.scrollTop = 0;
  }

  /** Redraw every control from the live state. Cheap, so call it freely. */
  function syncAdjust() {
    if (!ADJUST || el.adjustPanel.classList.contains('hidden')) return;
    ADJUST.forEach(function (tab) {
      if (tab.list && tab.list.items().length !== shadowRendered) renderShadowList(tab);
      tab.rows.concat(tab.listRows || []).forEach(function (row) {
        var value = row.get();
        if (row.swatch) {
          row.buttons.forEach(function (b, i) {
            b.classList.toggle('on', row.swatch[i][0] === value);
          });
          return;
        }
        if (row.choice) {
          row.buttons.forEach(function (b, i) {
            b.classList.toggle('on', row.choice[i][0] === value);
          });
          return;
        }
        row.range.value = value;
        row.out.textContent = (row.print || String)(value);
      });
    });
  }

  function adjustNote(text, kind) {
    el.adjustNote.textContent = text || '';
    el.adjustNote.className = 'adjust-note' + (kind ? ' ' + kind : '');
  }

  /** A change makes the last "saved" message stale, so clear it. */
  function markDirty() {
    if (el.adjustNote.classList.contains('ok')) adjustNote('');
  }

  function openAdjust(open) {
    if (open) {
      buildAdjust();
      var ex = EX();
      el.adjustWho.textContent = ex ? ex.name : '';
      showAdjustTab(S.mode === MODE.SCAN ? 'video' : adjustTab);
      el.adjustPanel.classList.remove('hidden');
      el.adjustPanel.setAttribute('aria-hidden', 'false');
      el.adjustToggle.classList.add('on');
      hide(el.actionBar);              // it sits under the sheet anyway
      adjustNote('');
      syncAdjust();
    } else {
      el.adjustPanel.classList.add('hidden');
      el.adjustPanel.setAttribute('aria-hidden', 'true');
      el.adjustToggle.classList.remove('on');
      applyModeUI();
    }
  }

  /** Exactly what Save writes, and what Copy puts on the clipboard. */
  function adjustPatch() {
    return {
      model: {
        scale: roundToStep(S.modelScale, 0.01),
        rotation: { x: S.modelRot.x, y: S.modelRot.y, z: S.modelRot.z },
        offset: {
          x: roundToStep(S.modelOffset.x, 0.01),
          y: roundToStep(S.modelOffset.y, 0.01),
          z: roundToStep(S.modelOffset.z, 0.01),
        },
        // Set in the Studio's floor editor, and carried through untouched so
        // a save from the phone never moves it.
        anchor: { x: S.modelAnchor.x, y: S.modelAnchor.y, z: S.modelAnchor.z },
        lighting: S.lighting,
        shadowOpacity: roundToStep(S.shadowOpacity, 0.01),
        shadowFollow: !!S.shadowFollow,
        shadowScale: roundToStep(S.shadowScale, 0.01),
        shadows: S.shadows.map(function (b) {
          var out = {
            s: b.s || 'ellipse',
            x: roundToStep(b.x, 0.01), z: roundToStep(b.z, 0.01),
            w: roundToStep(b.w, 0.01), d: roundToStep(b.d, 0.01),
            r: roundToStep(b.r, 1),
            o: roundToStep(typeof b.o === 'number' ? b.o : 1, 0.01),
            c: b.c || '#000000',
          };
          // A picture drawn in the Studio rides through a save from the phone.
          if (out.s === 'image') { out.src = b.src; out.n = b.n || ''; }
          else out.f = roundToStep(window.ARShadows.featherOf(b), 0.01);
          return out;
        }),
        spin: !!S.spin,
        playClip: S.playClip !== false,
        loopClip: !!S.loopClip,
      },
      media: {
        fit: S.fit,
        scale: roundToStep(S.videoScale, 0.01),
        offset: {
          x: roundToStep(S.videoOffset.x, 0.01),
          y: roundToStep(S.videoOffset.y, 0.01),
          z: S.videoOffset.z,
        },
      },
    };
  }

  /** One level deep, which is all these patches ever are. */
  function assignInto(target, source) {
    if (!target) return;
    Object.keys(source).forEach(function (k) {
      var v = source[k];
      if (Array.isArray(v)) { target[k] = v.slice(); return; }
      if (v && typeof v === 'object') {
        target[k] = target[k] || {};
        Object.keys(v).forEach(function (j) { target[k][j] = v[j]; });
      } else {
        target[k] = v;
      }
    });
  }

  function saveAdjust() {
    var ex = EX();
    if (!ex) { adjustNote('No exhibit is loaded.', 'bad'); return; }

    var patch = adjustPatch();
    el.adjustSave.disabled = true;

    // Signed in as staff on this phone, with the gallery coming from the
    // cloud: straight into the Studio's draft of this exhibit.
    var community = window.ARCommunity;
    if (community && community.staff.state().canEdit && bundle && bundle.source === 'cloud') {
      community.staff.saveExhibit(ex.id, patch).then(function () {
        el.adjustSave.disabled = false;
        assignInto(ex.model, patch.model);
        assignInto(ex.media, patch.media);
        adjustNote('Saved to "' + ex.name + '" in the Studio. Putting it live…', 'ok');
        log.ok('adjust: saved "' + ex.name + '" to the Studio draft as ' + community.staff.state().email +
               ' — ' + JSON.stringify(patch.model));
        community.staff.publishSoon(ex.name + ' (Adjust on a phone)').then(function (r) {
          if (r.release) {
            adjustNote('Saved and live: visitors get it the next time they open the guide.', 'ok');
            log.ok('adjust: live as ' + r.release);
          } else {
            adjustNote('Saved to "' + ex.name + '" in the Studio. ' + r.why, 'ok');
            log.info('adjust: not put live — ' + r.why);
          }
        }, function (err) {
          adjustNote('Saved, but it could not go live: ' + ((err && err.message) || err), 'bad');
          log.warn('adjust: could not go live — ' + err);
        });
      }, function (err) {
        el.adjustSave.disabled = false;
        adjustNote(String((err && err.message) || err), 'bad');
        log.warn('adjust: could not save to the Studio — ' + err);
      });
      return;
    }

    // The gallery comes from the cloud but nobody is signed in as staff: the
    // old portal draft below lives only in this browser and nothing reads it
    // any more, so saving there would look like it worked and change nothing.
    if (bundle && bundle.source === 'cloud') {
      el.adjustSave.disabled = false;
      adjustNote('Not saved: sign in as staff (Settings > Staff) to save this to the Studio, ' +
                 'or use Copy to keep the numbers.', 'bad');
      log.warn('adjust: not saved — the gallery is from the cloud and this phone is not signed in as staff');
      return;
    }

    window.ARContent.saveExhibitSettings(ex.id, patch).then(function (name) {
      el.adjustSave.disabled = false;
      // Keep the running copy in step, so leaving and re-entering the floor
      // scene does not snap back to the old numbers.
      assignInto(ex.model, patch.model);
      assignInto(ex.media, patch.media);
      adjustNote('Saved to "' + name + '" in the portal draft. Open admin.html ' +
                 'and press Export to get it into the repo.', 'ok');
      log.ok('adjust: saved "' + name + '" into the portal draft \u2014 ' +
             JSON.stringify(patch.model));
    }, function (err) {
      el.adjustSave.disabled = false;
      adjustNote(String((err && err.message) || err), 'bad');
      log.warn('adjust: could not save \u2014 ' + err);
    });
  }

  function copyAdjust() {
    var ex = EX();
    var payload = JSON.stringify({
      exhibit: ex ? ex.id : null,
      name: ex ? ex.name : null,
      settings: adjustPatch(),
    }, null, 2);

    var done = function (ok) {
      adjustNote(ok
        ? 'Copied. Paste it into the portal with "Paste adjustments".'
        : 'Copy was blocked \u2014 the values are in the log instead.',
        ok ? 'ok' : 'bad');
      if (!ok) log.info('adjust: settings for pasting into admin.html:\n' + payload);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload)
        .then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  function resetAdjust() {
    var ex = EX();
    if (!ex) return;
    adoptExhibit(ex);
    if (S.mode === MODE.PLACED) rebuildFigure(); else refreshFigure();
    updateFloorShadow();
    shadowRendered = -1;
    syncAdjust();
    adjustNote('Back to this exhibit\u2019s saved values.');
  }

  function wireAdjust() {
    el.adjustToggle.addEventListener('click', function () {
      openAdjust(el.adjustPanel.classList.contains('hidden'));
    });
    el.adjustClose.addEventListener('click', function () { openAdjust(false); });
    el.adjustSave.addEventListener('click', saveAdjust);
    el.adjustCopy.addEventListener('click', copyAdjust);
    el.adjustReset.addEventListener('click', resetAdjust);
  }

  // ---------------------------------------------------------------- debug tools
  function wireDebugTools() {
    var fitBtn = el.logTools.querySelector('[data-tool="fit"]');
    var modeBtn = el.logTools.querySelector('[data-tool="mode"]');
    fitBtn.textContent = S.fit;
    modeBtn.textContent = S.mode;

    // Baked vs lit, switchable on the device so the difference is visible while
    // standing in front of the figure.
    var lightBtn = el.logTools.querySelector('[data-tool="lighting"]');
    if (lightBtn) {
      lightBtn.textContent = S.lighting;
      lightBtn.addEventListener('click', function () {
        S.lighting = S.lighting === 'baked' ? 'lit' : 'baked';
        lightBtn.textContent = S.lighting;
        refreshFigure();
      });
    }

    fitBtn.addEventListener('click', function () {
      var modes = ['stretch', 'cover', 'contain'];
      S.fit = modes[(modes.indexOf(S.fit) + 1) % modes.length];
      fitBtn.textContent = S.fit;
      applyMediaFit();
    });

    // Jump straight between the scenes without waiting for the real triggers.
    modeBtn.addEventListener('click', function () {
      if (S.mode === MODE.SCAN) enterFloorScene();
      else if (S.mode === MODE.FLOOR) leaveFloorScene();
      else if (S.mode === MODE.PLACED) moveFigure();
      modeBtn.textContent = S.mode;
    });

    Array.prototype.forEach.call(el.logTools.querySelectorAll('[data-nudge]'), function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-nudge').split(':'); // what:axis:direction
        var what = parts[0], axis = parts[1], dir = parseFloat(parts[2]);

        if (what === 'video') {
          if (axis === 's') S.videoScale = Math.max(0.1, S.videoScale + dir * cfg.ui.scaleStep);
          else S.videoOffset[axis] += dir * cfg.ui.nudgeStep;
          applyMediaFit();
        } else if (what === 'floor') {
          S.cameraHeight = clamp(S.cameraHeight + dir * 0.05, 0.4, 2.5);
          stability.reset();
          log.info('gyro engine: phone assumed to be ' + S.cameraHeight.toFixed(2) +
                   'm above the floor');
        } else if (what === 'model') {
          if (axis === 's') S.modelScale = Math.max(0.1, S.modelScale + dir * cfg.ui.scaleStep);
          // Rounded, because repeated 0.05 steps otherwise land on 1e-16 rather
          // than 0 and the shadow never quite switches off.
          else if (axis === 'sh') {
            S.shadowOpacity = clamp(Math.round((S.shadowOpacity + dir * 0.05) * 100) / 100, 0, 1);
          }
          else S.modelRot.y = wrapDegrees(S.modelRot.y + dir * 15);
          refreshFigure();
          syncAdjust();
          log.info('figure: ' + (modelCfg().heightMeters * S.modelScale).toFixed(2) +
                   'm tall (×' + S.modelScale.toFixed(2) + '), turned ' +
                   Math.round(S.modelRot.y) + '°, shadow ' + S.shadowOpacity.toFixed(2));
        }
      });
    });
  }

  /** Print the current tuning so it can be pasted straight into js/config.js. */
  function dumpState() {
    var r = function (n) { return Math.round(n * 1000) / 1000; };
    var v = el.arVideo;
    var engine = S.engine;

    var ex = EX();

    log.info(
      'current values for "' + (ex ? ex.name : '?') + '" — type these into its ' +
      'Settings in admin.html:\n' +
      '  Video fit: ' + S.fit + ', scale ' + r(S.videoScale) +
      ', nudge x ' + r(S.videoOffset.x) + ' y ' + r(S.videoOffset.y) + '\n' +
      '  Figure height: ' + r(modelCfg().heightMeters) + 'm' +
      ', size ×' + r(S.modelScale) +
      ' (= ' + r(modelCfg().heightMeters * S.modelScale) + 'm tall)\n' +
      '  Rotate x ' + r(S.modelRot.x) + '° y ' + r(S.modelRot.y) +
      '° z ' + r(S.modelRot.z) + '°\n' +
      '  Move x ' + r(S.modelOffset.x) + 'm y ' + r(S.modelOffset.y) +
      'm z ' + r(S.modelOffset.z) + 'm\n' +
      '  Shading: ' + S.lighting +
      ', contact shadow ' + r(S.shadowOpacity) +
      ' (' + (S.shadows.length
              ? S.shadows.length + ' shape(s)' +
                (S.shadowFollow ? ', following the figure' : '')
              : 'auto circle') + ')\n' +
      '  Phone height (js/config.js floor.cameraHeightMeters): ' + r(S.cameraHeight) + '\n' +
      '  photo: ' + (window.ARCapture ? window.ARCapture.report() : 'capture.js missing') +
      ' shareFiles=' + canShareFiles() +
      ' logos=' + window.ARContent.photoLogos(bundle).length + '\n' +
      '  content: ' + (bundle ? bundle.source : '?') + ', ' + exhibits.length +
      ' exhibit(s), active ' + S.activeIndex + '\n' +
      '  scene: ' + S.mode +
      ' engine=' + (engine ? engine.name : 'none') +
      ' xrSupported=' + S.xrSupported +
      ' gyro=' + gyro.active +
      ' floorFound=' + S.floorFound + ' floorStable=' + S.floorStable + '\n' +
      '  scene 1: arReady=' + S.arReady + ' targetFound=' + S.targetFound +
      ' mediaReady=' + S.mediaReady + ' mediaKind=' + S.mediaKind +
      ' videoTime=' + v.currentTime.toFixed(2) + '/' +
      (isFinite(v.duration) ? v.duration.toFixed(2) : '?') + 's'
    );
  }

  // ---------------------------------------------------------------- wiring
  function wireVideoElement() {
    var v = el.arVideo;
    v.muted = true; // required for autoplay on both platforms
    v.setAttribute('playsinline', '');
    // The src is set per exhibit by loadExhibitMedia(); adoptExhibit() has
    // already pointed this at the first one.

    ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'waiting',
     'stalled', 'ended', 'error', 'suspend'].forEach(function (name) {
      v.addEventListener(name, function () {
        if (name === 'error') {
          var e = v.error || {};
          log.error('video element error for "' + (EX() ? EX().name : '?') + '": code=' +
                    e.code + ' ' + (e.message || '') + ' src=' + shortSrc(v.currentSrc));
          showError('The video file could not be loaded. Check the log for details.', true);
          return;
        }
        if (name === 'loadedmetadata') {
          log.ok('video metadata: ' + v.videoWidth + 'x' + v.videoHeight + ', ' +
                 (isFinite(v.duration) ? v.duration.toFixed(2) + 's' : 'unknown duration'));
          applyMediaFit();
          return;
        }
        log.debug('video event: ' + name + ' (t=' + v.currentTime.toFixed(2) +
                  ', readyState=' + v.readyState + ')');
      });
    });
  }

  function wireScene() {
    var scene = el.scene;

    scene.addEventListener('arReady', function () {
      S.arReady = true;
      hide(el.loadingScreen);
      // MindAR also fires this when it is restarted to hand the camera back to
      // the gyro engine after WebXR failed. That must NOT drag the user out of
      // the floor scene they are standing in.
      if (S.mode === MODE.BOOT || S.mode === MODE.SCAN) {
        setMode(MODE.SCAN);
        setStatus(ARI18n.t('status.searching'), 'warn');
      }
      applyModeUI();
      log.ok('AR ready (+' + ((performance.now() - S.tStart) / 1000).toFixed(2) + 's)');

      var sys = scene.systems['mindar-image-system'];
      if (sys && sys.video) {
        var track = sys.video.srcObject && sys.video.srcObject.getVideoTracks
          ? sys.video.srcObject.getVideoTracks()[0] : null;
        var settings = track && track.getSettings ? track.getSettings() : {};
        log.info('camera: ' + sys.video.videoWidth + 'x' + sys.video.videoHeight +
                 ' facing=' + (settings.facingMode || '?') +
                 ' fps=' + (settings.frameRate || '?') +
                 ' label="' + (track ? track.label : '?') + '"');
      }
      setupVideoPlanes();
    });

    scene.addEventListener('arError', function (e) {
      onArError((e.detail && e.detail.error) || 'unknown');
    });

    exhibits.forEach(function (ex, i) {
      ex.anchorEl.addEventListener('targetFound', function () { onTargetFound(i); });
      ex.anchorEl.addEventListener('targetLost', function () { onTargetLost(i); });
    });
    log.ok('scene wired for ' + exhibits.length + ' exhibit' +
           (exhibits.length === 1 ? '' : 's'));
  }

  function wireUI() {
    renderLanguages();
    wireDetails();

    // The interface redraws itself; the sheet and the start button have to be
    // told, because their words are built rather than declared.
    ARI18n.onChange(refreshChrome);

    on(el.langGo, 'click', function () { openLanguagePicker(false); });
    // Through history when the camera has an entry there, so the next Back
    // press is not spent on a camera that is already closed.
    on(el.exitAR, 'click', function () {
      if (window.ARShell && window.ARShell.leaveAr && window.ARShell.leaveAr()) return;
      exitAR();
    });

    el.errorRetry.addEventListener('click', function () {
      hide(el.errorBanner);
      if (!S.arReady) { S.started = false; startAR(); }
      else if (S.mode === MODE.SCAN) playMedia();
    });

    el.arBtn.addEventListener('click', enterFloorScene);
    el.placeBtn.addEventListener('click', placeFigure);
    el.moveBtn.addEventListener('click', moveFigure);
    el.removeBtn.addEventListener('click', function () {
      removeModel();
      resetFloorSearch();
      setMode(MODE.FLOOR);
      setStatus(ARI18n.t('status.floor'), 'warn');
      log.event('figure removed');
    });
    el.backBtn.addEventListener('click', leaveFloorScene);

    // Guarded: an older cached index.html has none of these, and a souvenir
    // photo is not worth losing the AR over.
    renderBrandBar();
    on(el.shotBtn, 'click', takePhoto);
    on(el.photoSave, 'click', savePhoto);
    on(el.photoClose, 'click', closePhoto);
    wireShare();
    wireAdjust();
    wireGestures();

    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        log.debug('orientationchange -> ' + window.innerWidth + 'x' + window.innerHeight);
        if (el.scene.resize) el.scene.resize();
      }, 300);
    });

    document.addEventListener('visibilitychange', function () {
      log.debug('visibility: ' + document.visibilityState);
      if (document.visibilityState === 'visible' && S.mode === MODE.SCAN && S.targetFound) {
        playMedia();
      }
    });
  }

  // ---------------------------------------------------------------- init
  /**
   * What the Start button is waiting for, and a way to see it stuck.
   *
   * The button is disabled until the exhibits are known and the scene is wired,
   * which is right — but a grey rectangle that never wakes up is indistinguishable
   * from a broken page. So it carries its own label, and if it is still asleep
   * after a few seconds the log says exactly which step never finished.
   */
  var boot = { content: false, sceneLoaded: false, wired: false, ready: false };

  function bootWatchdog() {
    setTimeout(function () {
      if (boot.ready) return;
      var stage = 'content=' + boot.content +
                  ' sceneLoaded=' + (el.scene ? !!el.scene.hasLoaded : '?') +
                  ' wired=' + boot.wired +
                  ' AFRAME=' + (typeof window.AFRAME) +
                  ' mindar=' + !!(window.AFRAME && window.AFRAME.systems &&
                                  window.AFRAME.systems['mindar-image-system']);
      log.error('Start AR is still not ready 10s in — ' + stage + '. ' +
                (!boot.content
                  ? 'The exhibit list never resolved: assets/content/content.json.'
                  : 'A-Frame never finished loading the scene, which usually means ' +
                    'WebGL is unavailable or blocked in this browser.'));
      showError('The page did not finish starting. Open the log and send it.', true);
    }, 10000);
  }

  /** The start screen shows what to point the phone at — every exhibit. */
  /**
   * One anchor per exhibit, built before MindAR starts.
   *
   * mindar-image-target registers itself with the system on init, and the
   * system only hands target dimensions to anchors it already knows about when
   * start() runs. These are built once and survive the stop/start cycle the
   * gyro fallback puts MindAR through.
   */
  function buildExhibitEntities() {
    exhibits.forEach(function (ex, i) {
      var anchor = document.createElement('a-entity');
      anchor.id = 'anchor-' + i;
      anchor.setAttribute('mindar-image-target', 'targetIndex: ' + i);

      var plane = document.createElement('a-plane');
      plane.id = 'videoPlane-' + i;
      plane.setAttribute('visible', false);
      plane.setAttribute('position', '0 0 0');
      plane.setAttribute('width', 1);
      plane.setAttribute('height', planeH(ex));
      anchor.appendChild(plane);

      el.scene.appendChild(anchor);
      ex.anchorEl = anchor;
      ex.planeEl = plane;
    });
  }

  function describeSource(loaded) {
    if (loaded.source === 'preview') return 'the admin portal draft in this browser';
    if (loaded.source === 'bundle') {
      return 'assets/content/content.json' +
        (loaded.generated ? ', exported ' + loaded.generated : '');
    }
    return 'js/config.js — no content bundle is deployed yet';
  }

  function logContent(loaded) {
    loaded.notes.forEach(function (note) { log.warn('content: ' + note); });
    if (loaded.previewFailed) {
      showError('The admin portal draft could not be loaded — showing the deployed ' +
                'exhibits instead. Open the log for why.', false);
    }

    log.ok('content: ' + exhibits.length + ' exhibit' + (exhibits.length === 1 ? '' : 's') +
           ' from ' + describeSource(loaded));
    log.info('tracker: ' + shortSrc(loaded.mindSrc));

    var langs = (loaded.languages || []).map(function (l) { return l.code; });
    log.info('languages: ' + (langs.join(', ') || 'none') + ' (first is the fallback)');

    exhibits.forEach(function (ex, i) {
      var written = (loaded.languages || []).filter(function (l) {
        return window.ARContent.hasDetail(ex.details[l.code]);
      }).map(function (l) { return l.code; });
      var spoken = window.ARContent.audioLanguages(ex);
      log.info('  target ' + i + ' "' + ex.name + '": image ' +
               ex.image.width + 'x' + ex.image.height +
               ' (plane 1 x ' + planeH(ex).toFixed(4) + '), ' + ex.media.kind + ' ' +
               (ex.media.width || '?') + 'x' + (ex.media.height || '?') +
               ' fit=' + ex.media.fit + ', model ' +
               (ex.model.src ? shortSrc(ex.model.src) : 'none') +
               ' at ' + ex.model.heightMeters + 'm');
      log.info('      details: ' + (written.join(', ') || 'NONE — the sheet will be empty') +
               '; audio: ' + (spoken.join(', ') || 'none'));
    });
  }

  function init() {
    var missing = cacheDom();
    wireLogPanel();

    if (missing.length) {
      log.warn('this index.html is older than js/app.js — it has no ' +
               missing.join(', ') + '. Almost always a cached page: pull down to ' +
               'refresh, or clear the site data. Anything needing those is off.');
    }

    bootWatchdog();

    if (!preflight()) {
      // preflight has already put the real reason on screen; the watchdog would
      // only talk over it. The shell still opens, because Explore and the
      // labels are worth reading on a phone that cannot run the camera.
      boot.ready = true;
      applyModeUI();
      announceReady();
      return;
    }

    THREE = window.AFRAME.THREE;
    WORLD_UP = new THREE.Vector3(0, 1, 0);

    // js/capture.js owns none of the scene; this is the whole of what it can
    // reach into, so there is one place to look when a photo comes out wrong.
    if (window.ARCapture) {
      window.ARCapture.init({
        log: log,
        photo: cfg.photo || {},
        branding: cfg.branding || {},
        renderer: function () { return el.scene.renderer; },
        sceneObject: function () { return el.scene.object3D; },
        camera: function () { return el.scene.camera; },
        videoFeed: function () {
          var system = el.scene.systems['mindar-image-system'];
          return system && system.video;
        },
        placeholders: placeholdersWanted,
        logos: function () { return window.ARContent.photoLogos(bundle); },
      });
    }

    registerClipPlayer();
    registerFloorDriver();
    // Registered above rather than in index.html, because A-Frame only applies a
    // component that already exists when the entity initialises.
    el.floorScene.setAttribute('floor-driver', '');

    var whenSceneReady = function (fn) {
      if (el.scene.hasLoaded) fn();
      else el.scene.addEventListener('loaded', fn);
    };

    window.ARContent.load().then(function (loaded) {
      boot.content = true;
      bundle = loaded;
      exhibits = loaded.exhibits;
      // Which languages exist is the museum's decision and travels with the
      // exhibits, so the interface can only be set up once they have landed.
      ARI18n.init(loaded.languages);
      logContent(loaded);

      whenSceneReady(function () {
        try {
          buildExhibitEntities();
          S.activeIndex = 0;
          adoptExhibit(exhibits[0]);
          // Ask before anything else, but only on a first visit and only
          // when there is genuinely a choice to make.
          S.langOpen = !ARI18n.chosen() && ARI18n.languages().length > 1;

          wireVideoElement();
          wireUI();
          watchActionBar();
          // The release may carry its own logos: the photo strip was preloaded
          // before it landed.
          if (window.ARCapture && window.ARCapture.reloadLogos) window.ARCapture.reloadLogos();
          applyModeUI();
          wireScene();
          boot.wired = true;
        } catch (err) {
          log.error('setting the page up failed: ' + ((err && err.stack) || err));
          showError('Part of the page could not be set up. Open the log and send ' +
                    'it — Start AR still works.', false);
        }

        // Whatever happened above, the visitor gets their button back. A broken
        // extra is not a reason to lock anyone out of the AR, and this used to
        // be reported as "no exhibits could be loaded", which it never was.
        boot.ready = true;
        if (!exhibits.length) showEmptyGallery();
        applyModeUI();
        announceReady();
        log.ok('app ready — waiting for the AR button');
      });
    }).catch(function (err) {
      log.error('content failed to load: ' + ((err && err.stack) || err));
      showError('No exhibits could be loaded. Open admin.html, add one, compile the ' +
                'targets, export the bundle and deploy it.', false);
      // Still let them in. The camera and the log are worth more than a button
      // that does nothing, and the banner above already says what is wrong.
      boot.ready = true;
      applyModeUI();
      announceReady();
    });
  }

  /**
   * What the browse half is allowed to know about the AR half.
   *
   * Deliberately small and one-directional: js/shell.js reads the exhibits
   * app.js has already loaded and asks it to start or stop the camera. It
   * never reaches into the scene, and nothing in here hands out a live
   * A-Frame entity.
   */
  var readyHandlers = [];

  /*
   * A release put live while this page sat in a pocket or a background tab
   * (the Studio publishes on save): pick it up when the visitor comes back -
   * but only while they are browsing, never in the middle of the camera. The
   * reload is quick, because every file the new release shares with this one
   * is already on the phone.
   */
  var releaseCheckedAt = 0;
  function watchForNewRelease() {
    if (!bundle || bundle.source !== 'cloud' || bundle.previewRelease || !window.ARContent.liveRelease) return;
    if (watchForNewRelease.on) return;
    watchForNewRelease.on = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || S.started) return;
      if (Date.now() - releaseCheckedAt < 30000) return;
      releaseCheckedAt = Date.now();
      window.ARContent.liveRelease().then(function (id) {
        if (!id || id === bundle.releaseId || S.started) return;
        log.event('release ' + id + ' went live (this page has ' + bundle.releaseId + ') — reloading');
        location.reload();
      }, function () { /* offline: what this page has is the best there is */ });
    });
  }

  function announceReady() {
    var queue = readyHandlers;
    readyHandlers = [];
    queue.forEach(function (fn) {
      try { fn(); } catch (e) { log.error('a ready handler threw: ' + ((e && e.stack) || e)); }
    });
    // Now there is a gallery to download. Explore is worth having offline even
    // on a phone that cannot run the camera, so this runs on every path here.
    if (window.AROffline && bundle) {
      try { window.AROffline.start(bundle); }
      catch (e) { log.warn('offline: could not start — ' + e); }
    }
    watchForNewRelease();
  }

  window.ARViewer = {
    /** The normalised exhibits, in target order. Do not mutate. */
    exhibits: function () { return exhibits; },
    /** The loaded bundle, for its `languages` list. */
    bundle: function () { return bundle; },
    ready: function () { return boot.ready; },
    /** True when the gallery genuinely has nothing in it. */
    empty: function () { return S.empty; },
    /** True when something stopped the app from ever starting the camera. */
    broken: function () { return !!S.fatal; },
    /** One sentence saying why, when there is one worth showing. */
    blockNote: function () { return S.blockNote; },
    inAR: function () { return S.started; },
    /** Ids of the exhibits this phone has found with the camera. */
    found: foundList,
    /** Redraw the AR chrome - after a staff sign-in changes what it may show. */
    refreshUi: function () { if (el.actionBar) applyModeUI(); },
    startAR: startAR,
    exitAR: exitAR,
    backInAr: backInAr,
    /** Reopen the language question. The picker itself stays app.js's. */
    openLanguage: openLanguagePicker,
    /**
     * The visitor's label for one exhibit, in the language they chose, with
     * whether that IS the language they chose. The same call the AR sheet
     * makes, so the two presentations can never drift.
     */
    detailsOf: function (ex) {
      return window.ARContent.detailsFor(ex, ARI18n.code(), bundle && bundle.languages);
    },
    log: log,
    /**
     * Where everything is, as plain numbers: the scene, the live transform,
     * and the standing figure's bounds in metres in its slot's frame (bind
     * pose, like the sizing). For the end-to-end tests and the debug log -
     * it reads, and never changes anything.
     */
    inspect: function () {
      var upm = S.engine ? S.engine.unitsPerMetre : 1;
      var out = {
        mode: S.mode, engine: S.engine ? S.engine.name : null,
        exhibit: EX() ? EX().id : null, activeIndex: S.activeIndex,
        mediaReady: S.mediaReady, floorStable: S.floorStable,
        anchor: S.modelAnchor, offset: S.modelOffset, rotation: S.modelRot,
        scale: S.modelScale, visitorScale: S.visitorScale, faceYaw: S.faceYaw,
        placedAt: S.placedAt ? { x: S.placedAt.x / upm, y: S.placedAt.y / upm, z: S.placedAt.z / upm } : null,
        figure: null,
      };
      var holder = $('modelHolder');
      var mesh = holder && (holder.getObject3D('mesh') || holder.object3D);
      if (mesh && S.mode === MODE.PLACED && THREE) {
        var slot = el.modelSlot.object3D;
        slot.updateMatrixWorld(true);
        // The bounds it was fitted by, measured at load in the model's own
        // space and carried straight into the slot's frame - never through a
        // world-aligned box, which the gyro engine's tilted scene would
        // inflate. So a playing clip cannot change the answer either.
        var measured = mesh.userData && mesh.userData.__measure;
        var source = measured ? measured.box.clone() : window.ARPlacement.localBox(THREE, holder.object3D);
        var from = measured ? mesh : holder.object3D.parent;
        var toSlot = new THREE.Matrix4().copy(slot.matrixWorld).invert().multiply(from.matrixWorld);
        var inSlot = source.applyMatrix4(toSlot);
        out.figure = {
          min: { x: inSlot.min.x / upm, y: inSlot.min.y / upm, z: inSlot.min.z / upm },
          max: { x: inSlot.max.x / upm, y: inSlot.max.y / upm, z: inSlot.max.z / upm },
          loaded: !!holder.getObject3D('mesh'),
          placeholder: holder.hasAttribute('data-placeholder'),
        };
      }
      return JSON.parse(JSON.stringify(out));
    },
    /** Runs fn once the exhibits have landed — immediately if they already have. */
    onReady: function (fn) {
      if (boot.ready) fn();
      else readyHandlers.push(fn);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
