/**
 * The floor editor's 3D scene: the gallery floor, the visitor, and the figure
 * standing on its anchor - built exactly the way the AR viewer builds it.
 *
 * The frame is the visitor's at the moment they place the figure:
 *
 *   origin   the spot they tapped (the blue reticle)
 *   +x       to their right
 *   +y       up
 *   +z       towards them - they stand at +z, looking at -z
 *
 * and the hierarchy mirrors the viewer's slot / inner / holder, collapsed:
 *
 *   pivot    position = offset, rotation = rotation (YXZ), scale = size ×
 *   spinner  the turntable spin, about the anchor
 *   holder   the glTF, fitted by ARPlacement.fit() to its real height and
 *            hung from its anchor - the same function the phone calls
 *
 * so what stands here is what stands in the gallery. The contact shadow is
 * the viewer's too: the same shapes (js/shadows.js), the same automatic
 * circle. Select a shape and the gizmo moves, turns and sizes it on the floor
 * instead of the figure; a white patch of floor can be laid under it, because
 * a dark shadow on this dark floor cannot be seen.
 *
 * The gizmo works in two modes. OBJECT moves, turns and scales the figure
 * about its anchor. ANCHOR moves the anchor itself and leaves the figure where
 * it is (Blender's "affect only origins"): the offset is re-solved so the
 * model does not budge, and from then on it turns and scales about the new
 * point.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';

const P = () => window.ARPlacement;
const D2R = Math.PI / 180;
const ANCHOR_COLOUR = 0xff9f43;
const RETICLE_COLOUR = 0x7fd4ff;     // the AR reticle's colour
const VISITOR_EYE = 1.4;            // the gyro engine's assumed phone height
const VISITOR_DISTANCE = 2.2;

export class Stage {
  constructor(container, { onChange = () => {}, onCommit = () => {}, onStatus = () => {}, onPickShadow = () => {} } = {}) {
    this.container = container;
    this.onChange = onChange;      // every frame of a drag
    this.onCommit = onCommit;      // once, when a drag ends - for undo
    this.onStatus = onStatus;      // hud text
    this.onPickShadow = onPickShadow;   // a shadow shape clicked in the view
    this.shadowEdit = null;        // the index of the shape the gizmo holds
    this.shadowPicking = false;    // clicks in the view select shadow shapes
    this.state = null;
    this.measure = null;
    this.mode = 'translate';
    this.anchorEdit = false;
    this.snap = true;
    this.picking = false;
    this.lastFrame = performance.now();
    this.mixer = null;
    this.actions = [];
    this.playing = false;
    this.duration = 0;

    // ---- renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x0d0b0a, 1);
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0d0b0a, 9, 22);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    camera.position.set(0, 1.5, 3.4);
    this.camera = camera;

    // Lights only matter for a model on "lit"; "baked" ignores them, as in AR.
    scene.add(new THREE.HemisphereLight(0xfff4e8, 0x2a2420, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-1.5, 3, 2);
    scene.add(sun);

    this.buildFloor();
    this.buildVisitor();
    this.buildHuman();

    // ---- the figure
    this.shadowSlot = new THREE.Group();
    this.shadowGroup = new THREE.Group();
    this.shadowSlot.add(this.shadowGroup);
    scene.add(this.shadowSlot);

    this.pivot = new THREE.Group();
    this.pivot.rotation.order = 'YXZ';
    this.spinner = new THREE.Group();
    this.pivot.add(this.spinner);
    scene.add(this.pivot);

    this.anchorMarker = this.buildAnchorMarker();
    scene.add(this.anchorMarker);
    this.anchorHandle = new THREE.Object3D();
    scene.add(this.anchorHandle);

    // ---- controls
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.8, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.12;
    orbit.screenSpacePanning = true;
    orbit.maxPolarAngle = Math.PI * 0.495;    // never below the floor
    orbit.minDistance = 0.2;
    orbit.maxDistance = 30;
    this.orbit = orbit;

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.9);
    gizmo.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      if (!e.value) this.commit();
    });
    gizmo.addEventListener('objectChange', () => this.fromGizmo());
    scene.add(gizmo.getHelper());
    this.gizmo = gizmo;
    this.applySnap();
    gizmo.attach(this.pivot);

    this.viewHelper = new ViewHelper(camera, renderer.domElement);
    this.viewHelper.center = orbit.target;
    this.viewHelper.setLabels('X', 'Y', 'Z');

    // ---- picking a point on the model for the anchor, or a shadow shape
    this.raycaster = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (this.viewHelper.handleClick(e)) return;
      if (this.picking) { this.pickAt(e); return; }
      // A click, not the end of an orbit or a gizmo drag.
      const still = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
      if (still && this.shadowPicking && !this.gizmo.dragging && !this.gizmo.axis) this.pickShadowAt(e);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      this.frame = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  // ------------------------------------------------------------------ scenery
  buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(12, 96),
      new THREE.MeshBasicMaterial({ color: 0x17130f }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    this.scene.add(floor);

    const fine = new THREE.GridHelper(12, 120, 0x2a221c, 0x221c17);
    fine.material.transparent = true;
    fine.material.opacity = 0.7;
    this.scene.add(fine);
    const coarse = new THREE.GridHelper(12, 12, 0x5a4636, 0x3b2f26);
    coarse.position.y = 0.0005;
    this.scene.add(coarse);
    this.grids = [fine, coarse];

    // A patch of light floor, for seeing a shadow by. Off until asked for.
    this.patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      // Pulled towards the camera in depth, or the grid lines just under it
      // stripe through from a distance.
      new THREE.MeshBasicMaterial({ color: 0xf4f1ec, toneMapped: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.patch.rotation.x = -Math.PI / 2;
    this.patch.position.y = 0.0008;       // over the grid, under the shadow
    this.patch.visible = false;
    this.scene.add(this.patch);

    // Axis lines on the floor: x red, z blue, like every 3D tool.
    const axis = (from, to, colour) => {
      const g = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.8 }));
      line.position.y = 0.001;
      this.scene.add(line);
    };
    axis(new THREE.Vector3(-6, 0, 0), new THREE.Vector3(6, 0, 0), 0xb34848);
    axis(new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, 0, 6), 0x4870b3);

    // The reticle: where the visitor tapped. Same ring as the AR's.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.11, 48),
      new THREE.MeshBasicMaterial({ color: RETICLE_COLOUR, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.003;
    ring.renderOrder = 2;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.08, 48),
      new THREE.MeshBasicMaterial({ color: RETICLE_COLOUR, transparent: true, opacity: 0.18, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.003;
    this.scene.add(ring, disc);
  }

  /** The visitor: a phone at eye height, 2.2 m back, looking at the spot. */
  buildVisitor() {
    const g = new THREE.Group();
    g.position.set(0, VISITOR_EYE, VISITOR_DISTANCE);
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.01),
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.85 }));
    phone.rotation.x = -Math.atan2(VISITOR_EYE, VISITOR_DISTANCE) + Math.PI / 2 - Math.PI / 2;
    g.add(phone);
    const sight = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -VISITOR_EYE, -VISITOR_DISTANCE)]);
    const line = new THREE.Line(sight, new THREE.LineDashedMaterial({ color: 0x7fd4ff, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.6 }));
    line.computeLineDistances();
    g.add(line);
    const feet = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.18, 40),
      new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    feet.rotation.x = -Math.PI / 2;
    feet.position.y = -VISITOR_EYE + 0.003;
    g.add(feet);
    g.add(this.label('Visitor', 0, 0.16, 0));
    this.visitor = g;
    this.scene.add(g);
  }

  /** A 1.70 m person, for scale. Off to the visitor's left. */
  buildHuman() {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: 0x8a7f72, transparent: true, opacity: 0.35, depthWrite: false });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.95, 6, 16), m);
    body.position.y = 0.17 + 0.475 + 0.12;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), m);
    head.position.y = 1.59;
    g.add(body, head, this.label('1.70 m', 0, 1.82, 0));
    g.position.set(-1.1, 0, 0.2);
    g.visible = false;
    this.human = g;
    this.scene.add(g);
  }

  label(text, x, y, z) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = '600 30px system-ui, sans-serif';
    g.fillStyle = 'rgba(245,237,229,0.9)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(0.5, 0.125, 1);
    s.position.set(x, y, z);
    return s;
  }

  buildAnchorMarker() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: ANCHOR_COLOUR, depthTest: false, transparent: true });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), mat);
    dot.renderOrder = 20;
    g.add(dot);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.05, 32),
      new THREE.MeshBasicMaterial({ color: ANCHOR_COLOUR, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    ring.renderOrder = 20;
    g.add(ring);
    this.anchorRing = ring;
    // A plumb line from the anchor to the floor, so its height reads at a glance.
    const plumb = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
      new THREE.LineDashedMaterial({ color: ANCHOR_COLOUR, dashSize: 0.03, gapSize: 0.03, depthTest: false, transparent: true, opacity: 0.8 }));
    plumb.computeLineDistances();
    plumb.renderOrder = 19;
    g.add(plumb);
    this.plumb = plumb;
    return g;
  }

  // ------------------------------------------------------------------ the model
  async loadModel(url) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (this.holder) this.spinner.remove(this.holder);
    const root = gltf.scene;
    this.holder = root;
    this.spinner.add(root);
    this.originals = new Map();
    root.traverse((node) => { if (node.isMesh) { node.frustumCulled = false; this.originals.set(node, node.material); } });

    // Measured once, now, before any clip moves anything - exactly as the
    // viewer does it, so the two agree on the size and the anchor.
    root.position.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    root.updateMatrix();
    this.measure = P().measure(THREE, root);
    if (!this.measure) throw new Error('the model has no geometry to measure');

    this.clips = gltf.animations || [];
    this.mixer = this.clips.length ? new THREE.AnimationMixer(root) : null;
    this.actions = this.clips.map((clip) => this.mixer.clipAction(clip));
    this.duration = this.clips.reduce((m, c) => Math.max(m, c.duration), 0);
    return { measure: this.measure, clips: this.clips, duration: this.duration };
  }

  /** Put the scene in step with a placement state. */
  setState(state) {
    this.state = clone(state);
    this.apply();
  }

  getState() { return clone(this.state); }

  apply() {
    const s = this.state;
    if (!s) return;
    this.pivot.position.set(s.offset.x, s.offset.y, s.offset.z);
    this.pivot.rotation.set(s.rotation.x * D2R, s.rotation.y * D2R, s.rotation.z * D2R, 'YXZ');
    this.pivot.scale.setScalar(s.scale || 1);
    this.lastScale = s.scale || 1;
    if (this.holder && this.measure) {
      this.fit = P().fit(THREE, this.holder, s.heightMeters || 1, s.anchor, this.measure);
    }
    this.applyLighting();
    this.updateAnchorMarker();
    this.updateShadow();
  }

  applyLighting() {
    if (!this.holder) return;
    const baked = this.state.lighting !== 'lit';
    if (baked === this.baked) return;
    this.baked = baked;
    this.holder.traverse((node) => {
      if (!node.isMesh) return;
      const original = this.originals.get(node);
      node.material = baked ? mapMaterial(original, toUnlit) : original;
    });
  }

  updateAnchorMarker() {
    this.pivot.updateMatrixWorld(true);
    const p = this.pivot.getWorldPosition(new THREE.Vector3());
    this.anchorMarker.position.copy(p);
    this.anchorMarker.quaternion.copy(this.camera.quaternion);   // the ring faces the camera
    // The plumb line runs straight down to the floor in world space.
    this.plumb.quaternion.copy(this.camera.quaternion).invert();
    this.plumb.scale.set(1, Math.max(0.0001, p.y), 1);
    if (!this.anchorEdit) this.anchorHandle.position.copy(p);
  }

  // ------------------------------------------------------------------ the shadow
  /** The viewer's contact shadow, ported: shapes or the automatic circle. */
  updateShadow() {
    const s = this.state;
    const opacity = Math.max(0, Math.min(1, s.shadowOpacity ?? 0.5));
    this.shadowSlot.position.set(s.offset.x, 0, s.offset.z);
    this.patch.position.x = s.offset.x;
    this.patch.position.z = s.offset.z;
    // Hidden at strength 0 - except while a shape is being edited, when an
    // invisible handle would be no use to anyone.
    this.shadowSlot.visible = (opacity > 0 || this.shadowEdit !== null) && !!this.holder;
    if (!this.shadowSlot.visible) return;

    const auto = !(s.shadows && s.shadows.length);
    const blobs = auto ? [this.autoBlob()] : s.shadows;
    const kit = shadowKit();
    const group = this.shadowGroup;
    while (group.children.length < blobs.length) {
      const wrapper = new THREE.Object3D();
      const mesh = new THREE.Mesh(kit.geometry, new THREE.MeshBasicMaterial({
        map: null, color: 0x000000, transparent: true, depthWrite: false, toneMapped: false,
        // Further forward still than the white floor, which lies just under it.
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      mesh.rotation.x = -Math.PI / 2;
      wrapper.add(mesh);
      // The outline the selected shape wears.
      const outline = new THREE.LineLoop(kit.circle, new THREE.LineBasicMaterial({
        color: ANCHOR_COLOUR, transparent: true, opacity: 0.95, depthTest: false }));
      outline.renderOrder = 18;
      outline.visible = false;
      wrapper.add(outline);
      group.add(wrapper);
    }
    while (group.children.length > blobs.length) {
      const gone = group.children.pop();
      if (this.gizmo.object === gone) this.gizmo.detach();
      gone.children[0].material.dispose();
      gone.children[1].material.dispose();
    }
    const follow = s.shadowFollow && !auto;
    const k = this.shadowFactor();
    group.rotation.set(0, follow ? s.rotation.y * D2R : 0, 0);
    blobs.forEach((b, i) => {
      const w = group.children[i];
      const material = w.children[0].material;
      w.position.set(b.x * k, 0.002 + i * 0.0002, b.z * k);
      w.rotation.set(0, (b.r || 0) * D2R, 0);
      w.scale.set(Math.max(0.01, b.w * k), 1, Math.max(0.01, b.d * k));
      const map = this.shadowTexture(b);
      if (material.map !== map) { material.map = map; material.needsUpdate = true; }
      w.children[0].visible = !!map;
      material.color.set(b.c || '#000000');
      // Never quite gone while it is being edited, so there is something to grab.
      const strength = opacity * (typeof b.o === 'number' ? b.o : 1);
      material.opacity = i === this.shadowEdit ? Math.max(0.12, strength) : strength;
      const outline = w.children[1];
      outline.geometry = b.s === 'ellipse' || !b.s ? kit.circle : kit.square;
      outline.visible = i === this.shadowEdit;
    });
    this.holdShadow();
  }

  /** How much the shapes are scaled: by the figure's size, when they follow it. */
  shadowFactor() {
    const s = this.state;
    const follow = s.shadowFollow && s.shadows && s.shadows.length;
    return follow && s.shadowScale > 0 ? (s.scale || 1) / s.shadowScale : 1;
  }

  /** The texture for one shape; a picture's is null until it has loaded. */
  shadowTexture(b) {
    const kit = shadowKit();
    if (b.s === 'image') {
      let got = kit.pictures.get(b.src);
      if (got) return got.texture;
      got = { texture: null };
      kit.pictures.set(b.src, got);
      window.ARShadows.loadMask(b.src).then((canvas) => {
        got.texture = new THREE.CanvasTexture(canvas);
        if (this.alive && this.state) this.updateShadow();
      }, () => {
        kit.pictures.delete(b.src);
        this.onStatus('The shadow picture could not be loaded');
      });
      return null;
    }
    const shape = b.s === 'rect' ? 'rect' : 'ellipse';
    const feather = window.ARShadows.featherOf(b);
    const key = shape + '|' + feather.toFixed(2);
    if (!kit.textures.has(key)) kit.textures.set(key, new THREE.CanvasTexture(window.ARShadows.mask(shape, feather)));
    return kit.textures.get(key);
  }

  /**
   * Hand the gizmo to shadow shape i (null gives it back to the figure). Moves
   * stay on the floor, turns about the vertical, and sizing is width and depth.
   */
  setShadowEdit(i) {
    const list = (this.state && this.state.shadows) || [];
    this.shadowEdit = i !== null && i >= 0 && i < list.length ? i : null;
    if (this.shadowEdit !== null && this.anchorEdit) this.setAnchorEdit(false);
    this.updateShadow();
    if (this.shadowEdit === null) {
      this.gizmo.attach(this.anchorEdit ? this.anchorHandle : this.pivot);
      this.gizmo.setMode(this.anchorEdit ? 'translate' : this.mode);
      this.constrain(this.axis);
    }
  }

  /** Keep the gizmo on the shape being edited, and its handles on the floor. */
  holdShadow() {
    if (this.shadowEdit === null) return;
    const w = this.shadowGroup.children[this.shadowEdit];
    if (!w) return;
    if (this.gizmo.object !== w) this.gizmo.attach(w);
    this.gizmo.setMode(this.mode);
    const turning = this.mode === 'rotate';
    this.gizmo.showX = !turning && (!this.axis || this.axis === 'x');
    this.gizmo.showZ = !turning && (!this.axis || this.axis === 'z');
    this.gizmo.showY = turning;
  }

  /** Lay the light patch: { on, w, d, colour }. */
  setPatch({ on, w, d, colour } = {}) {
    this.patch.visible = !!on;
    if (w > 0 && d > 0) this.patch.scale.set(w, d, 1);
    if (colour) this.patch.material.color.set(colour);
  }

  pickShadowAt(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const list = (this.state && this.state.shadows) || [];
    if (!list.length) return;
    const meshes = this.shadowGroup.children.slice(0, list.length).map((w) => w.children[0]);
    const hits = this.raycaster.intersectObjects(meshes, false);
    // Nothing there: a click away from the shapes hands the gizmo back.
    if (!hits.length) { if (this.shadowEdit !== null) this.onPickShadow(null); return; }
    // The top one where they overlap: the later a shape, the higher it lies.
    let best = -1;
    hits.forEach((hit) => { best = Math.max(best, meshes.indexOf(hit.object)); });
    if (best >= 0) this.onPickShadow(best);
  }

  autoBlob() {
    if (!this.fit) return { s: 'ellipse', x: 0, z: 0, w: 0.6, d: 0.6, r: 0, o: 1, c: '#000000', f: 1 };
    const footprint = this.fit.footprint * (this.state.scale || 1);
    const spread = Math.max(0.1, footprint * 2.1);
    // Under the figure's base, wherever the anchor is - as in the viewer.
    this.pivot.updateMatrixWorld(true);
    const base = this.holder.localToWorld(this.measure.base.clone());
    this.shadowSlot.updateMatrixWorld(true);
    this.shadowSlot.worldToLocal(base);
    return { s: 'ellipse', x: base.x, z: base.z, w: spread, d: spread, r: 0, o: 1, c: '#000000', f: 1 };
  }

  // ------------------------------------------------------------------ gizmo
  setMode(mode) {
    this.mode = mode;
    if (this.shadowEdit !== null) { this.holdShadow(); return; }
    if (!this.anchorEdit) this.gizmo.setMode(mode);
  }

  setSpace(space) { this.gizmo.setSpace(space); }

  setSnap(on) { this.snap = on; this.applySnap(); }
  applySnap(invert = false) {
    const on = invert ? !this.snap : this.snap;
    this.gizmo.setTranslationSnap(on ? 0.01 : null);
    this.gizmo.setRotationSnap(on ? 5 * D2R : null);
    this.gizmo.setScaleSnap(on ? 0.01 : null);
  }

  /** X, Y or Z alone - Blender's axis constraint. null shows all three. */
  constrain(axis) {
    this.axis = axis || null;
    if (this.shadowEdit !== null) { this.holdShadow(); return; }
    this.gizmo.showX = !axis || axis === 'x';
    this.gizmo.showY = !axis || axis === 'y';
    this.gizmo.showZ = !axis || axis === 'z';
  }

  setAnchorEdit(on) {
    if (on && this.shadowEdit !== null) this.setShadowEdit(null);
    this.anchorEdit = !!on;
    this.updateAnchorMarker();
    if (on) {
      this.anchorHandle.position.copy(this.pivot.getWorldPosition(new THREE.Vector3()));
      this.anchorHandle.quaternion.copy(this.pivot.quaternion);
      this.gizmo.attach(this.anchorHandle);
      this.gizmo.setMode('translate');
    } else {
      this.gizmo.attach(this.pivot);
      this.gizmo.setMode(this.mode);
    }
    this.anchorRing.material.opacity = on ? 1 : 0.7;
  }

  /** The gizmo moved something: read it back into the state. */
  fromGizmo() {
    const s = this.state;
    if (this.shadowEdit !== null) {
      const w = this.shadowGroup.children[this.shadowEdit];
      const b = s.shadows[this.shadowEdit];
      const k = this.shadowFactor() || 1;
      b.x = round(w.position.x / k, 0.001);
      b.z = round(w.position.z / k, 0.001);
      b.r = round(new THREE.Euler().setFromQuaternion(w.quaternion, 'YXZ').y / D2R, 0.1);
      b.w = round(Math.max(0.01, Math.abs(w.scale.x) / k), 0.001);
      b.d = round(Math.max(0.01, Math.abs(w.scale.z) / k), 0.001);
      this.updateShadow();
      this.onChange(this.getState());
      return;
    }
    if (this.anchorEdit) {
      this.moveAnchorTo(this.anchorHandle.position.clone(), false);
      return;
    }
    if (this.mode === 'scale') {
      // One size for all three axes: whichever handle moved furthest wins.
      const v = this.pivot.scale;
      const last = this.lastScale || 1;
      let next = [v.x, v.y, v.z].reduce((best, c) => (Math.abs(c - last) > Math.abs(best - last) ? c : best), last);
      next = Math.max(0.05, Math.min(20, next));
      this.pivot.scale.setScalar(next);
      this.lastScale = next;
      s.scale = round(next, 0.001);
    }
    s.offset = { x: round(this.pivot.position.x), y: round(this.pivot.position.y), z: round(this.pivot.position.z) };
    const e = new THREE.Euler().setFromQuaternion(this.pivot.quaternion, 'YXZ');
    s.rotation = { x: round(e.x / D2R, 0.01), y: round(e.y / D2R, 0.01), z: round(e.z / D2R, 0.01) };
    this.updateAnchorMarker();
    this.updateShadow();
    this.onChange(this.getState());
  }

  /**
   * Relocate the anchor to a point in the scene WITHOUT moving the figure:
   * the new anchor is that point in the model's own units, and the offset
   * becomes that point, so the model lands exactly where it was.
   */
  moveAnchorTo(world, commit = true) {
    if (!this.holder || !this.measure) return;
    this.pivot.updateMatrixWorld(true);
    const native = this.holder.worldToLocal(world.clone());
    const s = this.state;
    s.anchor = roundVec(P().anchorAt(this.measure, native), 0.0001);
    // Solve the offset from the anchor as stored (rounded), so nothing drifts.
    this.holder.updateMatrixWorld(true);
    const exact = this.holder.localToWorld(P().anchorPoint(THREE, this.measure, s.anchor));
    s.offset = { x: round(exact.x, 0.0001), y: round(exact.y, 0.0001), z: round(exact.z, 0.0001) };
    this.apply();
    if (this.anchorEdit) this.anchorHandle.position.copy(this.pivot.getWorldPosition(new THREE.Vector3()));
    this.onChange(this.getState());
    if (commit) this.commit();
  }

  /** A named anchor - base, centre, top, front, back - keeping the figure still. */
  anchorPreset(name) {
    if (!this.holder) return;
    let world;
    if (name === 'feet') {
      // The posed figure's lowest point, centred - for a figure whose held
      // pose stands differently from its rest pose.
      const box = this.posedBox();
      world = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    } else {
      this.pivot.updateMatrixWorld(true);
      world = this.holder.localToWorld(P().anchorPoint(THREE, this.measure, P().preset(this.measure, name)));
    }
    this.moveAnchorTo(world);
  }

  /** Type the anchor in: metres from the base centre, in the model's frame. */
  anchorFromMetres(m) {
    if (!this.holder) return;
    const height = (this.state.heightMeters || 1);
    const a = P().fromMetres(m, height);
    this.pivot.updateMatrixWorld(true);
    this.moveAnchorTo(this.holder.localToWorld(P().anchorPoint(THREE, this.measure, a)));
  }

  startPick() { this.picking = true; this.renderer.domElement.style.cursor = 'crosshair'; }
  stopPick() { this.picking = false; this.renderer.domElement.style.cursor = ''; }

  pickAt(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.holder, true);
    this.stopPick();
    if (!hits.length) { this.onStatus('Missed the model — pick again'); return; }
    this.moveAnchorTo(hits[0].point);
    this.onStatus('Anchor moved to the point you picked');
  }

  // ------------------------------------------------------------------ grounding
  /** The posed figure's bounds, at the current frame of its clip. */
  posedBox() {
    this.scene.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(this.holder, true);
  }

  /** Lift or lower it so its lowest point, as posed right now, touches the floor. */
  dropToFloor() {
    const box = this.posedBox();
    if (!Number.isFinite(box.min.y)) return 0;
    const d = box.min.y;
    this.state.offset.y = round(this.state.offset.y - d, 0.0001);
    this.apply();
    this.onChange(this.getState());
    this.commit();
    return d;
  }

  /**
   * Where its lowest point goes over the whole clip: sampled through the
   * animation, then put back where it was. The numbers the lean fix in the
   * README was checked with, without leaving the Studio.
   */
  floorCheck(samples = 40) {
    if (!this.holder) return null;
    const t0 = this.time();
    const lows = [];
    const n = this.mixer && this.duration ? samples : 1;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * this.duration;
      this.seek(t, false);
      lows.push(this.posedBox().min.y);
    }
    this.seek(t0, false);
    return { min: Math.min(...lows), max: Math.max(...lows), start: lows[0], end: lows[lows.length - 1], samples: n };
  }

  // ------------------------------------------------------------------ animation
  prepareActions(loop) {
    this.actions.forEach((a) => {
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      a.clampWhenFinished = true;
      a.play();
    });
  }

  play(loop) {
    if (!this.mixer) return;
    if (this.time() >= this.duration - 0.01) this.prepareActions(loop);
    else this.actions.forEach((a) => { a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); a.paused = false; a.play(); });
    this.playing = true;
    this.loop = loop;
  }

  pause() { this.playing = false; }

  time() {
    if (!this.mixer) return 0;
    // Played once, a clip ends ON its last frame - that is the pose it holds.
    return this.loop ? this.mixer.time % (this.duration || 1) : Math.min(this.mixer.time, this.duration);
  }

  seek(t, keepPlaying = false) {
    if (!this.mixer) return;
    if (!this.actions.some((a) => a.isRunning() || a.paused)) this.prepareActions(false);
    this.actions.forEach((a) => { a.enabled = true; a.paused = false; });
    this.mixer.setTime(Math.max(0, Math.min(this.duration, t)));
    if (!keepPlaying) this.playing = false;
    this.updateShadow();
  }

  // ------------------------------------------------------------------ views
  view(name) {
    const target = new THREE.Vector3(0, ((this.state && this.state.heightMeters) || 1) * 0.5, 0);
    const d = Math.max(2.2, ((this.state && this.state.heightMeters) || 1) * 2.2);
    const at = {
      visitor: [0, VISITOR_EYE, Math.max(VISITOR_DISTANCE, d * 1.05)],
      front: [0, target.y, d],
      side: [d, target.y, 0],
      top: [0, d * 1.6, 0.0001],
      persp: [d * 0.75, d * 0.6, d * 0.9],
    }[name] || [d * 0.75, d * 0.6, d * 0.9];
    // Where the visitor stands, looking at the middle of the figure - so a
    // tall one is seen whole, as it is on the phone once they step back.
    if (name === 'visitor') target.set(0, Math.min(VISITOR_EYE, target.y), 0);
    this.camera.position.set(at[0], at[1], at[2]);
    this.orbit.target.copy(target);
    this.camera.lookAt(target);
    this.orbit.update();
  }

  frameFigure() {
    if (!this.holder) return;
    const box = this.posedBox();
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(centre);
    this.camera.position.copy(centre).addScaledVector(dir, Math.max(0.6, size * 1.4));
    this.orbit.update();
  }

  showHuman(on) { this.human.visible = !!on; }
  /** Out of the way, to see the shadow under it from above. */
  showFigure(on) { this.pivot.visible = !!on; this.anchorMarker.visible = !!on; }
  showGrid(on) { this.grids.forEach((g) => { g.visible = !!on; }); }

  /** A PNG of the current view - for the release notes, or a quick check. */
  snapshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }

  // ------------------------------------------------------------------ frame loop
  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.mixer && this.playing) {
      this.mixer.update(dt);
      if (!this.loop && this.mixer.time >= this.duration) this.playing = false;
      if (this.state && !(this.state.shadows && this.state.shadows.length)) this.updateShadow();
    }
    if (this.state && this.state.spin && this.holder) this.spinner.rotation.y += dt * (2 * Math.PI / 14);
    else this.spinner.rotation.y = 0;
    if (this.viewHelper.animating) this.viewHelper.update(dt);
    this.orbit.update();
    this.updateAnchorMarker();
    this.render();
  }

  render() {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.viewHelper.render(this.renderer);
  }

  commit() { this.onCommit(this.getState()); }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.viewHelper.dispose && this.viewHelper.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ------------------------------------------------------------------ helpers
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function round(v, step = 0.0001) { return Math.round(v / step) * step; }
function roundVec(v, step) { return { x: round(v.x, step), y: round(v.y, step), z: round(v.z, step) }; }

