# Web AR Museum Guide

Web AR that runs in the phone browser — no app install, no QR marker.

Three separate scenes, in order:

1. **Painting** — the camera finds the artwork and a video plays mapped exactly
   onto it. Once playback is confirmed, **View in 3D** appears.
2. **Floor** — image tracking and the video stop. Point the phone at the floor;
   when a surface holds still, **Place AR figure on the floor** appears.
3. **Placed** — the figure stands where you put it.

They are deliberately independent. Nothing in scenes 2 and 3 needs the painting,
so you can walk away from it, and **View in 3D** stays on screen once earned
rather than vanishing the moment the artwork leaves the frame.

Built on [A-Frame](https://aframe.io) 1.5.0 + [MindAR](https://hiukim.github.io/mind-ar-js-doc/) 1.2.5.
Works on Android (Chrome) and iOS (Safari 11.3+).

**Live:** https://infinitybrainnetworks.github.io/web-ar-museum-guide/

Open it on the phone, tap **Start AR**, allow the camera, and point at the
painting (`assets/targets/target.png` — print it, or show it on another screen).

## What's in the box

| Path | What it is |
|---|---|
| `index.html` | Page shell: AR scene + overlay UI |
| `js/config.js` | **All the tunables** — target size, video fit, model placement, tracking |
| `js/app.js` | The three-scene machine, video mapping, both floor engines, debug tools |
| `js/logger.js` | On-screen log window (loads first so it captures everything) |
| `css/style.css` | Overlay UI |
| `assets/targets/target.png` | The image being tracked (552 × 566) |
| `assets/targets/targets.mind` | Compiled tracking data for that image |
| `assets/video/video.mp4` | The video played on the painting (704 × 704, H.264, silent) |
| `assets/models/` | Drop your `.glb` here |
| `tools/` | Offline compiler that rebuilds `targets.mind` |

## Running it

The camera API needs **https** (or `localhost`). Plain `http://192.168.x.x` will not work.

**On a phone:** open the live URL above. Pages is already configured to deploy
from `main`, so pushing to `main` redeploys it.

**On a desktop with a webcam:**

```bash
npx http-server -p 8080     # then open http://localhost:8080
```

## How the video gets mapped onto the image

MindAR scales its anchor so **1 unit = the width of the target image**. The video
plane is therefore `1 × (imageHeight / imageWidth)` = `1 × 1.0254`, sitting at the
anchor origin — which is exactly the painting, at whatever size and angle it appears
in the camera.

The video is 704 × 704 and the painting is 552 × 566, so `video.fit` in `js/config.js`
decides what happens to that ~2.5% difference:

- `stretch` *(default)* — fill the painting exactly, ignore the video's aspect ratio
- `cover` — fill the painting exactly, crop the video's overflowing edges
- `contain` — show the whole video, may leave a small gap

Fine alignment lives in `video.scale` and `video.offset` (in target units, so `0.02`
is 2% of the painting's width).

## Adding the 3D figure

1. Put the `.glb` / `.gltf` in `assets/models/`.
2. Point `model.src` at it in `js/config.js`.

Until you do, the button places a built-in placeholder so the whole flow is testable.

The figure is auto-centred and **stands on its own base, not its origin** —
whatever units it was exported in and wherever its pivot sits, it lands on the
floor at `floor.objectHeightMeters` tall. It turns to face you when placed
(`floor.faceViewer`); `model.yawOffset` corrects an export that faces sideways.
glTF animation clips play automatically (`model.playClip`).

## Finding the floor

Scene 2 picks one of two engines automatically and says which in the log.

### webxr — Chrome on Android

Real plane detection through WebXR hit-test. The floor is genuinely sensed, and
because the session tracks the camera in 6DoF the figure is anchored to the room:
walk around it and it stays put. Units are metres, measured, not assumed.

Candidate surfaces are filtered so a table does not get mistaken for the floor —
the hit must be near-horizontal (`up.y > 0.85`) and at least `minDropMeters`
below the camera.

Entering this session needs exclusive use of the camera, so MindAR is stopped
first and rebuilt when you go back to the painting.

### gyro — everything else, iOS above all

**iOS Safari has no WebXR at any version**, so on iPhone there is nothing to
sense a plane with. Instead the gyroscope gives the exact direction of gravity,
and the floor is taken to be the horizontal plane `cameraHeightMeters` below the
phone. "Stable" then means a real, checkable thing: the phone is pointed at that
plane and has held still.

The consequences are worth being clear about:

- The distance to the floor is **assumed**, so if the phone is held much higher
  or lower than `cameraHeightMeters` the figure lands nearer or further than the
  reticle suggested. Tools → **Phone height** fixes that on-device.
- It tracks rotation only. Turning and looking around is accurate; **walking**
  while the figure is placed will drift it, because nothing is measuring where
  you moved to.

This path keeps the camera picture by pausing MindAR's processing rather than
stopping it, so the feed never blinks. If WebXR is tried first and fails, the
camera is rebuilt automatically before the fallback starts.

### Both engines

The same stability gate guards the Place button: the target point must stay
inside a `stableToleranceMeters` ball for `stableSeconds`. Drift out of it and
the button locks again, so you cannot place onto a surface that was never really
there.

```js
floor: {
  useWebXR: true,            // false forces the gyro path everywhere
  cameraHeightMeters: 1.4,   // gyro only — how high the phone is held
  objectHeightMeters: 1.0,   // the figure's real height
  stableSeconds: 1.2,
  stableToleranceMeters: 0.12,
}
```

## The debug log

Tap 🐞 (top right) at any time. The button gets a red badge when errors occur.

- **Copy** — the whole log plus a device header (UA, WebGL renderer, camera
  resolution, secure-context status, codec support) → paste it into chat.
- **Save** — same thing as a `.txt` file, for when clipboard access is blocked.
- **Tools** — live controls: cycle the video fit mode, jump between the three
  scenes without waiting for the real triggers, nudge the video, and set the
  assumed phone height, figure size and figure turn. **Log current values** then
  prints the numbers ready to paste into `js/config.js` — this is how you dial
  things in on the actual device instead of guessing.

It captures `console.*`, uncaught errors, promise rejections, failed resource
loads, every `<video>` event, and the AR lifecycle with timings.

## Swapping the target image

```bash
cd tools
npm install          # one-off
node compile-target.mjs ../assets/targets/new-target.png -o ../assets/targets/targets.mind
```

Then update `target.imageSrc`, `target.width` and `target.height` in `js/config.js`,
and `imageTargetSrc` in `index.html` if you renamed the `.mind` file.

The compiler prints a feature-point count — under ~400 means the image is too flat
or repetitive to track reliably. The current target scores 2723.

(The official [online compiler](https://hiukim.github.io/mind-ar-js-doc/tools/compile)
works too. The local one exists so targets can be rebuilt from a script; it swaps
MindAR's `node-canvas` dependency for a pure-JS decoder, so there's no native build.)

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Must be served over https" | Camera is blocked on plain http. Use the Pages URL. |
| Camera never starts on iOS | Opened inside Instagram/Facebook/etc. Those in-app browsers block `getUserMedia` — open in Safari. |
| Permission was denied once | iOS: Settings → Safari → Camera. Android: tap the padlock in the address bar → Permissions. |
| Target never locks | Poor light, glare on glass, or the painting is too small in frame. Fill about half the screen with it. |
| Video plays but is misaligned | Use Tools → nudge, then paste the printed values into `js/config.js`. |
| Video never starts | Send the log — it records `readyState`, `networkState` and the media error code. |
| "Place AR figure" never appears | The floor is not being found. On the gyro path the phone must actually point down at it; on WebXR, poor light or a plain glossy floor gives ARCore nothing to lock onto. |
| Figure lands nearer or further than the reticle | Gyro path only: `cameraHeightMeters` does not match how you hold the phone. Tools → Phone height. |
| Figure drifts when you walk | Expected on the gyro path — rotation only. Android gets 6DoF through WebXR. |
| Scene 2 shows a black screen | The camera did not come back after WebXR. The log says so; set `floor.useWebXR: false` to skip WebXR entirely. |
| Nothing happens on iOS when entering 3D | Motion access denied. Settings → Safari → Motion & Orientation Access. |

## Notes

- A-Frame and MindAR load from jsDelivr, so the first load needs a network
  connection. Everything else is served from this repo.
- The video has no audio track, which is what lets it autoplay on both platforms.
- Tracking is all on-device; no camera frames leave the phone.
