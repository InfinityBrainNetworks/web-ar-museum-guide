/**
 * AR Content Portal.
 *
 * Authoring for the AR page: add exhibits (target image + video + 3D model),
 * compile the image tracker, export a bundle you commit and push.
 *
 * Everything happens in this browser. Files live in IndexedDB, and the .mind
 * tracker is built by MindAR's own compiler — the very same one the AR page
 * loads, which ships alongside the runtime in mindar-image-aframe.prod.js.
 * There is no server to run and nothing is uploaded anywhere.
 *
 * The one rule that matters: exhibit order IS target order. targetIndex 0 is
 * the first image handed to the compiler, so reordering or adding an exhibit
 * invalidates the compiled tracker. That is what the staleness banner watches,
 * because a stale tracker fails in the nastiest possible way — every exhibit
 * still tracks, just against the wrong video.
 */
(function () {
  'use strict';

  // MindAR's own guidance, and the point past which compiling gets slow for no
  // gain: its detector works on a pyramid that starts well below this anyway.
  var MAX_TARGET_EDGE = 1024;
  // Below this, a target is too flat or repetitive to track reliably.
  var GOOD_FEATURE_POINTS = 400;

  var draft = { version: 1, exhibits: [], compiled: null };
  var urls = new Map();     // file key -> object URL, so re-renders do not churn
  var pending = null;       // which {exhibit, kind} a file picker was opened for

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ utils
  function bytes(n) {
    if (!n && n !== 0) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function ago(iso) {
    if (!iso) return 'never';
    var seconds = (Date.now() - new Date(iso).getTime()) / 1000;
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' h ago';
    return Math.round(seconds / 86400) + ' d ago';
  }

  function slug(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 40) || 'exhibit';
  }

  function extOf(name, fallback) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : fallback;
  }

  function toast(message, kind) {
    var node = $('toast');
    node.textContent = message;
    node.className = 'toast ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { node.classList.add('hidden'); }, kind === 'err' ? 7000 : 3200);
  }

  function get(object, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, object);
  }

  function set(object, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (o, k) {
      if (o[k] == null || typeof o[k] !== 'object') o[k] = {};
      return o[k];
    }, object);
    target[last] = value;
  }

  function urlFor(key, blob) {
    if (urls.has(key)) return urls.get(key);
    var url = URL.createObjectURL(blob);
    urls.set(key, url);
    return url;
  }

  function dropUrl(key) {
    if (!urls.has(key)) return;
    URL.revokeObjectURL(urls.get(key));
    urls.delete(key);
  }

  // ------------------------------------------------------------------ busy UI
  function busy(title, text) {
    $('busyTitle').textContent = title;
    $('busyText').textContent = text || '';
    $('busyBar').style.width = '0%';
    $('busy').classList.remove('hidden');
  }
  function progress(fraction, text) {
    $('busyBar').style.width = Math.max(0, Math.min(1, fraction)) * 100 + '%';
    if (text !== undefined) $('busyText').textContent = text;
  }
  function idle() { $('busy').classList.add('hidden'); }

  // ------------------------------------------------------------------ model
  function save() {
    return ARStore.setDraft(draft).then(function () { renderHeader(); });
  }

  function isComplete(ex) {
    return !!(ex.image && ex.image.stamp && ex.video && ex.video.stamp);
  }

  /**
   * What the compiled tracker was built from.
   *
   * Both the order and each image's identity matter, so the signature carries
   * the ids in sequence together with a fingerprint of the file behind each.
   */
  function signature() {
    return draft.exhibits.map(function (ex) {
      return ex.id + '@' + ((ex.image && ex.image.stamp) || 'none');
    }).join('|');
  }

  function compileState() {
    var withImages = draft.exhibits.filter(function (ex) { return ex.image && ex.image.stamp; });
    if (!draft.exhibits.length) return { kind: 'empty' };
    if (withImages.length < draft.exhibits.length) {
      return { kind: 'blocked', text: 'Every exhibit needs a target image before the tracker can be compiled.' };
    }
    if (!draft.compiled) {
      return { kind: 'stale', text: 'The image tracker has not been compiled yet. Visitors cannot scan anything until it is.' };
    }
    if (draft.compiled.signature !== signature()) {
      return {
        kind: 'stale',
        text: 'Exhibits changed since the tracker was compiled ' + ago(draft.compiled.at) +
              '. Until you recompile, scanning will match the wrong exhibit.',
      };
    }
    return {
      kind: 'ok',
      text: 'Tracker compiled ' + ago(draft.compiled.at) + ' from ' +
            draft.compiled.count + ' target' + (draft.compiled.count === 1 ? '' : 's') + '.',
    };
  }

  // ------------------------------------------------------------------ files
  function probeImage(blob) {
    return createImageBitmap(blob).then(function (bitmap) {
      var out = { width: bitmap.width, height: bitmap.height };
      if (bitmap.close) bitmap.close();
      return out;
    });
  }

  function probeVideo(blob) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      var url = URL.createObjectURL(blob);
      var done = function (result, error) {
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        if (error) reject(error); else resolve(result);
      };
      video.preload = 'metadata';
      video.muted = true;
      video.onloadedmetadata = function () {
        done({
          width: video.videoWidth,
          height: video.videoHeight,
          duration: isFinite(video.duration) ? video.duration : 0,
        });
      };
      video.onerror = function () {
        done(null, new Error('this browser cannot decode that video — MP4 with H.264 is the safe choice'));
      };
      setTimeout(function () { done(null, new Error('the video did not report its dimensions within 15s')); }, 15000);
      video.src = url;
    });
  }

  /** GLB starts with the ASCII magic "glTF"; a .gltf is JSON. Catch a wrong file early. */
  function probeModel(blob, name) {
    return blob.slice(0, 4).arrayBuffer().then(function (head) {
      var magic = String.fromCharCode.apply(null, new Uint8Array(head));
      var isGltfJson = /\.gltf$/i.test(name || '');
      if (magic !== 'glTF' && !isGltfJson) {
        throw new Error('that is not a glTF file — export your model as .glb');
      }
      if (isGltfJson && magic !== 'glTF') {
        // A .gltf references its textures and buffers as separate files, which a
        // single-file bundle cannot carry.
        return { warn: '.gltf files reference external textures that will not be bundled — re-export as .glb' };
      }
      return {};
    });
  }

  function setFile(ex, kind, file) {
    if (!file) return Promise.resolve();

    var key = ARStore.fileKey(ex.id, kind);
    var stamp = file.size + ':' + (file.lastModified || 0) + ':' + file.name;

    var probe;
    if (kind === 'img') probe = probeImage(file);
    else if (kind === 'vid') probe = probeVideo(file);
    else probe = probeModel(file, file.name);

    return probe.then(function (info) {
      if (kind === 'img') {
        ex.image = {
          stamp: stamp, fileName: file.name, type: file.type,
          size: file.size, width: info.width, height: info.height,
          // Any previous quality report belongs to the old file.
          featurePoints: null, keyframes: null,
        };
      } else if (kind === 'vid') {
        ex.video = ex.video || ARContent.videoDefaults();
        ex.video.stamp = stamp;
        ex.video.fileName = file.name;
        ex.video.type = file.type;
        ex.video.size = file.size;
        ex.video.width = info.width;
        ex.video.height = info.height;
        ex.video.duration = info.duration;
      } else {
        ex.model = ex.model || ARContent.modelDefaults();
        ex.model.stamp = stamp;
        ex.model.fileName = file.name;
        ex.model.type = file.type;
        ex.model.size = file.size;
        if (info.warn) toast(info.warn, 'err');
      }

      dropUrl(key);
      return ARStore.putFile(key, file);
    }).then(function () {
      return save();
    }).then(function () {
      render();
      if (kind === 'img') toast('Target image set — remember to compile before exporting.');
    }).catch(function (err) {
      toast(err.message || String(err), 'err');
    });
  }

  function clearFile(ex, kind) {
    var key = ARStore.fileKey(ex.id, kind);
    dropUrl(key);
    return ARStore.delFile(key).then(function () {
      if (kind === 'img') ex.image = { stamp: null };
      else if (kind === 'vid') { ex.video.stamp = null; ex.video.fileName = null; ex.video.size = 0; }
      else ex.model = ARContent.modelDefaults();
      return save();
    }).then(render);
  }

  // ------------------------------------------------------------------ compile
  /**
   * Turn a stored image into something MindAR's compiler can read.
   *
   * It only ever draws the input into a canvas and reads the pixels back, so a
   * canvas is the most direct thing to hand it — and going through one lets us
   * cap the resolution in the same step.
   *
   * Downscaling is safe: MindAR's anchor scale is the target's own width, so
   * everything downstream is a ratio. Only the ratio has to survive, and the
   * compiled dimensions are what gets written back to the exhibit so the video
   * plane is shaped from exactly what the tracker was built on.
   */
  function toCanvas(blob) {
    return createImageBitmap(blob).then(function (bitmap) {
      var scale = Math.min(1, MAX_TARGET_EDGE / Math.max(bitmap.width, bitmap.height));
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));

      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) bitmap.close();

      return { canvas: canvas, scaled: scale < 1, from: bitmap.width + '×' + bitmap.height };
    });
  }

  function compile() {
    var state = compileState();
    if (state.kind === 'empty') { toast('Add an exhibit first.', 'err'); return Promise.resolve(); }
    if (state.kind === 'blocked') { toast(state.text, 'err'); return Promise.resolve(); }
    if (!window.MINDAR || !window.MINDAR.IMAGE || !window.MINDAR.IMAGE.Compiler) {
      toast(window.__mindarError
        ? 'The MindAR compiler could not be loaded from the CDN (' + window.__mindarError +
          '). Check your connection and reload.'
        : 'The MindAR compiler is still loading — give it a moment and try again.', 'err');
      return Promise.resolve();
    }

    busy('Compiling the image tracker', 'Reading targets…');

    var images = [];
    var chain = draft.exhibits.reduce(function (previous, ex) {
      return previous.then(function () {
        return ARStore.getFile(ARStore.fileKey(ex.id, 'img')).then(function (blob) {
          if (!blob) throw new Error('"' + ex.name + '" has no target image');
          return toCanvas(blob).then(function (result) {
            images.push(result.canvas);
            // The tracker is built on these pixels, so these are the dimensions
            // the AR page must shape the video plane from.
            ex.image.width = result.canvas.width;
            ex.image.height = result.canvas.height;
            if (result.scaled) ex.image.resizedFrom = result.from;
            else delete ex.image.resizedFrom;
          });
        });
      });
    }, Promise.resolve());

    return chain.then(function () {
      progress(0.02, 'Extracting features from ' + images.length +
        ' target' + (images.length === 1 ? '' : 's') + '…');

      var compiler = new window.MINDAR.IMAGE.Compiler();
      return compiler.compileImageTargets(images, function (percent) {
        progress(0.02 + (percent / 100) * 0.95, 'Extracting features… ' + percent.toFixed(0) + '%');
      }).then(function () {
        progress(0.98, 'Packing targets.mind…');
        var buffer = compiler.exportData();
        var blob = new Blob([buffer], { type: 'application/octet-stream' });

        // Feature counts are the only honest offline answer to "will this track
        // well", so they are recorded per exhibit and shown on the card.
        (compiler.data || []).forEach(function (data, i) {
          if (!draft.exhibits[i]) return;
          var points = data.matchingData.reduce(function (sum, frame) {
            return sum + frame.maximaPoints.length + frame.minimaPoints.length;
          }, 0);
          draft.exhibits[i].image.featurePoints = points;
          draft.exhibits[i].image.keyframes = data.matchingData.length;
        });

        return ARStore.putFile(ARStore.MIND_FILE, blob).then(function () {
          draft.compiled = {
            at: new Date().toISOString(),
            signature: signature(),
            count: images.length,
            size: blob.size,
          };
          return save();
        }).then(function () {
          idle();
          render();
          var weak = draft.exhibits.filter(function (ex) {
            return ex.image.featurePoints !== null && ex.image.featurePoints < GOOD_FEATURE_POINTS;
          });
          if (weak.length) {
            toast('Compiled, but ' + weak.length + ' target' + (weak.length === 1 ? ' has' : 's have') +
                  ' few features and may track poorly — see the cards.', 'err');
          } else {
            toast('Tracker compiled — ' + bytes(blob.size) + ' from ' + images.length +
                  ' target' + (images.length === 1 ? '' : 's') + '.', 'ok');
          }
        });
      });
    }).catch(function (err) {
      idle();
      toast('Compile failed: ' + (err.message || err), 'err');
    });
  }

  // ------------------------------------------------------------------ export
  function contentJson(fileNames) {
    return {
      version: 1,
      generated: new Date().toISOString(),
      mindSrc: './assets/content/targets.mind',
      exhibits: draft.exhibits.map(function (ex, i) {
        var names = fileNames[ex.id];
        return {
          id: ex.id,
          name: ex.name,
          targetIndex: i,
          image: {
            src: './assets/content/' + names.img,
            width: ex.image.width,
            height: ex.image.height,
          },
          video: {
            src: './assets/content/' + names.vid,
            width: ex.video.width,
            height: ex.video.height,
            fit: ex.video.fit,
            loop: ex.video.loop,
            restartOnFound: ex.video.restartOnFound,
            scale: ex.video.scale,
            offset: ex.video.offset,
          },
          model: names.mdl ? {
            src: './assets/content/' + names.mdl,
            heightMeters: ex.model.heightMeters,
            yawOffset: ex.model.yawOffset,
            scale: ex.model.scale,
            spin: ex.model.spin,
            playClip: ex.model.playClip,
          } : {
            src: null,
            heightMeters: ex.model ? ex.model.heightMeters : 1,
            yawOffset: ex.model ? ex.model.yawOffset : 0,
            scale: ex.model ? ex.model.scale : 1,
            spin: ex.model ? ex.model.spin : false,
            playClip: ex.model ? ex.model.playClip : true,
          },
        };
      }),
    };
  }

  var DEPLOY_NOTES = [
    'Web AR Museum Guide — content bundle',
    '',
    'Unzip this at the ROOT of the repository. It writes only into',
    'assets/content/, so nothing else in the project is touched:',
    '',
    '    assets/content/content.json     what the AR page reads',
    '    assets/content/targets.mind     the compiled image tracker',
    '    assets/content/*-target.*       target images',
    '    assets/content/*-video.*        videos',
    '    assets/content/*-model.glb      3D models',
    '',
    'Then publish:',
    '',
    '    git add assets/content',
    '    git commit -m "Update AR exhibits"',
    '    git push',
    '',
    'The order of exhibits in content.json is the order they were compiled',
    'into targets.mind. Never hand-edit one without the other — swap two',
    'entries and every exhibit will still track, just against the wrong video.',
    'Re-export from the portal instead.',
    '',
    'To edit these exhibits again later, open admin.html and use',
    '"Import a bundle" on this zip.',
    '',
  ].join('\n');

  function exportBundle() {
    if (!draft.exhibits.length) { toast('Nothing to export.', 'err'); return Promise.resolve(); }

    var incomplete = draft.exhibits.filter(function (ex) { return !isComplete(ex); });
    if (incomplete.length) {
      toast('"' + incomplete[0].name + '" is missing its image or video.', 'err');
      return Promise.resolve();
    }
    var state = compileState();
    if (state.kind !== 'ok') { toast(state.text, 'err'); return Promise.resolve(); }

    busy('Building the bundle', 'Collecting files…');

    var names = {};
    var entries = [];
    var used = {};

    var chain = draft.exhibits.reduce(function (previous, ex) {
      return previous.then(function () {
        // Names are derived from the exhibit name for legibility, and
        // de-duplicated because two exhibits may well share one.
        var base = slug(ex.name);
        used[base] = (used[base] || 0) + 1;
        if (used[base] > 1) base += '-' + used[base];
        names[ex.id] = {};

        return Promise.all([
          ARStore.getFile(ARStore.fileKey(ex.id, 'img')),
          ARStore.getFile(ARStore.fileKey(ex.id, 'vid')),
          ARStore.getFile(ARStore.fileKey(ex.id, 'mdl')),
        ]).then(function (files) {
          var img = files[0], vid = files[1], mdl = files[2];
          names[ex.id].img = base + '-target.' + extOf(ex.image.fileName, 'png');
          names[ex.id].vid = base + '-video.' + extOf(ex.video.fileName, 'mp4');
          entries.push({ name: 'assets/content/' + names[ex.id].img, blob: img });
          entries.push({ name: 'assets/content/' + names[ex.id].vid, blob: vid });
          if (mdl) {
            names[ex.id].mdl = base + '-model.' + extOf(ex.model.fileName, 'glb');
            entries.push({ name: 'assets/content/' + names[ex.id].mdl, blob: mdl });
          }
        });
      });
    }, Promise.resolve());

    return chain.then(function () {
      return ARStore.getFile(ARStore.MIND_FILE);
    }).then(function (mind) {
      entries.push({ name: 'assets/content/targets.mind', blob: mind });
      entries.push({
        name: 'assets/content/content.json',
        blob: new Blob([JSON.stringify(contentJson(names), null, 2)], { type: 'application/json' }),
      });
      entries.push({ name: 'HOW-TO-DEPLOY.txt', blob: new Blob([DEPLOY_NOTES], { type: 'text/plain' }) });

      return ARZip.write(entries, function (name, fraction) {
        progress(fraction, 'Packing ' + name.replace('assets/content/', '') + '…');
      });
    }).then(function (zip) {
      var stamp = new Date().toISOString().slice(0, 10);
      var link = document.createElement('a');
      link.href = URL.createObjectURL(zip);
      link.download = 'ar-exhibits-' + stamp + '.zip';
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 60000);

      idle();
      showHelp('exported', zip.size);
    }).catch(function (err) {
      idle();
      toast('Export failed: ' + (err.message || err), 'err');
    });
  }

  // ------------------------------------------------------------------ import
  function importBundle(file) {
    busy('Reading the bundle', 'Opening the archive…');

    return ARZip.read(file).then(function (entries) {
      var byName = {};
      entries.forEach(function (e) { byName[e.name] = e.blob; });

      var manifest = byName['assets/content/content.json'];
      if (!manifest) throw new Error('no assets/content/content.json inside — is this a bundle exported by this portal?');

      return manifest.text().then(function (text) {
        var data = JSON.parse(text);
        if (!data.exhibits || !data.exhibits.length) throw new Error('that bundle has no exhibits in it');

        progress(0.15, 'Replacing the current draft…');
        return ARStore.clear().then(function () {
          urls.forEach(function (url) { URL.revokeObjectURL(url); });
          urls.clear();

          var exhibits = [];
          var step = 0.8 / (data.exhibits.length || 1);

          var chain = data.exhibits.reduce(function (previous, raw, i) {
            return previous.then(function () {
              progress(0.15 + step * i, 'Importing ' + (raw.name || 'exhibit ' + (i + 1)) + '…');

              var ex = ARContent.normalize(raw, i);
              // Paths in content.json are site-relative; zip entries are not.
              var pick = function (src) { return src ? byName[String(src).replace(/^\.\//, '')] : null; };
              var img = pick(raw.image && raw.image.src);
              var vid = pick(raw.video && raw.video.src);
              var mdl = pick(raw.model && raw.model.src);

              var record = {
                id: ex.id, name: ex.name,
                image: { stamp: null }, video: ARContent.videoDefaults(), model: ARContent.modelDefaults(),
              };
              ['fit', 'loop', 'restartOnFound', 'scale', 'offset', 'width', 'height'].forEach(function (k) {
                if (ex.video[k] !== undefined) record.video[k] = ex.video[k];
              });
              ['heightMeters', 'yawOffset', 'scale', 'spin', 'playClip'].forEach(function (k) {
                if (ex.model && ex.model[k] !== undefined) record.model[k] = ex.model[k];
              });

              var writes = [];
              if (img) {
                record.image = {
                  stamp: 'bundle:' + img.size, fileName: basename(raw.image.src), type: img.type,
                  size: img.size, width: ex.image.width, height: ex.image.height,
                  featurePoints: null, keyframes: null,
                };
                writes.push(ARStore.putFile(ARStore.fileKey(ex.id, 'img'), img));
              }
              if (vid) {
                record.video.stamp = 'bundle:' + vid.size;
                record.video.fileName = basename(raw.video.src);
                record.video.size = vid.size;
                writes.push(ARStore.putFile(ARStore.fileKey(ex.id, 'vid'), vid));
              }
              if (mdl) {
                record.model.stamp = 'bundle:' + mdl.size;
                record.model.fileName = basename(raw.model.src);
                record.model.size = mdl.size;
                writes.push(ARStore.putFile(ARStore.fileKey(ex.id, 'mdl'), mdl));
              }

              exhibits.push(record);
              return Promise.all(writes);
            });
          }, Promise.resolve());

          return chain.then(function () {
            var mind = byName['assets/content/targets.mind'];
            draft = { version: 1, exhibits: exhibits, compiled: null };
            if (!mind) return null;
            return ARStore.putFile(ARStore.MIND_FILE, mind).then(function () {
              // The bundle's tracker matches the bundle's exhibits by
              // construction, so it is not stale — record it as current.
              draft.compiled = {
                at: data.generated || new Date().toISOString(),
                signature: signature(),
                count: exhibits.length,
                size: mind.size,
              };
            });
          });
        });
      });
    }).then(function () {
      return save();
    }).then(function () {
      idle();
      render();
      toast('Imported ' + draft.exhibits.length + ' exhibit' +
            (draft.exhibits.length === 1 ? '' : 's') + '.', 'ok');
    }).catch(function (err) {
      idle();
      toast('Import failed: ' + (err.message || err), 'err');
    });
  }

  function basename(path) { return String(path || '').split('/').pop(); }

  // ------------------------------------------------------------------ adopt
  /** Pull whatever this site is currently serving into the portal, to edit it. */
  function adopt() {
    busy('Loading the deployed content', 'Reading content.json…');

    return ARContent.load().then(function (bundle) {
      if (!bundle.exhibits.length) throw new Error('nothing is deployed yet');

      var grab = function (url) {
        if (!url) return Promise.resolve(null);
        return fetch(url).then(function (r) {
          if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
          return r.blob();
        });
      };

      return ARStore.clear().then(function () {
        urls.forEach(function (url) { URL.revokeObjectURL(url); });
        urls.clear();

        var exhibits = [];
        var step = 0.85 / bundle.exhibits.length;

        return bundle.exhibits.reduce(function (previous, ex, i) {
          return previous.then(function () {
            progress(0.1 + step * i, 'Fetching ' + ex.name + '…');
            return Promise.all([
              grab(ex.image.src), grab(ex.video.src), grab(ex.model && ex.model.src),
            ]).then(function (files) {
              var img = files[0], vid = files[1], mdl = files[2];
              var record = {
                id: ex.id, name: ex.name,
                image: img ? {
                  stamp: 'deployed:' + img.size, fileName: basename(ex.image.src), type: img.type,
                  size: img.size, width: ex.image.width, height: ex.image.height,
                  featurePoints: null, keyframes: null,
                } : { stamp: null },
                video: ex.video, model: ex.model || ARContent.modelDefaults(),
              };
              record.video.stamp = vid ? 'deployed:' + vid.size : null;
              record.video.fileName = basename(ex.video.src);
              record.video.size = vid ? vid.size : 0;
              record.model.stamp = mdl ? 'deployed:' + mdl.size : null;
              record.model.fileName = mdl ? basename(ex.model.src) : null;
              record.model.size = mdl ? mdl.size : 0;
              delete record.image.src; delete record.video.src; delete record.model.src;

              var writes = [];
              if (img) writes.push(ARStore.putFile(ARStore.fileKey(ex.id, 'img'), img));
              if (vid) writes.push(ARStore.putFile(ARStore.fileKey(ex.id, 'vid'), vid));
              if (mdl) writes.push(ARStore.putFile(ARStore.fileKey(ex.id, 'mdl'), mdl));
              exhibits.push(record);
              return Promise.all(writes);
            });
          });
        }, Promise.resolve()).then(function () {
          progress(0.95, 'Fetching the compiled tracker…');
          draft = { version: 1, exhibits: exhibits, compiled: null };
          return grab(bundle.mindSrc).then(function (mind) {
            if (!mind) return;
            return ARStore.putFile(ARStore.MIND_FILE, mind).then(function () {
              draft.compiled = {
                at: bundle.generated || new Date().toISOString(),
                signature: signature(), count: exhibits.length, size: mind.size,
              };
            });
          }).catch(function () {
            // No tracker is recoverable — the banner will ask for a compile.
          });
        });
      });
    }).then(function () {
      return save();
    }).then(function () {
      idle();
      render();
      toast('Loaded ' + draft.exhibits.length + ' deployed exhibit' +
            (draft.exhibits.length === 1 ? '' : 's') + ' into the portal.', 'ok');
    }).catch(function (err) {
      idle();
      toast('Could not load the deployed content: ' + (err.message || err), 'err');
    });
  }

  // ------------------------------------------------------------------ render
  function renderHeader() {
    var n = draft.exhibits.length;
    var complete = draft.exhibits.filter(isComplete).length;
    var parts = [n + ' exhibit' + (n === 1 ? '' : 's')];
    if (complete < n) parts.push((n - complete) + ' incomplete');
    parts.push('saved ' + ago(draft.updated));

    $('subLine').textContent = parts.join(' · ');

    ARStore.usage().then(function (estimate) {
      if (!estimate || !estimate.usage) return;
      var text = parts.join(' · ') + ' · ' + bytes(estimate.usage) + ' stored';
      if (estimate.quota) {
        var share = estimate.usage / estimate.quota;
        text += ' (' + (share * 100).toFixed(0) + '% of this browser’s quota)';
        if (share > 0.8) toast('Browser storage is nearly full — export a bundle and delete what you do not need.', 'err');
      }
      $('subLine').textContent = text;
    });

    var state = compileState();
    var banner = $('compileBanner');
    if (state.kind === 'empty') {
      banner.classList.add('hidden');
    } else {
      banner.classList.remove('hidden');
      banner.className = 'banner ' + (state.kind === 'ok' ? 'ok' : state.kind === 'blocked' ? 'err' : '');
      $('compileIcon').textContent = state.kind === 'ok' ? '✅' : '⚠️';
      $('compileText').textContent = state.text;
      $('compileNow').classList.toggle('hidden', state.kind === 'ok' || state.kind === 'blocked');
    }

    $('exportBtn').disabled = state.kind !== 'ok' || complete !== n || !n;
    $('previewBtn').disabled = !n;
    $('compileBtn').disabled = !n;
  }

  function renderSlot(card, ex, kind) {
    var slot = card.querySelector('.slot[data-kind="' + kind + '"]');
    var record = kind === 'img' ? ex.image : kind === 'vid' ? ex.video : ex.model;
    var filled = !!(record && record.stamp);
    var key = ARStore.fileKey(ex.id, kind);

    slot.classList.toggle('filled', filled);
    var hint = slot.querySelector('.drop-hint');
    var meta = slot.querySelector('.meta');

    if (!filled) {
      hint.classList.remove('hidden');
      slot.querySelectorAll('.thumb, .glb').forEach(function (n) { n.classList.add('hidden'); });
      meta.textContent = '';
      var quality = slot.querySelector('.quality');
      if (quality) quality.textContent = '';
      return;
    }

    hint.classList.add('hidden');

    if (kind === 'mdl') {
      slot.querySelector('.glb').classList.remove('hidden');
      meta.textContent = record.fileName + ' · ' + bytes(record.size);
    } else {
      var node = slot.querySelector('.thumb');
      node.classList.remove('hidden');
      ARStore.getFile(key).then(function (blob) {
        if (!blob) return;
        node.src = urlFor(key, blob);
        if (kind === 'vid') {
          // Without a nudge past zero most browsers show a black frame.
          node.onloadeddata = function () { try { node.currentTime = 0.1; } catch (e) {} };
        }
      });

      if (kind === 'img') {
        meta.textContent = record.fileName + ' · ' + record.width + '×' + record.height +
          (record.resizedFrom ? ' (resized from ' + record.resizedFrom + ')' : '') +
          ' · ' + bytes(record.size);

        var q = slot.querySelector('.quality');
        if (record.featurePoints === null || record.featurePoints === undefined) {
          q.className = 'quality';
          q.textContent = 'Trackability is measured when you compile.';
        } else if (record.featurePoints < GOOD_FEATURE_POINTS) {
          q.className = 'quality poor';
          q.textContent = '⚠ ' + record.featurePoints + ' feature points — too few. Use a busier, ' +
            'higher-contrast image; flat or repetitive artwork tracks badly.';
        } else {
          q.className = 'quality good';
          q.textContent = '✓ ' + record.featurePoints + ' feature points across ' +
            record.keyframes + ' keyframes — good.';
        }
      } else {
        meta.textContent = record.fileName + ' · ' + record.width + '×' + record.height +
          (record.duration ? ' · ' + record.duration.toFixed(1) + 's' : '') +
          ' · ' + bytes(record.size);
      }
    }
  }

  function renderCard(ex, index) {
    var card = $('cardTemplate').content.firstElementChild.cloneNode(true);
    card.dataset.id = ex.id;
    card.classList.toggle('incomplete', !isComplete(ex));
    card.querySelector('.index').textContent = index + 1;

    var name = card.querySelector('.name');
    name.value = ex.name;
    name.addEventListener('change', function () {
      ex.name = name.value.trim() || 'Exhibit ' + (index + 1);
      name.value = ex.name;
      save();
    });

    ['img', 'vid', 'mdl'].forEach(function (kind) { renderSlot(card, ex, kind); });

    // --- files: click to pick, drop to set, and a right-click to clear.
    card.querySelectorAll('.slot').forEach(function (slot) {
      var kind = slot.dataset.kind;
      var drop = slot.querySelector('.drop');

      drop.addEventListener('click', function () {
        pending = { ex: ex, kind: kind };
        $(kind === 'img' ? 'pickImage' : kind === 'vid' ? 'pickVideo' : 'pickModel').click();
      });
      drop.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        var record = kind === 'img' ? ex.image : kind === 'vid' ? ex.video : ex.model;
        if (record && record.stamp) clearFile(ex, kind);
      });
      ['dragenter', 'dragover'].forEach(function (type) {
        drop.addEventListener(type, function (e) { e.preventDefault(); drop.classList.add('over'); });
      });
      ['dragleave', 'dragend'].forEach(function (type) {
        drop.addEventListener(type, function () { drop.classList.remove('over'); });
      });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('over');
        var file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) setFile(ex, kind, file);
      });
    });

    // --- card tools
    card.querySelector('[data-act="up"]').addEventListener('click', function () { move(index, -1); });
    card.querySelector('[data-act="down"]').addEventListener('click', function () { move(index, 1); });
    card.querySelector('[data-act="dup"]').addEventListener('click', function () { duplicate(ex, index); });
    card.querySelector('[data-act="del"]').addEventListener('click', function () { remove(ex, index); });

    var settings = card.querySelector('.settings');
    card.querySelector('[data-act="settings"]').addEventListener('click', function (e) {
      settings.classList.toggle('hidden');
      e.target.textContent = settings.classList.contains('hidden') ? 'Settings ▾' : 'Settings ▴';
    });

    // --- settings, bound by path
    settings.querySelectorAll('[data-set]').forEach(function (input) {
      var path = input.dataset.set;
      var value = get(ex, path);
      if (value === undefined) value = get({ video: ARContent.videoDefaults(), model: ARContent.modelDefaults() }, path);

      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value === undefined || value === null ? '' : value;

      input.addEventListener('change', function () {
        var next = input.type === 'checkbox' ? input.checked
          : input.type === 'number' ? parseFloat(input.value)
            : input.value;
        if (input.type === 'number' && isNaN(next)) { input.value = get(ex, path); return; }
        set(ex, path, next);
        save();
      });
    });

    return card;
  }

  function render() {
    var list = $('list');
    list.textContent = '';
    draft.exhibits.forEach(function (ex, i) { list.appendChild(renderCard(ex, i)); });
    $('empty').classList.toggle('hidden', draft.exhibits.length > 0);
    renderHeader();
  }

  // ------------------------------------------------------------------ list ops
  function add() {
    draft.exhibits.push(ARContent.blankExhibit(draft.exhibits.length));
    save().then(function () {
      render();
      var cards = $('list').children;
      if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function move(index, delta) {
    var to = index + delta;
    if (to < 0 || to >= draft.exhibits.length) return;
    var moved = draft.exhibits.splice(index, 1)[0];
    draft.exhibits.splice(to, 0, moved);
    save().then(render);
    // Order is target order, so this invalidates the tracker. The banner says so.
  }

  function duplicate(ex, index) {
    var copy = JSON.parse(JSON.stringify(ex));
    copy.id = ARContent.blankExhibit(0).id;
    copy.name = ex.name + ' (copy)';
    copy.image.featurePoints = null;

    // The copy needs its own files, not a second reference to the originals:
    // deleting the original would otherwise take the copy's assets with it.
    var kinds = ['img', 'vid', 'mdl'];
    Promise.all(kinds.map(function (kind) {
      return ARStore.getFile(ARStore.fileKey(ex.id, kind)).then(function (blob) {
        return blob ? ARStore.putFile(ARStore.fileKey(copy.id, kind), blob) : null;
      });
    })).then(function () {
      draft.exhibits.splice(index + 1, 0, copy);
      return save();
    }).then(render);
  }

  function remove(ex, index) {
    if (!confirm('Delete "' + ex.name + '"? Its image, video and model are deleted from this browser too.')) return;
    Promise.all(['img', 'vid', 'mdl'].map(function (kind) {
      dropUrl(ARStore.fileKey(ex.id, kind));
      return ARStore.delFile(ARStore.fileKey(ex.id, kind));
    })).then(function () {
      draft.exhibits.splice(index, 1);
      return save();
    }).then(render);
  }

  // ------------------------------------------------------------------ help
  function showHelp(which, size) {
    var body = $('sheetBody');
    if (which === 'exported') {
      $('sheetTitle').textContent = 'Bundle downloaded — two commands to go live';
      body.innerHTML =
        '<p>Your bundle is <strong>' + bytes(size) + '</strong>. Unzip it at the root of the repository ' +
        '(it only writes into <code>assets/content/</code>), then:</p>' +
        '<pre><code>git add assets/content\ngit commit -m "Update AR exhibits"\ngit push</code></pre>' +
        '<p>Vercel and GitHub Pages both rebuild on push, so the new exhibits are live a minute later. ' +
        'Visitors get them on their next reload.</p>' +
        '<h4>Keep the zip</h4>' +
        '<p>It is the only backup of your originals outside this browser. ' +
        '<em>Import a bundle</em> reads it straight back into the portal.</p>';
    } else {
      $('sheetTitle').textContent = 'How this works';
      body.innerHTML =
        '<h4>An exhibit is a set of three</h4>' +
        '<p>A <strong>target image</strong> visitors point their phone at, a <strong>video</strong> that plays ' +
        'mapped exactly onto it, and an optional <strong>3D model</strong> they can then stand on the floor.</p>' +
        '<h4>The order of exhibits matters</h4>' +
        '<p>Image tracking works by index: exhibit 1 is target 0 inside <code>targets.mind</code>. ' +
        'Adding, removing, reordering or replacing an image means the tracker has to be rebuilt — press ' +
        '<strong>Compile targets</strong>. The banner at the top tells you when it is out of date. ' +
        'Ignore it and every exhibit still tracks, just against the wrong video.</p>' +
        '<h4>What makes a good target image</h4>' +
        '<p>Busy, high-contrast, non-repeating detail. A flat colour field, a smooth gradient or a regular ' +
        'pattern gives the tracker nothing to lock onto. After compiling, each card reports its feature ' +
        'point count — under ' + GOOD_FEATURE_POINTS + ' and it will struggle. Photograph the artwork flat and evenly lit.</p>' +
        '<h4>Preview is this browser only</h4>' +
        '<p><strong>Preview</strong> opens the AR page against the draft held in this browser, so it needs ' +
        'a webcam here. It cannot reach your phone — browser storage never leaves the device it is on. ' +
        'To test on a phone, export the bundle, push it, and open the live URL there.</p>' +
        '<h4>Nothing is uploaded</h4>' +
        '<p>Files live in this browser’s storage, and target compilation runs on this machine. ' +
        'Clearing site data deletes them, so keep your exported zips — they are the backup.</p>' +
        '<h4>Right-click a file to remove it</h4>' +
        '<p>Right-click any filled image, video or model slot to clear it.</p>';
    }
    $('sheet').classList.remove('hidden');
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    $('addBtn').addEventListener('click', add);
    $('compileBtn').addEventListener('click', compile);
    $('compileNow').addEventListener('click', compile);
    $('exportBtn').addEventListener('click', exportBundle);

    $('previewBtn').addEventListener('click', function () {
      var state = compileState();
      if (state.kind !== 'ok') { toast(state.text, 'err'); return; }
      window.open('./index.html?preview=1', '_blank');
    });

    $('menuBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      $('menu').classList.toggle('hidden');
    });
    document.addEventListener('click', function () { $('menu').classList.add('hidden'); });
    $('menu').addEventListener('click', function (e) { e.stopPropagation(); });

    $('importBtn').addEventListener('click', function () {
      $('menu').classList.add('hidden');
      pending = { bundle: true };
      $('pickBundle').click();
    });
    $('adoptBtn').addEventListener('click', function () {
      $('menu').classList.add('hidden');
      if (draft.exhibits.length &&
          !confirm('This replaces everything in the portal with what the site is currently serving. Continue?')) return;
      adopt();
    });
    $('helpBtn').addEventListener('click', function () {
      $('menu').classList.add('hidden');
      showHelp('how');
    });
    $('wipeBtn').addEventListener('click', function () {
      $('menu').classList.add('hidden');
      if (!confirm('Delete every exhibit and file from this browser? Exported bundles are unaffected.')) return;
      ARStore.clear().then(function () {
        urls.forEach(function (url) { URL.revokeObjectURL(url); });
        urls.clear();
        draft = { version: 1, exhibits: [], compiled: null };
        render();
        toast('Cleared.');
      });
    });

    $('sheetClose').addEventListener('click', function () { $('sheet').classList.add('hidden'); });
    $('sheet').addEventListener('click', function (e) {
      if (e.target === $('sheet')) $('sheet').classList.add('hidden');
    });

    $('empty').addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.act;
      if (act === 'add') add();
      if (act === 'import') { pending = { bundle: true }; $('pickBundle').click(); }
      if (act === 'adopt') adopt();
    });

    [['pickImage', 'img'], ['pickVideo', 'vid'], ['pickModel', 'mdl']].forEach(function (pair) {
      $(pair[0]).addEventListener('change', function (e) {
        var file = e.target.files[0];
        e.target.value = '';
        if (file && pending && pending.ex) setFile(pending.ex, pending.kind, file);
        pending = null;
      });
    });
    $('pickBundle').addEventListener('change', function (e) {
      var file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (draft.exhibits.length &&
          !confirm('Importing replaces everything currently in the portal. Continue?')) return;
      importBundle(file);
    });

    // A whole-window drop target, so a file dragged onto empty space does not
    // navigate the browser away from unsaved work.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    wire();
    ARStore.getDraft().then(function (saved) {
      if (saved && saved.exhibits) draft = saved;
      render();
      if (!draft.exhibits.length) $('empty').classList.remove('hidden');
    }).catch(function (err) {
      toast('Could not open local storage: ' + err.message +
            ' — private browsing blocks it.', 'err');
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
