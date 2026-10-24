/**
 * From draft exhibits to the manifest a visitor's phone reads.
 *
 * The manifest has the same shape as assets/content/content.json, so the
 * viewer runs one code path for both (ARContent.fromData) - it just names
 * cloud URLs, and carries every file's size so the offline download can say
 * how big it is before it starts.
 */
const C = () => window.ARContent;

export function languagesOf(site) { return C().languageList(site && site.languages); }

/** What an exhibit still needs before it can be published. */
export function missing(ex, languages) {
  const out = [];
  if (!ex.image || !ex.image.url) out.push('a target photo');
  if (!ex.media || !ex.media.url) out.push('a video or picture to project');
  const base = languages[0].code;
  const d = ex.details && ex.details[base];
  if (!d || !(String(d.title || '').trim() || C().plainText(d.html))) out.push('its label in ' + languages[0].name);
  return out;
}

export function complete(ex, languages) { return missing(ex, languages).length === 0; }

/** Which languages an exhibit is written in, and which have a recording. */
export function coverage(ex, languages) {
  const written = [], spoken = [];
  languages.forEach((l) => {
    const d = ex.details && ex.details[l.code];
    if (d && (String(d.title || '').trim() || C().plainText(d.html))) written.push(l.code);
    if (d && d.audio && d.audio.url) spoken.push(l.code);
  });
  return { written, spoken };
}

function modelOf(ex) {
  const defaults = C().modelDefaults();
  const m = ex.model || {};
  const out = { src: m.url || null, size: m.size || 0 };
  C().MODEL_FIELDS.forEach((key) => {
    out[key] = m[key] !== undefined ? m[key] : defaults[key];
  });
  return out;
}

function detailsOf(ex, languages) {
  const out = {};
  languages.forEach((l) => {
    const d = (ex.details || {})[l.code];
    if (!d) return;
    const title = String(d.title || '').trim();
    // Sanitised once more on the way out: this is what every phone renders
    // with innerHTML, and the draft is only as clean as whoever wrote it.
    const html = C().sanitizeRichText(d.html || '');
    const audio = d.audio && d.audio.url
      ? { src: d.audio.url, size: d.audio.size || 0, duration: d.audio.duration || 0 } : null;
    if (!title && !html && !audio) return;
    out[l.code] = { title, html, audio };
  });
  return out;
}

export function buildManifest({ id, notes, exhibits, site, tracker }) {
  const languages = languagesOf(site);
  return {
    version: 3,
    generated: new Date().toISOString(),
    release: { id, notes: notes || '' },
    site: {
      name: site.name || '',
      features: site.features || {},
      photobooth: { enabled: !!(site.photobooth && site.photobooth.enabled) },
    },
    mindSrc: tracker.url,
    mindSize: tracker.size || 0,
    languages,
    exhibits: exhibits.map((ex, i) => ({
      id: ex.id,
      name: ex.name,
      targetIndex: i,
      image: {
        src: ex.image.url,
        thumb: ex.image.thumbUrl || null,
        width: ex.image.width,
        height: ex.image.height,
        size: ex.image.size || 0,
      },
      media: {
        kind: ex.media.kind === 'image' ? 'image' : 'video',
        src: ex.media.url,
        width: ex.media.width || 0,
        height: ex.media.height || 0,
        size: ex.media.size || 0,
        fit: ex.media.fit || 'stretch',
        loop: ex.media.loop !== false,
        restartOnFound: !!ex.media.restartOnFound,
        scale: typeof ex.media.scale === 'number' ? ex.media.scale : 1,
        offset: ex.media.offset || { x: 0, y: 0, z: 0.001 },
      },
      details: detailsOf(ex, languages),
      model: modelOf(ex),
    })),
  };
}

/** What a visitor downloads, per exhibit and in all. */
export function weigh(exhibits, tracker, languages) {
  const base = languages[0].code;
  const rows = exhibits.map((ex) => {
    let audio = 0;
    Object.values(ex.details || {}).forEach((d) => { if (d && d.audio && d.audio.size) audio += d.audio.size; });
    const parts = {
      photo: ((ex.image && ex.image.size) || 0) + ((ex.image && ex.image.thumbSize) || 0),
      media: (ex.media && ex.media.size) || 0,
      model: (ex.model && ex.model.url && ex.model.size) || 0,
      audio,
    };
    return { id: ex.id, name: ex.name, parts, total: parts.photo + parts.media + parts.model + parts.audio };
  });
  const tracked = (tracker && tracker.size) || 0;
  return { rows, tracker: tracked, total: rows.reduce((s, r) => s + r.total, 0) + tracked, base };
}
