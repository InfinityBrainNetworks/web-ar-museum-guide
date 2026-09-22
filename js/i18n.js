/**
 * The app's own words, in every language it can speak.
 *
 * Two quite different things are translated in this project, and only one of
 * them lives here:
 *
 *   the INTERFACE   "More details", "Listen", "Point at the artwork". Shipped
 *                   with the app, the same in every museum. This file.
 *
 *   the EXHIBITS    what each label actually says. Written per exhibit in the
 *                   admin portal and carried in content.json. Not here.
 *
 * A gallery may add a language the interface has never heard of — the portal
 * lets it — and that is deliberately not an error. An unknown language shows
 * its own exhibit text, written by the museum, inside an English interface,
 * which is a great deal more useful than refusing to show it at all.
 *
 * Translations below are a starting point and should be read by a native
 * speaker before the gallery opens. The keys, not the English, are the source
 * of truth: nothing in the app compares against a displayed string.
 */
(function () {
  'use strict';

  var STORE_KEY = 'ar-museum-language';

  /**
   * The interface, key by key.
   *
   * `en` is complete by definition and every other language falls back to it
   * key by key, so a half-finished translation shows the translated half
   * rather than nothing.
   */
  var STRINGS = {
    en: {
      'app.name': 'Museum Guide',
      'app.eyebrow': 'Web AR',

      'lang.title': 'Choose your language',
      'lang.sub': 'You can change this at any time.',
      'lang.continue': 'Continue',
      'lang.change': 'Language',

      'intro.empty.title': 'No exhibits yet',
      'intro.empty.text': 'This gallery has no artworks loaded. Add them in the admin portal, compile the targets and export the bundle.',

      'loading.camera': 'Starting camera…',
      'scan.point': 'Point at the artwork',
      'floor.point': 'Point your phone down at the floor and move it slowly',

      'btn.details': 'More details',
      'btn.ar': 'View in 3D',
      'btn.place': 'Place on the floor',
      'btn.back': 'Back to artwork',
      'btn.move': 'Move',
      'btn.remove': 'Remove',
      'btn.close': 'Close',
      'btn.photo': 'Take a photo',

      'details.listen': 'Listen',
      'details.pause': 'Pause',
      'details.replay': 'Play again',
      'details.empty': 'No details have been written for this exhibit yet.',
      'details.fallback': 'Shown in {language} — this exhibit has no {wanted} translation yet.',
      'details.readIn': 'Read in',

      'photo.save': 'Save to photos',
      'photo.back': 'Back to AR',


      'nav.explore': 'Explore',
      'nav.map': 'Map',
      'nav.ar': 'Start AR',
      'nav.feedback': 'Feedback',
      'nav.settings': 'Settings',

      'explore.title1': 'Ancient echoes,',
      'explore.title2': 'living canvas',
      'explore.count': '{count} artworks',
      'explore.countOne': '1 artwork',

      'exhibit.about': 'About this exhibit',
      'exhibit.viewInAr': 'View in AR',
      'exhibit.scanHint': 'Point your camera at this artwork in the gallery to watch it come alive.',

      'fact.video': 'AR video',
      'fact.videoSub': 'Plays on the artwork',
      'fact.image': 'AR picture',
      'fact.imageSub': 'Appears on the artwork',
      'fact.model': '3D object',
      'fact.modelSub': 'Stand it on the floor',
      'fact.audio': 'Narration',
      'fact.audioSub': '{count} languages',
      'fact.audioSubOne': '1 language',

      'btn.back2': 'Back',
      'btn.exitAr': 'Close AR',

      'settings.language': 'Language',
      'settings.languageSub': 'Interface and exhibit text',
      'settings.display': 'Display',
      'settings.motion': 'Reduce motion',
      'settings.motionSub': 'Turn off the drifting dust and the slow fades',
      'settings.log': 'Debug log',
      'settings.logSub': 'Show the bug button over the camera',
      'settings.aboutText': 'Everything runs on your device. The camera picture is never uploaded.',

      'soon.map.title': 'Gallery map',
      'soon.map.text': 'A floor plan showing where each artwork hangs, and which one is nearest to you.',
      'soon.map.needs': 'Still needed: a floor plan of the gallery, and the room and wall for each exhibit.',
      'soon.feedback.title': 'Tell us what you think',
      'soon.feedback.text': 'A short note to the museum about your visit.',
      'soon.feedback.needs': 'Still needed: somewhere for the messages to go. This guide is a static site, so it has no server of its own yet.',

      'toast.arUnavailable': 'AR is not ready yet.',
      'toast.noExhibits': 'Add an artwork in the admin portal first.',
      'status.searching': 'Searching…',
      'status.tracking': 'Tracking',
      'status.floor': 'Looking for the floor',
      'status.floorReady': 'Floor ready',
      'status.hold': 'Hold steady… {seconds}s',
      'status.placed': 'Placed',
    },

    si: {
      'app.name': 'කෞතුකාගාර මාර්ගෝපදේශය',
      'app.eyebrow': 'වෙබ් AR',

      'lang.title': 'ඔබේ භාෂාව තෝරන්න',
      'lang.sub': 'ඔබට ඕනෑම වේලාවක මෙය වෙනස් කළ හැකිය.',
      'lang.continue': 'ඉදිරියට',
      'lang.change': 'භාෂාව',

      'intro.empty.title': 'තවම ප්‍රදර්ශන නැත',
      'intro.empty.text': 'මෙම ගැලරියට කලා කෘති එක් කර නැත. පරිපාලන පිවිසුමෙන් ඒවා එක් කරන්න.',

      'loading.camera': 'කැමරාව ආරම්භ වෙමින්…',
      'scan.point': 'කලා කෘතිය දෙසට එල්ල කරන්න',
      'floor.point': 'දුරකථනය බිම දෙසට යොමු කර සෙමින් චලනය කරන්න',

      'btn.details': 'වැඩි විස්තර',
      'btn.ar': '3D ලෙස බලන්න',
      'btn.place': 'බිම තබන්න',
      'btn.back': 'කලා කෘතියට ආපසු',
      'btn.move': 'ගෙන යන්න',
      'btn.remove': 'ඉවත් කරන්න',
      'btn.close': 'වසන්න',
      'btn.photo': 'ඡායාරූපයක් ගන්න',

      'details.listen': 'අසන්න',
      'details.pause': 'විරාම කරන්න',
      'details.replay': 'නැවත අසන්න',
      'details.empty': 'මෙම ප්‍රදර්ශනය සඳහා තවම විස්තර ලියා නැත.',
      'details.fallback': '{language} භාෂාවෙන් පෙන්වයි — මෙම ප්‍රදර්ශනයට තවම {wanted} පරිවර්තනයක් නැත.',
      'details.readIn': 'කියවන්නේ',

      'photo.save': 'ඡායාරූප වෙත සුරකින්න',
      'photo.back': 'AR වෙත ආපසු',


      'nav.explore': 'ගවේෂණය',
      'nav.map': 'සිතියම',
      'nav.ar': 'AR ආරම්භ කරන්න',
      'nav.feedback': 'ප්‍රතිපෝෂණ',
      'nav.settings': 'සැකසුම්',

      'explore.title1': 'පැරණි දෝංකාර,',
      'explore.title2': 'ජීවමාන කැන්වසය',
      'explore.count': 'කලා කෘති {count}ක්',
      'explore.countOne': 'කලා කෘති 1ක්',

      'exhibit.about': 'මෙම ප්‍රදර්ශනය ගැන',
      'exhibit.viewInAr': 'AR තුළ බලන්න',
      'exhibit.scanHint': 'ගැලරියේදී මෙම කලා කෘතිය දෙසට ඔබේ කැමරාව එල්ල කර එය දිවි ගෙන එනු බලන්න.',

      'fact.video': 'AR දෘශ්‍යය',
      'fact.videoSub': 'කලා කෘතිය මතම ධාවනය වේ',
      'fact.image': 'AR පින්තූරය',
      'fact.imageSub': 'කලා කෘතිය මත දිස් වේ',
      'fact.model': '3D වස්තුව',
      'fact.modelSub': 'එය බිම තබන්න',
      'fact.audio': 'හඬ විවරණය',
      'fact.audioSub': 'භාෂා {count}ක්',
      'fact.audioSubOne': 'භාෂා 1ක්',

      'btn.back2': 'ආපසු',
      'btn.exitAr': 'AR වසන්න',

      'settings.language': 'භාෂාව',
      'settings.languageSub': 'අතුරුමුහුණත සහ ප්‍රදර්ශන විස්තර',
      'settings.display': 'සංදර්ශනය',
      'settings.motion': 'චලනය අඩු කරන්න',
      'settings.motionSub': 'සෙමින් ගෙවෙන සජීවිකරණ ක්‍රියා විරහිත කරන්න',
      'settings.log': 'දෝෂ ලොගය',
      'settings.logSub': 'කැමරාව මත දෝෂ බොත්තම පෙන්වන්න',
      'settings.aboutText': 'සියල්ල ඔබේ උපාංගය තුළම ක්‍රියාත්මක වේ. කැමරා රූපය කිසිදා උඩුගත නොවේ.',

      'soon.map.title': 'ගැලරි සිතියම',
      'soon.map.text': 'එක් එක් කලා කෘතිය ඇති ස්ථානය සහ ඔබට ළඟම ඇත්තේ කුමක්ද යන්න පෙන්වන බිම් සැලැස්මක්.',
      'soon.map.needs': 'තවම අවශ්‍යයි: ගැලරියේ බිම් සැලැස්ම සහ එක් එක් ප්‍රදර්ශනයේ කාමරය හා බිත්තිය.',
      'soon.feedback.title': 'ඔබේ අදහස කියන්න',
      'soon.feedback.text': 'ඔබේ සංචාරය ගැන කෞතුකාගාරයට කෙටි සටහනක්.',
      'soon.feedback.needs': 'තවම අවශ්‍යයි: පණිවිඩ යවන තැනක්. මෙම මාර්ගෝපදේශය ස්ථිතික අඩවියක් වන බැවින් තවම එයට සේවාදායකයක් නැත.',

      'toast.arUnavailable': 'AR තවම සූදානම් නැත.',
      'toast.noExhibits': 'පළමුව පරිපාලන පිවිසුමෙන් කලා කෘතියක් එක් කරන්න.',
      'status.searching': 'සොයමින්…',
      'status.tracking': 'හඳුනාගෙන ඇත',
      'status.floor': 'බිම සොයමින්',
      'status.floorReady': 'බිම සූදානම්',
      'status.hold': 'ස්ථිරව තබාගෙන සිටින්… {seconds}s',
      'status.placed': 'තබා ඇත',
    },

    ta: {
      'app.name': 'அருங்காட்சியக வழிகாட்டி',
      'app.eyebrow': 'வெப் AR',

      'lang.title': 'உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்',
      'lang.sub': 'இதை நீங்கள் எப்போது வேண்டுமானாலும் மாற்றலாம்.',
      'lang.continue': 'தொடரவும்',
      'lang.change': 'மொழி',

      'intro.empty.title': 'இன்னும் காட்சிப்பொருட்கள் இல்லை',
      'intro.empty.text': 'இந்தக் கேலரியில் கலைப்படைப்புகள் ஏற்றப்படவில்லை. நிர்வாகப் பக்கத்தில் அவற்றைச் சேர்க்கவும்.',

      'loading.camera': 'கேமரா தொடங்குகிறது…',
      'scan.point': 'கலைப்படைப்பை நோக்கிக் காட்டவும்',
      'floor.point': 'உங்கள் தொலைபேசியைத் தரையை நோக்கித் திருப்பி மெதுவாக நகர்த்தவும்',

      'btn.details': 'மேலும் விவரங்கள்',
      'btn.ar': '3D இல் பார்க்க',
      'btn.place': 'தரையில் வைக்கவும்',
      'btn.back': 'கலைப்படைப்புக்குத் திரும்பு',
      'btn.move': 'நகர்த்து',
      'btn.remove': 'அகற்று',
      'btn.close': 'மூடு',
      'btn.photo': 'படம் எடுக்க',

      'details.listen': 'கேட்க',
      'details.pause': 'இடைநிறுத்து',
      'details.replay': 'மீண்டும் கேட்க',
      'details.empty': 'இந்தக் காட்சிப்பொருளுக்கு இன்னும் விவரங்கள் எழுதப்படவில்லை.',
      'details.fallback': '{language} மொழியில் காட்டப்படுகிறது — இதற்கு இன்னும் {wanted} மொழிபெயர்ப்பு இல்லை.',
      'details.readIn': 'படிக்கும் மொழி',

      'photo.save': 'படங்களில் சேமி',
      'photo.back': 'AR க்குத் திரும்பு',


      'nav.explore': 'ஆராய்க',
      'nav.map': 'வரைபடம்',
      'nav.ar': 'AR தொடங்கு',
      'nav.feedback': 'கருத்து',
      'nav.settings': 'அமைப்புகள்',

      'explore.title1': 'பழைய எதிரொலிகள்,',
      'explore.title2': 'உயிர்ப்புள்ள ஓவியம்',
      'explore.count': '{count} கலைப்படைப்புகள்',
      'explore.countOne': '1 கலைப்படைப்பு',

      'exhibit.about': 'இந்தக் கண்காட்சிப் பொருள் பற்றி',
      'exhibit.viewInAr': 'AR இல் பார்க்க',
      'exhibit.scanHint': 'கேலரியில் இந்தக் கலைப்படைப்பை நோக்கி உங்கள் கேமராவைக் காட்டி அது உயிர்பெறுவதைப் பாருங்கள்.',

      'fact.video': 'AR காணொளி',
      'fact.videoSub': 'கலைப்படைப்பின் மீதே இயங்கும்',
      'fact.image': 'AR படம்',
      'fact.imageSub': 'கலைப்படைப்பின் மீது தோன்றும்',
      'fact.model': '3D பொருள்',
      'fact.modelSub': 'தரையில் வைக்கவும்',
      'fact.audio': 'குரல் விளக்கம்',
      'fact.audioSub': '{count} மொழிகள்',
      'fact.audioSubOne': '1 மொழி',

      'btn.back2': 'பின்செல்',
      'btn.exitAr': 'AR ஐ மூடு',

      'settings.language': 'மொழி',
      'settings.languageSub': 'இடைமுகம் மற்றும் கண்காட்சி உரை',
      'settings.display': 'காட்சி',
      'settings.motion': 'அசைவைக் குறைக்க',
      'settings.motionSub': 'மெதுவான அசைவூட்டங்களை நிறுத்து',
      'settings.log': 'பிழைப் பதிவு',
      'settings.logSub': 'கேமராவின் மீது பிழை பொத்தானைக் காட்டு',
      'settings.aboutText': 'அனைத்தும் உங்கள் சாதனத்திலேயே இயங்குகிறது. கேமரா படம் எப்போதும் பதிவேற்றப்படுவதில்லை.',

      'soon.map.title': 'கேலரி வரைபடம்',
      'soon.map.text': 'ஒவ்வொரு கலைப்படைப்பும் எங்கே உள்ளது, உங்களுக்கு எது அருகில் உள்ளது என்பதைக் காட்டும் தளவமைப்பு.',
      'soon.map.needs': 'இன்னும் தேவை: கேலரியின் தளவமைப்பு, மற்றும் ஒவ்வொரு கண்காட்சிப் பொருளின் அறை மற்றும் சுவர்.',
      'soon.feedback.title': 'உங்கள் கருத்தைச் சொல்லுங்கள்',
      'soon.feedback.text': 'உங்கள் வருகை குறித்து அருங்காட்சியகத்துக்கு ஒரு சிறு குறிப்பு.',
      'soon.feedback.needs': 'இன்னும் தேவை: செய்திகள் செல்ல ஓர் இடம். இந்த வழிகாட்டி ஒரு நிலையான தளம், எனவே இதற்கு இன்னும் சொந்த சேவையகம் இல்லை.',

      'toast.arUnavailable': 'AR இன்னும் தயாராகவில்லை.',
      'toast.noExhibits': 'முதலில் நிர்வாகப் பக்கத்தில் ஒரு கலைப்படைப்பைச் சேர்க்கவும்.',
      'status.searching': 'தேடுகிறது…',
      'status.tracking': 'கண்டறியப்பட்டது',
      'status.floor': 'தரையைத் தேடுகிறது',
      'status.floorReady': 'தரை தயார்',
      'status.hold': 'அசையாமல் பிடிக்கவும்… {seconds}s',
      'status.placed': 'வைக்கப்பட்டது',
    },
  };

  var available = [];        // what this bundle offers, in the portal's order
  var current = 'en';
  var picked = false;        // has a human chosen, or is this just a guess?
  var listeners = [];

  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode: not worth a warning */ }
  }

  function has(code) {
    for (var i = 0; i < available.length; i++) if (available[i].code === code) return true;
    return false;
  }

  function entry(code) {
    for (var i = 0; i < available.length; i++) if (available[i].code === code) return available[i];
    return null;
  }

  /**
   * The language to start on before anyone has chosen.
   *
   * Only a highlight in the picker, never a decision — the picker is still
   * shown. A phone set to Sinhala landing on a Sinhala-first screen is a nice
   * touch; a phone set to Sinhala being given no choice is not.
   */
  function guess() {
    var wanted = [];
    if (navigator.languages) wanted = wanted.concat(navigator.languages);
    if (navigator.language) wanted.push(navigator.language);
    for (var i = 0; i < wanted.length; i++) {
      var code = String(wanted[i]).toLowerCase();
      if (has(code)) return code;
      var base = code.split('-')[0];
      if (has(base)) return base;
    }
    return available.length ? available[0].code : 'en';
  }

  /**
   * One string.
   *
   * Falls back key by key rather than language by language, so a translation
   * that is 80% done shows 80% translated instead of nothing. {placeholders}
   * are filled from `vars`.
   */
  function t(key, vars) {
    var table = STRINGS[current] || {};
    var text = table[key];
    if (text === undefined) text = STRINGS.en[key];
    if (text === undefined) return key;          // a typo'd key shows itself, loudly
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] === undefined ? whole : vars[name];
    });
  }

  /** The name of a language in its own script, for the picker and the sheet. */
  function nameOf(code) {
    var l = entry(code);
    if (l) return l.native || l.name;
    return code;
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(current); } catch (e) { /* one bad listener must not stop the rest */ }
    });
  }

  function set(code, byHuman) {
    if (!has(code)) return false;
    var changed = code !== current;
    current = code;
    if (byHuman) {
      picked = true;
      write(STORE_KEY, code);
    }
    document.documentElement.setAttribute('lang', code);
    apply(document);
    if (changed || byHuman) notify();
    return true;
  }

  /**
   * Fill every element that names a string key.
   *
   *   data-i18n        its text
   *   data-i18n-label  its aria-label, for the icon-only buttons
   *   data-i18n-title  its tooltip
   *
   * Markup carries the key, not the English, so a screen added later is
   * translated by naming a key and nothing else.
   */
  function apply(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    nodes = scope.querySelectorAll('[data-i18n-label]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('aria-label', t(nodes[i].getAttribute('data-i18n-label')));
    nodes = scope.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('title', t(nodes[i].getAttribute('data-i18n-title')));
  }

  /**
   * Adopt the bundle's language list.
   *
   * Called once the content has loaded, because which languages exist is the
   * museum's decision and travels with the exhibits. A stored choice survives
   * only if the gallery still offers it — a language deleted in the portal
   * must not strand the visitor who last used it.
   */
  function init(languages) {
    available = (languages || []).map(function (l) {
      return { code: l.code, name: l.name, native: l.native || l.name };
    });
    if (!available.length) available = [{ code: 'en', name: 'English', native: 'English' }];

    var stored = read(STORE_KEY);
    if (stored && has(stored)) {
      picked = true;
      current = stored;
    } else {
      picked = false;
      current = guess();
    }
    document.documentElement.setAttribute('lang', current);
    apply(document);
    return current;
  }

  window.ARI18n = {
    init: init,
    apply: apply,
    t: t,
    set: set,
    nameOf: nameOf,
    code: function () { return current; },
    languages: function () { return available.slice(); },
    /** Has a human chosen? False means the picker has not been answered yet. */
    chosen: function () { return picked; },
    /** Is this language one the interface itself is translated into? */
    translated: function (code) { return !!STRINGS[code]; },
    onChange: function (fn) { listeners.push(fn); },
    STORE_KEY: STORE_KEY,
  };
})();
