/**
 * Reading files before they are uploaded: their sizes, their dimensions, and
 * what would make them slow or broken on a visitor's phone.
 *
 * Every number a visitor downloads is chosen here or warned about here. The
 * advice is the same that got the deployed gallery to ~25 MB for nine
 * paintings and three figures; see "The deployed gallery" in the README.
 */

// ------------------------------------------------------------------ images
async function bitmapOf(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(source, maxEdge, quality) {
  const w0 = source.width, h0 = source.height;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';       // a transparent PNG becomes a photo on white, not on black
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve({ blob: b, width: w, height: h }), 'image/jpeg', quality));
}

export const TARGET_EDGE = 1024;   // what the tracker is compiled at - see admin.js on why
export const THUMB_EDGE = 480;

/**
 * A target photo, ready to upload: at most 1024 px (the tracker never uses
 * more, and visitors download it for the label page), and a 480 px thumbnail
 * for the Explore grid. A JPEG already that small is kept byte for byte.
 */
export async function prepareTarget(file) {
  const bitmap = await bitmapOf(file);
  const width = bitmap.width, height = bitmap.height;
  let display;
  if (file.type === 'image/jpeg' && Math.max(width, height) <= TARGET_EDGE) {
    display = { blob: file, width, height };
  } else {
    display = await canvasBlob(bitmap, TARGET_EDGE, 0.86);
  }
  const thumb = await canvasBlob(bitmap, THUMB_EDGE, 0.8);
  if (bitmap.close) bitmap.close();
  return { display, thumb, original: { width, height, size: file.size } };
}

export async function imageSize(blob) {
  const b = await bitmapOf(blob);
  const out = { width: b.width, height: b.height };
  if (b.close) b.close();
  return out;
}

// ------------------------------------------------------------------ video, audio
function mediaMeta(file, tag) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    const url = URL.createObjectURL(file);
    const done = (value, err) => {
      // Detach and stop the element BEFORE revoking its URL, or it carries on
      // asking the revoked blob for byte ranges and the console fills up.
      el.onloadedmetadata = el.onerror = null;
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      if (err) reject(err); else resolve(value);
    };
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => done({
      width: el.videoWidth || 0, height: el.videoHeight || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
    });
    el.onerror = () => done(null, new Error('this browser cannot read that ' + tag + ' file'));
    el.src = url;
  });
}

export const probeVideo = (file) => mediaMeta(file, 'video');
export const probeAudio = (file) => mediaMeta(file, 'audio');

export const FFMPEG_VIDEO =
  'ffmpeg -i in.mp4 -vf "scale=\'min(960,iw)\':-2" -c:v libx264 -crf 24 -preset slow -an -movflags +faststart out.mp4';
export const FFMPEG_AUDIO = 'ffmpeg -i in.wav -ac 1 -b:a 96k out.mp3';

export function videoAdvice(file, meta) {
  const notes = [];
  const mb = file.size / 1048576;
  if (mb > 6) notes.push(['bad', `${mb.toFixed(1)} MB is a lot for one painting — every visitor who points at it downloads it. Aim for 1–2 MB.`]);
  else if (mb > 3) notes.push(['warn', `${mb.toFixed(1)} MB. Fine, but 1–2 MB is usually enough.`]);
  else notes.push(['ok', `${mb.toFixed(1)} MB — light enough.`]);
  if (meta && Math.max(meta.width, meta.height) > 1280) {
    notes.push(['warn', `${meta.width}×${meta.height} is more than a phone shows on a painting. 960 px on the long edge is plenty.`]);
  }
  if (file.type && file.type !== 'video/mp4') notes.push(['warn', 'Use H.264 MP4: it is the only format every phone plays.']);
  return notes;
}

// ------------------------------------------------------------------ glb
const GLB_MAGIC = 0x46546c67;

function imageDims(bytes, mime) {
  try {
    if (mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    // JPEG: walk the markers to the first start-of-frame.
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
      }
      i += 2 + len;
    }
  } catch { /* unknown */ }
  return null;
}

/**
 * Look inside a .glb without loading it: what it contains, and what will hurt.
 *
 * The checks are the ones this gallery has learnt the hard way:
 *   - 4096² textures decode to ~90 MB of GPU memory each; three of them
 *     crashed Safari on an iPhone.
 *   - a quantized SKINNED model is sized wrong by the viewer (its stored
 *     bounds are the quantization box, not the figure).
 *   - Draco and meshopt need decoders the viewer does not load.
 */
