# Connecting the guide to Firebase

About 20 minutes, once. Afterwards the gallery is edited in the **Studio**
(`/studio/`) instead of `admin.html`, published with one button, and visitors
get the photobooth and feedback.

Until you finish this, nothing changes: with no project in
`js/cloud/config.js` the guide reads `assets/content/` from the repo exactly
as before.

You need: the museum's admin Google account, a card for the Blaze plan (see
step 2 — you will almost certainly pay nothing), and Node.js for the
`firebase` command.

## 1. Create the project

1. <https://console.firebase.google.com> → **Add project**. Any name, e.g.
   `ibn-ar-museum`. Google Analytics is not needed.
2. **Project settings** (the gear) → **Your apps** → the **`</>`** web icon →
   register an app called `AR Guide`. Do not tick Firebase Hosting yet.
3. It shows a `firebaseConfig = { ... }` block. Paste those six values into
   `js/cloud/config.js`, in place of `firebase: null`:

   ```js
   firebase: {
     apiKey: 'AIza…',
     authDomain: 'ibn-ar-museum.firebaseapp.com',
     projectId: 'ibn-ar-museum',
     storageBucket: 'ibn-ar-museum.firebasestorage.app',
     messagingSenderId: '…',
     appId: '1:…:web:…',
   },
   ```

   None of these is a secret; every web app ships them to every browser. What
   protects the data is the rules in step 5.

4. Put the same project id in `.firebaserc`, replacing
   `your-firebase-project-id`.

## 2. Turn on the Blaze plan

Cloud Storage — where the photos, videos and 3D figures live — needs the
pay-as-you-go **Blaze** plan for new projects. Blaze keeps Firebase's free
allowances; for Storage, at the time of writing, the no-cost allowance (about
5 GB stored and 1 GB downloaded a day) applies to buckets in **us-central1,
us-east1 or us-west1** only — check <https://firebase.google.com/pricing>
before choosing. Each phone downloads the 25 MB gallery once and keeps it, so
even a bucket outside those regions costs a few dollars per thousand visitors.

Console → **Upgrade** → Blaze → then **Budgets & alerts** → set a budget of a
few dollars with an email alert, so a surprise is impossible.

## 3. Sign-in

**Build → Authentication → Get started → Sign-in method**, and enable:

- **Google** — the staff sign in with this. Pick the support email.
- **Anonymous** — visitors' phones use it, invisibly, to own the photos they
  share and the feedback they leave.

Then **Settings → Authorised domains** → add every address the guide is
served from: `infinitybrainnetworks.github.io`, the Vercel address (e.g.
`web-ar-museum-guide.vercel.app`, the exact one is on the project's Vercel
page), and your own domain if you add one.
Without this the Google sign-in window refuses to open.

## 4. The database and the files

- **Build → Firestore Database → Create database**, in **production mode**.
  Region: the nearest to the museum — `asia-south1` (Mumbai) for Sri Lanka.
  Its free daily reads and writes apply in any region.
- **Build → Storage → Get started**, production mode. `us-central1` keeps
  downloads inside the no-cost allowance (step 2); `asia-south1` is a little
  quicker on the first visit and billed. Either works — after the first
  visit, phones play everything from their own offline copy.

## 5. Deploy the rules

From the root of the repo:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore,storage
```

That uploads `firestore.rules`, `storage.rules` and `firestore.indexes.json` —
who may read and write what, which `tests/rules/` checks 26 ways against the
emulators. **Claim the Studio straight after this step** (step 7).

## 6. Let phones download the files (CORS)

Storage refuses cross-site downloads until told otherwise, and the guide needs
them: to draw the video onto the painting, and to keep the gallery offline.
Open **Cloud Shell** (the `>_` icon at the top of
<https://console.cloud.google.com>, signed in as the same account) and run:

```bash
cat > cors.json <<'EOF'
[{ "origin": ["*"], "method": ["GET", "HEAD"],
   "responseHeader": ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Range", "ETag"],
   "maxAgeSeconds": 3600 }]
EOF
gsutil cors set cors.json gs://YOUR-BUCKET
```

with your `storageBucket` from step 1. (The same file is `storage.cors.json`
in the repo.) The Studio's **Settings** screen checks this for you and says if
it is missing.

## 7. Claim the Studio

Commit and push `js/cloud/config.js` and `.firebaserc`, wait for Pages to
rebuild, then open **`…/studio/`** and **Sign in with Google** with the
museum's admin Gmail. The first account into a fresh project is offered
**Claim this Studio** and becomes its **owner**: it can add anyone, and nobody
can remove it.

Do this right after step 5. If anyone ever claimed it before you, delete
`config/setup` and their `members/…` document in the Firestore console and
claim again.

## 8. Move the gallery in, and publish

1. **Exhibits → Import the 9 deployed exhibits.** Photos, videos, narration,
   figures, labels in every language and the compiled tracker are copied in.
2. **Publish → Build a release → Preview** — scan the QR code with a phone and
   check it.
3. **Go live.** Every visitor gets it from then on.

## 9. The team

**People → Add a person**, by Google address, before they have ever signed
in. Send them the Studio's link yourself.

| Role | Can |
|---|---|
| Owner | Everything, including other owners. Cannot be removed by anyone else, and cannot remove themselves |
| Admin | Content, **Go live**, roll back, the photobooth, and adding or removing admins, editors and moderators |
| Editor | Exhibits, the floor editor, compiling, building releases — not going live, not people |
| Moderator | The photobooth queue and the feedback inbox — the front desk |

Someone who signs in without being on the list can **ask for access**; the
request appears at the top of People.

## Optional

- **The photobooth** is off until an admin switches it on (Photobooth or
  Settings). Every photo waits for a moderator unless **Auto-approve** is on.
  The wall is `…/photobooth/` — open it full-screen on a TV in the gallery.
- **App Check** keeps anyone but your site from filling the photobooth and the
  inbox. Console → App Check → register the web app with **reCAPTCHA
  Enterprise**, paste its site key as `appCheckSiteKey` in
  `js/cloud/config.js`, watch the metrics for a day, then **Enforce** for
  Firestore and Storage.
- **Your own domain, e.g. `webpage.com/photobooth`.** Pages works as it is
  (`/photobooth/` is a folder). Or host on Firebase:
  `npx firebase-tools deploy --only hosting` serves the repo with the right
  cache headers, and Console → Hosting → **Add custom domain** puts it on
  yours. Add that domain to step 3's list.

## Working on it locally, with no project at all

The emulators stand in for Firebase entirely (Java 21 needed):

```bash
cd tests/rules && npm install
npx firebase emulators:start --only auth,firestore,storage --project demo-museum --config ../../firebase.json
```

then serve the repo (`npx http-server -p 8080` in another terminal — use a
port other than the emulators' 8080, e.g. `-p 8123`) and open
`http://127.0.0.1:8123/studio/?emu=1`. `?emu=1` points every page at the
emulators and stays on for the tab; the Studio offers a sign-in as any
address. `tests/e2e` runs the whole workflow this way — see the README.
