// Minimal EXIF support.
// - readDateTaken(): pulls DateTimeOriginal out of the picked JPEG so the
//   developed copy lands next to the original in the Photos timeline.
// - withIphone5Exif(): writes an APP1 block so Photos shows the shot as
//   "Apple iPhone 5 · Back Camera 4.13mm f/2.4". No location is ever written.

export async function readDateTaken(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const d = new DataView(buf);
    if (d.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < d.byteLength) {
      const marker = d.getUint16(off);
      const len = d.getUint16(off + 2);
      if (marker === 0xffe1 && d.getUint32(off + 4) === 0x45786966) {
        return parseDate(d, off + 10);
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      off += 2 + len;
    }
  } catch (_) {
    /* not a JPEG or unreadable: fall back to the file date */
  }
  return null;
}

function parseDate(d, tiff) {
  const le = d.getUint16(tiff) === 0x4949;
  const u16 = (o) => d.getUint16(tiff + o, le);
  const u32 = (o) => d.getUint32(tiff + o, le);
  const findTag = (ifd, tag) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) return e;
    }
    return -1;
  };
  const ifd0 = u32(4);
  const exifPtr = findTag(ifd0, 0x8769);
  const tryAscii = (entry) => {
    if (entry < 0) return null;
    const count = u32(entry + 4);
    const at = count > 4 ? u32(entry + 8) : entry + 8;
    let s = '';
    for (let i = 0; i < count - 1; i++) s += String.fromCharCode(d.getUint8(tiff + at + i));
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  };
  if (exifPtr >= 0) {
    const exif = u32(exifPtr + 8);
    const got = tryAscii(findTag(exif, 0x9003));
    if (got) return got;
  }
  return tryAscii(findTag(ifd0, 0x0132));
}

const pad = (n) => String(n).padStart(2, '0');
const exifDate = (dt) =>
  `${dt.getFullYear()}:${pad(dt.getMonth() + 1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(
    dt.getMinutes(),
  )}:${pad(dt.getSeconds())}`;

// Types: 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED
function buildTiff({ width, height, date, shutter, iso, flash }) {
  const when = exifDate(date);
  const ifd0 = [
    [0x010f, 2, 'Apple'],
    [0x0110, 2, 'iPhone 5'],
    [0x0112, 3, 1],
    [0x011a, 5, [72, 1]],
    [0x011b, 5, [72, 1]],
    [0x0128, 3, 2],
    [0x0131, 2, '6.1.4'],
    [0x0132, 2, when],
    [0x8769, 4, 0], // patched with the Exif IFD offset
  ];
  const exif = [
    [0x829a, 5, [1, shutter]],
    [0x829d, 5, [12, 5]],
    [0x8822, 3, 2],
    [0x8827, 3, iso],
    [0x9000, 7, '0221'],
    [0x9003, 2, when],
    [0x9004, 2, when],
    [0x9207, 3, 5],
    [0x9209, 3, flash ? 0x19 : 0x10],
    [0x920a, 5, [413, 100]],
    [0xa001, 3, 1],
    [0xa002, 4, width],
    [0xa003, 4, height],
    [0xa405, 3, 33],
    [0xa433, 2, 'Apple'],
    [0xa434, 2, 'iPhone 5 back camera 4.13mm f/2.4'],
  ];

  const sizeOfValue = ([, type, v]) => {
    if (type === 2) return v.length + 1;
    if (type === 7) return v.length;
    if (type === 5) return 8;
    return 4;
  };
  const ifdSize = (ents) => 2 + ents.length * 12 + 4;
  const extra = (ents) =>
    ents.reduce((s, e) => {
      const n = sizeOfValue(e);
      return s + (n > 4 ? n + (n & 1) : 0);
    }, 0);

  const ifd0Off = 8;
  const exifOff = ifd0Off + ifdSize(ifd0) + extra(ifd0);
  const total = exifOff + ifdSize(exif) + extra(exif);
  const buf = new ArrayBuffer(total);
  const d = new DataView(buf);
  d.setUint16(0, 0x4d4d); // big endian
  d.setUint16(2, 42);
  d.setUint32(4, ifd0Off);

  ifd0[ifd0.length - 1][2] = exifOff;

  const writeIfd = (ents, at) => {
    d.setUint16(at, ents.length);
    let data = at + ifdSize(ents);
    ents.forEach(([tag, type, v], i) => {
      const e = at + 2 + i * 12;
      d.setUint16(e, tag);
      d.setUint16(e + 2, type);
      const n = sizeOfValue([tag, type, v]);
      let target = e + 8;
      if (n > 4) {
        d.setUint32(e + 8, data);
        target = data;
        data += n + (n & 1);
      }
      if (type === 2 || type === 7) {
        d.setUint32(e + 4, type === 2 ? v.length + 1 : v.length);
        for (let k = 0; k < v.length; k++) d.setUint8(target + k, v.charCodeAt(k) & 0x7f);
      } else if (type === 3) {
        d.setUint32(e + 4, 1);
        d.setUint16(target, v);
      } else if (type === 4) {
        d.setUint32(e + 4, 1);
        d.setUint32(target, v);
      } else if (type === 5) {
        d.setUint32(e + 4, 1);
        d.setUint32(target, v[0]);
        d.setUint32(target + 4, v[1]);
      }
    });
    d.setUint32(at + 2 + ents.length * 12, 0);
  };
  writeIfd(ifd0, ifd0Off);
  writeIfd(exif, exifOff);
  return new Uint8Array(buf);
}

export async function withIphone5Exif(jpegBlob, info) {
  const src = new Uint8Array(await jpegBlob.arrayBuffer());
  if (src[0] !== 0xff || src[1] !== 0xd8) return jpegBlob;

  // Skip the encoder's own APP0/APP1 blocks; keep everything else.
  let off = 2;
  while (off + 4 < src.length && src[off] === 0xff && (src[off + 1] === 0xe0 || src[off + 1] === 0xe1)) {
    off += 2 + ((src[off + 2] << 8) | src[off + 3]);
  }

  const tiff = buildTiff(info);
  const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]); // "Exif\0\0"
  const segLen = 2 + header.length + tiff.length;
  const app1 = new Uint8Array(4 + header.length + tiff.length);
  app1.set([0xff, 0xe1, segLen >> 8, segLen & 0xff], 0);
  app1.set(header, 4);
  app1.set(tiff, 4 + header.length);

  return new Blob([src.subarray(0, 2), app1, src.subarray(off)], { type: 'image/jpeg' });
}
