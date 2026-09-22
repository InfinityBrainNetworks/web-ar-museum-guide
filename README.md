# Web AR Museum Guide

Web AR that runs in the phone browser — no app install, no QR marker.

A visitor picks their language, browses the gallery, and points the camera at
an artwork to make it answer.

1. **Language** — asked once, before anything else, and remembered. English,
   Sinhala and Tamil out of the box; the list is editable in the portal.
2. **Explore** — every artwork in the gallery as a grid of cards, with a bottom
   bar: Explore · Map · **AR** · Feedback · Settings. Tapping a card opens its
   full label — photograph, title in each language, what it carries, the
   museum's text, **Listen**, and **View in AR**.
3. **Artwork** — the AR button starts the camera. It finds the piece and its
   media plays mapped exactly onto it: a video, or a still such as an archival
   photograph. Once it is up, **More details** appears, and **View in 3D** too
   if that exhibit has a 3D object.
4. **Details** — the same label, this time as a sheet that slides up over the
   artwork rather than replacing it, so the piece stays visible while you read.
5. **Floor** — image tracking and the video stop. Point the phone at the floor;
   when a surface holds still, **Place on the floor** appears.
6. **Placed** — the object stands where you put it, and the shutter button
   takes a photo of the whole scene for the visitor to keep.

**✕**, top-left, leaves AR at any point: the camera is released and the visitor
lands back in Explore.

Scenes 4 and 5 are deliberately independent of the artwork: nothing in them
needs it, so you can walk away, and the buttons stay on screen once earned
rather than vanishing the moment the artwork leaves the frame.

The page can carry **any number of exhibits**. An exhibit is one artwork —
a target image, the video or picture projected onto it, what the label says in
each language with the recording of it, and optionally a 3D object — and you add
them through the admin portal rather than by editing code.

