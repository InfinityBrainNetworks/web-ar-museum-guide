/**
 * Compiling the image tracker, in this browser, with MindAR's own compiler -
 * the same code the old portal used and the same library the guide runs.
 *
 * Exhibit order is target order: the i-th image handed to the compiler is
 * what MindAR reports as target i, so the tracker is only valid for the exact
 * order and photos it was built from. data.trackerSignature() records both.
 */
const MINDAR = 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';
export const MAX_EDGE = 1024;
export const GOOD_POINTS = 400;

let loading = null;

export function loadCompiler() {
  if (window.MINDAR && window.MINDAR.IMAGE && window.MINDAR.IMAGE.Compiler) return Promise.resolve();
  if (!loading) {
    loading = import(MINDAR).then(() => {
      if (!(window.MINDAR && window.MINDAR.IMAGE && window.MINDAR.IMAGE.Compiler)) {
        throw new Error('MindAR loaded but its compiler is missing');
      }
    }).catch((err) => { loading = null; throw err; });
  }
  return loading;
}

async function canvasFrom(url) {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error('could not fetch a target photo (HTTP ' + response.status + ')');
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return canvas;
}

/**
 * Build targets.mind for these exhibits, in this order.
 * Resolves { blob, points: [{ id, featurePoints, keyframes, width, height }] }.
 */
export async function compileTargets(exhibits, onProgress = () => {}) {
  onProgress(0, 'Loading the MindAR compiler…');
  await loadCompiler();

  const canvases = [];
  for (let i = 0; i < exhibits.length; i++) {
    onProgress(0.02 * (i / exhibits.length), `Reading target ${i + 1} of ${exhibits.length}…`);
    canvases.push(await canvasFrom(exhibits[i].image.url));
  }

  const compiler = new window.MINDAR.IMAGE.Compiler();
  await compiler.compileImageTargets(canvases, (percent) => {
    onProgress(0.03 + (percent / 100) * 0.95, `Extracting features… ${percent.toFixed(0)}%`);
  });
  onProgress(0.99, 'Packing the tracker…');
  const blob = new Blob([compiler.exportData()], { type: 'application/octet-stream' });

  const points = (compiler.data || []).map((d, i) => ({
    id: exhibits[i].id,
    featurePoints: d.matchingData.reduce((sum, f) => sum + f.maximaPoints.length + f.minimaPoints.length, 0),
    keyframes: d.matchingData.length,
    width: canvases[i].width,
    height: canvases[i].height,
  }));
  return { blob, points };
}
