# Target compiler

Rebuilds `assets/targets/targets.mind` from a source image.

```bash
npm install                                                   # one-off
npm run compile                                               # the current target
node compile-target.mjs ../path/to/image.png -o ../assets/targets/targets.mind
```

Accepts `.png`, `.jpg`. Multiple images can be compiled into one `.mind`
(they become target index 0, 1, 2… in the order given).

MindAR's own offline compiler depends on `node-canvas`, a native module needing a
C++ toolchain. It only uses canvas to turn the image into RGBA pixels, so this
script decodes with `pngjs` / `jpeg-js` and hands the compiler a small canvas
stand-in instead — same output, no native build. Install with `--ignore-scripts`
if npm still tries to build the transitive `canvas` dependency.

The run prints a feature-point count per target. Under ~400 points means the
image is too flat or repetitive to track reliably.
