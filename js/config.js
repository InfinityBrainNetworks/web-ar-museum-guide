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

    // Only used when floor.enabled is false — on the floor the object is always
    // the right way up.
    // 'upright' - stands out of the image plane facing the viewer (painting on a wall)
    // 'flat'    - stands up off the image surface (target printed and lying on a table)
    orientation: 'upright',

    // Largest dimension of the model, in target units (1 = painting width).
    // On the floor, floor.objectHeightMeters takes over instead.
    fitSize: 0.4,
    // Ignored while floor.enabled is true.
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

  /**
   * Floor placement.
   *
   * There is no floor *sensor* available here: WebXR hit-test is Android-Chrome
   * only and iOS Safari has no WebXR at all, so anything that actually probes
   * the room would work on one platform and not the other. Instead the floor is
   * derived from the painting, which MindAR already tracks in full 6DoF: the
   * painting hangs flat on a vertical wall, so its own "down" axis points at the
   * floor and the floor is the horizontal plane `centerHeightMeters` below it.
   *
   * That makes it as accurate as these two measurements. Take them once per
   * painting with a tape measure, or dial them in on-site with the debug panel's
   * Floor row and paste back what "Log current values" prints.
   */
  floor: {
    enabled: true,

    // The painting's real width, and the height of its CENTRE above the floor.
    // Everything else here is in metres and converted using these two.
    paintingWidthMeters: 1.0,
    centerHeightMeters: 1.45,   // galleries normally hang to a 145-155cm centre line

    // Where the object stands: this far out from the wall, on the floor.
    distanceMeters: 1.2,
    // Real height of the object. 0 = fall back to model.fitSize instead.
    objectHeightMeters: 1.0,

    // Tap the floor in the camera view to move the object there.
    tapToMove: true,
    maxDistanceMeters: 6,       // clamp, so a tap at the horizon can't fling it away
    maxSideMeters: 4,

    // Looking down at the floor takes the painting out of frame, which loses
    // tracking. The gyroscope carries the pose for this long so the object stays
    // put instead of vanishing. Rotation only — walking around while the target
    // is lost will drift. 0 disables the hold.
    holdSeconds: 25,
    useGyro: true,

    // Soft contact shadow, so the object reads as standing on the floor.
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
