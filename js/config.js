/**
 * Everything tunable in one place.
 *
 * The AR scene works in "target units": 1 unit = the width of the target image.
 * So a plane 1 wide and (imageHeight / imageWidth) tall covers the painting exactly.
 */
window.AR_CONFIG = {

  target: {
    // Compiled with: cd tools && npm install && npm run compile
    // MindAR reads this path from the <a-scene mindar-image="imageTargetSrc: ...">
    // attribute in index.html, so change it in both places. The app warns in the
    // log if the two ever drift apart.
    mindSrc: './assets/targets/targets.mind',
    // Source image, shown as a thumbnail on the start screen.
    imageSrc: './assets/targets/target.png',
    width: 552,
    height: 566,
  },

  video: {
    src: './assets/video/video.mp4',
    width: 704,
    height: 704,

    // How the video is mapped onto the painting:
    //   'stretch' - fills the painting exactly, ignoring the video's own aspect ratio
    //   'cover'   - fills the painting exactly, crops the video's overflowing edges
    //   'contain' - shows the whole video inside the painting, may leave a gap
    fit: 'stretch',

    loop: true,
    // Restart from 0:00 every time the target is re-found (false = resume).
    restartOnFound: false,
    // Fine alignment, in target units. Use the debug panel's nudge buttons to
    // find values on-device, then paste them here.
    scale: 1.0,
    offset: { x: 0, y: 0, z: 0.001 },
  },

  model: {
    // Drop a .glb/.gltf in assets/models/ and point here, e.g.
    //   src: './assets/models/artifact.glb'
    // While null, the "Place AR figure" button drops in a placeholder so the
    // whole flow is testable.
    src: null,

    // Extra turn applied after the figure has been stood up and faced at you,
    // in degrees. Use it if the model was exported facing sideways or backwards.
    yawOffset: 0,

    // Multiplier on floor.objectHeightMeters, so the debug panel can resize the
    // figure on-device without touching the real-world measurement.
    scale: 1.0,

    // Slow turntable spin, and play the glTF's own animation clip if it has one.
    spin: false,
    playClip: true,
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

    // The figure's real height. Whatever units the .glb was exported in and
    // wherever its pivot sits, it lands on the floor at this height.
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
    // Soft contact shadow, so it reads as standing on the floor.
    shadow: true,
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
