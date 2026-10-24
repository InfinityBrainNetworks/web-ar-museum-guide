/**
 * Where a 3D figure stands - the one definition, shared by the AR viewer and
 * the Studio's floor editor so the two can never disagree.
 *
 * A figure is placed by its ANCHOR: one point on the model, which is what
 * lands on the spot the visitor tapped, and what it turns and scales about -
 * Blender's "origin". Out of the box the anchor is the centre of the figure's
 * base, which is how every exhibit stood before anchors existed, so an old
 * bundle places exactly as it always did.
 *
 * The anchor is stored as a fraction of the figure's own height, measured from
 * the centre of its base: { x: 0, y: 0.5, z: 0 } is the middle of the figure,
 * whatever units the .glb was exported in and however tall the exhibit is set
 * to be. So it stays on the same point of the model when the height changes,
 * and when a re-export comes back in centimetres instead of metres.
 *
 * The frame everything else is measured in is the visitor's, at the moment
 * they put the figure down:
 *
 *   origin   the spot on the floor they placed it on
 *   +x       to their right
 *   +y       up
 *   +z       towards them - the figure is turned to face this way
 *
 * The hierarchy both apps build, from the floor up:
 *
 *   slot     at the placement point (+ the horizontal part of the offset),
 *            turned to face the visitor. The contact shadow lives here, flat.
 *   inner    lifted by the vertical offset; rotated about the anchor, YXZ.
 *   holder   the model itself, scaled to its real height and shifted so its
 *            anchor sits exactly on inner's origin.
 *
 * Plain script, no modules: it is handed whichever THREE the page has -
 * A-Frame's own copy in the viewer, three.js proper in the Studio - and only
 * ever uses Box3, Vector3 and Matrix4 from it.
 */
(function () {
  'use strict';

  var ORIGIN = { x: 0, y: 0, z: 0 };

  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }

  /** A tidy anchor: three finite numbers, kept within sight of the figure. */
  function anchor(value) {
    var v = value || ORIGIN;
    var clampTo = function (n) { return Math.max(-4, Math.min(4, num(n, 0))); };
    return { x: clampTo(v.x), y: clampTo(v.y), z: clampTo(v.z) };
  }

  /**
   * A subtree's bounds in its OWN space.
   *
   * Box3.setFromObject() works in world space, which in the viewer carries the
   * floor engine's unit scale and can be degenerate before the first pose
   * arrives. It also poses skinned meshes in newer three.js, and the two apps
   * run different versions - so this walks the geometry's own bounds instead,
   * from identity at the root, and both apps get the same box from the same
   * file.
   *
   * Those are bind-pose bounds for a skinned mesh. That is deliberate: they do
   * not move while the figure animates, so the size and the anchor do not
   * either. (Never quantize a skinned model: its stored bounds are then the
   * quantization box, not the figure - see the README.)
   */
  function localBox(THREE, root) {
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

  /** The numbers everything else is derived from. Null for a model with no geometry. */
  function measure(THREE, root) {
    var box = localBox(THREE, root);
    var size = box.getSize(new THREE.Vector3());
    if (!isFinite(size.y) || size.y <= 0) return null;
    var centre = box.getCenter(new THREE.Vector3());
    return {
      box: box,
      size: size,
      centre: centre,
      height: size.y,
      // The centre of the base: where the anchor is measured from.
      base: new THREE.Vector3(centre.x, box.min.y, centre.z),
    };
  }

  /** The anchor as a point in the model's own units. */
  function anchorPoint(THREE, m, a) {
    var n = anchor(a);
    return new THREE.Vector3(
      m.base.x + n.x * m.height,
      m.base.y + n.y * m.height,
      m.base.z + n.z * m.height);
  }

  /**
   * Scale a loaded model to its real height and hang it from its anchor.
   *
   *   heightUnits  how tall it should stand, in the caller's units
   *   anchor       the normalised anchor (see the top of this file)
   *   measured     what an earlier fit() returned as `measure`, to reuse
   *
   * Leaves `root` scaled and shifted so the anchor sits on its parent's origin,
   * and returns what it measured, or null when there was nothing to measure.
   *
   * Measure ONCE, when the model has just loaded, and pass that back in on
   * every later fit. A playing clip moves the nodes inside the model, so the
   * same walk mid-dance can come out a different size - a figure re-fitted
   * then would jump. The bounds that define it are the ones it arrived with.
   */
  function fit(THREE, root, heightUnits, a, measured) {
    root.position.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrix();

    var m = measured || measure(THREE, root);
    if (!m) return null;

    var s = heightUnits / m.height;
    var p = anchorPoint(THREE, m, a);
    root.scale.setScalar(s);
    root.position.set(-p.x * s, -p.y * s, -p.z * s);

    return {
      scale: s,
      measure: m,
      anchor: p,
      footprint: Math.max(m.size.x, m.size.z) * s,
    };
  }

  // ------------------------------------------------------------------ units
  /** The anchor in metres from the base centre, at the figure's current height. */
  function toMetres(a, heightMeters) {
    var n = anchor(a);
    var h = num(heightMeters, 1);
    return { x: n.x * h, y: n.y * h, z: n.z * h };
  }

  /** Back again: metres at the current height, to the stored fraction. */
  function fromMetres(m, heightMeters) {
    var h = num(heightMeters, 1) || 1;
    return anchor({ x: num(m.x, 0) / h, y: num(m.y, 0) / h, z: num(m.z, 0) / h });
  }

  /**
   * Named anchors, worked out from the model's own bounds.
   *
   *   base     centre of the base - the default, and right for most figures
   *   centre   the middle of the figure
   *   top      the top of the figure, centred
   *   front    the middle of the base's front edge (the side facing the
   *            visitor, +z), for a figure meant to stand against a wall
   *   back     the middle of the base's back edge
   */
  function preset(m, name) {
    var h = m.height;
    var halfX = m.size.x / 2 / h;
    var halfZ = m.size.z / 2 / h;
    switch (name) {
      case 'centre': return { x: 0, y: 0.5, z: 0 };
      case 'top':    return { x: 0, y: 1, z: 0 };
      case 'front':  return { x: 0, y: 0, z: halfZ };
      case 'back':   return { x: 0, y: 0, z: -halfZ };
      case 'left':   return { x: -halfX, y: 0, z: 0 };
      case 'right':  return { x: halfX, y: 0, z: 0 };
      default:       return { x: 0, y: 0, z: 0 };
    }
  }

  /**
   * An anchor for a point given in the model's own units - a click on its
   * surface in the Studio, say.
   */
  function anchorAt(m, point) {
    return anchor({
      x: (point.x - m.base.x) / m.height,
      y: (point.y - m.base.y) / m.height,
      z: (point.z - m.base.z) / m.height,
    });
  }

  window.ARPlacement = {
    anchor: anchor,
    localBox: localBox,
    measure: measure,
    anchorPoint: anchorPoint,
    fit: fit,
    toMetres: toMetres,
    fromMetres: fromMetres,
    preset: preset,
    anchorAt: anchorAt,
    ORDER: 'YXZ',   // the Euler order of the figure's own rotation, in both apps
  };
})();
