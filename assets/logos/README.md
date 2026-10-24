# Logo strip

The built-in logos printed along the bottom of every AR photo, on a light
plate, and shown above the shutter while the figure is standing:

| File | Whose |
|---|---|
| `ibn.png` | IBN — the mark alone, no wordmark (drawn from the one in `index.html`) |
| `sliit-creative-computing.png` | SLIIT Creative Computing (from the approved `.ai`) |
| `national-museum-colombo.png` | National Museum Colombo |

All three are transparent PNGs, trimmed and 360 px tall.

## Changing them

In the Studio: **Settings → Photo logos** — add, replace, rename, reorder or
remove, and the change is published with the gallery. These files stay as the
fallback, and as what a gallery without Firebase prints.

To change the built-in set itself, replace the files here and edit
`branding.logos` in [js/config.js](../../js/config.js). Any width is fine:
every logo is drawn at the same height and keeps its aspect ratio. About
400 px tall is plenty — the photo is 1600 px on its longest edge.
