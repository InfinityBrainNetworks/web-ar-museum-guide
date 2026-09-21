# Logo strip

The row of logos printed across the top of every AR photo, and shown over the
camera feed while the floor scene is open.

## Adding one

1. Drop the artwork in here. Transparent PNG or SVG, any width — the strip
   sizes every logo by height and keeps its aspect ratio, so wide wordmarks and
   square badges mix fine. Around 400px tall is plenty; the photo is 1600px on
   its longest edge.
2. Fill in that slot's `src` in `branding.logos` ([js/config.js](../../js/config.js)):

   ```js
   { src: './assets/logos/logo-1.png', label: 'LOGO 1' },
   ```

A slot with no `src` is drawn as a labelled dashed box, on screen and in the
photo, so the layout is visible and correctly spaced before the artwork exists.
All three start that way, which is why this folder starts empty.

## Changing how many there are, or what they are called

`branding.logos` in [js/config.js](../../js/config.js). Add, remove or rename
slots there; the row is centred and rescaled to fit whatever is in it. The same
file has the strip's height, the gap between logos, whether a dark gradient is
drawn behind it, and whether it shows on screen as well as in the photo.
