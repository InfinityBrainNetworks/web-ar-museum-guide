/**
 * Web AR Museum Guide
 *
 * Three scenes, deliberately independent:
 *
 *   1. SCAN   image tracking. MindAR finds the painting and the video plays
 *             mapped exactly onto it. Once playback is confirmed, "View in 3D"
 *             appears — and stays, whether or not the painting is still in
 *             frame, because it is a doorway, not a property of the target.
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
    videoConfirmed: false,
    xrSupported: false,

    // Which exhibit is on screen, or was last seen. Scene 2 keeps using it
    // after the painting leaves the frame, which is the whole point of the door.
    activeIndex: -1,
    // Which exhibit's file the shared <video> element currently holds.
    loadedVideo: -1,

    // Seeded from the active exhibit each time one is found; the debug panel's
    // nudges then live here until another exhibit is scanned.
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
    faceYaw: 0,            // radians, set at placement so the figure faces you
    modelYaw: 0,           // degrees, the debug panel's turn on top of that

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
     'arVideo', 'introScreen', 'introThumbs', 'introHint', 'startBtn', 'loadingScreen',
     'loadingText', 'scanScreen', 'floorScreen', 'floorText', 'statusChip', 'statusText',
     'actionBar', 'arBtn', 'placeBtn', 'placeBtnLabel', 'moveBtn', 'removeBtn', 'backBtn',
     'errorBanner', 'errorText', 'errorRetry', 'logToggle', 'logBadge', 'logPanel',
     'logList', 'logCount', 'logCopy', 'logDownload', 'logClear', 'logClose', 'logTools',
     'logToolsToggle', 'copyToast', 'dumpState', 'reloadBtn', 'overlay',
     'brandBar', 'shotBtn', 'shutterFlash', 'photoSheet', 'photoPreview',
     'photoHint', 'photoSave', 'photoClose'
    ].forEach(function (id) {
      el[id] = $(id);
      if (!el[id]) missing.push(id);
    });
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
      el.introHint.textContent = 'Blocked: open this page over https. Cameras do not work on plain http.';
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
      el.introHint.textContent = 'Open this link in Safari — in-app browsers block the camera on iOS.';
      log.warn('iOS in-app browser detected; camera will likely be blocked');
    }
    log.info('platform: iOS=' + isIOS + ' android=' + /Android/.test(ua));

    // Which floor engine will run. Asked now so the answer is in the log even if
    // the user never reaches the floor scene.
    probeWebXR();

    if (fatal) el.startBtn.disabled = true;
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

  // ---------------------------------------------------------------- video plane
  /** Build the video texture and hang it on every exhibit's plane. */
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

    // Every plane draws the same <video>, because MindAR tracks one target at a
    // time. They still need a material each: a material is the mesh's draw
    // state, not just a texture reference.
    var attached = 0;
    exhibits.forEach(function (ex) {
      var mesh = ex.planeEl && ex.planeEl.getObject3D('mesh');
      if (!mesh) return;
      if (!mesh.material || mesh.material.map !== videoTexture) {
        mesh.material = new THREE.MeshBasicMaterial({
          map: videoTexture,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        mesh.material.needsUpdate = true;
      }
      attached++;
    });

    if (!attached) {
      log.error('no exhibit planes are ready — cannot attach the video texture');
      return;
    }
    applyVideoFit();
    log.ok('video texture attached to ' + attached + ' exhibit plane' +
           (attached === 1 ? '' : 's'));
  }

  /**
   * Size the plane to the painting and crop the texture to match.
   *
   * MindAR scales the anchor so 1 unit = the target image's width, so a plane
   * 1 x (imageHeight / imageWidth) at the anchor origin covers the painting
   * exactly, at any distance or angle.
   */
  function applyVideoFit() {
    var ex = EX();
    if (!ex || !ex.planeEl) return;

    var v = el.arVideo;
    // The element's own numbers once it has metadata; the bundle's until then.
    var videoAspect = (v.videoWidth && v.videoHeight)
      ? v.videoWidth / v.videoHeight
      : ((ex.video.width && ex.video.height) ? ex.video.width / ex.video.height : 1);

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

    // repeat/offset live on the texture, which every plane shares — safe only
    // because MindAR tracks one target at a time, so one plane is ever visible.
    if (videoTexture) {
      videoTexture.repeat.set(rx, ry);
      videoTexture.offset.set(ox, oy);
      videoTexture.needsUpdate = true;
    }

    log.debug('video fit=' + S.fit + ' plane=' + w.toFixed(3) + 'x' + h.toFixed(3) +
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
  function loadExhibitVideo(index) {
    var ex = exhibits[index];
    if (!ex || !ex.video.src) return false;
    if (S.loadedVideo === index) return true;

    var v = el.arVideo;
    S.loadedVideo = index;
    v.loop = ex.video.loop !== false;
    v.src = ex.video.src;
    v.load();
    log.info('video source —> "' + ex.name + '" (' + shortSrc(ex.video.src) + ')');
    return true;
  }

  /** Re-seed the live tunables from an exhibit and load its video. */
  function adoptExhibit(ex) {
    if (!ex) return;
    S.fit = ex.video.fit;
    S.videoScale = ex.video.scale;
    S.videoOffset = { x: ex.video.offset.x, y: ex.video.offset.y, z: ex.video.offset.z };
    S.modelScale = ex.model.scale;
    S.modelYaw = 0;
    S.lighting = ex.model.lighting === 'lit' ? 'lit' : 'baked';
    S.shadowOpacity = typeof ex.model.shadowOpacity === 'number' ? ex.model.shadowOpacity : 0.5;

    loadExhibitVideo(ex.targetIndex);
    applyVideoFit();

    var fitBtn = el.logTools && el.logTools.querySelector('[data-tool="fit"]');
    if (fitBtn) fitBtn.textContent = S.fit;
  }

  // ---------------------------------------------------------------- video playback
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

  function playVideo() {
    var v = el.arVideo;
    var ex = EX();
    if (ex && ex.video.restartOnFound) v.currentTime = 0;
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
        var first = !S.videoConfirmed;
        S.videoConfirmed = true;
        log.ok('playback confirmed for "' + name + '" at t=' + v.currentTime.toFixed(2) + 's' +
               (first ? ' — unlocking "View in 3D"' : ''));
        // Once unlocked the door stays open, so only the first one moves the UI.
        if (first) applyModeUI();
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

    toggle(el.introScreen, m === MODE.BOOT);
    toggle(el.scanScreen, m === MODE.SCAN && !S.targetFound);
    toggle(el.floorScreen, m === MODE.FLOOR && !S.floorStable);
    toggle(el.statusChip, m !== MODE.BOOT);

    // "View in 3D" survives losing the painting on purpose: once the video has
    // played, moving on is always available. Scene 2 does not need the target.
    toggle(el.arBtn, m === MODE.SCAN && S.videoConfirmed);
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
    if (el.overlay) el.overlay.classList.toggle('framing', framing);
    // Leaving the floor scene while looking at a photo drops the sheet too,
    // rather than leaving it floating over scene 1.
    if (!onFloor) hide(el.photoSheet);

    var anyButton = (m === MODE.SCAN && S.videoConfirmed) ||
                    (m === MODE.FLOOR) || (m === MODE.PLACED);
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
    setStatus('Looking for the floor', 'warn');
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
    setStatus('Searching…', 'warn');

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

  /** The gyro frame at the moment the floor scene opened becomes "world". */
  function captureReference() {
    gyro.ref.copy(gyro.q);
    gyro.hasRef = true;
    log.debug('floor scene: gyro reference frame captured');
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
            setStatus('Looking for the floor', 'warn');
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
            setStatus('Floor ready', 'ok');
          } else {
            setStatus('Looking for the floor', 'warn');
          }
        } else if (!stable) {
          setStatus('Hold steady… ' + stability.heldFor().toFixed(1) + 's', 'warn');
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

    el.modelSlot.object3D.position.copy(p);
    S.faceYaw = faceViewerYaw(p);
    applyFigureYaw();

    buildFigure();
    setMode(MODE.PLACED);
    updateFloorShadow();     // after setMode: it only draws in the placed scene
    setStatus('Figure placed', 'ok');
    log.event('AR figure placed on the floor at ' +
              (p.length() / engine.unitsPerMetre).toFixed(2) + 'm, ' +
              'using the ' + engine.name + ' engine');
  }

  function degToRad(d) { return d * Math.PI / 180; }

  /** Facing the viewer, plus any turn from config or the debug panel. */
  function applyFigureYaw() {
    el.modelSlot.object3D.rotation.set(
      0, S.faceYaw + degToRad(modelCfg().yawOffset + S.modelYaw), 0);
  }

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
    if (model.spin) {
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
        if (model.playClip) holder.setAttribute('clip-player', '');
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

    el.modelSlot.appendChild(pivot);
  }

  function removeModel() {
    var pivot = $('modelPivot');
    if (pivot && pivot.parentNode) pivot.parentNode.removeChild(pivot);
    el.modelSlot.setAttribute('visible', false);
    el.floorShadow.setAttribute('visible', false);
    var model = modelCfg();
    S.modelScale = model.scale;
    S.lighting = model.lighting === 'lit' ? 'lit' : 'baked';
    S.shadowOpacity = typeof model.shadowOpacity === 'number' ? model.shadowOpacity : 0.5;
    S.modelYaw = 0;
    S.faceYaw = 0;
    S.figureFootprint = 0;
  }

  /** Back to hunting for a spot, keeping the scene and the engine running. */
  function moveFigure() {
    if (S.mode !== MODE.PLACED) return;
    removeModel();
    resetFloorSearch();
    setMode(MODE.FLOOR);
    setStatus('Looking for the floor', 'warn');
    log.event('figure picked up — looking for a new spot');
  }

  /**
   * Measures a subtree in its OWN space.
   *
   * Box3.setFromObject() works in world space, and this model hangs under a
   * scene whose matrix carries the engine's unit scale — and can be degenerate
   * on the frames before the first pose arrives. Either would corrupt the fit,
   * so the walk starts from identity at the root and ignores every ancestor.
   */
  function localBox(root) {
    var box = new THREE.Box3();
    var tmp = new THREE.Box3();

    (function walk(node, parentMatrix) {
      node.updateMatrix();
      var m = new THREE.Matrix4().multiplyMatrices(parentMatrix, node.matrix);
      if (node.geometry) {
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox) {
          box.union(tmp.copy(node.geometry.boundingBox).applyMatrix4(m));
        }
      }
      for (var i = 0; i < node.children.length; i++) walk(node.children[i], m);
    })(root, new THREE.Matrix4());

    return box;
  }

  /** Centre the glTF horizontally, stand it on its base, scale it to real height. */
  function normalizeModel(holder) {
    var obj = holder.getObject3D('mesh');
    if (!obj) { log.warn('model has no mesh to normalize'); return; }

    obj.position.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrix();

    var box = localBox(obj);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());

    if (!isFinite(size.y) || size.y <= 0) {
      log.warn('model bounding box is empty (no geometry, or skinned-only meshes) — ' +
               'leaving it at its authored scale');
      return;
    }

    var wanted = figureHeightUnits();
    var s = wanted / size.y;
    obj.scale.setScalar(s);
    // The base sits on the slot origin, which is the floor — not the centre,
    // or half the figure would be underground.
    obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);

    S.figureFootprint = Math.max(size.x, size.z) * s;

    log.info('model normalized: source size ' +
             size.x.toFixed(2) + ' x ' + size.y.toFixed(2) + ' x ' + size.z.toFixed(2) +
             ' -> scale ' + s.toFixed(4) + ' (' +
             (modelCfg().heightMeters * S.modelScale).toFixed(2) + 'm tall on the floor)');
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

    // Authored around its own centre, then lifted so its base is on the floor.
    var f = figureHeightUnits() * 0.92;
    var lift = document.createElement('a-entity');
    lift.setAttribute('position', '0 ' + (f * 0.46) + ' 0');
    S.figureFootprint = f * 0.84;

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

    applyFigureYaw();
    updateFloorShadow();
  }

  // ---------------------------------------------------------------- contact shadow
  function buildFloorShadow() {
    if (!cfg.floor.shadow || el.floorShadow.getObject3D('mesh')) return;

    // Drawn at full strength and scaled down by material.opacity, so the
    // exhibit's shadowOpacity IS the peak opacity you see.
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.44)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true, depthWrite: false, toneMapped: false,
        opacity: S.shadowOpacity,
      })
    );
    mesh.rotation.x = -Math.PI / 2;   // lie flat on the floor
    el.floorShadow.setObject3D('mesh', mesh);
  }

  function updateFloorShadow() {
    var opacity = clamp(S.shadowOpacity, 0, 1);
    // A model with its own grounding shadow baked into the texture wants this
    // at 0, or it gets a second shadow stacked under the first.
    var on = cfg.floor.shadow && opacity > 0 && S.mode === MODE.PLACED;
    el.floorShadow.setAttribute('visible', on);
    if (!on) return;

    var mesh = el.floorShadow.getObject3D('mesh');
    if (mesh && mesh.material) {
      mesh.material.opacity = opacity;
      mesh.material.needsUpdate = true;
    }

    var upm = S.engine ? S.engine.unitsPerMetre : 1;
    var spread = Math.max(0.1 * upm, (S.figureFootprint || 0.5 * upm) * 2.1);
    el.floorShadow.setAttribute('position', '0 ' + (0.002 * upm) + ' 0');
    el.floorShadow.setAttribute('scale', spread + ' ' + spread + ' ' + spread);
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
        model.animations.forEach(function (clip) {
          this.mixer.clipAction(clip).play();
        }, this);
        log.ok('playing ' + model.animations.length + ' animation clip(s)');
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

    hide(el.errorBanner);
    hide(el.introScreen);
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
    log.event('starting AR — mind: ' + system.imageTargetSrc +
              ', filterMinCF=' + shown(system.filterMinCF) +
              ', filterBeta=' + shown(system.filterBeta) +
              ', missTolerance=' + shown(system.missTolerance) +
              ', warmupTolerance=' + shown(system.warmupTolerance));
    try {
      system.start();
    } catch (e) {
      onArError(e);
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

    S.targetFound = true;
    setStatus(exhibits.length > 1 ? ex.name : 'Target locked', 'ok');
    applyModeUI();
    playVideo();
    log.event('targetFound: "' + ex.name + '" (+' +
              ((performance.now() - S.tStart) / 1000).toFixed(2) + 's)');
  }

  function onTargetLost(index) {
    if (S.mode !== MODE.SCAN) return;
    if (index !== S.activeIndex) return;  // a target we were not showing anyway

    S.targetFound = false;
    el.arVideo.pause();
    setStatus('Searching…', 'warn');
    applyModeUI();
    log.event('targetLost: "' + (exhibits[index] ? exhibits[index].name : index) + '"' +
              (S.videoConfirmed
                ? ' ("View in 3D" stays available — scene 2 does not need the painting)' : ''));
  }

  // ---------------------------------------------------------------- the photo
  /*
   * Scene 3's souvenir. js/capture.js does the compositing; everything here is
   * the button, the flash and what happens to the picture afterwards.
   */
  var lastShot = null;

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

    (brand.logos || []).forEach(function (entry) {
      var label = entry.label || 'LOGO';
      if (!entry.src) { host.appendChild(slot(label)); return; }
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
    show(el.photoSheet);
  }

  function closePhoto() {
    hide(el.photoSheet);
    el.photoSave.disabled = false;
    el.photoSave.textContent = 'Save to photos';
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
      applyVideoFit();
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
          applyVideoFit();
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
          else S.modelYaw = (S.modelYaw + dir * 15) % 360;
          refreshFigure();
          log.info('figure: ' + (modelCfg().heightMeters * S.modelScale).toFixed(2) +
                   'm tall (×' + S.modelScale.toFixed(2) + '), turned ' +
                   Math.round(S.modelYaw) + '°, shadow ' + S.shadowOpacity.toFixed(2));
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
      ' (= ' + r(modelCfg().heightMeters * S.modelScale) + 'm tall)' +
      ', turn ' + r(modelCfg().yawOffset + S.modelYaw) + '°\n' +
      '  Shading: ' + S.lighting +
      ', contact shadow ' + r(S.shadowOpacity) + '\n' +
      '  Phone height (js/config.js floor.cameraHeightMeters): ' + r(S.cameraHeight) + '\n' +
      '  photo: ' + (window.ARCapture ? window.ARCapture.report() : 'capture.js missing') +
      ' shareFiles=' + canShareFiles() +
      ' logoSlots=' + ((cfg.branding && cfg.branding.logos) || []).length + '\n' +
      '  content: ' + (bundle ? bundle.source : '?') + ', ' + exhibits.length +
      ' exhibit(s), active ' + S.activeIndex + '\n' +
      '  scene: ' + S.mode +
      ' engine=' + (engine ? engine.name : 'none') +
      ' xrSupported=' + S.xrSupported +
      ' gyro=' + gyro.active +
      ' floorFound=' + S.floorFound + ' floorStable=' + S.floorStable + '\n' +
      '  scene 1: arReady=' + S.arReady + ' targetFound=' + S.targetFound +
      ' videoConfirmed=' + S.videoConfirmed +
      ' videoTime=' + v.currentTime.toFixed(2) + '/' +
      (isFinite(v.duration) ? v.duration.toFixed(2) : '?') + 's'
    );
  }

  // ---------------------------------------------------------------- wiring
  function wireVideoElement() {
    var v = el.arVideo;
    v.muted = true; // required for autoplay on both platforms
    v.setAttribute('playsinline', '');
    // The src is set per exhibit by loadExhibitVideo(); adoptExhibit() has
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
          applyVideoFit();
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
        setStatus('Searching…', 'warn');
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
    renderIntroThumbs();

    el.startBtn.addEventListener('click', startAR);
    el.errorRetry.addEventListener('click', function () {
      hide(el.errorBanner);
      if (!S.arReady) { S.started = false; startAR(); }
      else if (S.mode === MODE.SCAN) playVideo();
    });

    el.arBtn.addEventListener('click', enterFloorScene);
    el.placeBtn.addEventListener('click', placeFigure);
    el.moveBtn.addEventListener('click', moveFigure);
    el.removeBtn.addEventListener('click', function () {
      removeModel();
      resetFloorSearch();
      setMode(MODE.FLOOR);
      setStatus('Looking for the floor', 'warn');
      log.event('figure removed');
    });
    el.backBtn.addEventListener('click', leaveFloorScene);

    // Guarded: an older cached index.html has none of these, and a souvenir
    // photo is not worth losing the AR over.
    renderBrandBar();
    on(el.shotBtn, 'click', takePhoto);
    on(el.photoSave, 'click', savePhoto);
    on(el.photoClose, 'click', closePhoto);

    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        log.debug('orientationchange -> ' + window.innerWidth + 'x' + window.innerHeight);
        if (el.scene.resize) el.scene.resize();
      }, 300);
    });

    document.addEventListener('visibilitychange', function () {
      log.debug('visibility: ' + document.visibilityState);
      if (document.visibilityState === 'visible' && S.mode === MODE.SCAN && S.targetFound) {
        playVideo();
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

  function setStartLabel(text, enabled) {
    if (!el.startBtn) return;
    el.startBtn.textContent = text;
    el.startBtn.disabled = !enabled;
  }

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
  function renderIntroThumbs() {
    var host = el.introThumbs;
    if (!host) return;

    host.textContent = '';
    host.classList.toggle('many', exhibits.length > 1);

    exhibits.forEach(function (ex) {
      var figure = document.createElement('figure');
      figure.className = 'intro-thumb';

      var img = document.createElement('img');
      img.alt = ex.name;
      img.addEventListener('error', function () {
        figure.classList.add('missing');
        log.warn('target thumbnail missing for "' + ex.name + '": ' + shortSrc(ex.image.src));
      });
      img.src = ex.image.src || '';
      figure.appendChild(img);

      if (exhibits.length > 1) {
        var caption = document.createElement('figcaption');
        caption.textContent = ex.name;
        figure.appendChild(caption);
      }
      host.appendChild(figure);
    });
  }

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

    exhibits.forEach(function (ex, i) {
      log.info('  target ' + i + ' "' + ex.name + '": image ' +
               ex.image.width + 'x' + ex.image.height +
               ' (plane 1 x ' + planeH(ex).toFixed(4) + '), video ' +
               (ex.video.width || '?') + 'x' + (ex.video.height || '?') +
               ' fit=' + ex.video.fit + ', model ' +
               (ex.model.src ? shortSrc(ex.model.src) : 'placeholder') +
               ' at ' + ex.model.heightMeters + 'm');
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

    setStartLabel('Loading…', false);
    bootWatchdog();

    if (!preflight()) {
      setStartLabel('Unavailable', false);
      // preflight has already put the real reason on screen; the watchdog would
      // only talk over it.
      boot.ready = true;
      return;
    }

    THREE = window.AFRAME.THREE;

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
      logContent(loaded);

      whenSceneReady(function () {
        try {
          buildExhibitEntities();
          S.activeIndex = 0;
          adoptExhibit(exhibits[0]);
          renderIntroThumbs();

          wireVideoElement();
          wireUI();
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
        setStartLabel('Start AR', true);
        log.ok('app ready — waiting for the Start button');
      });
    }).catch(function (err) {
      log.error('content failed to load: ' + ((err && err.stack) || err));
      showError('No exhibits could be loaded. Open admin.html, add one, compile the ' +
                'targets, export the bundle and deploy it.', false);
      // Still let them in. The camera and the log are worth more than a button
      // that does nothing, and the banner above already says what is wrong.
      boot.ready = true;
      setStartLabel('Start AR', true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
