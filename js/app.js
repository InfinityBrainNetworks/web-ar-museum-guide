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

    // Floor placement. Metres, because that is what you measure in the gallery.
    floorMode: !!cfg.floor.enabled,
    floorHeight: cfg.floor.centerHeightMeters,          // painting centre above floor
    floorPos: { x: 0, z: cfg.floor.distanceMeters },    // object on the floor, from the wall
    holding: false,
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
     'dumpState', 'reloadBtn', 'floorRig', 'floorShadow', 'floorHint'
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

  // ---------------------------------------------------------------- floor
  /*
   * Finding the floor.
   *
   * Nothing here can *sense* a floor: WebXR hit-test exists only in Chrome on
   * Android, and iOS Safari has no WebXR at all, so a real probe would work on
   * half the phones this has to run on. What both platforms do have is the
   * painting, which MindAR already tracks in full 6DoF.
   *
   * A painting hangs flat and level on a vertical wall, so the target's own axes
   * are the room's: local +X runs along the wall, local +Y is straight up, local
   * +Z points out of the wall into the room. The floor is therefore the plane
   *
   *     y = -(centre height / painting width)
   *
   * in target units, and it stays welded to the real floor at every angle and
   * distance, because it rides the same tracked pose the video does.
   *
   * The catch is that looking down at that floor swings the painting out of
   * frame and tracking drops. #floorRig mirrors the anchor's pose rather than
   * parenting to it, so when tracking goes the gyroscope can carry the pose and
   * the object stays where it was put instead of blinking out.
   */

  /** Painting width is the bridge between metres and target units. */
  function m2u(metres) { return metres / Math.max(0.05, cfg.floor.paintingWidthMeters); }
  function u2m(units) { return units * Math.max(0.05, cfg.floor.paintingWidthMeters); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /** The floor plane's height in target units — negative, it is below the painting. */
  function floorLocalY() { return -m2u(S.floorHeight); }

  /** Where the object stands, in target units. */
  function floorSlotPosition() {
    return { x: m2u(S.floorPos.x), y: floorLocalY(), z: m2u(S.floorPos.z) };
  }

  /** A pose is only usable if it is finite and not collapsed to zero. */
  function isUsablePose(matrix) {
    var e = matrix.elements;
    for (var i = 0; i < 16; i++) if (!isFinite(e[i])) return false;
    return Math.abs(matrix.determinant()) > 1e-9;
  }

  // ------------------------------------------------- gyroscope (3DoF carry)
  var gyro = { active: false, q: null, requested: false };

  function initGyro() {
    if (!cfg.floor.useGyro || gyro.requested) return;
    gyro.requested = true;
    gyro.q = new THREE.Quaternion();

    var D = window.DeviceOrientationEvent;
    if (!D) {
      log.warn('floor: this browser has no DeviceOrientationEvent — the object will ' +
               'hide when the painting leaves the frame');
      return;
    }
    var listen = function () {
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
      log.info('floor: waiting for the first gyroscope reading');
    };
    // iOS 13+ gates motion behind a permission prompt that must come from a
    // user gesture — this runs inside the Start button's click.
    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then(function (res) {
        log.info('floor: motion permission = ' + res);
        if (res === 'granted') listen();
        else log.warn('floor: motion denied — the object will hide when tracking drops');
      }).catch(function (e) {
        log.warn('floor: motion permission request failed: ' + e);
      });
    } else {
      listen();
    }
  }

  var gyroZ = null, gyroEuler = null, gyroFlip = null, gyroTwist = null;

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
      log.ok('floor: gyroscope active — the object will hold its place for up to ' +
             cfg.floor.holdSeconds + 's after tracking drops');
    }
  }

  // ------------------------------------------------- the rig that mirrors the anchor
  function registerRigMirror() {
    if (AFRAME.components['anchor-mirror']) return;
    AFRAME.registerComponent('anchor-mirror', {
      init: function () {
        this.o = this.el.object3D;
        this.o.matrixAutoUpdate = false;
        this.last = new THREE.Matrix4();
        this.hasLast = false;
        this.lostAt = 0;
        this.qAtLoss = new THREE.Quaternion();
        this.tmpQ = new THREE.Quaternion();
        this.tmpM = new THREE.Matrix4();
      },

      tick: function () {
        var src = el.anchor.object3D;

        if (src.visible && isUsablePose(src.matrix)) {
          this.o.matrix.copy(src.matrix);
          this.last.copy(src.matrix);
          this.hasLast = true;
          this.lostAt = 0;
          this.o.visible = true;
          if (S.holding) { S.holding = false; }
          return;
        }

        // Tracking is gone. Carry the last pose with the gyroscope, so looking
        // down at the object does not delete it. Rotation only: standing still
        // and tilting is accurate, walking around drifts.
        var canHold = this.hasLast && gyro.active && S.modelPlaced &&
                      S.floorMode && cfg.floor.holdSeconds > 0;
        if (!canHold) {
          this.o.visible = false;
          if (S.holding) { S.holding = false; endHold(); }
          return;
        }

        if (!this.lostAt) {
          this.lostAt = performance.now();
          this.qAtLoss.copy(gyro.q);
          S.holding = true;
          setStatus('Holding position', 'warn');
          log.debug('floor: holding the object on the gyroscope');
        }

        if ((performance.now() - this.lostAt) / 1000 > cfg.floor.holdSeconds) {
          this.o.visible = false;
          if (S.holding) {
            S.holding = false;
            endHold();
            log.debug('floor: hold expired after ' + cfg.floor.holdSeconds + 's');
          }
          return;
        }

        // Content fixed in the room is  delta * lastPose,  where
        // delta = (device orientation now)^-1 * (device orientation at loss).
        this.tmpQ.copy(gyro.q).invert().multiply(this.qAtLoss);
        this.tmpM.makeRotationFromQuaternion(this.tmpQ);
        this.o.matrix.multiplyMatrices(this.tmpM, this.last);
        this.o.visible = true;
      },
    });
  }

  /** Hold is over and the painting still is not in frame — ask for it back. */
  function endHold() {
    if (S.targetFound) return;
    show(el.scanScreen);
    setStatus('Searching…', 'warn');
  }

  // ------------------------------------------------- contact shadow
  function buildFloorShadow() {
    if (!cfg.floor.shadow || el.floorShadow.getObject3D('mesh')) return;

    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d');
    var grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.50)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true, depthWrite: false, toneMapped: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2; // lie flat on the floor
    el.floorShadow.setObject3D('mesh', mesh);
  }

  function updateFloorShadow() {
    var on = S.floorMode && S.modelPlaced && cfg.floor.shadow;
    el.floorShadow.setAttribute('visible', on);
    if (!on) return;

    var p = floorSlotPosition();
    el.floorShadow.setAttribute('position', {
      x: p.x + S.modelOffset.x,
      y: p.y + 0.002,                 // hair above the plane, to avoid z-fighting
      z: p.z + S.modelOffset.z,
    });
    var spread = Math.max(0.12, (S.modelFootprint || m2u(0.6)) * 2.1);
    el.floorShadow.setAttribute('scale', spread + ' ' + spread + ' ' + spread);
  }

  // ------------------------------------------------- tap the floor to move it
  var raycaster = null;

  function wireFloorTap() {
    if (!cfg.floor.tapToMove) return;
    var canvas = el.scene.canvas;
    if (!canvas) { log.warn('floor: no canvas yet, tap-to-move not wired'); return; }
    canvas.addEventListener('pointerdown', onFloorTap);
    log.info('floor: tap-to-move armed');
  }

  function onFloorTap(ev) {
    if (!S.floorMode || !S.modelPlaced) return;

    var rig = el.floorRig.object3D;
    if (!rig.visible) return;

    var cam = el.scene.camera;
    var canvas = el.scene.canvas;
    if (!cam || !canvas) return;

    if (!raycaster) raycaster = new THREE.Raycaster();
    var rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    ), cam);

    rig.updateMatrixWorld();
    // The floor plane, lifted out of target space into the camera's space.
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorLocalY());
    plane.applyMatrix4(rig.matrixWorld);

    var hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) { log.debug('floor: that tap did not land on the floor'); return; }

    rig.worldToLocal(hit);
    var out = u2m(hit.z);   // metres out from the wall

    // Above the line where the floor meets the wall, the ray still hits the
    // floor *plane* — metres behind the wall, where there is no floor. Ignore
    // those instead of clamping, which would fling the object to the skirting.
    if (out < 0.25) {
      log.debug('floor: tap landed ' + out.toFixed(2) + 'm out — that is at or behind ' +
                'the wall, ignoring. Tap lower, on floor you can actually see.');
      return;
    }
    if (out > cfg.floor.maxDistanceMeters) {
      log.debug('floor: tap landed ' + out.toFixed(1) + 'm out, past the ' +
                cfg.floor.maxDistanceMeters + 'm limit — clamped');
    }

    S.floorPos.x = clamp(u2m(hit.x), -cfg.floor.maxSideMeters, cfg.floor.maxSideMeters);
    S.floorPos.z = Math.min(out, cfg.floor.maxDistanceMeters);
    applyModelTransform();

    hideFloorHint();
    log.info('floor: object moved to ' + S.floorPos.x.toFixed(2) + 'm across, ' +
             S.floorPos.z.toFixed(2) + 'm out from the wall');
  }

  function showFloorHint() {
    if (!cfg.floor.tapToMove) return;
    el.floorHint.classList.remove('fade');
    show(el.floorHint);
    clearTimeout(showFloorHint._t);
    showFloorHint._t = setTimeout(hideFloorHint, 5000);
  }

  function hideFloorHint() {
    clearTimeout(showFloorHint._t);
    el.floorHint.classList.add('fade');
    setTimeout(function () { hide(el.floorHint); }, 450);
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

  /** Where the object goes: on the floor, or floating against the painting. */
  function modelBasePosition() {
    if (S.floorMode) return floorSlotPosition();
    return cfg.model.position || autoModelPosition();
  }

  function applyModelTransform() {
    var base = modelBasePosition();
    el.modelSlot.setAttribute('position', {
      x: base.x + S.modelOffset.x,
      y: base.y + S.modelOffset.y,
      z: base.z + S.modelOffset.z,
    });

    // On the floor the object is always the right way up, so orientation only
    // applies to the wall/table modes:
    // 'upright': the painting hangs on a wall, so the image's +Y is world up.
    // 'flat':    the target lies on a table, so the model stands along +Z.
    var flat = !S.floorMode && S.orientation === 'flat';
    el.modelSlot.setAttribute('rotation', {
      x: (flat ? 90 : 0) + cfg.model.extraRotation.x,
      y: cfg.model.extraRotation.y,
      z: cfg.model.extraRotation.z,
    });

    updateFloorShadow();
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
    S.modelPlaced = true;
    applyModelTransform();
    el.modelSlot.setAttribute('visible', true);

    el.placeBtnLabel.textContent = 'Remove 3D object';
    el.placeBtn.classList.add('placed');

    if (S.floorMode) {
      showFloorHint();
      log.event('3D object placed on the floor — ' + S.floorPos.z.toFixed(2) +
                'm out from the wall, floor is ' + S.floorHeight.toFixed(2) +
                'm below the painting centre (' + floorLocalY().toFixed(3) + ' target units)');
    } else {
      log.event('3D object placed against the painting');
    }
  }

  function removeModel() {
    var pivot = $('modelPivot');
    if (pivot && pivot.parentNode) pivot.parentNode.removeChild(pivot);
    el.modelSlot.setAttribute('visible', false);
    S.modelPlaced = false;
    S.modelOffset = { x: 0, y: 0, z: 0 };
    S.modelScale = cfg.model.scale;
    S.modelFootprint = 0;
    S.floorPos = { x: 0, z: cfg.floor.distanceMeters };
    updateFloorShadow();
    hideFloorHint();
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
    // On the floor a real height in metres is the natural thing to specify —
    // a 1.8m statue should be 1.8m tall next to the wall it stands by.
    var byHeight = S.floorMode && cfg.floor.objectHeightMeters > 0 && size.y > 0;
    var s = byHeight
      ? (m2u(cfg.floor.objectHeightMeters) / size.y) * S.modelScale
      : (cfg.model.fitSize / maxDim) * S.modelScale;

    obj.scale.setScalar(s);
    // Standing on the floor means the model's BASE sits at the slot origin,
    // not its centre — otherwise half of it sinks into the floor.
    obj.position.set(
      -center.x * s,
      (S.floorMode ? -box.min.y : -center.y) * s,
      -center.z * s
    );

    S.modelFootprint = Math.max(size.x, size.z) * s;
    updateFloorShadow();

    log.info('model normalized: source size ' +
             size.x.toFixed(2) + ' x ' + size.y.toFixed(2) + ' x ' + size.z.toFixed(2) +
             ' -> scale ' + s.toFixed(4) + ' (' + (byHeight
               ? cfg.floor.objectHeightMeters + 'm tall, standing on the floor'
               : 'fitSize ' + cfg.model.fitSize + ' target units') + ')');
  }

  /** Stand-in object so the whole flow works before a real .glb exists. */
  function buildPlaceholder() {
    var g = document.createElement('a-entity');
    g.id = 'modelHolder';
    g.setAttribute('data-placeholder', '');

    // On the floor, size it by the real height the object will have; otherwise
    // by fitSize against the painting.
    var f = (S.floorMode && cfg.floor.objectHeightMeters > 0)
      ? m2u(cfg.floor.objectHeightMeters) * 0.92   // 0.92: the parts below total ~1.08f tall
      : cfg.model.fitSize;
    g.setAttribute('scale', S.modelScale + ' ' + S.modelScale + ' ' + S.modelScale);

    // Built around its own centre, so lift it onto the floor plane.
    var lift = document.createElement('a-entity');
    if (S.floorMode) lift.setAttribute('position', '0 ' + (f * 0.46) + ' 0');

    S.placeholderFootprint = f * 0.84;
    S.modelFootprint = S.placeholderFootprint * S.modelScale;

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

    lift.appendChild(base);
    lift.appendChild(gem);
    lift.appendChild(label);
    g.appendChild(lift);
    return g;
  }

  /** Re-applies the scale nudge to whichever kind of object is currently placed. */
  function applyModelScale() {
    var holder = $('modelHolder');
    if (!holder) return;
    if (holder.hasAttribute('data-placeholder')) {
      holder.setAttribute('scale', S.modelScale + ' ' + S.modelScale + ' ' + S.modelScale);
      S.modelFootprint = (S.placeholderFootprint || 0) * S.modelScale;
      updateFloorShadow();
    } else if (holder.getObject3D('mesh')) {
      normalizeModel(holder);
    }
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
    // Must ride this same click: iOS only grants motion access from a gesture.
    initGyro();

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
    el.arVideo.pause();
    if (S.videoConfirmed) el.actionBar.classList.add('dim');

    // While the gyroscope is carrying an object on the floor, the scan prompt
    // would be wrong — the user is deliberately looking away from the painting.
    var willHold = S.floorMode && S.modelPlaced && gyro.active && cfg.floor.holdSeconds > 0;
    if (willHold) {
      setStatus('Holding position', 'warn');
    } else {
      show(el.scanScreen);
      setStatus('Searching…', 'warn');
    }
    log.event('targetLost' + (willHold ? ' (holding the floor object on the gyroscope)' : ''));
  }

  // ---------------------------------------------------------------- debug tools
  function wireDebugTools() {
    var fitBtn = el.logTools.querySelector('[data-tool="fit"]');
    var orientBtn = el.logTools.querySelector('[data-tool="orient"]');
    var floorBtn = el.logTools.querySelector('[data-tool="floor"]');
    fitBtn.textContent = S.fit;
    orientBtn.textContent = S.orientation;
    floorBtn.textContent = S.floorMode ? 'on' : 'off';

    // Floor vs. against-the-painting. The object is built differently for each
    // (standing on its base vs. centred), so re-place it rather than nudge it.
    floorBtn.addEventListener('click', function () {
      S.floorMode = !S.floorMode;
      floorBtn.textContent = S.floorMode ? 'on' : 'off';
      log.info('floor mode = ' + (S.floorMode ? 'on' : 'off'));
      if (S.modelPlaced) { removeModel(); placeModel(); }
      else applyModelTransform();
    });

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
        } else if (what === 'floor') {
          // In metres — these are the two gallery measurements, dialled in on site.
          // dir follows what you SEE: up moves the object up, which means a
          // shorter drop from the painting centre to the floor.
          if (axis === 'h') S.floorHeight = Math.max(0.1, S.floorHeight - dir * 0.05);
          else S.floorPos.z = clamp(S.floorPos.z + dir * 0.1, 0.25, cfg.floor.maxDistanceMeters);
          applyModelTransform();
          log.info('floor: painting centre ' + S.floorHeight.toFixed(2) +
                   'm above the floor, object ' + S.floorPos.z.toFixed(2) + 'm out');
        } else {
          if (axis === 's') {
            S.modelScale = Math.max(0.1, S.modelScale + dir * cfg.ui.scaleStep);
            applyModelScale();
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
    var base = modelBasePosition();
    var r = function (n) { return Math.round(n * 1000) / 1000; };
    var v = el.arVideo;

    var placement = S.floorMode
      ? '  floor: { enabled: true, paintingWidthMeters: ' + r(cfg.floor.paintingWidthMeters) +
        ', centerHeightMeters: ' + r(S.floorHeight) +
        ', distanceMeters: ' + r(S.floorPos.z) +
        ', objectHeightMeters: ' + r(cfg.floor.objectHeightMeters) + ' }\n' +
        '  model: { scale: ' + r(S.modelScale) + ' }   // position comes from floor\n'
      : '  model: { orientation: "' + S.orientation + '", scale: ' + r(S.modelScale) +
        ', position: { x: ' + r(base.x + S.modelOffset.x) +
        ', y: ' + r(base.y + S.modelOffset.y) +
        ', z: ' + r(base.z + S.modelOffset.z) + ' } }\n';

    log.info(
      'current values — paste into js/config.js:\n' +
      '  video: { fit: "' + S.fit + '", scale: ' + r(S.videoScale) +
      ', offset: { x: ' + r(S.videoOffset.x) + ', y: ' + r(S.videoOffset.y) +
      ', z: ' + r(S.videoOffset.z) + ' } }\n' +
      placement +
      '  state: arReady=' + S.arReady + ' targetFound=' + S.targetFound +
      ' videoConfirmed=' + S.videoConfirmed + ' modelPlaced=' + S.modelPlaced +
      ' floorMode=' + S.floorMode + ' gyro=' + gyro.active + ' holding=' + S.holding +
      ' sideways=' + r(S.floorPos.x) + 'm' +
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
      buildFloorShadow();
      wireFloorTap();
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
    registerRigMirror();
    // Registered above rather than in index.html, because A-Frame only applies a
    // component that already exists when the entity initialises.
    el.floorRig.setAttribute('anchor-mirror', '');
    wireVideoElement();
    wireUI();

    if (S.floorMode) {
      log.info('floor: on — painting is ' + cfg.floor.paintingWidthMeters + 'm wide with its ' +
               'centre ' + S.floorHeight + 'm up, so the floor is ' +
               floorLocalY().toFixed(3) + ' target units below it; object stands ' +
               S.floorPos.z + 'm out from the wall' +
               (cfg.floor.objectHeightMeters > 0 ? ' at ' + cfg.floor.objectHeightMeters + 'm tall' : ''));
    }

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
