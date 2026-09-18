/**
 * Web AR Museum Guide
 *
 * Flow:
 *   start tap -> camera starts -> target found -> video plays mapped onto the
 *   painting -> playback confirmed -> "Place 3D object" button appears.
 *
 * Scene units: 1 = the target image's width. MindAR scales the anchor so a
 * 1 x (h/w) plane at the origin sits exactly over the painting.
 */
(function () {
  'use strict';

  var cfg = window.AR_CONFIG;
  var THREE = null; // filled in at init, once A-Frame is up
  var log = window.ARLog;

  log.setMax(cfg.ui.maxLogEntries);

  // ---------------------------------------------------------------- state
  var S = {
    started: false,
    arReady: false,
    targetFound: false,
    videoConfirmed: false,
    modelPlaced: false,
    fit: cfg.video.fit,
    orientation: cfg.model.orientation,
    videoScale: cfg.video.scale,
    videoOffset: { x: cfg.video.offset.x, y: cfg.video.offset.y, z: cfg.video.offset.z },
    modelScale: cfg.model.scale,
    modelOffset: { x: 0, y: 0, z: 0 }, // on top of the auto/config position
    tStart: 0,
  };

  var PLANE_H = cfg.target.height / cfg.target.width; // painting height in target units
  var videoTexture = null;

  // ---------------------------------------------------------------- dom
  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  function cacheDom() {
    ['scene', 'anchor', 'videoPlane', 'modelSlot', 'arVideo', 'introScreen', 'introThumb',
     'introHint', 'startBtn', 'loadingScreen', 'loadingText', 'scanScreen', 'statusChip',
     'statusText', 'actionBar', 'placeBtn', 'placeBtnLabel', 'errorBanner', 'errorText',
     'errorRetry', 'logToggle', 'logBadge', 'logPanel', 'logList', 'logCount', 'logCopy',
     'logDownload', 'logClear', 'logClose', 'logTools', 'logToolsToggle', 'copyToast',
     'dumpState', 'reloadBtn'
    ].forEach(function (id) { el[id] = $(id); });
  }

  function show(node) { if (node) node.classList.remove('hidden'); }
  function hide(node) { if (node) node.classList.add('hidden'); }

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

    if (fatal) el.startBtn.disabled = true;
    return !fatal;
  }

  // ---------------------------------------------------------------- video plane
  /** Build the video texture and hang it on the plane. */
  function setupVideoPlane() {
    var mesh = el.videoPlane.getObject3D('mesh');
    if (!mesh) { log.error('video plane mesh missing — cannot attach video texture'); return; }

    videoTexture = new THREE.VideoTexture(el.arVideo);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
    if ('colorSpace' in videoTexture && THREE.SRGBColorSpace) {
      videoTexture.colorSpace = THREE.SRGBColorSpace;      // three >= r152
    } else if (THREE.sRGBEncoding !== undefined) {
      videoTexture.encoding = THREE.sRGBEncoding;
    }

    mesh.material = new THREE.MeshBasicMaterial({
      map: videoTexture,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    mesh.material.needsUpdate = true;

    applyVideoFit();
    log.ok('video texture attached to plane');
  }

  /** Map the video onto the painting according to the current fit mode. */
  function applyVideoFit() {
    var vw = el.arVideo.videoWidth || cfg.video.width;
    var vh = el.arVideo.videoHeight || cfg.video.height;
    var videoAspect = vw / vh;
    var imageAspect = cfg.target.width / cfg.target.height;

    var w = 1, h = PLANE_H;             // exactly the painting
    var rx = 1, ry = 1, ox = 0, oy = 0; // texture crop

    if (S.fit === 'contain') {
      if (videoAspect > imageAspect) { w = 1; h = 1 / videoAspect; }
      else { h = PLANE_H; w = PLANE_H * videoAspect; }
    } else if (S.fit === 'cover') {
      if (videoAspect > imageAspect) { rx = imageAspect / videoAspect; ox = (1 - rx) / 2; }
      else { ry = videoAspect / imageAspect; oy = (1 - ry) / 2; }
    } // 'stretch' keeps the defaults

    w *= S.videoScale;
    h *= S.videoScale;

    el.videoPlane.setAttribute('width', w.toFixed(5));
    el.videoPlane.setAttribute('height', h.toFixed(5));
    el.videoPlane.setAttribute('position',
      S.videoOffset.x + ' ' + S.videoOffset.y + ' ' + S.videoOffset.z);

    if (videoTexture) {
      videoTexture.repeat.set(rx, ry);
      videoTexture.offset.set(ox, oy);
      videoTexture.needsUpdate = true;
    }

    log.info('video fit=' + S.fit + ' source=' + vw + 'x' + vh +
             ' plane=' + w.toFixed(3) + 'x' + h.toFixed(3) +
             ' (painting is 1.000 x ' + PLANE_H.toFixed(3) + ')' +
             ' crop=' + rx.toFixed(3) + 'x' + ry.toFixed(3));
  }

  /** iOS will not start a video that was never touched by a user gesture. */
  function primeVideo() {
    var p = el.arVideo.play();
    if (p && p.then) {
      p.then(function () {
        el.arVideo.pause();
        el.arVideo.currentTime = 0;
        log.ok('video unlocked by user gesture');
      }).catch(function (err) {
        log.warn('video priming rejected: ' + err.name + ' — ' + err.message);
      });
    }
  }

  function playVideo() {
    if (cfg.video.restartOnFound) el.arVideo.currentTime = 0;
    var p = el.arVideo.play();
    if (p && p.catch) {
      p.catch(function (err) {
        log.error('video.play() failed: ' + err.name + ' — ' + err.message);
        showError('The video could not start. Tap Retry, or send the log.', true);
      });
    }
    confirmPlayback();
  }

  /**
   * "Playing" is not enough — some devices report playing while the decoder
   * never delivers a frame. Confirm currentTime actually advances.
   */
  function confirmPlayback() {
    if (S.videoConfirmed || confirmPlayback._running) return;
    confirmPlayback._running = true;

    var startTime = el.arVideo.currentTime;
    var deadline = performance.now() + 6000;

    (function check() {
      if (S.videoConfirmed) { confirmPlayback._running = false; return; }

      if (el.arVideo.currentTime > startTime + 0.05 &&
          el.arVideo.readyState >= 2 && !el.arVideo.paused) {
        S.videoConfirmed = true;
        confirmPlayback._running = false;
        log.ok('video playback confirmed at t=' + el.arVideo.currentTime.toFixed(2) +
               's — unlocking "Place 3D object"');
        unlockActionBar();
        return;
      }
      if (performance.now() > deadline) {
        confirmPlayback._running = false;
        log.error('video did not advance within 6s. paused=' + el.arVideo.paused +
                  ' readyState=' + el.arVideo.readyState +
                  ' networkState=' + el.arVideo.networkState +
                  ' currentTime=' + el.arVideo.currentTime.toFixed(2) +
                  ' error=' + (el.arVideo.error ? el.arVideo.error.code : 'none'));
        showError('The video is not playing. Open the log (🐞) and send it over.', true);
        return;
      }
      requestAnimationFrame(check);
    })();
  }

  function unlockActionBar() {
    show(el.actionBar);
    requestAnimationFrame(function () { el.actionBar.classList.add('up'); });
  }

  // ---------------------------------------------------------------- 3D object
  function autoModelPosition() {
    // Floating in front of the painting's lower third. Sitting it *below* the
    // painting reads more cleanly, but drops off-screen as soon as the viewer
    // steps close enough for the painting to fill the frame — which is exactly
    // when they are looking. Set model.position in js/config.js to override,
    // e.g. { x: 0, y: -0.85, z: 0.05 } to hang it underneath instead.
    return {
      x: 0,
      y: -(PLANE_H / 2) + (cfg.model.fitSize * 0.55),
      z: 0.2,
    };
  }

  function applyModelTransform() {
    var base = cfg.model.position || autoModelPosition();
    el.modelSlot.setAttribute('position', {
      x: base.x + S.modelOffset.x,
      y: base.y + S.modelOffset.y,
      z: base.z + S.modelOffset.z,
    });

    // 'upright': the painting hangs on a wall, so the image's +Y is world up.
    // 'flat':    the target lies on a table, so the model stands along +Z.
    el.modelSlot.setAttribute('rotation', {
      x: (S.orientation === 'flat' ? 90 : 0) + cfg.model.extraRotation.x,
      y: cfg.model.extraRotation.y,
      z: cfg.model.extraRotation.z,
    });
  }

  function placeModel() {
    if (S.modelPlaced) { removeModel(); return; }

    var pivot = document.createElement('a-entity');
    pivot.id = 'modelPivot';
    if (cfg.model.spin) {
      pivot.setAttribute('animation', {
        property: 'rotation', from: '0 0 0', to: '0 360 0',
        loop: true, dur: 14000, easing: 'linear',
      });
    }

    if (cfg.model.src) {
      var holder = document.createElement('a-entity');
      holder.id = 'modelHolder';
      holder.setAttribute('gltf-model', 'url(' + cfg.model.src + ')');
      holder.addEventListener('model-loaded', function () {
        normalizeModel(holder);
        if (cfg.model.playClip) holder.setAttribute('clip-player', '');
        log.ok('3D model loaded: ' + cfg.model.src);
      });
      holder.addEventListener('model-error', function () {
        log.error('3D model failed to load: ' + cfg.model.src);
        showError('The 3D model could not be loaded — showing a placeholder instead.', true);
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        pivot.appendChild(buildPlaceholder());
      });
      pivot.appendChild(holder);
      log.info('loading 3D model: ' + cfg.model.src);
    } else {
      pivot.appendChild(buildPlaceholder());
      log.info('no model configured — placed the built-in placeholder ' +
               '(set model.src in js/config.js to use a .glb)');
    }

    el.modelSlot.appendChild(pivot);
    applyModelTransform();
    el.modelSlot.setAttribute('visible', true);

    S.modelPlaced = true;
    el.placeBtnLabel.textContent = 'Remove 3D object';
    el.placeBtn.classList.add('placed');
    log.event('3D object placed');
  }

  function removeModel() {
    var pivot = $('modelPivot');
    if (pivot && pivot.parentNode) pivot.parentNode.removeChild(pivot);
    el.modelSlot.setAttribute('visible', false);
    S.modelPlaced = false;
    S.modelOffset = { x: 0, y: 0, z: 0 };
    S.modelScale = cfg.model.scale;
    el.placeBtnLabel.textContent = 'Place 3D object';
    el.placeBtn.classList.remove('placed');
    log.event('3D object removed');
  }

  /**
   * Measures a subtree in its OWN space.
   *
   * Box3.setFromObject() works in world space, and this model hangs under
   * MindAR's anchor, whose world matrix carries the marker scale — and is an
   * all-zero matrix whenever the target is not currently visible. Either would
   * corrupt the fit calculation, so the walk starts from identity at the root
   * and ignores every ancestor.
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

  /** Centre any glTF on the pivot and scale it to model.fitSize target units. */
  function normalizeModel(holder) {
    var obj = holder.getObject3D('mesh');
    if (!obj) { log.warn('model has no mesh to normalize'); return; }

    obj.position.set(0, 0, 0);
    obj.scale.set(1, 1, 1);
    obj.updateMatrix();

    var box = localBox(obj);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);

    if (!isFinite(maxDim) || maxDim <= 0) {
      log.warn('model bounding box is empty (no geometry, or skinned-only meshes) — ' +
               'leaving it at its authored scale; set model.fitSize/scale by hand');
      return;
    }
    var s = (cfg.model.fitSize / maxDim) * S.modelScale;
    obj.scale.setScalar(s);
    obj.position.set(-center.x * s, -center.y * s, -center.z * s);

    log.info('model normalized: source size ' +
             size.x.toFixed(2) + ' x ' + size.y.toFixed(2) + ' x ' + size.z.toFixed(2) +
             ' -> scale ' + s.toFixed(4) + ' (fitSize ' + cfg.model.fitSize + ' target units)');
  }

  /** Stand-in object so the whole flow works before a real .glb exists. */
  function buildPlaceholder() {
    var g = document.createElement('a-entity');
    g.id = 'modelHolder';
    var f = cfg.model.fitSize;

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
      property: 'object3D.position.y', from: -0.02, to: 0.02,
      dir: 'alternate', loop: true, dur: 2000, easing: 'easeInOutSine',
    });

    var label = document.createElement('a-text');
    label.setAttribute('value', 'PLACEHOLDER');
    label.setAttribute('align', 'center');
    label.setAttribute('color', '#9aa4b5');
    label.setAttribute('width', f * 3);
    label.setAttribute('position', '0 ' + (f * 0.62) + ' 0');

    g.appendChild(base);
    g.appendChild(gem);
    g.appendChild(label);
    return g;
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

    var system = el.scene.systems['mindar-image-system'];
    if (!system) { showError('MindAR system is missing. Reload the page.', true); return; }

    // The mindar-image component reads its schema once, in init, so tuning from
    // config.js is applied to the system here instead — start() reads it.
    var t = cfg.tracking;
    if (t.filterMinCF !== -1) system.filterMinCF = t.filterMinCF;
    if (t.filterBeta !== -1) system.filterBeta = t.filterBeta;
    if (t.missTolerance !== -1) system.missTolerance = t.missTolerance;
    if (t.warmupTolerance !== -1) system.warmupTolerance = t.warmupTolerance;

    if (system.imageTargetSrc !== cfg.target.mindSrc) {
      log.warn('config.target.mindSrc (' + cfg.target.mindSrc + ') does not match the ' +
               'imageTargetSrc in index.html (' + system.imageTargetSrc + '); index.html wins');
    }

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

  function onTargetFound() {
    S.targetFound = true;
    hide(el.scanScreen);
    show(el.statusChip);
    setStatus('Target locked', 'ok');
    el.videoPlane.setAttribute('visible', true);
    el.actionBar.classList.remove('dim');
    playVideo();
    log.event('targetFound (+' + ((performance.now() - S.tStart) / 1000).toFixed(2) + 's)');
  }

  function onTargetLost() {
    S.targetFound = false;
    show(el.scanScreen);
    setStatus('Searching…', 'warn');
    el.arVideo.pause();
    if (S.videoConfirmed) el.actionBar.classList.add('dim');
    log.event('targetLost');
  }

  // ---------------------------------------------------------------- debug tools
  function wireDebugTools() {
    var fitBtn = el.logTools.querySelector('[data-tool="fit"]');
    var orientBtn = el.logTools.querySelector('[data-tool="orient"]');
    fitBtn.textContent = S.fit;
    orientBtn.textContent = S.orientation;

    fitBtn.addEventListener('click', function () {
      var modes = ['stretch', 'cover', 'contain'];
      S.fit = modes[(modes.indexOf(S.fit) + 1) % modes.length];
      fitBtn.textContent = S.fit;
      applyVideoFit();
    });

    orientBtn.addEventListener('click', function () {
      S.orientation = S.orientation === 'upright' ? 'flat' : 'upright';
      orientBtn.textContent = S.orientation;
      applyModelTransform();
      log.info('model orientation = ' + S.orientation);
    });

    Array.prototype.forEach.call(el.logTools.querySelectorAll('[data-nudge]'), function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-nudge').split(':'); // what:axis:direction
        var what = parts[0], axis = parts[1], dir = parseFloat(parts[2]);

        if (what === 'video') {
          if (axis === 's') S.videoScale = Math.max(0.1, S.videoScale + dir * cfg.ui.scaleStep);
          else S.videoOffset[axis] += dir * cfg.ui.nudgeStep;
          applyVideoFit();
        } else {
          if (axis === 's') {
            S.modelScale = Math.max(0.1, S.modelScale + dir * cfg.ui.scaleStep);
            var holder = $('modelHolder');
            if (holder && holder.getObject3D('mesh')) normalizeModel(holder);
          } else {
            S.modelOffset[axis] += dir * cfg.ui.nudgeStep;
          }
          applyModelTransform();
        }
      });
    });
  }

  /** Print the current tuning so it can be pasted straight into js/config.js. */
  function dumpState() {
    var base = cfg.model.position || autoModelPosition();
    var r = function (n) { return Math.round(n * 1000) / 1000; };
    var v = el.arVideo;
    log.info(
      'current values — paste into js/config.js:\n' +
      '  video: { fit: "' + S.fit + '", scale: ' + r(S.videoScale) +
      ', offset: { x: ' + r(S.videoOffset.x) + ', y: ' + r(S.videoOffset.y) +
      ', z: ' + r(S.videoOffset.z) + ' } }\n' +
      '  model: { orientation: "' + S.orientation + '", scale: ' + r(S.modelScale) +
      ', position: { x: ' + r(base.x + S.modelOffset.x) +
      ', y: ' + r(base.y + S.modelOffset.y) +
      ', z: ' + r(base.z + S.modelOffset.z) + ' } }\n' +
      '  state: arReady=' + S.arReady + ' targetFound=' + S.targetFound +
      ' videoConfirmed=' + S.videoConfirmed + ' modelPlaced=' + S.modelPlaced +
      ' videoTime=' + v.currentTime.toFixed(2) + '/' +
      (isFinite(v.duration) ? v.duration.toFixed(2) : '?') + 's'
    );
  }

  // ---------------------------------------------------------------- wiring
  function wireVideoElement() {
    var v = el.arVideo;
    v.src = cfg.video.src;
    v.loop = cfg.video.loop;
    v.muted = true; // required for autoplay on both platforms
    v.setAttribute('playsinline', '');
    v.load();

    ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'waiting',
     'stalled', 'ended', 'error', 'suspend'].forEach(function (name) {
      v.addEventListener(name, function () {
        if (name === 'error') {
          var e = v.error || {};
          log.error('video element error: code=' + e.code + ' ' + (e.message || '') +
                    ' src=' + (v.currentSrc || cfg.video.src));
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
      show(el.scanScreen);
      show(el.statusChip);
      setStatus('Searching…', 'warn');
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
      setupVideoPlane();
    });

    scene.addEventListener('arError', function (e) {
      onArError((e.detail && e.detail.error) || 'unknown');
    });

    el.anchor.addEventListener('targetFound', onTargetFound);
    el.anchor.addEventListener('targetLost', onTargetLost);
    log.ok('scene wired');
  }

  function wireUI() {
    el.introThumb.src = cfg.target.imageSrc;
    el.introThumb.addEventListener('error', function () {
      log.warn('target thumbnail missing: ' + cfg.target.imageSrc);
    });

    el.startBtn.addEventListener('click', startAR);
    el.errorRetry.addEventListener('click', function () {
      hide(el.errorBanner);
      if (!S.arReady) { S.started = false; startAR(); }
      else playVideo();
    });
    el.placeBtn.addEventListener('click', placeModel);

    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        log.debug('orientationchange -> ' + window.innerWidth + 'x' + window.innerHeight);
        if (el.scene.resize) el.scene.resize();
      }, 300);
    });

    document.addEventListener('visibilitychange', function () {
      log.debug('visibility: ' + document.visibilityState);
      if (document.visibilityState === 'visible' && S.targetFound) playVideo();
    });
  }

  // ---------------------------------------------------------------- init
  function init() {
    cacheDom();
    wireLogPanel();
    log.info('config: target ' + cfg.target.width + 'x' + cfg.target.height +
             ' (plane 1 x ' + PLANE_H.toFixed(4) + '), video ' +
             cfg.video.width + 'x' + cfg.video.height + ', fit=' + S.fit);

    if (!preflight()) return;

    THREE = window.AFRAME.THREE;
    registerClipPlayer();
    wireVideoElement();
    wireUI();

    if (el.scene.hasLoaded) wireScene();
    else el.scene.addEventListener('loaded', wireScene);

    log.ok('app ready — waiting for the Start button');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
