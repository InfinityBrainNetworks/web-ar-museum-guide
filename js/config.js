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
    // While null, the "Place 3D object" button drops in a placeholder so the
    // whole flow is testable.
    src: null,

    // 'upright' - stands out of the image plane facing the viewer (painting on a wall)
    // 'flat'    - stands up off the image surface (target printed and lying on a table)
    orientation: 'upright',

    // Largest dimension of the model, in target units (1 = painting width).
    fitSize: 0.4,
    // null = auto-place floating in front of the painting's lower third.
    // Or give { x, y, z } in target units — e.g. { x: 0, y: -0.85, z: 0.05 }
    // hangs it below the painting instead. Use the debug panel's nudge buttons
    // to find values on-device, then "Log current values" prints them here.
    position: null,
    extraRotation: { x: 0, y: 0, z: 0 },
    scale: 1.0,
    // Slow turntable spin, and play the glTF's own animation clip if it has one.
    spin: true,
    playClip: true,
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
