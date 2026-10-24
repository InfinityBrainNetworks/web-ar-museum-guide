/**
 * Bring the gallery that is already deployed from the repo
 * (assets/content/content.json) into the cloud: every exhibit, file and
 * setting, and its compiled tracker - so the move to Firebase costs a click
 * rather than a week of re-entering nine paintings in six languages.
 *
 * Exhibit ids are kept, so anything that refers to an exhibit by id (a copied
 * Adjust block, a photo's caption) still finds it. The tracker comes too,
 * already compiled for exactly this order, so nothing needs recompiling.
 */
import * as data from './data.js';
import { prepareTarget, probeAudio, inspectGlb } from './media.js';

function nameOf(src) { return decodeURIComponent(String(src).split('?')[0].split('/').pop()); }

async function fetchFile(base, src, type) {
  const url = new URL(src, base).href;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`could not read ${nameOf(src)} (HTTP ${response.status})`);
  const blob = await response.blob();
  // An empty answer is not a file. (A 204 counts as "ok" to fetch(), and
  // OS-level download managers answer media requests with one.)
  if (!blob.size) throw new Error(`${nameOf(src)} came back empty (HTTP ${response.status})`);
  return new File([blob], nameOf(src), { type: type || blob.type });
}

export async function readBundle() {
  const base = window.AR_CLOUD.appUrl;
  const response = await fetch(new URL('assets/content/content.json', base).href, { cache: 'no-cache' });
  if (!response.ok) throw new Error('there is no assets/content/content.json deployed alongside the Studio');
  // Every path in the bundle is relative to the app's own root.
  return { base, bundle: await response.json() };
}

/**
 * onProgress(fraction, text). Resolves { exhibits, files, bytes }.
 * Needs an admin: it writes the gallery's languages into config/site.
 */
