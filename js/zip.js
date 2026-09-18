/**
 * A tiny ZIP reader/writer, so the admin portal can hand you one downloadable
 * file and read it back later.
 *
 * Deliberately dependency-free. The alternative was pulling JSZip off a CDN,
 * which would mean the portal stops working the day that CDN does — a poor
 * trade for ~150 lines.
 *
 * Writing is store-only (no compression). Every byte the portal ships is
 * already compressed — PNG, MP4, GLB, and MindAR's own packed .mind — so
 * deflating them would burn CPU on tens of megabytes to save almost nothing.
 *
 * Reading handles both stored and deflated entries, since a bundle may have
 * been re-zipped by Windows Explorer or macOS Finder in between. Deflate is
 * undone by the browser's own DecompressionStream.
 *
 * Blobs are never read whole into memory: writing streams each file through a
 * 1 MB window to compute its CRC, and the archive is assembled as a Blob of
 * references, so a bundle of 200 MB of video costs a few kilobytes of heap.
 *
 * No ZIP64, so a single bundle tops out at 4 GB.
 */
(function () {
  'use strict';

  var CHUNK = 1024 * 1024;

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32Update(crc, bytes) {
    var c = crc ^ 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** CRC a Blob without ever holding more than CHUNK bytes of it. */
  function crc32Blob(blob, onProgress) {
    var crc = 0;
    var offset = 0;

    function step() {
      if (offset >= blob.size) return Promise.resolve(crc >>> 0);
      var slice = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
      return slice.arrayBuffer().then(function (buffer) {
        crc = crc32Update(crc, new Uint8Array(buffer));
        offset += buffer.byteLength;
        if (onProgress) onProgress(offset, blob.size);
        return step();
      });
    }
    return step();
  }

  // ------------------------------------------------------------------ helpers
  function Writer(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  Writer.prototype.u16 = function (v) { this.view.setUint16(this.at, v, true); this.at += 2; return this; };
  Writer.prototype.u32 = function (v) { this.view.setUint32(this.at, v >>> 0, true); this.at += 4; return this; };
  Writer.prototype.raw = function (b) { this.bytes.set(b, this.at); this.at += b.length; return this; };

  /** MS-DOS packed date/time, which is all a ZIP can carry. */
  function dosTime(date) {
    var d = date || new Date();
    var year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  var utf8 = new TextEncoder();
  var utf8Decode = new TextDecoder();

  /**
   * Build a ZIP Blob.
   *
   * @param {Array<{name: string, blob: Blob}>} entries
   * @param {function(string, number)} [onProgress] name, 0..1 over the whole archive
   */
  function write(entries, onProgress) {
    var stamp = dosTime(new Date());
    var parts = [];
    var central = [];
    var offset = 0;

    var totalBytes = entries.reduce(function (sum, e) { return sum + e.blob.size; }, 0) || 1;
    var doneBytes = 0;

    function one(index) {
      if (index >= entries.length) return Promise.resolve();
      var entry = entries[index];
      var nameBytes = utf8.encode(entry.name);
      var size = entry.blob.size;

      return crc32Blob(entry.blob, function (read) {
        if (onProgress) onProgress(entry.name, Math.min(1, (doneBytes + read) / totalBytes));
      }).then(function (crc) {
        doneBytes += size;

        var local = new Writer(30 + nameBytes.length);
        local.u32(0x04034b50)
          .u16(20)            // version needed
          .u16(0x0800)        // UTF-8 filenames
          .u16(0)             // stored
          .u16(stamp.time).u16(stamp.date)
          .u32(crc).u32(size).u32(size)
          .u16(nameBytes.length).u16(0)
          .raw(nameBytes);

        parts.push(local.bytes, entry.blob);

        var dir = new Writer(46 + nameBytes.length);
        dir.u32(0x02014b50)
          .u16(20).u16(20)
          .u16(0x0800).u16(0)
          .u16(stamp.time).u16(stamp.date)
          .u32(crc).u32(size).u32(size)
          .u16(nameBytes.length).u16(0).u16(0)
          .u16(0).u16(0).u32(0)
          .u32(offset)
          .raw(nameBytes);
        central.push(dir.bytes);

        offset += local.bytes.length + size;
        return one(index + 1);
      });
    }

    return one(0).then(function () {
      var centralSize = central.reduce(function (sum, b) { return sum + b.length; }, 0);
      var end = new Writer(22);
      end.u32(0x06054b50)
        .u16(0).u16(0)
        .u16(central.length).u16(central.length)
        .u32(centralSize).u32(offset)
        .u16(0);

      return new Blob(parts.concat(central, [end.bytes]), { type: 'application/zip' });
    });
  }

  // ------------------------------------------------------------------ reading
  function findEocd(bytes) {
    // The comment field means the record is not necessarily the last 22 bytes.
    for (var i = bytes.length - 22; i >= 0; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function inflateRaw(blob) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error(
        'This bundle is compressed and this browser cannot decompress it. ' +
        'Re-export from the portal, or unzip it yourself and import the files individually.'));
    }
    return new Response(blob.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  }

  /**
   * Read a ZIP Blob.
   * @returns {Promise<Array<{name: string, blob: Blob}>>}
   */
  function read(zipBlob) {
    // The central directory lives at the end; 64 KB covers any comment.
    var tailSize = Math.min(zipBlob.size, 65536 + 22);
    return zipBlob.slice(zipBlob.size - tailSize).arrayBuffer().then(function (buffer) {
      var tail = new Uint8Array(buffer);
      var eocd = findEocd(tail);
      if (eocd === -1) throw new Error('not a ZIP file (no end-of-archive record)');

      var view = new DataView(tail.buffer);
      var count = view.getUint16(eocd + 10, true);
      var cdSize = view.getUint32(eocd + 12, true);
      var cdOffset = view.getUint32(eocd + 16, true);

      return zipBlob.slice(cdOffset, cdOffset + cdSize).arrayBuffer().then(function (cdBuffer) {
        var cd = new DataView(cdBuffer);
        var entries = [];
        var at = 0;

        for (var i = 0; i < count && at + 46 <= cd.byteLength; i++) {
          if (cd.getUint32(at, true) !== 0x02014b50) break;
          var method = cd.getUint16(at + 10, true);
          var compSize = cd.getUint32(at + 20, true);
          var nameLen = cd.getUint16(at + 28, true);
          var extraLen = cd.getUint16(at + 30, true);
          var commentLen = cd.getUint16(at + 32, true);
          var localAt = cd.getUint32(at + 42, true);
          var name = utf8Decode.decode(new Uint8Array(cdBuffer, at + 46, nameLen));

          entries.push({ name: name, method: method, compSize: compSize, localAt: localAt });
          at += 46 + nameLen + extraLen + commentLen;
        }

        // The local header repeats the name and extra lengths, and its own
        // extra field is often a different length from the directory's, so the
        // data offset has to be read from the local header rather than guessed.
        return entries.reduce(function (chain, entry) {
          return chain.then(function (out) {
            return zipBlob.slice(entry.localAt, entry.localAt + 30).arrayBuffer().then(function (lh) {
              var local = new DataView(lh);
              if (local.getUint32(0, true) !== 0x04034b50) throw new Error('corrupt entry: ' + entry.name);
              var dataAt = entry.localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
              var raw = zipBlob.slice(dataAt, dataAt + entry.compSize);

              if (entry.method === 0) { out.push({ name: entry.name, blob: raw }); return out; }
              if (entry.method === 8) {
                return inflateRaw(raw).then(function (blob) {
                  out.push({ name: entry.name, blob: blob });
                  return out;
                });
              }
              throw new Error('unsupported compression in ' + entry.name + ' (method ' + entry.method + ')');
            });
          });
        }, Promise.resolve([]));
      });
    });
  }

  window.ARZip = { write: write, read: read, crc32Blob: crc32Blob };
})();
