/**
 * What every end-to-end test needs: a static server for the repo, a headless
 * Chrome that can actually run the AR, and a fake camera pointed at an
 * artwork.
 *
 * The Chrome flags are not optional - each one stands between the test and a
 * silent false pass:
 *
 *   --use-angle=swiftshader          software WebGL. Without it MindAR's
 *   --enable-unsafe-swiftshader      compiler never finishes and the scene
 *                                    never renders.
 *   --use-fake-device-for-media-stream
 *   --use-fake-ui-for-media-stream   a camera, granted without a prompt. Without
 *                                    one the scene machine stays in boot.
 *   --use-file-for-fake-video-capture
 *                                    ...showing a real artwork, so MindAR has
 *                                    something to find.
 *   --autoplay-policy=...            the projected video and the narration.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CHROME = process.env.CHROME ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome');
export const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-museum-e2e-'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary',
  '.mind': 'application/octet-stream',
};

/**
 * The repo over http, with byte ranges - which is what a <video> asks for,
 * and what a dumb server gets wrong.
 */
export function serve(port = 8123, root = ROOT) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }

    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
                      'Access-Control-Allow-Origin': '*' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    server,
    url: `http://127.0.0.1:${port}/`,
    // Keep-alive sockets would hold the server open; a test that switches the
    // server off means off.
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  })));
}

/**
 * A one-second clip of an artwork hanging on a wall, for Chrome's fake camera:
 * the target photo, a little smaller than the frame and tilted a few degrees,
 * on a wall-coloured background.
 */
export function cameraOf(targetJpg) {
  const out = path.join(SCRATCH, path.basename(targetJpg).replace(/\.\w+$/, '') + '.y4m');
  if (fs.existsSync(out)) return out;
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x8a7f72:s=640x480:d=1:r=15',
    '-i', targetJpg,
    '-filter_complex',
    '[1]scale=400:-1,rotate=3*PI/180:c=none:ow=rotw(3*PI/180):oh=roth(3*PI/180)[t];' +
    '[0][t]overlay=(W-w)/2:(H-h)/2,format=yuv420p',
    '-frames:v', '15', out,
  ]);
  return out;
}

/** A plain floor plan - two rooms and a corridor - for the Map. */
export function floorPlan() {
  const out = path.join(SCRATCH, 'plan.png');
  if (fs.existsSync(out)) return out;
  const wall = 'color=0x5a4636@1:t=8';
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0xf4efe8:s=1600x1000:d=1',
    '-vf', [
      `drawbox=x=80:y=80:w=700:h=840:${wall}`,
      `drawbox=x=820:y=80:w=700:h=840:${wall}`,
      `drawbox=x=760:y=420:w=80:h=160:color=0xf4efe8@1:t=fill`,
      'drawbox=x=700:y=900:w=160:h=40:color=0xe0673a@1:t=fill',
    ].join(','),
    '-frames:v', '1', out,
  ]);
  return out;
}

/** A painted shadow as a plain picture: a black ellipse on a white page, no transparency. */
export function shadowPicture() {
  const out = path.join(SCRATCH, 'painted-shadow.png');
  if (fs.existsSync(out)) return out;
  execFileSync(process.env.FFMPEG || 'ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=white:s=600x300:d=1',
    '-vf', "format=gray,geq=lum='if(lt(pow((X-300)/260,2)+pow((Y-150)/100,2),1),0,255)'",
    '-frames:v', '1', out,
  ]);
  return out;
}

export async function launch({ camera = null, profile = null, headless = true } = {}) {
  const args = [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check',
    '--window-size=412,915',
  ];
  if (camera) args.push('--use-file-for-fake-video-capture=' + camera);
  return puppeteer.launch({
    executablePath: CHROME,
    headless: headless ? 'new' : false,
    userDataDir: profile || fs.mkdtempSync(path.join(SCRATCH, 'profile-')),
    args,
    defaultViewport: { width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  });
}

/** A page whose console, errors and failed requests all end up in `logs`. */
export async function open(browser, url, { quiet = false } = {}) {
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => { logs.push('pageerror: ' + (e.stack || e.message || e)); });
  page.on('requestfailed', (r) => {
    const why = r.failure() && r.failure().errorText;
    if (why !== 'net::ERR_ABORTED') logs.push('requestfailed: ' + r.url() + ' ' + why);
  });
  if (!quiet) page.on('pageerror', (e) => console.error('  [page] ' + (e.message || e)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  page.logs = logs;
  return page;
}

/** Poll a function in the page until it returns something truthy. */
export async function until(page, fn, { timeout = 20000, what = 'condition', arg } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(fn, arg);
      if (last) return last;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${what} (last: ${JSON.stringify(last)})`);
}

/** The app's own on-screen log, as text. */
export async function appLog(page) {
  return page.evaluate(() => (window.ARLog && window.ARLog.text ? window.ARLog.text() :
    Array.from(document.querySelectorAll('#logList li')).map((li) => li.textContent).join('\n')));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
