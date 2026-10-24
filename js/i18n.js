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

      'gesture.drag': 'Drag to move',
      'gesture.twist': 'Twist to turn',
      'gesture.pinch': 'Pinch to resize',
      'gesture.realSize': 'Real size',

      'photo.share': "Share to the museum's photo wall",
      'photo.consentTitle': 'Show this photo on the photo wall?',
      'photo.consentText': "I agree to this photo being shown publicly on the museum's photo wall. Staff check every photo first, and I can take it down at any time from this phone.",
      'photo.namePlaceholder': 'Your first name (optional)',
      'photo.send': 'Share',
      'photo.sending': 'Sharing…',
      'photo.cancel': 'Not now',
      'photo.unshare': 'Take it down',
      'photo.sharedPending': 'Shared. It appears on the wall at {wall} once the museum staff have seen it.',
      'photo.sharedLive': 'Shared. It is on the wall now, at {wall}.',
      'photo.shareFailed': 'The photo could not be shared. Check the connection and try again.',
      'photo.unshared': 'Taken down. It is no longer on the wall.',

      'feedback.eyebrow': 'Tell the museum',
      'feedback.title': 'How was your visit?',
      'feedback.rating': 'Your rating',
      'feedback.about': 'About',
      'feedback.wholeVisit': 'The whole visit',
      'feedback.placeholder': 'What did you enjoy? What could be better?',
      'feedback.send': 'Send',
      'feedback.sending': 'Sending…',
      'feedback.note': "Anonymous. Only the museum's staff read it.",
      'feedback.failed': 'That could not be sent. Check the connection and try again.',
      'feedback.thanks': 'Thank you',
      'feedback.thanksText': "The museum's team reads every message.",
      'feedback.again': 'Write another',

      'settings.staff': 'Museum staff',
      'settings.staffSignIn': 'Staff sign-in',
      'settings.staffSub': 'Tune exhibits from this phone, straight into the Studio',
      'settings.staffAs': 'Signed in as {role} · tap to sign out',
      'settings.staffNotMember': 'Not on the museum team yet · tap to sign out',
      'settings.staffReady': 'Signed in. Adjust now saves to the Studio.',

      'sync.eyebrow': 'Before you start',
      'sync.title': 'Getting the gallery ready',
      'sync.lead': '{count} artworks, {size} MB. Downloading them once makes AR instant and lets the guide work without wifi.',
      'sync.update': 'The gallery has changed since your last visit. Fetching {count} new file(s).',
      'sync.bytes': '{done} of {total} MB',
      'sync.waiting': '{size} MB to download',
      'sync.done': 'Everything is on your phone',
      'sync.go': 'Start exploring',
      'sync.goBackground': 'Start exploring — the rest keeps downloading',
      'sync.preparing': 'Preparing…',
      'sync.download': 'Download the gallery ({size} MB)',
      'sync.later': 'Continue in the background',
      'sync.notNow': 'Not now — stream as I go',
      'sync.failed': 'Some files could not be downloaded. They will stream when you need them, or try again from Settings.',
      'sync.saveData': 'Your phone is saving data, so nothing downloads until you say so.',
      'sync.why': 'Downloaded once, kept on this phone. Remove it any time in Settings.',
      'sync.item.tracker': 'Artwork recognition',
      'sync.item.photo': 'Photo',
      'sync.item.video': 'Video',
      'sync.item.still': 'Picture',
      'sync.item.model': '3D figure',
      'sync.item.narration': 'Narration',
      'sync.item.file': 'File',

      'loading.tracker': 'Getting artwork recognition ready… {done} of {total} MB',
      'loading.trackerSome': 'Getting artwork recognition ready… {done} MB',

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
      'settings.storage': 'On this phone',
      'settings.offline': 'Offline gallery',
      'settings.offlineSub': 'Keep the gallery on this phone',
      'settings.offlineNo': 'This browser streams everything instead',
      'settings.offlineReady': 'Ready offline · {size} MB · tap to remove',
      'settings.offlineRunning': 'Downloading…',
      'settings.offlinePartial': '{size} MB still to download · tap to download',
      'settings.offlineConfirmFree': 'Remove the downloaded gallery from this phone? It will stream from the network instead.',
      'settings.aboutText': 'Everything runs on your device. The camera picture is never uploaded.',
      'settings.about': 'About',
      'about.eyebrow': 'Augmented reality guide',
      'about.body': 'An augmented reality guide for the museum: point your phone at an artwork and it answers, in your own language.',
      'about.createdBy': 'Created by',
      'about.role.pm': 'Project Manager',
      'about.role.ar': 'AR Developer',
      'about.role.3d': '3D Developer',
      'about.role.ui': 'UI/UX & Language Developer',
      'about.productOf': 'A product of',

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

      'gesture.drag': 'ගෙන යාමට අදින්න',
      'gesture.twist': 'හැරවීමට කරකවන්න',
      'gesture.pinch': 'ප්‍රමාණය වෙනස් කිරීමට ඇඟිලි දෙකෙන් අදින්න',
      'gesture.realSize': 'සැබෑ ප්‍රමාණය',

      'photo.share': 'කෞතුකාගාරයේ ඡායාරූප බිත්තියට බෙදාගන්න',
      'photo.consentTitle': 'මෙම ඡායාරූපය ඡායාරූප බිත්තියේ පෙන්වන්නද?',
      'photo.consentText': 'මෙම ඡායාරූපය කෞතුකාගාරයේ ඡායාරූප බිත්තියේ ප්‍රසිද්ධියේ පෙන්වීමට මම එකඟ වෙමි. කාර්ය මණ්ඩලය සෑම ඡායාරූපයක්ම පළමුව පරීක්ෂා කරන අතර, මෙම දුරකථනයෙන් ඕනෑම වේලාවක එය ඉවත් කළ හැක.',
      'photo.namePlaceholder': 'ඔබේ මුල් නම (අත්‍යවශ්‍ය නොවේ)',
      'photo.send': 'බෙදාගන්න',
      'photo.sending': 'බෙදාගනිමින්…',
      'photo.cancel': 'දැන් නොවේ',
      'photo.unshare': 'ඉවත් කරන්න',
      'photo.sharedPending': 'බෙදාගත්තා. කාර්ය මණ්ඩලය බැලූ පසු එය {wall} හි බිත්තියේ දිස්වේ.',
      'photo.sharedLive': 'බෙදාගත්තා. එය දැන් {wall} හි බිත්තියේ ඇත.',
      'photo.shareFailed': 'ඡායාරූපය බෙදාගත නොහැකි විය. සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
      'photo.unshared': 'ඉවත් කළා. එය තවදුරටත් බිත්තියේ නැත.',

      'feedback.eyebrow': 'කෞතුකාගාරයට කියන්න',
      'feedback.title': 'ඔබේ පැමිණීම කෙසේද?',
      'feedback.rating': 'ඔබේ ශ්‍රේණිගත කිරීම',
      'feedback.about': 'පිළිබඳව',
      'feedback.wholeVisit': 'සම්පූර්ණ පැමිණීම',
      'feedback.placeholder': 'ඔබ රස වින්දේ කුමක්ද? වඩා හොඳ කළ හැක්කේ කුමක්ද?',
      'feedback.send': 'යවන්න',
      'feedback.sending': 'යවමින්…',
      'feedback.note': 'නිර්නාමිකයි. කෞතුකාගාර කාර්ය මණ්ඩලය පමණක් කියවයි.',
      'feedback.failed': 'යැවිය නොහැකි විය. සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
      'feedback.thanks': 'ස්තූතියි',
      'feedback.thanksText': 'කෞතුකාගාර කණ්ඩායම සෑම පණිවිඩයක්ම කියවයි.',
      'feedback.again': 'තවත් එකක් ලියන්න',

      'settings.staff': 'කෞතුකාගාර කාර්ය මණ්ඩලය',
      'settings.staffSignIn': 'කාර්ය මණ්ඩල පිවිසුම',
      'settings.staffSub': 'මෙම දුරකථනයෙන් ප්‍රදර්ශන සකසා Studio වෙත සුරකින්න',
      'settings.staffAs': '{role} ලෙස පිවිස ඇත · වැසීමට තට්ටු කරන්න',
      'settings.staffNotMember': 'තවම කෞතුකාගාර කණ්ඩායමේ නැත · වැසීමට තට්ටු කරන්න',
      'settings.staffReady': 'පිවිසුණා. Adjust දැන් Studio වෙත සුරකියි.',

      'sync.eyebrow': 'ආරම්භ කිරීමට පෙර',
      'sync.title': 'ගැලරිය සූදානම් කරමින්',
      'sync.lead': 'කලා කෘති {count}ක්, MB {size}. එක් වරක් බාගත කළ විට AR ක්ෂණිකව ක්‍රියා කරන අතර wifi නොමැතිව ද මාර්ගෝපදේශය ක්‍රියා කරයි.',
      'sync.update': 'ඔබගේ අවසන් පැමිණීමෙන් පසු ගැලරිය වෙනස් වී ඇත. නව ගොනු {count}ක් ලබා ගනිමින්.',
      'sync.bytes': 'MB {total} න් MB {done}',
      'sync.waiting': 'බාගත කිරීමට MB {size}',
      'sync.done': 'සියල්ල ඔබගේ දුරකථනයේ ඇත',
      'sync.go': 'ගවේෂණය අරඹන්න',
      'sync.goBackground': 'ගවේෂණය අරඹන්න — ඉතිරිය පසුබිමේ බාගත වේ',
      'sync.preparing': 'සූදානම් කරමින්…',
      'sync.download': 'ගැලරිය බාගත කරන්න (MB {size})',
      'sync.later': 'පසුබිමේ දිගටම කරන්න',
      'sync.notNow': 'දැන් නොවේ — අවශ්‍ය විට පමණක්',
      'sync.failed': 'සමහර ගොනු බාගත කළ නොහැකි විය. අවශ්‍ය විට ඒවා ජාලයෙන් ලැබේ, නැතහොත් සැකසුම් වලින් නැවත උත්සාහ කරන්න.',
      'sync.saveData': 'ඔබගේ දුරකථනය දත්ත ඉතිරි කරයි, එබැවින් ඔබ කියන තුරු කිසිවක් බාගත නොවේ.',
      'sync.why': 'එක් වරක් බාගත කර මෙම දුරකථනයේ තබා ගනී. සැකසුම් වලින් ඕනෑම වේලාවක ඉවත් කළ හැක.',
      'sync.item.tracker': 'කලා කෘති හඳුනාගැනීම',
      'sync.item.photo': 'ඡායාරූපය',
      'sync.item.video': 'වීඩියෝව',
      'sync.item.still': 'රූපය',
      'sync.item.model': '3D රූපය',
      'sync.item.narration': 'විස්තරය',
      'sync.item.file': 'ගොනුව',

      'loading.tracker': 'කලා කෘති හඳුනාගැනීම සූදානම් කරමින්… MB {total} න් MB {done}',
      'loading.trackerSome': 'කලා කෘති හඳුනාගැනීම සූදානම් කරමින්… MB {done}',

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
      'settings.storage': 'මෙම දුරකථනයේ',
      'settings.offline': 'නොබැඳි ගැලරිය',
      'settings.offlineSub': 'ගැලරිය මෙම දුරකථනයේ තබා ගන්න',
      'settings.offlineNo': 'මෙම බ්‍රව්සරය සියල්ල ජාලයෙන් ලබා ගනී',
      'settings.offlineReady': 'නොබැඳිව සූදානම් · MB {size} · ඉවත් කිරීමට තට්ටු කරන්න',
      'settings.offlineRunning': 'බාගත කරමින්…',
      'settings.offlinePartial': 'තවත් MB {size} ක් ඉතිරියි · බාගත කිරීමට තට්ටු කරන්න',
      'settings.offlineConfirmFree': 'බාගත කළ ගැලරිය මෙම දුරකථනයෙන් ඉවත් කරන්නද? ඉන්පසු එය ජාලයෙන් ලැබේ.',
      'settings.aboutText': 'සියල්ල ඔබේ උපාංගය තුළම ක්‍රියාත්මක වේ. කැමරා රූපය කිසිදා උඩුගත නොවේ.',
      'settings.about': 'පිළිබඳව',
      'about.eyebrow': 'විස්තාරිත යථාර්ථ මාර්ගෝපදේශය',
      'about.body': 'කෞතුකාගාරය සඳහා විස්තාරිත යථාර්ථ මාර්ගෝපදේශයකි: ඔබේ දුරකථනය කලා කෘතියක් දෙසට යොමු කරන්න, එය ඔබේම භාෂාවෙන් පිළිතුරු දෙයි.',
      'about.createdBy': 'නිර්මාණය කළේ',
      'about.role.pm': 'ව්‍යාපෘති කළමනාකරු',
      'about.role.ar': 'AR සංවර්ධක',
      'about.role.3d': 'ත්‍රිමාණ සංවර්ධක',
      'about.role.ui': 'UI/UX සහ භාෂා සංවර්ධක',
      'about.productOf': 'නිෂ්පාදනය',

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

      'gesture.drag': 'நகர்த்த இழுக்கவும்',
      'gesture.twist': 'திருப்ப சுழற்றவும்',
      'gesture.pinch': 'அளவை மாற்ற கிள்ளவும்',
      'gesture.realSize': 'உண்மையான அளவு',

      'photo.share': 'அருங்காட்சியகத்தின் புகைப்படச் சுவரில் பகிர்',
      'photo.consentTitle': 'இந்தப் புகைப்படத்தைப் புகைப்படச் சுவரில் காட்டவா?',
      'photo.consentText': 'இந்தப் புகைப்படம் அருங்காட்சியகத்தின் புகைப்படச் சுவரில் பொதுவாகக் காட்டப்படுவதை நான் ஒப்புக்கொள்கிறேன். ஊழியர்கள் ஒவ்வொரு புகைப்படத்தையும் முதலில் சரிபார்ப்பார்கள், இந்தத் தொலைபேசியிலிருந்து எப்போது வேண்டுமானாலும் அதை நீக்கலாம்.',
      'photo.namePlaceholder': 'உங்கள் முதல் பெயர் (விருப்பம்)',
      'photo.send': 'பகிர்',
      'photo.sending': 'பகிர்கிறது…',
      'photo.cancel': 'இப்போது வேண்டாம்',
      'photo.unshare': 'நீக்கு',
      'photo.sharedPending': 'பகிரப்பட்டது. ஊழியர்கள் பார்த்தபின் {wall} இல் சுவரில் தோன்றும்.',
      'photo.sharedLive': 'பகிரப்பட்டது. அது இப்போது {wall} இல் சுவரில் உள்ளது.',
      'photo.shareFailed': 'புகைப்படத்தைப் பகிர முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.',
      'photo.unshared': 'நீக்கப்பட்டது. அது இனி சுவரில் இல்லை.',

      'feedback.eyebrow': 'அருங்காட்சியகத்திடம் சொல்லுங்கள்',
      'feedback.title': 'உங்கள் வருகை எப்படி இருந்தது?',
      'feedback.rating': 'உங்கள் மதிப்பீடு',
      'feedback.about': 'பற்றி',
      'feedback.wholeVisit': 'முழு வருகை',
      'feedback.placeholder': 'எது பிடித்தது? எதை மேம்படுத்தலாம்?',
      'feedback.send': 'அனுப்பு',
      'feedback.sending': 'அனுப்புகிறது…',
      'feedback.note': 'அநாமதேயம். அருங்காட்சியக ஊழியர்கள் மட்டுமே படிப்பார்கள்.',
      'feedback.failed': 'அனுப்ப முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.',
      'feedback.thanks': 'நன்றி',
      'feedback.thanksText': 'அருங்காட்சியகக் குழு ஒவ்வொரு செய்தியையும் படிக்கிறது.',
      'feedback.again': 'இன்னொன்று எழுது',

      'settings.staff': 'அருங்காட்சியக ஊழியர்கள்',
      'settings.staffSignIn': 'ஊழியர் உள்நுழைவு',
      'settings.staffSub': 'இந்தத் தொலைபேசியிலிருந்து கண்காட்சிகளைச் சரிசெய்து Studio இல் சேமிக்கவும்',
      'settings.staffAs': '{role} ஆக உள்நுழைந்துள்ளீர்கள் · வெளியேறத் தட்டவும்',
      'settings.staffNotMember': 'இன்னும் அருங்காட்சியகக் குழுவில் இல்லை · வெளியேறத் தட்டவும்',
      'settings.staffReady': 'உள்நுழைந்தீர்கள். Adjust இப்போது Studio இல் சேமிக்கும்.',

      'sync.eyebrow': 'தொடங்கும் முன்',
      'sync.title': 'காட்சியகத்தைத் தயார் செய்கிறது',
      'sync.lead': '{count} கலைப்படைப்புகள், {size} MB. ஒருமுறை பதிவிறக்கினால் AR உடனே இயங்கும், wifi இல்லாமலும் வழிகாட்டி வேலை செய்யும்.',
      'sync.update': 'உங்கள் கடைசி வருகைக்குப் பின் காட்சியகம் மாறியுள்ளது. {count} புதிய கோப்புகளைப் பெறுகிறது.',
      'sync.bytes': '{total} MB இல் {done} MB',
      'sync.waiting': 'பதிவிறக்க {size} MB',
      'sync.done': 'அனைத்தும் உங்கள் தொலைபேசியில் உள்ளன',
      'sync.go': 'ஆராயத் தொடங்கு',
      'sync.goBackground': 'ஆராயத் தொடங்கு — மீதி பின்னணியில் பதிவிறங்கும்',
      'sync.preparing': 'தயாராகிறது…',
      'sync.download': 'காட்சியகத்தைப் பதிவிறக்கு ({size} MB)',
      'sync.later': 'பின்னணியில் தொடரவும்',
      'sync.notNow': 'இப்போது வேண்டாம் — தேவைப்படும்போது மட்டும்',
      'sync.failed': 'சில கோப்புகளைப் பதிவிறக்க முடியவில்லை. தேவைப்படும்போது அவை இணையத்திலிருந்து வரும், அல்லது அமைப்புகளில் மீண்டும் முயலவும்.',
      'sync.saveData': 'உங்கள் தொலைபேசி தரவைச் சேமிக்கிறது, எனவே நீங்கள் சொல்லும் வரை எதுவும் பதிவிறங்காது.',
      'sync.why': 'ஒருமுறை பதிவிறக்கி இந்தத் தொலைபேசியில் வைக்கப்படும். அமைப்புகளில் எப்போது வேண்டுமானாலும் நீக்கலாம்.',
      'sync.item.tracker': 'கலைப்படைப்பு அடையாளம்',
      'sync.item.photo': 'புகைப்படம்',
      'sync.item.video': 'காணொளி',
      'sync.item.still': 'படம்',
      'sync.item.model': '3D உருவம்',
      'sync.item.narration': 'விவரிப்பு',
      'sync.item.file': 'கோப்பு',

      'loading.tracker': 'கலைப்படைப்பு அடையாளத்தைத் தயார் செய்கிறது… {total} MB இல் {done} MB',
      'loading.trackerSome': 'கலைப்படைப்பு அடையாளத்தைத் தயார் செய்கிறது… {done} MB',

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
      'settings.storage': 'இந்தத் தொலைபேசியில்',
      'settings.offline': 'ஆஃப்லைன் காட்சியகம்',
      'settings.offlineSub': 'காட்சியகத்தை இந்தத் தொலைபேசியில் வைத்திரு',
      'settings.offlineNo': 'இந்த உலாவி அனைத்தையும் இணையத்திலிருந்து பெறுகிறது',
      'settings.offlineReady': 'ஆஃப்லைனில் தயார் · {size} MB · நீக்கத் தட்டவும்',
      'settings.offlineRunning': 'பதிவிறக்குகிறது…',
      'settings.offlinePartial': 'இன்னும் {size} MB மீதம் · பதிவிறக்கத் தட்டவும்',
      'settings.offlineConfirmFree': 'பதிவிறக்கிய காட்சியகத்தை இந்தத் தொலைபேசியிலிருந்து நீக்கவா? பின்னர் அது இணையத்திலிருந்து வரும்.',
      'settings.aboutText': 'அனைத்தும் உங்கள் சாதனத்திலேயே இயங்குகிறது. கேமரா படம் எப்போதும் பதிவேற்றப்படுவதில்லை.',
      'settings.about': 'பற்றி',
      'about.eyebrow': 'மிகை யதார்த்த வழிகாட்டி',
      'about.body': 'அருங்காட்சியகத்திற்கான மிகை யதார்த்த வழிகாட்டி: உங்கள் தொலைபேசியை ஒரு கலைப்படைப்பை நோக்கிக் காட்டுங்கள், அது உங்கள் சொந்த மொழியில் பதிலளிக்கும்.',
      'about.createdBy': 'உருவாக்கியவர்கள்',
      'about.role.pm': 'திட்ட மேலாளர்',
      'about.role.ar': 'AR உருவாக்குநர்',
      'about.role.3d': '3D உருவாக்குநர்',
      'about.role.ui': 'UI/UX மற்றும் மொழி உருவாக்குநர்',
      'about.productOf': 'தயாரிப்பு',

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
   *   data-i18n-placeholder  an input's placeholder
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
    nodes = scope.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-placeholder')));
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
