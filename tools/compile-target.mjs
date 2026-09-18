#!/usr/bin/env node
/**
 * Offline MindAR image-target compiler.
 *
 * Produces the .mind file that the AR page loads. Equivalent to the online
 * compiler at https://hiukim.github.io/mind-ar-js-doc/tools/compile, but runs
 * locally so targets can be rebuilt in CI or from a script.
 *
 * MindAR ships an offline compiler that depends on node-canvas (a native
 * module that needs a C++ toolchain). The only thing it uses canvas for is
 * turning the image into RGBA pixels, so we decode the file in pure JS and
 * hand the compiler a minimal canvas stand-in instead. No native build needed.
 *
 * Usage:
 *   node compile-target.mjs <image> [more images...] -o <out.mind>
 */
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { CompilerBase } from 'mind-ar/src/image-target/compiler-base.js';
import { buildTrackingImageList } from 'mind-ar/src/image-target/image-list.js';
import { extractTrackingFeatures } from 'mind-ar/src/image-target/tracker/extract-utils.js';
import 'mind-ar/src/image-target/detector/kernels/cpu/index.js';

/** Decode png/jpg into { width, height, data: RGBA Uint8ClampedArray }. */
const decodeImage = (file) => {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: img.data };
  }
  throw new Error(`Unsupported image type "${ext}" (use .png, .jpg or .jpeg)`);
};

/**
 * Stands in for an HTMLCanvasElement. CompilerBase only ever calls
 * getContext('2d') -> drawImage(img, ...) -> getImageData(...), and our "image"
 * already carries its own decoded pixels, so drawImage is a no-op.
 */
class PixelCanvas {
  constructor(img) {
    this.img = img;
  }
  getContext() {
    return {
      drawImage: () => {},
      getImageData: () => ({
        width: this.img.width,
        height: this.img.height,
        data: this.img.data,
      }),
    };
  }
}

class NodeCompiler extends CompilerBase {
  createProcessCanvas(img) {
    return new PixelCanvas(img);
  }

  // Same work the browser build farms out to a web worker, run inline.
  compileTrack({ progressCallback, targetImages, basePercent }) {
    const percentPerImage = (100 - basePercent) / targetImages.length;
    let percent = 0;
    const list = [];
    for (const targetImage of targetImages) {
      const imageList = buildTrackingImageList(targetImage);
      const percentPerAction = percentPerImage / imageList.length;
      list.push(
        extractTrackingFeatures(imageList, () => {
          percent += percentPerAction;
          progressCallback(basePercent + percent);
        })
      );
    }
    return Promise.resolve(list);
  }
}

const main = async () => {
  const argv = process.argv.slice(2);
  const outIndex = Math.max(argv.indexOf('-o'), argv.indexOf('--out'));
  if (outIndex === -1 || !argv[outIndex + 1] || outIndex === 0) {
    console.error('Usage: node compile-target.mjs <image...> -o <out.mind>');
    process.exit(1);
  }
  const outFile = path.resolve(argv[outIndex + 1]);
  const inputs = argv.slice(0, outIndex).map((p) => path.resolve(p));

  const images = inputs.map((file) => {
    const img = decodeImage(file);
    console.log(`  input: ${path.basename(file)}  ${img.width}x${img.height}`);
    return img;
  });

  const compiler = new NodeCompiler();
  let lastLogged = -10;
  await compiler.compileImageTargets(images, (percent) => {
    if (percent - lastLogged >= 10) {
      lastLogged = percent;
      console.log(`  compiling... ${percent.toFixed(0)}%`);
    }
  });

  const buffer = compiler.exportData();
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(buffer));
  console.log(`  wrote ${outFile} (${(buffer.byteLength / 1024).toFixed(0)} KB)`);

  // Feature-point counts are the best offline proxy for "will this track well".
  compiler.data.forEach((d, i) => {
    const points = d.matchingData.reduce(
      (sum, kf) => sum + kf.maximaPoints.length + kf.minimaPoints.length,
      0
    );
    console.log(
      `  target ${i}: ${d.matchingData.length} keyframes, ${points} feature points` +
        (points < 400 ? '  <-- low, tracking may be unstable' : '')
    );
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
