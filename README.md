# Web AR Museum Guide

Web AR that runs in the phone browser — no app install, no QR marker.

Three separate scenes, in order:

1. **Painting** — the camera finds the artwork and a video plays mapped exactly
   onto it. Once playback is confirmed, **View in 3D** appears.
2. **Floor** — image tracking and the video stop. Point the phone at the floor;
   when a surface holds still, **Place AR figure on the floor** appears.
3. **Placed** — the figure stands where you put it, and the shutter button
   takes a photo of the whole scene for the visitor to keep.

They are deliberately independent. Nothing in scenes 2 and 3 needs the painting,
so you can walk away from it, and **View in 3D** stays on screen once earned
rather than vanishing the moment the artwork leaves the frame.

The page can carry **any number of exhibits**. An exhibit is one set — a target
image, the video mapped onto it, and the 3D model that follows it onto the floor
— and you add them through the admin portal rather than by editing code.

Built on [A-Frame](https://aframe.io) 1.5.0 + [MindAR](https://hiukim.github.io/mind-ar-js-doc/) 1.2.5.
Works on Android (Chrome) and iOS (Safari 11.3+).

**Live:** https://infinitybrainnetworks.github.io/web-ar-museum-guide/
**Portal:** add `/admin.html` to that URL

Open it on the phone, tap **Start AR**, allow the camera, and point at one of the
artworks shown on the start screen.

## Adding exhibits — the admin portal

Open **`admin.html`** on a desktop browser. It runs entirely in that browser:
nothing is uploaded, there is no server and no account.

1. **+ Add exhibit**, then drop in a target image, a video, and optionally a `.glb`.
2. **⚙ Compile targets** — builds `targets.mind` from every target image, on your
   machine, using MindAR's own compiler. Each card then reports its feature
   point count, which is the honest answer to "will this track well".
3. **▶ Preview** — opens the AR page against the draft, in this browser.
4. **⬇ Export bundle** — downloads a zip. Unzip it at the root of the repo
   (it only writes into `assets/content/`) and push:

   ```bash
   git add assets/content
   git commit -m "Update AR exhibits"
   git push
   ```

Vercel and Pages both rebuild on push, so the exhibits are live a minute later.

### The one rule

**Exhibit order is target order.** Exhibit 1 is target 0 inside `targets.mind`,
and MindAR reports a find by that index. Adding, removing, reordering or
replacing an image therefore invalidates the compiled tracker — and a stale
tracker fails in the nastiest possible way: every exhibit still tracks, just
against the wrong video.

The portal watches for this. A banner at the top tells you when the tracker is
out of date, and **Export is blocked until you recompile**, so the broken
combination cannot reach the repo.

### Things worth knowing

- **Preview is this browser only.** Browser storage never leaves the device it
  is on, so Preview cannot reach your phone. To test on a phone, export, push,
  and open the live URL there.
- **Your exported zips are the backup.** The portal keeps files in this
  browser's storage; clearing site data deletes them. **Import a bundle** reads
  a zip straight back in, so keep them.
- **Load what is currently deployed** (⋯ menu) pulls the live exhibits into the
  portal so you can edit them.
- **Good target images** are busy, high-contrast and non-repeating. A flat
  colour, a smooth gradient or a regular pattern gives the tracker nothing to
  lock onto. Under ~400 feature points and it will struggle.
- Target images are capped at 1024 px on the long edge when compiled. MindAR's
  anchor scale is the target's own width, so everything downstream is a ratio
  and nothing is distorted by this.
- Right-click a filled image, video or model slot to clear it.

## What's in the box

| Path | What it is |
|---|---|
| `index.html` | The AR page: scene + overlay UI |
| `admin.html` | The authoring portal |
| `js/content.js` | Resolves which exhibits to show, and the shared IndexedDB store |
| `js/app.js` | The three-scene machine, video mapping, both floor engines, debug tools |
| `js/capture.js` | The photo: composing camera feed + figure + logo strip, and saving it |
| `js/admin.js` | The portal: editing, compiling, export, import |
| `js/zip.js` | Dependency-free ZIP reader/writer for the bundles |
| `js/config.js` | Global settings, plus the defaults a new exhibit starts from |
| `js/logger.js` | On-screen log window (loads first so it captures everything) |
| `css/style.css`, `css/admin.css` | Overlay UI, portal UI |
| `assets/content/content.json` | **What the AR page reads** — every exhibit, in target order |
| `assets/content/targets.mind` | Compiled tracking data, written by the portal |
| `assets/targets/`, `assets/video/` | The original single exhibit, still referenced by `content.json` |
| `assets/logos/` | Drop the logo strip's artwork in here |
| `tools/` | Offline compiler, the command-line equivalent of the portal's Compile |

### Where content comes from

`js/content.js` tries three sources in order, and says in the log which one won:

| Source | When |
|---|---|
| **preview** | `index.html?preview=1` — the portal's draft, from IndexedDB |
| **bundle** | `assets/content/content.json` — what visitors get |
| **legacy** | `js/config.js` — a checkout that has never had a bundle exported |

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

When the video's aspect ratio does not match the artwork's, the exhibit's
**Video fit** setting decides what happens to the difference:

- `stretch` *(default)* — fill the painting exactly, ignore the video's aspect ratio
- `cover` — fill the painting exactly, crop the video's overflowing edges
- `contain` — show the whole video, may leave a small gap

Fine alignment lives in each exhibit's *Video scale* and *Video nudge* (in target
units, so `0.02` is 2% of the artwork's width). To find the numbers on a phone,
use the debug panel's nudge buttons, press **Log current values**, then type them
into that exhibit's Settings in the portal.

## Adding the 3D figure

Drop a `.glb` onto an exhibit's third slot in the portal. **Each exhibit has its
own model**, and its own height and turn — the figure that appears on the floor
is the one belonging to the artwork you last scanned. An exhibit without a model
places a built-in placeholder, so the whole flow is testable before you have one.

Export `.glb`, not `.gltf`: a `.gltf` references its textures as separate files,
which a single-file bundle cannot carry.

The figure is auto-centred and **stands on its own base, not its origin** —
whatever units it was exported in and wherever its pivot sits, it lands on the
floor at the exhibit's *Figure height*. *Size multiplier* scales that without
restating the measurement, which is the quick way to dial a model in on the
device. It turns to face you when placed (`floor.faceViewer`); *Figure turn*
corrects an export that faces sideways. glTF animation clips play automatically.

### Shading: leave it on "baked" for scans

A photogrammetry scan or a model with baked ambient occlusion already carries
its lighting **in the texture**. Light it again with a scene light and you get
two lightings stacked — and because that light is fixed in world space while you
walk around the figure, whole sides drop into darkness that is not in the asset
at all. It looks correct from one angle and wrong from the next.

So *Shading* defaults to **baked**: the materials are swapped for unlit ones and
the texture renders exactly as authored, from every angle. Switch to **lit** for
a model that genuinely has no lighting baked in and wants the scene to light it.
The originals are kept in memory, so the debug menu can flip between the two on
the device without reloading anything.

*Contact shadow* is the soft blob under the figure, 0 to 1. **Set it to 0 or
around 0.1 for a model that already has its own grounding shadow in the
texture**, or you get a second shadow stacked under the first.

## The photo

Once the figure is standing, a shutter button appears. It takes one picture of
the whole scene — the real room from the camera, the figure standing in it, and
a strip of logos across the top — and offers it to the phone's share sheet,
which is what puts it in the camera roll on both platforms. If the share sheet
is unavailable the picture downloads instead; on Android that lands in
Downloads, which the gallery picks up.

Nothing is uploaded. The picture is composed in the page and handed straight to
the operating system.

### Why it is composed rather than screenshotted

Neither half of the picture is in the canvas:

- **The camera feed** is a `<video>` painted *behind* the canvas on the gyro
  path, and on WebXR it is the system compositor's passthrough, which never
  enters our GL context at all. That one has to be asked for by name — the
  `camera-access` session feature, requested in `index.html` — and read back
  inside the very XR frame that handed the texture over.
- **The figure** is in the drawing buffer, which is wiped before the next line
  of JavaScript runs, and during a WebXR session is not the canvas's buffer at
  all but the session's.

So `js/capture.js` fetches both deliberately: it re-renders the scene into an
offscreen target through the live camera's own pose and projection, reads the
camera picture back, and draws feed → figure → logos onto a 2D canvas. The log
says which parts it got: `camera feed: yes, figure: yes`.

`camera-access` is requested as *optional*, so a device that will not grant it
still starts a normal AR session — only the photo's background is lost, and
both the log and the preview say so in as many words.

### The logo strip

Three labelled dashed boxes by default. To use real artwork, drop it into
`assets/logos/` and fill in the `src` for that slot in `branding.logos`
(`js/config.js`):

```js
logos: [
  { src: './assets/logos/logo-1.png', label: 'LOGO 1' },
  ...
]
```

Transparent PNG or SVG, any width — every logo is sized by height and keeps its
aspect ratio, so wordmarks and square badges mix. Add, remove or rename slots
freely; the row is centred and squeezed to fit whatever is in it. A slot without
a `src` stays a placeholder box, in the photo and on screen, so the layout is
visible and correctly spaced before the artwork exists.

The same `branding` block sets the strip's height and spacing, the dark gradient
behind it, and whether it also shows on screen during the floor scene — it does
by default, so what you frame is what you get. `photo` next to it sets the
picture's size, format and file name.

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

**Clip planes matter here more than anywhere else.** MindAR sets `near = 10` and
`far = 1e5` on the camera, which is correct in its own units (552 per metre, so
near is 1.8cm). WebXR is in metres, and three.js pushes whatever it finds on the
camera straight into the session:

```js
session.updateRenderState({ depthNear: camera.near, depthFar: camera.far })
```

Entering a session without resetting those puts the near plane at **10 metres**.
Passthrough and the DOM overlay keep drawing, so the page looks completely
alive — and every bit of 3D is clipped away.

Swapping in 0.05/200m once is not enough, because **MindAR's window resize
listener outlives `stop()`** — the library calls `removeEventListener` nowhere,
and registers the handler as `this._resize.bind(this)`, an anonymous bound
function that cannot be removed afterwards. Entering the session resizes the
canvas, that listener fires, and `_resize()` puts `near = 10` right back.

So there are two defences: `_resize` is wrapped before MindAR binds it, and the
planes are re-asserted every frame while an XR engine is running, which heals
the reset whatever causes it. MindAR's values are restored before image tracking
resumes. The log records the swaps, counts any corrections, and reads back the
session's accepted `depthNear` twice.

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

## Compiling targets from the command line

The portal is the normal route. This is the same job from a script, for CI or a
batch of targets:

```bash
cd tools
npm install          # one-off
node compile-target.mjs ../a.png ../b.png -o ../assets/content/targets.mind
```

**The image order on that command line is the exhibit order in `content.json`.**
Get them out of step and every exhibit tracks against the wrong video, which is
exactly the mistake the portal exists to prevent — so if you compile by hand,
edit `content.json` in the same commit.

The compiler prints a feature-point count per target; under ~400 means the image
is too flat or repetitive to track reliably.

(It swaps MindAR's `node-canvas` dependency for a pure-JS decoder, so there is no
native build to fight with. The official
[online compiler](https://hiukim.github.io/mind-ar-js-doc/tools/compile) works too.)

## Troubleshooting

| Symptom | Cause |
|---|---|
| Right artwork, **wrong video** | The tracker and `content.json` are out of step. Re-export from the portal. |
| "No exhibits could be loaded" | No `assets/content/content.json` is deployed. Export a bundle from the portal. |
| Portal is empty after it worked | Browser site data was cleared. Import your last exported zip. |
| An artwork will not track | Too few feature points. Compile and read the count on its card. |
| Figure goes dark down one side as you walk around | Its lighting is baked into the texture and the scene light is shading it again. Set *Shading* to **baked**. |
| Two shadows under the figure | The model carries its own. Set *Contact shadow* to 0. |
| Figure is the wrong size | *Figure height* is the real-world height; *Size multiplier* is the quick nudge. |
| Photo has the figure but no room behind it | The device would not grant `camera-access`, so the WebXR passthrough is unreadable. The log says so. |
| Photo button never appears | It is scene 3 only — place the figure first. `photo.enabled: false` also hides it. |
| Logos show as dashed boxes | No `src` set for those slots. See **The logo strip**. |
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
| Reticle and figure invisible, everything else fine | Clip planes. `XR render state @5s: depthNear=…` should read ~0.05m; if it says 10m, send the log. |
| Nothing happens on iOS when entering 3D | Motion access denied. Settings → Safari → Motion & Orientation Access. |

## Notes

- A-Frame and MindAR load from jsDelivr, so the first load needs a network
  connection. Everything else is served from this repo.
- The video has no audio track, which is what lets it autoplay on both platforms.
- Tracking is all on-device; no camera frames leave the phone.
