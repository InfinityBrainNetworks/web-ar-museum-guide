/**
 * The guide's conversation with the museum: the photobooth, feedback, and
 * staff signing in on a phone.
 *
 *   photobooth  a visitor shares an AR photo to the wall at /photobooth -
 *               only ever when they ask to, after saying yes to showing it,
 *               and they can take it down again from the same phone.
 *   feedback    a rating and a few words, from the Feedback tab.
 *   staff       a curator signs in with Google on their own phone, and the
 *               Adjust panel saves straight into the Studio's draft - the
 *               numbers found standing in front of the real painting.
 *
 * None of it loads the Firebase SDK until it is used. Browsing, AR and the
 * offline gallery never do; the first photo shared or the first word of
 * feedback is what fetches it. Without a Firebase project configured, every
 * part reports itself unavailable and the guide shows what it always did.
 */
(function () {
  'use strict';

  var CLOUD = window.AR_CLOUD;
  var log = window.ARLog || console;
  var MINE_KEY = 'ar-museum-my-photos';

  function enabled() { return !!(CLOUD && CLOUD.enabled()); }

  // ------------------------------------------------------------------ site settings
  /**
   * config/site, read over REST like the live release - small, public, and
   * read once per visit. Which features are on is the museum's live choice,
   * not frozen into a release: switching the photobooth off in the Studio
   * takes effect on the next page load.
   */
  var sitePromise = null;
  function site() {
    if (!enabled()) return Promise.resolve(null);
    if (!sitePromise) {
      sitePromise = CLOUD.getDocument('config/site', 4000).catch(function (err) {
        log.warn('community: site settings unavailable — ' + err.message);
        sitePromise = null;
        return null;
      });
    }
    return sitePromise;
  }

  function feature(name) {
    return site().then(function (s) {
      if (!s) return false;
      if (name === 'photobooth') return !!(s.photobooth && s.photobooth.enabled);
      return !s.features || s.features[name] !== false;
    });
  }

  // ------------------------------------------------------------------ the SDK
  function api() {
    return CLOUD.sdk().then(function (sdk) {
      return Promise.all([sdk.firestoreApi(), sdk.storageApi(), sdk.db(), sdk.storage()])
        .then(function (r) { return { sdk: sdk, F: r[0], S: r[1], db: r[2], storage: r[3] }; });
    });
  }

  // ------------------------------------------------------------------ photobooth
  function readMine() {
    try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeMine(list) {
    try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(-30))); } catch (e) { /* private window */ }
  }

  /** Decode a picture - createImageBitmap where there is one, an <img> on older iPhones. */
  function decode(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).catch(function () { return decodeWithImg(blob); });
    }
    return decodeWithImg(blob);
  }

  function decodeWithImg(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('the photo could not be read')); };
      img.src = url;
    });
  }

  /** A photo for the wall: at most 1600 px and under the 5 MB the rules allow. */
  function forWall(blob) {
    return decode(blob).then(function (bitmap) {
      var scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (b) { resolve({ blob: b, width: canvas.width, height: canvas.height }); }, 'image/jpeg', 0.86);
      });
    });
  }

  /**
   * Share one photo. `consent` must be true - the rules refuse it otherwise.
   * Resolves { id, status } where status is 'pending' or 'approved'.
   */
  function sharePhoto(blob, meta) {
    if (!enabled()) return Promise.reject(new Error('the photobooth is not set up'));
    if (!meta || meta.consent !== true) return Promise.reject(new Error('consent is required'));
    var ctx, user, id, path, shot;
    return Promise.all([api(), site(), forWall(blob)]).then(function (r) {
      ctx = r[0];
      var pb = (r[1] && r[1].photobooth) || {};
      if (!pb.enabled) throw new Error('the photobooth is switched off');
      shot = r[2];
      ctx.status = pb.autoApprove ? 'approved' : 'pending';
      return ctx.sdk.visitor();
    }).then(function (u) {
      user = u;
      id = ctx.sdk.newId('p');
      path = 'photobooth/' + user.uid + '/' + id + '.jpg';
      var ref = ctx.S.ref(ctx.storage, path);
      return ctx.S.uploadBytes(ref, shot.blob, { contentType: 'image/jpeg' }).then(function () {
        return ctx.S.getDownloadURL(ref);
      });
    }).then(function (url) {
      var doc = {
        uid: user.uid, path: path, url: url, consent: true, status: ctx.status,
        width: shot.width, height: shot.height, createdAt: ctx.F.serverTimestamp(),
      };
      var name = String(meta.name || '').trim().slice(0, 40);
      if (name) doc.name = name;
      if (meta.exhibitId) doc.exhibitId = String(meta.exhibitId).slice(0, 120);
      if (meta.exhibitName) doc.exhibitName = String(meta.exhibitName).slice(0, 200);
      if (meta.lang) doc.lang = String(meta.lang).slice(0, 12);
      return ctx.F.setDoc(ctx.F.doc(ctx.db, 'photos', id), doc);
    }).then(function () {
      var mine = readMine();
      mine.push({ id: id, path: path, at: Date.now() });
      writeMine(mine);
      log.ok('photobooth: shared ' + id + ' (' + ctx.status + ')');
      return { id: id, status: ctx.status };
    });
  }

  /** Take one of this phone's photos back down - the file and the record. */
  function removePhoto(id) {
    var entry = readMine().filter(function (p) { return p.id === id; })[0];
    if (!entry) return Promise.reject(new Error('that photo was not shared from this phone'));
    return api().then(function (ctx) {
      return ctx.sdk.visitor().then(function () {
        return ctx.S.deleteObject(ctx.S.ref(ctx.storage, entry.path)).catch(function (err) {
          if (!err || err.code !== 'storage/object-not-found') throw err;
        });
      }).then(function () {
        return ctx.F.deleteDoc(ctx.F.doc(ctx.db, 'photos', id));
      });
    }).then(function () {
      writeMine(readMine().filter(function (p) { return p.id !== id; }));
      log.ok('photobooth: removed ' + id);
    });
  }

  /** Has a shared photo made it onto the wall yet? */
  function photoStatus(id) {
    return api().then(function (ctx) {
      return ctx.sdk.visitor().then(function () {
        return ctx.F.getDoc(ctx.F.doc(ctx.db, 'photos', id));
      }).then(function (snap) { return snap.exists() ? snap.data().status : 'removed'; });
    });
  }

  // ------------------------------------------------------------------ feedback
  function sendFeedback(entry) {
    if (!enabled()) return Promise.reject(new Error('feedback is not set up'));
    var rating = Math.round(Number(entry.rating));
    if (!(rating >= 1 && rating <= 5)) return Promise.reject(new Error('choose from one to five stars'));
    return api().then(function (ctx) {
      return ctx.sdk.visitor().then(function (user) {
        var doc = {
          uid: user.uid,
          rating: rating,
          message: String(entry.message || '').trim().slice(0, 2000),
          createdAt: ctx.F.serverTimestamp(),
        };
        if (entry.exhibitId) doc.exhibitId = String(entry.exhibitId).slice(0, 120);
        if (entry.exhibitName) doc.exhibitName = String(entry.exhibitName).slice(0, 200);
        if (entry.lang) doc.lang = String(entry.lang).slice(0, 12);
        if (entry.release) doc.release = String(entry.release).slice(0, 80);
        return ctx.F.addDoc(ctx.F.collection(ctx.db, 'feedback'), doc);
      });
    }).then(function () { log.ok('feedback sent (' + rating + '★)'); });
  }

  // ------------------------------------------------------------------ staff
  var staff = { user: null, member: null, checked: false, listeners: [] };

  function tellStaff() {
    staff.listeners.forEach(function (fn) { try { fn(staffState()); } catch (e) { log.warn(e); } });
  }

  function staffState() {
    return {
      signedIn: !!(staff.user && !staff.user.isAnonymous),
      email: staff.user && staff.user.email,
      role: staff.member ? staff.member.role : null,
      canEdit: !!(staff.member && ['owner', 'admin', 'editor'].indexOf(staff.member.role) !== -1),
    };
  }

  /**
   * Watch who is signed in - but only on a phone where someone has signed in
   * as staff before, so a visitor's phone never loads the SDK just to find
   * out it is nobody.
   */
  var STAFF_KEY = 'ar-museum-staff';
  function watchStaff() {
    var known = false;
    try { known = localStorage.getItem(STAFF_KEY) === '1'; } catch (e) {}
    if (!enabled() || !known) return;
    CLOUD.sdk().then(function (sdk) {
      return sdk.onUser(function (user) {
        staff.user = user && !user.isAnonymous ? user : null;
        if (!staff.user) { staff.member = null; tellStaff(); return; }
        sdk.memberOf(user).then(function (m) { staff.member = m; tellStaff(); },
          function () { staff.member = null; tellStaff(); });
      });
    }).catch(function (err) { log.warn('staff: ' + err.message); });
  }

  function staffSignIn() {
    if (!enabled()) return Promise.reject(new Error('no Firebase project is configured'));
    try { localStorage.setItem(STAFF_KEY, '1'); } catch (e) {}
    return CLOUD.sdk().then(function (sdk) {
      return sdk.signInWithGoogle().then(function (user) {
        if (!user) return null;     // redirecting
        staff.user = user;
        return sdk.memberOf(user).then(function (m) {
          staff.member = m;
          tellStaff();
          if (!staff.listening) { staff.listening = true; watchStaffNow(sdk); }
          return staffState();
        });
      });
    });
  }

  function watchStaffNow(sdk) {
    sdk.onUser(function (user) {
      staff.user = user && !user.isAnonymous ? user : null;
      if (!staff.user) { staff.member = null; tellStaff(); }
    });
  }

  function staffSignOut() {
    try { localStorage.removeItem(STAFF_KEY); } catch (e) {}
    return CLOUD.sdk().then(function (sdk) { return sdk.signOut(); }).then(function () {
      staff.user = null;
      staff.member = null;
      tellStaff();
    });
  }

  /**
   * Save Adjust's numbers into the exhibit's draft in the Studio. Dotted
   * paths, so only what Adjust owns is touched - a label being edited in the
   * Studio at the same moment is left alone.
   */
  function saveExhibit(id, patch) {
    if (!staffState().canEdit) return Promise.reject(new Error('sign in as staff (editor or above) to save to the Studio'));
    var update = {};
    ['model', 'media'].forEach(function (part) {
      Object.keys(patch[part] || {}).forEach(function (k) { update[part + '.' + k] = patch[part][k]; });
    });
    return api().then(function (ctx) {
      update.updatedAt = ctx.F.serverTimestamp();
      update.updatedBy = staff.user.email.toLowerCase();
      return ctx.F.updateDoc(ctx.F.doc(ctx.db, 'exhibits', id), update);
    });
  }

  /**
   * After an Adjust save by an admin: put the draft live, exactly as the
   * Studio does on save (studio/js/autopublish.js, loaded only now and only
   * on a staff phone). Resolves { release } or { skipped, why }.
   */
  function publishSoon(what) {
    var st = staffState();
    if (['owner', 'admin'].indexOf(st.role) === -1) {
      return Promise.resolve({ skipped: 'role', why: 'An admin puts it live, from Publish in the Studio.' });
    }
    var base = CLOUD.appUrl + 'studio/js/';
    return Promise.all([import(base + 'data.js'), import(base + 'autopublish.js')]).then(function (m) {
      return m[0].init().then(function () {
        m[0].setMe({ email: st.email.toLowerCase(), role: st.role });
        return m[1].schedule(what);
      });
    });
  }

  window.ARCommunity = {
    enabled: enabled,
    site: site,
    feature: feature,
    sharePhoto: sharePhoto,
    removePhoto: removePhoto,
    photoStatus: photoStatus,
    myPhotos: readMine,
    sendFeedback: sendFeedback,
    wallUrl: function () { return CLOUD ? CLOUD.appUrl + 'photobooth/' : null; },
    staff: {
      state: staffState,
      signIn: staffSignIn,
      signOut: staffSignOut,
      onChange: function (fn) { staff.listeners.push(fn); fn(staffState()); },
      saveExhibit: saveExhibit,
      publishSoon: publishSoon,
    },
  };

  watchStaff();
})();