export async function importBundle(onProgress = () => {}) {
  const { base, bundle } = await readBundle();
  const exhibits = bundle.exhibits || [];
  const languages = window.ARContent.languageList(bundle.languages);

  // Count the work first, so the bar means something.
  const jobs = [];
  exhibits.forEach((ex) => {
    jobs.push('target', 'media');
    if (ex.model && ex.model.src) jobs.push('model');
    Object.values(ex.details || {}).forEach((d) => { if (d && d.audio && d.audio.src) jobs.push('audio'); });
  });
  jobs.push('tracker');
  let done = 0, bytes = 0;
  const skipped = [];
  const step = (text) => onProgress(done / jobs.length, text);
  const up = async (folder, kind, file, label) => {
    step(label);
    const got = await data.upload(folder, kind, file, (f) => onProgress((done + f) / jobs.length, label));
    done++;
    bytes += file.size;
    return got;
  };

  await data.saveSite({
    name: (window.AR_CONFIG.gallery || {}).name || 'National Museum',
    languages,
  });

  const ids = [];
  for (let i = 0; i < exhibits.length; i++) {
    const ex = exhibits[i];
    const id = ex.id || data.slugId(ex.name);
    const folder = 'exhibits/' + id;
    const label = (what) => `${ex.name} — ${what} (${i + 1} of ${exhibits.length})`;

    const targetFile = await fetchFile(base, ex.image.src, 'image/jpeg');
    const target = await prepareTarget(targetFile);
    const display = await up(folder, 'target', new File([target.display.blob], targetFile.name, { type: 'image/jpeg' }), label('photo'));
    const thumb = await data.upload(folder, 'thumb', new File([target.thumb.blob], 'thumb.jpg', { type: 'image/jpeg' }));
    const media = ex.media || ex.video || {};
    const mediaFile = await fetchFile(base, media.src);
    const mediaUp = await up(folder, 'media', mediaFile, label(media.kind === 'image' ? 'picture' : 'video'));

    const doc = {
      name: ex.name,
      order: i,
      image: {
        path: display.path, url: display.url, hash: display.hash, size: display.size, fileName: display.fileName,
        width: target.display.width, height: target.display.height,
        thumbPath: thumb.path, thumbUrl: thumb.url, thumbSize: thumb.size,
      },
      media: {
        kind: media.kind === 'image' ? 'image' : 'video',
        path: mediaUp.path, url: mediaUp.url, hash: mediaUp.hash, size: mediaUp.size, fileName: mediaUp.fileName,
        type: mediaUp.type, width: media.width || 0, height: media.height || 0,
        fit: media.fit || 'stretch', loop: media.loop !== false, restartOnFound: !!media.restartOnFound,
        scale: typeof media.scale === 'number' ? media.scale : 1,
        offset: media.offset || { x: 0, y: 0, z: 0.001 },
      },
      details: {},
      model: {},
    };

    for (const [code, d] of Object.entries(ex.details || {})) {
      const detail = { title: String((d && d.title) || ''), html: window.ARContent.sanitizeRichText((d && d.html) || ''), audio: null };
      if (d && d.audio && d.audio.src) {
        // A recording that cannot be read is left out, not allowed to stop the
        // whole import: the label still comes across, and the narration can be
        // added again in the exhibit's Label tab.
        try {
          const file = await fetchFile(base, d.audio.src, 'audio/mpeg');
          const meta = await probeAudio(file).catch(() => ({ duration: 0 }));
          const got = await up(folder, 'audio-' + code, file, label('narration, ' + code));
          detail.audio = { path: got.path, url: got.url, size: got.size, fileName: got.fileName, duration: meta.duration || 0 };
        } catch (err) {
          done++;
          skipped.push(`${ex.name} (${code}): ${err.message}`);
        }
      }
      doc.details[code] = detail;
    }

    const model = ex.model || {};
    window.ARContent.MODEL_FIELDS.forEach((key) => { if (model[key] !== undefined) doc.model[key] = model[key]; });
    if (model.src) {
      const file = await fetchFile(base, model.src, 'model/gltf-binary');
      const report = await inspectGlb(file).catch(() => null);
      const got = await up(folder, 'model', file, label('3D figure'));
      Object.assign(doc.model, { path: got.path, url: got.url, size: got.size, fileName: got.fileName, hash: got.hash });
      if (report) doc.model.report = slimReport(report);
    }

    await writeExhibit(id, doc);
    ids.push({ id, hash: display.hash });
  }

  // The tracker, already compiled for exactly this order and these photos.
  step('Artwork recognition');
  const mind = await fetchFile(base, bundle.mindSrc || './assets/content/targets.mind', 'application/octet-stream');
  const tracker = await data.upload('tracker', 'targets', mind);
  done++;
  bytes += mind.size;
  await data.saveTracker({
    signature: ids.map((x) => x.id + ':' + x.hash).join('|'),
    path: tracker.path, url: tracker.url, size: tracker.size, imported: true, count: ids.length,
  });
  onProgress(1, 'Done');
  return { exhibits: ids.length, files: jobs.length, bytes, skipped };
}

async function writeExhibit(id, doc) {
  const { F, db } = data.api();
  await F.setDoc(F.doc(db, 'exhibits', id), {
    ...doc, createdAt: F.serverTimestamp(), createdBy: data.myEmail(),
    updatedAt: F.serverTimestamp(), updatedBy: data.myEmail(),
  });
}

/** The GLB inspection, minus the per-texture list, to keep the document small. */
export function slimReport(r) {
  return {
    size: r.size, triangles: r.triangles, vertices: r.vertices, meshes: r.meshes, materials: r.materials,
    maxTexture: r.maxTexture, gpuMB: r.gpuMB, skinned: r.skinned, extensions: r.extensions,
    animations: r.animations, textures: r.textures.length,
    // Firestore cannot hold an array inside an array.
    notes: r.notes.map(([kind, text]) => ({ kind, text })),
  };
}
