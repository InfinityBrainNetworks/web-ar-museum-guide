/**
 * QR codes, for opening a release on a phone and for the photo wall's
 * "take yours" card. The encoder is a small, long-stable library, loaded only
 * when a code is actually drawn.
 */
let lib = null;

async function encoder() {
  if (!lib) {
    lib = import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm')
      .then((m) => m.default || m)
      .catch((err) => { lib = null; throw err; });
  }
  return lib;
}

/** An <img> of the code for `text`. */
export async function qrImage(text, { cell = 6, margin = 2 } = {}) {
  const qrcode = await encoder();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const img = new Image();
  img.alt = 'QR code for ' + text;
  img.src = qr.createDataURL(cell, margin);
  return img;
}