export async function inspectGlb(file) {
  const buf = await file.arrayBuffer();
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('That is not a binary glTF (.glb). Export .glb, not .gltf - a .gltf keeps its textures in separate files.');
  }
  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLength)));
  const binStart = 20 + jsonLength + 8;

  const accessors = json.accessors || [];
  let triangles = 0, vertices = 0;
  (json.meshes || []).forEach((mesh) => (mesh.primitives || []).forEach((p) => {
    const pos = accessors[p.attributes && p.attributes.POSITION];
    if (pos) vertices += pos.count;
    const count = p.indices !== undefined ? (accessors[p.indices] || {}).count : (pos ? pos.count : 0);
    if ((p.mode === undefined || p.mode === 4) && count) triangles += Math.floor(count / 3);
  }));

  const textures = (json.images || []).map((img, i) => {
    let dims = null, bytes = 0;
    if (img.bufferView !== undefined && json.bufferViews) {
      const view = json.bufferViews[img.bufferView];
      bytes = view.byteLength;
      dims = imageDims(new Uint8Array(buf, binStart + (view.byteOffset || 0), Math.min(view.byteLength, 65536)), img.mimeType);
    }
    return { index: i, name: img.name || 'image ' + i, mime: img.mimeType || '?', bytes, w: dims ? dims.w : 0, h: dims ? dims.h : 0 };
  });

  const animations = (json.animations || []).map((a, i) => {
    let duration = 0;
    (a.samplers || []).forEach((s) => {
      const input = accessors[s.input];
      if (input && input.max) duration = Math.max(duration, input.max[0]);
    });
    return { name: a.name || 'clip ' + (i + 1), duration };
  });

  const used = json.extensionsUsed || [];
  const skinned = (json.skins || []).length > 0;
  const gpuBytes = textures.reduce((sum, t) => sum + (t.w * t.h * 4 * 1.33), 0);
  const report = {
    size: file.size,
    triangles, vertices,
    meshes: (json.meshes || []).length,
    materials: (json.materials || []).length,
    textures,
    maxTexture: textures.reduce((m, t) => Math.max(m, t.w, t.h), 0),
    gpuMB: Math.round(gpuBytes / 1048576),
    skinned,
    animations,
    extensions: used,
    generator: (json.asset && json.asset.generator) || '',
  };
  report.notes = glbAdvice(report);
  return report;
}

export function glbAdvice(r) {
  const notes = [];
  const mb = r.size / 1048576;
  if (mb > 12) notes.push(['bad', `${mb.toFixed(1)} MB. Visitors wait for all of it before the figure appears. Aim for 2–5 MB.`]);
  else if (mb > 6) notes.push(['warn', `${mb.toFixed(1)} MB — on the heavy side; 2–5 MB loads in a moment on museum wifi.`]);
  else notes.push(['ok', `${mb.toFixed(1)} MB — light enough.`]);

  if (r.maxTexture > 2048) {
    notes.push(['bad', `Textures up to ${r.maxTexture}² — about ${r.gpuMB} MB of GPU memory, enough to crash Safari on an iPhone. Resize colour maps to 2048² and normal/roughness maps to 1024².`]);
  } else if (r.maxTexture) {
    notes.push(['ok', `Largest texture ${r.maxTexture}² (~${r.gpuMB} MB of GPU memory).`]);
  }
  if (r.triangles > 300000) notes.push(['warn', `${(r.triangles / 1000).toFixed(0)}k triangles. Older phones slow down past ~150k.`]);
  if (r.skinned && r.extensions.includes('KHR_mesh_quantization')) {
    notes.push(['bad', 'A rigged model saved with quantization: the viewer will size it wrong (it measures the quantization box, not the figure). Re-export without quantizing.']);
  }
  if (r.extensions.includes('KHR_draco_mesh_compression') || r.extensions.includes('EXT_meshopt_compression')) {
    notes.push(['bad', 'Draco/meshopt compression needs a decoder the guide does not load. Re-export without mesh compression.']);
  }
  if (r.animations.length) {
    notes.push(['ok', `${r.animations.length} animation clip${r.animations.length === 1 ? '' : 's'}, ${Math.max(...r.animations.map((a) => a.duration)).toFixed(1)} s — plays once after the figure is placed, unless set to loop.`]);
  }
  return notes;
}

export function audioAdvice(file, meta) {
  const notes = [];
  const kbps = meta && meta.duration ? (file.size * 8 / 1000) / meta.duration : 0;
  if (kbps > 192) notes.push(['warn', `${kbps.toFixed(0)} kbps — narration sounds the same at 96 kbps mono, at half the download.`]);
  if (file.size > 4 * 1048576) notes.push(['warn', `${(file.size / 1048576).toFixed(1)} MB for one recording is large.`]);
  if (!notes.length) notes.push(['ok', `${(file.size / 1024).toFixed(0)} KB${meta && meta.duration ? ', ' + Math.round(meta.duration) + ' s' : ''}.`]);
  return notes;
}
