# Web AR Museum Guide

Image-tracking AR that runs in the phone browser — no app install, no QR marker.
Point the camera at the painting, a video plays mapped exactly onto it, and once
playback is confirmed a button appears that stands a related 3D object on the
gallery floor in front of it.

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
2. Point `model.src` at it in `js/config.js`.

Until you do, the button places a built-in placeholder so the whole flow is testable.

The model is auto-centred and auto-scaled, and stands on its own base rather than
its origin — whatever units it was exported in and wherever its pivot sits, it
lands on the floor at `floor.objectHeightMeters` tall. glTF animation clips play
automatically (`model.playClip`).

## Finding the floor

The object stands on the gallery floor, in front of the painting.

Nothing here *senses* the floor, and that is deliberate: WebXR hit-test — the only
real plane detection on the web — exists in Chrome on Android and nowhere on iOS,
so a version that probed the room would work on half the phones this has to run
on. The floor is derived from the painting instead.

A painting hangs flat and level on a vertical wall, so the tracked target's own
axes are the room's: `+X` along the wall, `+Y` straight up, `+Z` out into the
room. The floor is the plane

```
y = -(centerHeightMeters / paintingWidthMeters)
```

in target units. Because it rides the same tracked pose the video does, it stays
welded to the real floor at every angle and distance — no drift, no re-detection,
and it is already correct the moment the target locks.

It is only as accurate as two measurements, taken once per painting:

```js
floor: {
  paintingWidthMeters: 1.0,    // the painting's real width
  centerHeightMeters: 1.45,    // height of its CENTRE above the floor
  distanceMeters: 1.2,         // how far out from the wall the object stands
  objectHeightMeters: 1.0,     // the object's real height
}
```

Measure them with a tape, or dial them in on-site with the debug panel's **Floor**
row and paste back what **Log current values** prints.

**Tap the floor to move the object.** The tap is cast against that same plane, so
it lands where you point. Taps that fall above the line where floor meets wall are
ignored rather than snapped to the skirting.

**Looking down.** Tilting the phone to see the floor takes the painting out of
frame, and tracking drops with it. The object lives on `#floorRig`, which mirrors
the anchor's pose instead of parenting to it, so when tracking goes the gyroscope
carries the pose for `holdSeconds` and the object stays where it was put. The
status chip reads *Holding position* while that lasts. It is rotation only —
standing still and tilting is accurate; walking around while the painting is out
of frame will drift. On iOS the motion permission prompt appears on **Start AR**;
if it is denied the object hides when tracking drops instead of holding.

Set `floor.enabled: false` to go back to hanging the object against the painting
itself, using `model.fitSize`, `model.position` and `model.orientation`.

## The debug log

Tap 🐞 (top right) at any time. The button gets a red badge when errors occur.

- **Copy** — the whole log plus a device header (UA, WebGL renderer, camera
  resolution, secure-context status, codec support) → paste it into chat.
- **Save** — same thing as a `.txt` file, for when clipboard access is blocked.
- **Tools** — live alignment controls: cycle the video fit mode, flip the model
  orientation, turn floor mode on and off, raise/lower the floor plane, push the
  object in and out from the wall, and nudge the video and model with arrow
  buttons. **Log current values** then prints the numbers ready to paste into
  `js/config.js` — this is how you dial in alignment and the two floor
  measurements on the actual device instead of guessing.

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
| Object floats above or sinks into the floor | `centerHeightMeters` or `paintingWidthMeters` is off. Tools → Floor → Height, then paste the printed values. |
| Object is the wrong size | `objectHeightMeters` is its real height in metres; `paintingWidthMeters` is what converts it. |
| Object vanishes when you look down | Motion access was denied, or the hold ran out. iOS: Settings → Safari → Motion & Orientation Access. |

## Notes

- A-Frame and MindAR load from jsDelivr, so the first load needs a network
  connection. Everything else is served from this repo.
- The video has no audio track, which is what lets it autoplay on both platforms.
- Tracking is all on-device; no camera frames leave the phone.
