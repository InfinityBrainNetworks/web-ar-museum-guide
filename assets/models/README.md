# 3D models

Drop the `.glb` (or `.gltf` + its files) for the exhibit here, then point
`model.src` at it in `js/config.js`:

```js
model: { src: './assets/models/artifact.glb', ... }
```

Until one is configured, the "Place 3D object" button drops in a built-in
placeholder so the flow stays testable.

Notes:
- `.glb` is preferred — single file, no missing-texture surprises.
- Size and centring are handled automatically: the model is centred on its
  bounding box and scaled so its largest dimension equals `model.fitSize`
  (in target units, where 1 = the painting's width).
- Keep it light. A phone browser is not a workstation: aim for under ~5 MB
  and a few hundred thousand triangles, with textures at 1–2K.
- glTF animation clips are played automatically.
