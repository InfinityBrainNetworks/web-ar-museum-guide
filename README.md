# Web AR Museum Guide

Markerless-free image-tracking AR that runs in the phone browser — no app install.
Point the camera at the painting, a video plays mapped exactly onto it, and once
playback is confirmed a button appears that drops a related 3D object into the scene.

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
| `js/app.js` | AR lifecycle, video mapping, 3D placement, debug tools |
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

## Adding the 3D object

1. Put the `.glb` / `.gltf` in `assets/models/`.
2. Point `model.src` at it in `js/config.js`:

```js
model: {
  src: './assets/models/artifact.glb',
  orientation: 'upright',   // 'flat' if the target lies on a table
  fitSize: 0.5,             // largest dimension = half the painting's width
  position: null,           // null = auto-place just below the painting
}
```

Until you do, the button places a built-in placeholder so the whole flow is testable.

The model is auto-centred and auto-scaled — whatever units it was exported in,
its largest dimension becomes `fitSize` target units. glTF animation clips play
automatically (`model.playClip`).

`orientation` matters: `upright` assumes the target hangs on a wall, so the model
stands facing the viewer. `flat` assumes the target is printed and lying on a
table, so the model stands up off the paper.

## The debug log

Tap 🐞 (top right) at any time. The button gets a red badge when errors occur.

- **Copy** — the whole log plus a device header (UA, WebGL renderer, camera
  resolution, secure-context status, codec support) → paste it into chat.
- **Save** — same thing as a `.txt` file, for when clipboard access is blocked.
- **Tools** — live alignment controls: cycle the video fit mode, flip the model
  orientation, nudge the video and model with arrow buttons. **Log current
  values** then prints the numbers ready to paste into `js/config.js` — this is
  how you dial in alignment on the actual device instead of guessing.

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

## Notes

- A-Frame and MindAR load from jsDelivr, so the first load needs a network
  connection. Everything else is served from this repo.
- The video has no audio track, which is what lets it autoplay on both platforms.
- Tracking is all on-device; no camera frames leave the phone.