Built on [A-Frame](https://aframe.io) 1.5.0 + [MindAR](https://hiukim.github.io/mind-ar-js-doc/) 1.2.5.
Works on Android (Chrome) and iOS (Safari 11.3+).

**Live:** https://infinitybrainnetworks.github.io/web-ar-museum-guide/
**Portal:** add `/admin.html` to that URL

Open it on the phone, choose a language, and you are in Explore. Tap the
round **AR** button in the middle of the bottom bar, allow the camera, and
point at one of the artworks in the grid.

## The two halves — browse and AR

The app is two halves that never run at once, and knowing which is which
explains most of the code.

| | Owns | Lives in |
|---|---|---|
| **Browse** | Explore, the label page, Settings, the bottom bar | `#shell` · `js/shell.js` · `css/shell.css` |
| **AR** | The camera, the scene, the scan HUD, the details sheet, the floor | `#overlay` · `js/app.js` · `css/style.css` |

`js/app.js` publishes a small one-directional interface, `window.ARViewer`:
the shell reads the exhibits app.js has already loaded, renders them, and asks
for the camera to start or stop. It never reaches into the scene.

**`#shell` is a sibling of `#overlay`, not a child of it — keep it that way.**
`#overlay` is WebXR's dom-overlay element, and A-Frame injects
`.a-dom-overlay:not(.a-no-style) > * { pointer-events: auto }` into the page.
Every full-bleed direct child of `#overlay` therefore swallows taps meant for
the ones beneath it; that has cost this project two bugs. The browse screens
never coexist with a WebXR session, so they belong outside it.

`#overlay` sits at `z-index: 45`, **above** the shell. That is safe only
because it is transparent to pointers and its children opt back in one by one.
It is that way so the debug button and the error banner stay reachable while
browsing — which is exactly when someone is staring at a start screen
wondering why nothing works.

### Map and Feedback

Both are in the bottom bar and neither is built. Each says what it still needs
rather than opening a screen that pretends:

- **Map** needs a floor plan of the gallery, and a room and wall for each
  exhibit. Neither exists in the content model or the portal yet.
- **Feedback** needs somewhere for the messages to go. This guide deploys as a
  static site, so there is no server to post to — that is a decision to make
  (a form endpoint, a serverless function, or an email link), not a missing
  screen.

### Settings

Language, **Reduce motion** (which does the same thing as the OS-level
preference), and **Debug log** — the switch that shows or hides the 🐞 button
over the camera. Both preferences are remembered per device in
`localStorage`, and both reads are wrapped: a private window makes the
accessor throw rather than return nothing.

## The look

The palette, the motion tokens and the atmosphere layers in `css/theme.css`
are ported from the Kotlin app's `design/shared/theme.css`, value for value, so
the two apps read as one product. **`css/theme.css` is the single source of
truth for colour** — the names in `style.css`, `shell.css` and `admin.css` are
each file's own vocabulary pointed at it. Change a colour there, not in three
places.

Type is a dual serif/sans hierarchy: a serif carries curatorial authority on
artwork names and titles, a sans keeps body copy legible in a dark room. Both
are the **device's own faces**, not a download. Android resolves them to the
very Noto Serif and Noto Sans the Kotlin app asks for, and its font fallback
already covers Sinhala and Tamil — so a webfont would cost a few hundred KB on
museum wifi to arrive at the same glyphs, and a gallery in a basement would get
a flash of nothing first.

Icons are inline SVG symbols defined once at the bottom of `index.html`. The
Kotlin designs use Material Symbols, which is also a webfont; these are the
same glyphs as paths, so the gallery's wifi is never between a visitor and a
legible button.

Sinhala and Tamil run **20–40% longer than English** with taller glyphs. Two
rules follow and are load-bearing throughout: line heights stay generous so
vowel diacritics are not cropped, and every title clamps to a line count rather
than a pixel height, so a long translation truncates instead of breaking the
grid.

## Adding exhibits — the admin portal

Open **`admin.html`** on a desktop browser. It runs entirely in that browser:
nothing is uploaded, there is no server and no account.

1. **+ Add exhibit**, then fill the four parts of the card:
   1. **Target image** — what visitors point the phone at.
   2. **Projection** — the video *or* the still picture mapped onto it. Which
      one it is follows from the file you drop; there is no mode to choose.
   3. **3D object** — optional `.glb`.
   4. **Details** — the label, one tab per language. English (or whichever
      language is first in the list) is required; the rest are optional and
      fall back to it. Each tab also takes a recording.
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

### The label — what "More details" opens

Each exhibit carries a **title** and a **body** per language, plus an optional
**recording** of it. The body is rich text: headings, **bold**, *italic*,
underline, and bulleted or numbered lists. That list is the whole of it, and
deliberately so — see *What the sanitiser allows* below.

- **The first language is the fallback.** An exhibit must be written in it, and
  a visitor who picked a language with no translation gets that text with a line
  saying which language they are reading. Silently showing English would read as
  a bug in the translation.
- **The language chips inside the sheet** only offer languages that exhibit is
  actually written in, so a chip can never open an empty sheet. Tapping one
  changes the whole app, not just that sheet — someone who reaches for Tamil
  once wants Tamil at the next artwork too.
- **Listen appears only when a recording was uploaded**, per language. There is
  no text-to-speech fallback: on the phones this gallery will actually meet,
  Sinhala and Tamil voices are missing or poor, so a Listen button backed by
  speech synthesis would work in English and fail in exactly the two languages
  it was added for. A silent exhibit is honest; a button that reads nothing
  aloud is not.
- MP3 or M4A for the recordings. They are deployed as files in the repo, same as
  the video, so keep an eye on the size.

### Languages — ⋯ → 🌐 Languages…

The list belongs to the gallery, not to an exhibit: it lives on the draft, ships
inside `content.json`, and the viewer's picker offers exactly what was authored.
Each entry is a **code** (`en`, `si`, `ta`, `pt-br`), a **name** in English, and
a **native** name — the picker shows the native one, because someone who reads
only Tamil cannot be expected to find themselves in a list written in English.

- **The first is the fallback.** Reorder to change which one that is.
- **Removing a language never deletes text.** It stops being offered; the words
  stay on every exhibit and come back if the language does.
- **Adding a language the interface has not been translated into is fine.** The
  museum's own words appear in it, wrapped in an English interface. The three
  shipped interface translations are in `js/i18n.js`, keyed by string, and
  falling back key by key — so a half-finished translation shows the half that
  is done.

The Sinhala and Tamil interface strings in `js/i18n.js` were written to get the
app running end to end and **should be read by a native speaker before the
gallery opens**. Nothing in the code compares against a displayed string, so
editing them is safe.

### What the sanitiser allows

The label is authored as HTML and rendered with `innerHTML`, so `js/content.js`
rebuilds it from a whitelist — `h2 h3 p strong em u ul ol li br`, and **no
attributes at all**. Everything else is unwrapped and its words kept; `script`,
`style`, `iframe` and friends are dropped contents and all.

It runs **twice**: once in the portal as you type, and again in the viewer
before the sheet is filled. The second pass is the one that matters —
`content.json` is a file in a repo, and a file in a repo can be edited by hand,
by a script, or by a merge nobody read.

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
| `js/content.js` | Resolves which exhibits to show, the rich-text sanitiser, the language rules, and the shared IndexedDB store |
| `js/i18n.js` | The interface's own words, in each language, and the remembered choice |
| `js/app.js` | The scene machine, media mapping, the details sheet, both floor engines, debug tools. Publishes `window.ARViewer` |
| `js/shell.js` | The browse half: Explore, the label page, Settings, the bottom bar |
| `js/capture.js` | The photo: composing camera feed + figure + logo strip, and saving it |
| `js/app.js` → *adjust panel* | The gear sheet: one spec builds every slider, tab and toggle |
| `js/admin.js` | The portal: editing, compiling, export, import |
| `js/zip.js` | Dependency-free ZIP reader/writer for the bundles |
| `js/config.js` | Global settings, plus the defaults a new exhibit starts from |
| `js/logger.js` | On-screen log window (loads first so it captures everything) |
| `css/theme.css` | **The palette, motion and type tokens.** Ported from the Kotlin app; every other stylesheet points at it |
| `css/style.css`, `css/shell.css`, `css/admin.css` | AR overlay, browse screens, portal |
| `assets/content/content.json` | **What the AR page reads** — every exhibit, in target order |
| `assets/content/targets.mind` | Compiled tracking data, written by the portal |
| `assets/logos/` | Drop the logo strip's artwork in here |
| `tools/` | Offline compiler, the command-line equivalent of the portal's Compile |

### Where content comes from

`js/content.js` tries three sources in order, and says in the log which one won:

| Source | When |
|---|---|
| **preview** | `index.html?preview=1` — the portal's draft, from IndexedDB |
| **bundle** | `assets/content/content.json` — what visitors get |
| **legacy** | `js/config.js` — only if it names a target image; the shipped one does not |
| **empty** | Nothing is deployed. Explore says so instead of inventing an exhibit. |

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

## Adjust — tuning an exhibit in front of the real thing

Numbers guessed at a desk are never right. The gear button (top right, under
🐞) opens a sheet with the exhibit's transform and look on live sliders, and a
**Save to exhibit** that puts them where Export will find them.

It is deliberately not part of the debug log. The log is a wall of text that
covers the very thing you are trying to look at; this takes up half the screen
at most and shows nothing but controls. The log carries on recording underneath
exactly as before — including a line for every save.

### The tabs

| Tab | What is on it |
|---|---|
| **Transform** | Size, Rotate X/Y/Z, Move X/Y/Z |
| **Effects** | Shading (baked/lit), spin, animation |
| **Shadow** | Strength, Follow, and the shape of the shadow as ellipses |
| **Video** | Fit, size and nudge for the video on the painting |

**Size** multiplies the exhibit's real height, and the readout shows what that
comes to in metres. **Rotate Y** is the turn about the vertical — the one you
normally want; X and Z tilt the figure. **Move** is in metres from the spot you
put it down on, in the direction you were facing at the time: X to your right,
Y up, Z towards you. Relative to the placement rather than to the room, so the
same numbers mean the same thing wherever in the gallery it gets stood up.

Raising a figure leaves its contact shadow on the floor, which is what a raised
object does. Tilting it does not tilt the shadow either.

### Shaping the shadow

Out of the box the shadow is one circle, sized automatically from the figure —
exactly what it always was. The **Shadow** tab lets you replace that with as
many soft ellipses as the shape needs: one under the body, one per foot, a long
thin one under an outstretched arm.

Each ellipse has **X** and **Z** (where it sits, in metres from the figure's
feet), **Width** and **Depth** (unequal values stretch it), **Turn**, its own
**Opacity**, and a **Colour** picked from six swatches. The first one you add
copies the automatic circle, so nothing jumps the moment you take control.

**Strength** is the peak opacity of the whole shadow and each ellipse's own
*Opacity* scales it from there, so a secondary blob under a raised arm can be
faint while the body stays solid. Strength at 0 still turns the lot off.

Colour is per ellipse too, and a new one inherits the last one's colour and
opacity, so setting it once carries through. Black suits most rooms; the cool
swatch reads truer under daylight and the warm one under tungsten. They are
fixed swatches rather than a colour picker because a native picker is not
guaranteed to open over an immersive WebXR session.

**Follow** ties the shape to the figure. Off — the default, and how it behaved
before — the ellipses stay put on the floor in metres. On, they grow with the
**Size** slider and turn with the figure's own **Rotate Y**, so rescaling a
model rescales its shadow to match instead of leaving you to redraw it. Pitch,
roll and lift are deliberately left out: a shadow stays flat on the floor
whatever the thing above it is doing. Switching Follow on records the size the
ellipses are at right now, so nothing changes until you move the Size slider.

Removing every ellipse goes back to the automatic circle, which is also what
the portal's **Auto** button next to *Shadow shape* does. That circle is sized
from the figure's live footprint, so it follows the size on its own.

### Getting it into the repo

**Save to exhibit** writes into the admin portal's draft in this browser — the
same draft the portal edits. Then open `admin.html`, press **Export bundle**,
and commit the zip's contents as usual. The values ride along in
`assets/content/content.json` like everything else.

That works when the browser doing the adjusting is the browser holding the
draft — which is the case when you reach the viewer through the portal's
**Preview** button. Adjusting on a phone while the portal lives on a laptop is
the other case, and that is what **Copy** is for: it puts a small block on the
clipboard, and the portal's ⋯ menu has **Paste adjustments…** to take it back.
Matched by exhibit id, never by position, so reordering exhibits cannot
silently retune the wrong one.

**Reset** puts the exhibit back to its saved values.

Everything on the sheet is also editable by hand in the portal's **Settings**,
and the debug log's **Log current values** still prints them all as text.

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
| "No exhibits yet" on Explore | Nothing is deployed. Add exhibits in the portal, compile, export, push. |
| **More details** opens an empty sheet | That exhibit has no text in the fallback language. The portal marks the card incomplete and blocks Export, so this means a hand-edited `content.json`. |
| Sheet says "Shown in English" | That exhibit has no translation in the chosen language yet. Fill its tab in the portal. |
| **Listen** never appears | No recording was uploaded for that language. There is no text-to-speech fallback, on purpose. |
| The language picker never appears | It is asked once and remembered. Tap the **EN / සි / த** chip in the top bar, or Settings → Language. |
| A language is missing from the picker | It is not in ⋯ → 🌐 Languages, or the deployed bundle predates it. Re-export. |
| Formatting vanished after pasting from Word | Only `h2 h3 p strong em u ul ol li br` survive the sanitiser, by design. |
| Export says an exhibit "still needs…" | The card says exactly what: a target image, a projection, or its details in the fallback language. |
| Portal is empty after it worked | Browser site data was cleared. Import your last exported zip. |
| **Map** or **Feedback** says "still needed" | Neither is built. The panel lists exactly what each one is waiting for. |
| The 🐞 button is not there | Settings → **Debug log** turns it off, and the choice is remembered per device. |
| The 🐞 button sits on the language chip | It should drop to the bottom-right while browsing. If it did not, `index.html` is older than `js/app.js` — hard-refresh. |
| Everything still animates with Reduce motion on | The switch sets `data-motion="off"` on `<html>`; a cached `css/theme.css` will not honour it. Clear the site data. |
| Explore is blank but the log says exhibits loaded | `js/shell.js` did not load. Check the network tab; it is the last script in `index.html`. |
| Leaving AR and going back in shows no buttons | The video is re-confirmed on the way back. If it stays blank for more than 6s the log says why. |
| An artwork will not track | Too few feature points. Compile and read the count on its card. |
| Figure goes dark down one side as you walk around | Its lighting is baked into the texture and the scene light is shading it again. Set *Shading* to **baked**. |
| Two shadows under the figure | The model carries its own. Set Adjust → Shadow → **Strength** to 0. |
| Shadow is a circle under a figure that is not | Adjust → **Shadow** → add ellipses and shape it. |
| Resizing the figure leaves the shadow behind | Adjust → Shadow → **Follow** → *Object*. |
| Shadow looks too hard, or the wrong colour for the room | Drop that ellipse's **Opacity**, or pick a warmer or cooler **Colour**. |
| Figure is the wrong size | *Figure height* is the real-world height; Adjust → **Size** is the quick nudge. |
| Adjust → Save says there is no draft | That browser has never opened `admin.html`. Use **Copy**, then **Paste adjustments…** in the portal. |
| Adjust → Save says the exhibit is not in the draft | The draft and the deployed bundle are different sets. Load what is deployed from the portal's ⋯ menu first. |
| Saved in Adjust but the site is unchanged | Save only reaches the portal draft. Export from `admin.html` and commit, same as any other change. |
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