function mapMaterial(m, fn) { return Array.isArray(m) ? m.map(fn) : fn(m); }

/** The viewer's "baked" material, ported as is: the texture exactly as authored. */
function toUnlit(source) {
  const basic = new THREE.MeshBasicMaterial({
    map: source.map || null,
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    alphaMap: source.alphaMap || null,
    side: source.side,
    vertexColors: source.vertexColors,
    depthWrite: source.depthWrite,
    toneMapped: false,
  });
  if (!basic.map && source.emissiveMap) basic.map = source.emissiveMap;
  basic.name = source.name;
  return basic;
}

let kit = null;
function shadowKit() {
  if (kit) return kit;
  const ring = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ring.push(new THREE.Vector3(Math.cos(a) * 0.5, 0.001, Math.sin(a) * 0.5));
  }
  kit = {
    geometry: new THREE.PlaneGeometry(1, 1),
    textures: new Map(),        // shape|softness -> texture
    pictures: new Map(),        // url -> { texture }
    // Unit outlines, lying on the floor: the wrapper's scale stretches them.
    circle: new THREE.BufferGeometry().setFromPoints(ring),
    square: new THREE.BufferGeometry().setFromPoints([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
      .map(([x, z]) => new THREE.Vector3(x, 0.001, z))),
  };
  return kit;
}
