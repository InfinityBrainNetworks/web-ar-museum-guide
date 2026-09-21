/**
 * Scene 3's camera button: one picture of what is on screen — the real camera
 * feed, the figure standing on the floor, and the logo strip across the top.
 *
 * This cannot be a screenshot of the canvas, because neither half of the
 * picture is in it:
 *
 *   the camera feed   is a <video> painted BEHIND the canvas (gyro engine), or
 *                     the system compositor's passthrough, which never enters
 *                     our GL context at all (WebXR). That one has to be asked
 *                     for by name — the `camera-access` session feature — and
 *                     read back inside the XR frame that handed it over.
 *
 *   the AR content    is in the drawing buffer, which is wiped before the next
 *                     line of JavaScript runs. During a WebXR session it is not
 *                     the canvas's buffer at all, but the session's.
 *
 * So both layers are fetched deliberately and composited onto a 2D canvas:
 * camera picture first, figure over it, logos last. The figure is re-rendered
 * into an offscreen target using the live camera's pose and projection, which
 * is both exact and free of any timing race with the main render loop.
 *
 * js/app.js owns the scene; this file only knows how to reach into it through
 * the adapter handed to init(), and calls tick() once per frame so a shot taken
 * during a WebXR session can wait for a frame to arrive.
 */
window.ARCapture = (function () {
  'use strict';

  var api = null;          // the adapter from app.js
  var log = null;
  var pending = null;      // the shot being waited on, if any
  var logos = null;        // Promise of the preloaded logo slots
  var binding = null;      // XRWebGLBinding, rebuilt per session
  var bindingFor = null;
  var fbo = null;          // our own framebuffer, for reading the camera texture
  var cameraAccess = null; // null = not tried yet, then true/false

  function say(kind, message) { if (log && log[kind]) log[kind]('photo: ' + message); }
  function THREE() { return window.AFRAME && window.AFRAME.THREE; }

  // ---------------------------------------------------------------- logos
  /**
   * Preload every slot. A slot whose file is missing resolves with img=null and
   * is drawn as a labelled placeholder, so the strip lays out correctly long
   * before the real artwork exists.
   */
  function loadLogos() {
    var slots = (api.branding && api.branding.logos) || [];
    return Promise.all(slots.map(function (slot) {
      return new Promise(function (resolve) {
        var label = slot.label || 'LOGO';
        if (!slot.src) { resolve({ label: label, img: null }); return; }
        var img = new Image();
        img.onload = function () { resolve({ label: label, img: img }); };
        img.onerror = function () {
          say('debug', 'logo slot "' + label + '" has no file yet (' + slot.src +
                       ') — drawing a placeholder box in its place');
          resolve({ label: label, img: null });
        };
        img.src = slot.src;
      });
    })).then(function (loaded) {
      var real = loaded.filter(function (s) { return s.img; }).length;
      say('info', loaded.length + ' logo slot(s), ' + real + ' with artwork, ' +
                  (loaded.length - real) + ' placeholder(s)');
      return loaded;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLogoStrip(ctx, W, H, slots) {
    if (!slots || !slots.length) return;
    var b = api.branding || {};
    var band = Math.max(26, H * (b.heightRatio || 0.075));
    var gap = Math.max(10, H * (b.gapRatio || 0.03));
    var top = Math.max(14, H * 0.035);

    var widths = slots.map(function (s) {
      if (s.img && s.img.naturalHeight) {
        return band * (s.img.naturalWidth / s.img.naturalHeight);
      }
      return band * 2.6;                       // placeholder box
    });
    var total = widths.reduce(function (a, w) { return a + w; }, 0) + gap * (slots.length - 1);

    // Never let the row run off the edges, however many slots there are.
    var room = W * 0.9;
    if (total > room) {
      var squeeze = room / total;
      band *= squeeze;
      gap *= squeeze;
      widths = widths.map(function (w) { return w * squeeze; });
      total = room;
    }

    if (b.scrim !== false) {
      var scrim = ctx.createLinearGradient(0, 0, 0, top + band * 2.2);
      scrim.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
      scrim.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, W, top + band * 2.2);
    }

    var x = (W - total) / 2;
    slots.forEach(function (slot, i) {
      var w = widths[i];
      if (slot.img) {
        ctx.drawImage(slot.img, x, top, w, band);
      } else {
        ctx.save();
        ctx.lineWidth = Math.max(1.5, band * 0.05);
        ctx.setLineDash([band * 0.2, band * 0.13]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        roundRect(ctx, x, top, w, band, band * 0.2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = '600 ' + Math.round(band * 0.32) + 'px -apple-system, ' +
                   'BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(slot.label, x + w / 2, top + band / 2);
        ctx.restore();
      }
      x += w + gap;
    });
  }

  // ---------------------------------------------------------------- pixels
  /** GL reads bottom-up; canvas draws top-down. Flip row by row on the way. */
  function pixelsToCanvas(pixels, w, h) {
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    var image = ctx.createImageData(w, h);
    var row = w * 4;
    for (var y = 0; y < h; y++) {
      image.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /** Fill WxH with the source, cropping the overflow — same as CSS `cover`. */
  function drawCover(ctx, source, sw, sh, W, H) {
    if (!sw || !sh) return;
    var scale = Math.max(W / sw, H / sh);
    var w = sw * scale, h = sh * scale;
    ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
  }

  // ---------------------------------------------------------------- camera feed
  /**
   * The WebXR passthrough, via the raw camera access feature.
   *
   * The texture is opaque and lives only for this XRFrame, so it is attached to
   * a framebuffer of ours and read back here and now. Returns null when the
   * feature was not granted — plenty of Android builds start the session
   * happily without it, since it is only ever requested as optional.
   */
  function grabXrCamera(frame) {
    var renderer = api.renderer();
    if (!frame || !renderer || !renderer.xr.isPresenting) return null;

    var refSpace = renderer.xr.getReferenceSpace();
    if (!refSpace) return null;
    var pose = frame.getViewerPose(refSpace);
    if (!pose || !pose.views.length) return null;

    var view = pose.views[0];
    if (!view.camera) {
      if (cameraAccess !== false) {
        cameraAccess = false;
        say('warn', 'this browser did not grant the camera-access feature, so the ' +
                    'WebXR passthrough cannot be read - the picture will have the ' +
                    'figure but no room behind it');
      }
      return null;
    }
    if (typeof XRWebGLBinding === 'undefined') return null;

    var gl = renderer.getContext();
    var session = frame.session;
    if (bindingFor !== session) { binding = new XRWebGLBinding(session, gl); bindingFor = session; }
    if (!binding.getCameraImage) return null;

    var texture = binding.getCameraImage(view.camera);
    if (!texture) return null;

    var w = view.camera.width, h = view.camera.height;
    if (!fbo) fbo = gl.createFramebuffer();

    var previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    var pixels = null;
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } else {
      say('warn', 'the camera image texture could not be read back (framebuffer ' +
                  'incomplete) - the picture will have no room behind the figure');
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
    // We bound a framebuffer behind three.js's back; hand it a clean slate.
    if (renderer.resetState) renderer.resetState();

    if (!pixels) return null;
    if (cameraAccess !== true) {
      cameraAccess = true;
      say('ok', 'WebXR camera image available at ' + w + 'x' + h);
    }
    return { source: pixelsToCanvas(pixels, w, h), width: w, height: h };
  }

  /** The gyro engine leaves MindAR's own <video> on screen - just draw it. */
  function grabVideoCamera() {
    var video = api.videoFeed && api.videoFeed();
    if (!video || !video.videoWidth) return null;
    return { source: video, width: video.videoWidth, height: video.videoHeight };
  }

  // ---------------------------------------------------------------- AR layer
  /**
   * Re-render the scene offscreen at the output size, through the live camera.
   *
   * In a WebXR session three.js copies the view's pose and projection onto the
   * A-Frame camera every frame, so this reproduces exactly what the session is
   * showing — as long as xr.enabled is off for the duration, or the renderer
   * would try to draw into the session's own framebuffer instead of ours.
   */
  function renderLayer(W, H) {
    var T = THREE();
    var renderer = api.renderer();
    var scene = api.sceneObject();
    var camera = api.camera();
    if (!T || !renderer || !scene || !camera) return null;

    var options = { depthBuffer: true, stencilBuffer: false };
    if (renderer.capabilities && renderer.capabilities.isWebGL2) options.samples = 4;
    var target = new T.WebGLRenderTarget(W, H, options);
    // Without this the readback is linear-light and every photo comes out
    // washed out next to the screen it was taken from.
    if (T.SRGBColorSpace) target.texture.colorSpace = T.SRGBColorSpace;

    var wasXr = renderer.xr.enabled;
    var wasTarget = renderer.getRenderTarget();
    var wasAlpha = renderer.getClearAlpha();

    var pixels = null;
    try {
      renderer.xr.enabled = false;
      renderer.setClearAlpha(0);          // transparent, so the feed shows through
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(wasTarget);
      pixels = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
    } catch (e) {
      say('error', 'the figure could not be rendered into the picture: ' + e);
      pixels = null;
    } finally {
      renderer.setRenderTarget(wasTarget);
      renderer.xr.enabled = wasXr;
      renderer.setClearAlpha(wasAlpha);
      target.dispose();
    }

    return pixels ? pixelsToCanvas(pixels, W, H) : null;
  }

  // ---------------------------------------------------------------- the shot
  /** Output size: the screen's shape, capped so the file stays sendable. */
  function outputSize() {
    var renderer = api.renderer();
    var canvas = renderer.domElement;
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    var max = (api.photo && api.photo.maxEdge) || 1600;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    var scale = Math.min(dpr, max / Math.max(w, h));
    var even = function (n) { n = Math.round(n); return n % 2 ? n + 1 : n; };
    return { width: even(w * scale), height: even(h * scale) };
  }

  function shoot(frame) {
    var size = outputSize();
    var W = size.width, H = size.height;

    var feed = frame ? grabXrCamera(frame) : null;
    if (!feed) feed = grabVideoCamera();
    var layer = renderLayer(W, H);

    var out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    var ctx = out.getContext('2d');

    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, W, H);
    if (feed) drawCover(ctx, feed.source, feed.width, feed.height, W, H);
    if (layer) ctx.drawImage(layer, 0, 0, W, H);

    return Promise.resolve(logos)
      .then(function (slots) { drawLogoStrip(ctx, W, H, slots); })
      .then(function () {
        var photo = api.photo || {};
        return new Promise(function (resolve, reject) {
          out.toBlob(function (blob) {
            if (!blob) { reject(new Error('the canvas produced no image')); return; }
            resolve(blob);
          }, photo.format || 'image/jpeg', photo.quality || 0.92);
        });
      })
      .then(function (blob) {
        say('ok', 'took a ' + W + 'x' + H + ' picture (' +
                  Math.round(blob.size / 1024) + ' KB), camera feed: ' +
                  (feed ? 'yes' : 'MISSING') + ', figure: ' + (layer ? 'yes' : 'MISSING'));
        return { blob: blob, width: W, height: H, hasFeed: !!feed, hasLayer: !!layer };
      });
  }

  function settle(frame) {
    var request = pending;
    pending = null;
    shoot(frame).then(request.resolve, request.reject);
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    say('ok', 'saved "' + name + '" to downloads');
    return 'downloaded';
  }

  // ---------------------------------------------------------------- public
  return {
    init: function (adapter) {
      api = adapter;
      log = adapter.log;
      logos = loadLogos();
    },

    /** Reload the strip after the config changed. */
    reloadLogos: function () { logos = loadLogos(); return logos; },

    /**
     * Take a picture.
     *
     * Outside WebXR everything needed is already to hand, so the shot is taken
     * immediately. Inside a session the camera image only exists during an
     * XRFrame, so the request waits for tick() to bring one.
     */
    request: function () {
      if (pending) return pending.promise;

      var renderer = api && api.renderer();
      if (!renderer) return Promise.reject(new Error('the renderer is not up yet'));

      var request = {};
      request.promise = new Promise(function (resolve, reject) {
        request.resolve = resolve;
        request.reject = reject;
      });
      request.deadline = performance.now() + 3000;
      pending = request;

      if (!renderer.xr.isPresenting) settle(null);
      return request.promise;
    },

    /** Called once per frame by the floor driver, with scene.frame if in XR. */
    tick: function (frame) {
      if (!pending) return;
      if (frame) { settle(frame); return; }
      if (performance.now() > pending.deadline) {
        say('warn', 'no XR frame arrived within 3s - taking the picture without ' +
                    'the camera feed');
        settle(null);
      }
    },

    /**
     * Hand the picture to the phone.
     *
     * The share sheet is the only route into the camera roll on both platforms,
     * so it is tried first and a download is the fallback. Must be called from
     * the user's tap: Web Share refuses otherwise.
     */
    save: function (blob) {
      var photo = api.photo || {};
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      var extension = (photo.format || 'image/jpeg') === 'image/png' ? 'png' : 'jpg';
      var name = (photo.fileName || 'museum-ar') + '-' + stamp + '.' + extension;

      var file = null;
      try { file = new File([blob], name, { type: blob.type }); } catch (e) { /* older Safari */ }

      if (file && navigator.share && navigator.canShare &&
          navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file] })
          .then(function () { say('ok', 'shared "' + name + '"'); return 'shared'; })
          .catch(function (e) {
            if (e && e.name === 'AbortError') return 'cancelled';
            say('warn', 'sharing failed (' + e + ') - downloading instead');
            return download(blob, name);
          });
      }
      return Promise.resolve(download(blob, name));
    },

    /** For the debug dump: what the last shot could and could not reach. */
    report: function () {
      return 'cameraAccess=' + (cameraAccess === null ? 'untried' : cameraAccess);
    },
  };
})();
