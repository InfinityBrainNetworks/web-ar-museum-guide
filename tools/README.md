# Target compiler

Rebuilds `assets/content/targets.mind` from the source images.

The portal's **⚙ Compile targets** does the same job in the browser and is the
normal route; this is for a build server, or for a set too large to compile in
a tab.

```bash
npm install                                                   # one-off
node compile-target.mjs ../assets/content/*-target.png -o ../assets/content/targets.mind
```

**The order of the images is the order of the exhibits in `content.json`.**
`targetIndex` is a position, not a name, so compiling them in a different order
leaves every exhibit tracking against the wrong one.

Accepts `.png` and `.jpg`.

MindAR's own offline compiler depends on `node-canvas`, a native module needing a
C++ toolchain. It only uses canvas to turn the image into RGBA pixels, so this
script decodes with `pngjs` / `jpeg-js` and hands the compiler a small canvas
stand-in instead — same output, no native build. Install with `--ignore-scripts`
if npm still tries to build the transitive `canvas` dependency.

The run prints a feature-point count per target. Under ~400 points means the
image is too flat or repetitive to track reliably.
