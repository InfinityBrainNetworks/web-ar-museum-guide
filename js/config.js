/**
 * Settings that are NOT per exhibit, plus the defaults a new exhibit starts from.
 *
 * What each exhibit shows — its target image, video and 3D model — lives in
 * assets/content/content.json, written by the admin portal (admin.html). This
 * file no longer decides that. What it still owns:
 *
 *   floor, tracking, ui   global behaviour, the same for every exhibit
 *   target, video, model  the DEFAULTS the portal fills a new exhibit with, and
 *                         the fallback content for a checkout that has never had
 *                         a bundle exported
 *
 * The AR scene works in "target units": 1 unit = the width of the target image.
 * So a plane 1 wide and (imageHeight / imageWidth) tall covers the artwork exactly.
 */
window.AR_CONFIG = {

  /**
   * The languages a visitor can choose between, in the order the picker shows
   * them. The FIRST one is the fallback: an exhibit must have its details
   * written in that language, and every other language falls back to it when a
   * translation is missing. English first is a decision, not a preference - it
   * is the one language every exhibit is required to carry.
   *
   * Edit this list in the portal (the languages button), not here. The portal
   * writes the real list into the bundle; this is only what a fresh checkout
   * starts from.
   */
  languages: [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'si', name: 'Sinhala', native: 'සිංහල' },
    { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  ],

  // Where the compiled tracker lives. The portal writes this into the bundle
  // too; this is the path used before any bundle has been exported.
  target: {
    mindSrc: './assets/content/targets.mind',
    // There is no built-in exhibit. An empty gallery says so on the start
    // screen and sends you to the portal, which is more honest than shipping a
    // demo painting that hangs in no museum.
    imageSrc: null,
    width: 1,
    height: 1,
  },

  // Per-exhibit in the portal. These are the values a NEW exhibit starts with,
  // and the fallback exhibit's own settings.
  media: {
    // What is projected onto the artwork. Exactly one per exhibit, and which
    // it is follows from the file: an .mp4 makes it 'video', a .jpg or .png
    // makes it 'image'. A still is worth having - an archival photograph of
    // the piece before restoration, or a painting's underdrawing - and it
    // costs a fraction of a video to deploy.
    kind: 'video',
    src: null,
    width: 0,
    height: 0,

    // How the media is mapped onto the artwork:
    //   'stretch' - fills the painting exactly, ignoring the media's own aspect ratio
    //   'cover'   - fills the painting exactly, crops the overflowing edges
    //   'contain' - shows the whole thing inside the painting, may leave a gap
    fit: 'stretch',

    loop: true,
    // Restart from 0:00 every time the target is re-found (false = resume).
    // Video only; a still has nothing to restart.
    restartOnFound: false,
    // Fine alignment, in target units. Use the debug panel's nudge buttons to
    // find values on-device, press "Log current values", then type them into
    // that exhibit's Settings in admin.html.
    scale: 1.0,
    offset: { x: 0, y: 0, z: 0.001 },
  },

  /**
   * The written and spoken details behind the "More details" button.
   *
   * What they say is per exhibit and per language, in the portal. These are
   * the only two things about the sheet that are the same for every exhibit.
   */
  details: {
    // Open the sheet by itself as soon as the media has played, rather than
    // waiting to be asked. Off: a panel that covers the artwork uninvited is
    // the fastest way to annoy someone who came to look at the artwork.
    autoOpen: false,
    // Pause the projected video while the sheet is open. It is behind the
    // sheet and unwatchable there, and its sound would fight the narration.
    pauseMediaWhileOpen: true,
  },

  // Per-exhibit in the portal: each exhibit has its own model and its own
  // height, turn and spin. These are the defaults a new one starts with.
  model: {
    // Add a .glb to an exhibit in admin.html instead of setting this. While
    // an exhibit has no model, the "Place AR figure" button drops in a
    // placeholder so the whole flow is still testable.
    src: null,

    // Degrees. y is the turn applied after the figure has been stood up and
    // faced at you — use it if the model was exported facing sideways. x and z
    // tilt it. Far easier to set with the viewer's Adjust panel than by hand.
    rotation: { x: 0, y: 0, z: 0 },

    // Metres from the spot the figure was placed on, in the direction you were
    // facing when you put it down: x to your right, y up, z towards you.
    // Relative to the placement rather than the room, so a saved value means
    // the same thing wherever in the gallery it is stood up.
    offset: { x: 0, y: 0, z: 0 },

    // Multiplier on the exhibit's own figure height, so the debug panel can
    // resize it on-device without touching the real-world measurement.
    scale: 1.0,

    // Slow turntable spin, and play the glTF's own animation clip if it has one.
    spin: false,
    playClip: true,

    // How the figure is shaded. Per exhibit in the portal.
    //   'baked' - render the texture exactly as authored, unlit. Correct for
    //             photogrammetry and anything with ambient occlusion already in
    //             the texture: the scene's directional light would otherwise
    //             shade it a SECOND time, and since that light is fixed in the
    //             world while you walk around, whole sides fall dark.
    //   'lit'   - keep the glTF's PBR materials and light them with the scene.
    lighting: 'baked',

    // Peak opacity of the soft contact shadow under the figure, 0 to 1.
    // 0 turns it off — worth doing when the model already carries its own
    // grounding shadow in the texture. Per exhibit in the portal.
    shadowOpacity: 0.5,

    // The SHAPE of that shadow, as soft ellipses lying on the floor:
    //   { x, z }  where it sits, in metres from the figure's feet
    //   { w, d }  its width and depth in metres — unequal values stretch it
    //   { r }     its turn, in degrees
    //   { o }     its own opacity, multiplied by shadowOpacity above, so one
    //             blob can be darker than the rest
    //   { c }     its colour as #rrggbb — black for most rooms, but a cool
    //             blue under daylight or a warm one under tungsten reads truer
    // Empty means one circle sized automatically from the figure, which is
    // what every exhibit did before this existed. Build a real shape out of
    // several — one for the body, one per foot, a long thin one under an
    // outstretched arm — in the viewer's Adjust panel, where you can see it
    // against the real object. Per exhibit.
    shadows: [],

    // Whether those ellipses ride on the figure. On, they grow with the Size
    // slider and turn with the figure's own yaw, so scaling a model scales its
    // shadow to match; pitch, roll and lift are deliberately left out, because
    // a shadow stays flat on the floor whatever the thing above it is doing.
    // Off, they stay put in metres. Per exhibit.
    shadowFollow: false,
    // The figure scale the ellipses were drawn at; the shadow then grows by
    // scale / shadowScale. Written by the Adjust panel — there is no reason to
    // set it by hand.
    shadowScale: 1,
  },

  /**
   * Scene 2/3: floor mapping.
   *
   * This is a separate AR scene from the painting. Image tracking and the video
   * are stopped before it starts, and nothing in it depends on the painting
   * being in frame.
   *
   * Two engines, picked automatically:
   *
   *   webxr  - real plane detection via WebXR hit-test. Chrome on Android. The
   *            floor is genuinely sensed and the figure is world-anchored in
   *            6DoF, so you can walk around it. Units are metres.
   *
   *   gyro   - fallback for everything else, iOS Safari above all: Safari has no
   *            WebXR at any version. The floor is taken to be the horizontal
   *            plane `cameraHeightMeters` below the phone, which the gyroscope
   *            gives us the direction of. "Stable" then means the phone is held
   *            steady and pointed at it. Rotation-only, so the figure holds its
   *            place while you turn and look, and drifts if you walk about.
   *
   * The log says which one is running, on every entry into the floor scene.
   */
  floor: {
    // false forces the gyro fallback everywhere — useful if WebXR misbehaves on
    // a particular Android device, since the fallback is the same code path iOS
    // already uses.
    useWebXR: true,

    // Gyro fallback only: how high above the floor the phone is held. This is
    // the one number that sets how far away and how big the figure looks.
    // WebXR measures it instead of assuming it.
    cameraHeightMeters: 1.4,

    // Default figure height for a new exhibit, in metres. Each exhibit then
    // carries its own, set in admin.html. Whatever units the .glb was exported
    // in and wherever its pivot sits, it lands on the floor at that height.
    objectHeightMeters: 1.0,

    // How steady the floor has to be before "Place AR figure" appears: the
    // target point must stay inside a ball this big for this long.
    stableSeconds: 1.2,
    stableToleranceMeters: 0.12,

    // Ignore candidate floor points nearer/further than this.
    minDistanceMeters: 0.6,
    maxDistanceMeters: 6,
    // WebXR only: how far below the camera a hit must be to count as floor
    // rather than a table or a windowsill.
    minDropMeters: 0.7,

    // The figure turns to face you when placed.
    faceViewer: true,
    // Master switch for the soft contact shadow. Per-exhibit strength lives in
    // model.shadowOpacity; this turns it off everywhere at once.
    shadow: true,
  },

  /**
   * Scene 3's camera button.
   *
   * The picture is composed, not screenshotted: the camera feed and the 3D
   * figure live in different places (see js/capture.js), so both are fetched
   * deliberately and drawn onto one canvas at the screen's aspect ratio.
   */
  photo: {
    enabled: true,
    // Longest edge of the saved picture, in pixels.
    maxEdge: 1600,
    format: 'image/jpeg',
    quality: 0.92,
    // Saved as <fileName>-<timestamp>.jpg.
    fileName: 'museum-ar',
  },

  /**
   * The logo strip printed across the top of every photo.
   *
   * Each slot is a labelled dashed box until you give it a `src`: drop the
   * artwork into assets/logos/ and fill the path in. Transparent PNG or SVG,
   * any width — the strip sizes every logo by height and keeps its aspect
   * ratio. Add, remove or rename slots freely; the row is centred and rescaled
   * to whatever is in it.
   */
  branding: {
    // Also show the strip on screen while the floor scene is open, so what you
    // frame is what you get.
    showOnScreen: true,
    // Strip height as a fraction of the picture's height.
    heightRatio: 0.075,
    // Gap between logos, same units.
    gapRatio: 0.03,
    // Dark gradient behind the strip, so pale logos stay legible over a bright
    // gallery wall.
    scrim: true,
    logos: [
      { src: null, label: 'LOGO 1' },   // e.g. './assets/logos/logo-1.png'
      { src: null, label: 'LOGO 2' },
      { src: null, label: 'LOGO 3' },
    ],
  },

  // MindAR tuning. -1 keeps the library default.
  //   filterMinCF  lower  = smoother, laggier   (default 0.001)
  //   filterBeta   higher = snappier, jitterier (default 1000)
  //   missTolerance frames before the target counts as lost (default 5)
  tracking: {
    filterMinCF: -1,
    filterBeta: -1,
    missTolerance: -1,
    warmupTolerance: -1,
  },

  ui: {
    maxLogEntries: 600,
    autoOpenLogOnError: false,
    showDebugTools: true,
    // Step sizes for the debug nudge buttons, in target units / multiplier.
    nudgeStep: 0.02,
    scaleStep: 0.05,
  },
};
