/**
 * The contact shadow's shapes - the one definition, shared by the AR viewer
 * and the Studio's floor editor so a shadow drawn in one looks the same in the
 * other.
 *
 * A shadow is a list of shapes lying flat on the floor, each one
 *
 *   { s: 'ellipse' | 'rect' | 'image',
 *     x, z, w, d   where it lies and how big, in metres from the figure's feet
 *     r            its turn, in degrees
 *     o, c         its own opacity and its colour
 *     f            softness: 1 fades all the way from the middle, 0 is a hard
 *                  edge (ellipse and rect only)
 *     src, n       the picture and its file name (image only) }
 *
 * Every shape is drawn as a white mask whose alpha is the shadow, and tinted by
 * the material's colour - so one texture serves every colour and opacity.
 *
 * A picture is turned into a mask the same way: a PNG with transparency gives
 * its alpha, and one without (a black shadow on a white page) gives its
 * darkness, so either kind of file just works.
 *
 * Plain script, no modules, no THREE: it hands back canvases, and each app
 * wraps them in its own three.js texture.
 */
(function () {
  'use strict';

  var SIZE = 256;
  var IMAGE_SIZE = 512;

  var SHAPES = [
    ['ellipse', 'Ellipse'],
    ['rect', 'Rectangle'],
    ['image', 'Image'],
  ];

  /** The colours a shadow can be tinted, in the order the swatches appear. */
  var COLOURS = [
    ['#000000', 'Black'],
    ['#1c2333', 'Cool — daylight'],
    ['#2a1a12', 'Warm — tungsten'],
    ['#123024', 'Green — foliage'],
    ['#241026', 'Violet'],
    ['#3d3d3d', 'Grey — faint'],
  ];

  /**
   * How soft a shape is when it does not say. An ellipse fades from its very
   * middle, which is the look every shadow had before shapes existed; a
   * rectangle keeps a solid core.
   */
  function defaultFeather(shape) { return shape === 'rect' ? 0.5 : 1; }

  function featherOf(blob) {
    var f = blob && typeof blob.f === 'number' && isFinite(blob.f) ? blob.f : defaultFeather(blob && blob.s);
    return Math.min(1, Math.max(0, f));
  }

  /**
   * The fall-off across the soft edge, t = 0 at its inner side to 1 at the
   * shape's outline: full strength, 0.44 halfway, nothing at the outline - the
   * same ramp the single soft circle always used.
   */
  function ramp(t) {
    if (t <= 0) return 1;
    if (t >= 1) return 0;
    return t < 0.5 ? 1 - 1.12 * t : 0.88 * (1 - t);
  }

  var masks = {};

  /** A white SIZE² canvas whose alpha is the shape, cached by shape and softness. */
  function mask(shape, feather) {
    var s = shape === 'rect' ? 'rect' : 'ellipse';
    var f = Math.max(0.02, Math.round((feather === undefined ? defaultFeather(s) : feather) * 50) / 50);
    var key = s + '|' + f;
    if (masks[key]) return masks[key];

    var c = document.createElement('canvas');
    c.width = c.height = SIZE;
    var g = c.getContext('2d');
    var img = g.createImageData(SIZE, SIZE);
    var core = 1 - f;
    for (var y = 0; y < SIZE; y++) {
      var v = ((y + 0.5) / SIZE) * 2 - 1;
      for (var x = 0; x < SIZE; x++) {
        var u = ((x + 0.5) / SIZE) * 2 - 1;
        var past;
        if (s === 'rect') {
          // Distance outside a smaller rectangle: straight sides, and corners
          // that round off as the edge softens.
          var dx = Math.max(Math.abs(u) - core, 0);
          var dy = Math.max(Math.abs(v) - core, 0);
          past = Math.sqrt(dx * dx + dy * dy);
        } else {
          past = Math.sqrt(u * u + v * v) - core;
        }
        var i = (y * SIZE + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * ramp(past / f));
      }
    }
    g.putImageData(img, 0, 0);
    masks[key] = c;
    return c;
  }

  /** A picture, as a square white mask: its alpha if it has any, else its darkness. */
  function imageMask(image) {
    var c = document.createElement('canvas');
    c.width = c.height = IMAGE_SIZE;
    var g = c.getContext('2d');
    // Squashed square here, stretched back by the shape's own width and depth.
    g.drawImage(image, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    var data = g.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    var d = data.data;
    var transparent = false;
    for (var i = 3; i < d.length; i += 4) { if (d[i] < 250) { transparent = true; break; } }
    for (var j = 0; j < d.length; j += 4) {
      var a = transparent ? d[j + 3]
        : 255 - (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]);
      d[j] = d[j + 1] = d[j + 2] = 255;
      d[j + 3] = Math.round(a);
    }
    g.putImageData(data, 0, 0);
    return c;
  }

  var pictures = {};

  /** Load a picture and make it a mask. Cached by URL; resolves a canvas. */
  function loadMask(src) {
    if (!src) return Promise.reject(new Error('no picture'));
    if (pictures[src]) return pictures[src];
    pictures[src] = new Promise(function (resolve, reject) {
      var image = new Image();
      // Storage serves it with CORS; without this the canvas is tainted and
      // its pixels cannot be read.
      if (!/^(data|blob):/.test(src)) image.crossOrigin = 'anonymous';
      image.onload = function () {
        try { resolve(imageMask(image)); } catch (err) { reject(err); }
      };
      image.onerror = function () { reject(new Error('the shadow picture could not be loaded')); };
      image.src = src;
    });
    pictures[src].catch(function () { delete pictures[src]; });
    return pictures[src];
  }

  window.ARShadows = {
    SHAPES: SHAPES,
    COLOURS: COLOURS,
    defaultFeather: defaultFeather,
    featherOf: featherOf,
    mask: mask,
    loadMask: loadMask,
  };
})();
