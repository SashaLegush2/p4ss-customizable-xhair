const FMT = {
  RGBA8888: 0, ABGR8888: 1, RGB888: 2, BGR888: 3, RGB565: 4, I8: 5, IA88: 6,
  A8: 8, ARGB8888: 11, BGRA8888: 12, DXT1: 13, DXT3: 14, DXT5: 15,
  BGRX8888: 16, BGR565: 17, BGRA4444: 19, DXT1_ONEBITALPHA: 20, BGRA5551: 21, UV88: 22,
};

const BYTES_PER_PIXEL = {
  0: 4, 1: 4, 2: 3, 3: 3, 4: 2, 5: 1, 6: 2, 7: 1, 8: 1, 9: 3, 10: 3, 11: 4, 12: 4,
  16: 4, 17: 2, 18: 2, 19: 2, 21: 2, 22: 2, 23: 4, 24: 8, 25: 8, 26: 4,
};

const expand5 = v => (v * 255) / 31;
const expand6 = v => (v * 255) / 63;

const PIXEL_DECODERS = {
  [FMT.RGBA8888]: (a, b, c, d) => [a, b, c, d],
  [FMT.ABGR8888]: (a, b, c, d) => [d, c, b, a],
  [FMT.RGB888]:   (a, b, c)    => [a, b, c, 255],
  [FMT.BGR888]:   (a, b, c)    => [c, b, a, 255],
  [FMT.I8]:       a            => [a, a, a, 255],
  [FMT.IA88]:     (a, b)       => [a, a, a, b],
  [FMT.A8]:       a            => [255, 255, 255, a],
  [FMT.ARGB8888]: (a, b, c, d) => [b, c, d, a],
  [FMT.BGRA8888]: (a, b, c, d) => [c, b, a, d],
  [FMT.BGRX8888]: (a, b, c)    => [c, b, a, 255],
  [FMT.UV88]:     (a, b)       => [a, b, 128, 255],

  [FMT.RGB565]: (a, b) => {
    const v = a | (b << 8);
    return [expand5((v >> 11) & 31), expand6((v >> 5) & 63), expand5(v & 31), 255];
  },
  [FMT.BGR565]: (a, b) => {
    const v = a | (b << 8);
    return [expand5(v & 31), expand6((v >> 5) & 63), expand5((v >> 11) & 31), 255];
  },
  [FMT.BGRA4444]: (a, b) => {
    const v = a | (b << 8);
    return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, ((v >> 12) & 15) * 17];
  },
  [FMT.BGRA5551]: (a, b) => {
    const v = a | (b << 8);
    return [expand5((v >> 10) & 31), expand5((v >> 5) & 31), expand5(v & 31), v & 0x8000 ? 255 : 0];
  },
};

function isDXT1(format)  { return format === FMT.DXT1 || format === FMT.DXT1_ONEBITALPHA; }
function isDXT(format)   { return isDXT1(format) || format === FMT.DXT3 || format === FMT.DXT5; }

function mipmapBytes(format, width, height) {
  if (isDXT(format)) {
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
    return blocks * (isDXT1(format) ? 8 : 16);
  }
  return width * height * (BYTES_PER_PIXEL[format] || 4);
}

function rgb565ToRgb(v) {
  return [expand5((v >> 11) & 31), expand6((v >> 5) & 63), expand5(v & 31)];
}

function blend(a, b, weightA, weightB) {
  return a.map((value, i) => (value * weightA + b[i] * weightB) / (weightA + weightB));
}

function dxt5AlphaPalette(a0, a1) {
  const palette = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i < 7; i++) palette.push(((7 - i) * a0 + i * a1) / 7 | 0);
  } else {
    for (let i = 1; i < 5; i++) palette.push(((5 - i) * a0 + i * a1) / 5 | 0);
    palette.push(0, 255);
  }
  return palette;
}

function decodeDXT(src, offset, width, height, kind) {
  const out = new Uint8ClampedArray(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const blockSize = kind === 1 ? 8 : 16;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const block = offset + (by * blocksX + bx) * blockSize;
      const colorAt = block + (kind === 1 ? 0 : 8);

      const c0 = src[colorAt] | (src[colorAt + 1] << 8);
      const c1 = src[colorAt + 2] | (src[colorAt + 3] << 8);
      const A = rgb565ToRgb(c0);
      const B = rgb565ToRgb(c1);
      const palette = [A, B];
      if (c0 > c1 || kind !== 1) {
        palette.push(blend(A, B, 2, 1), blend(A, B, 1, 2));
      } else {
        palette.push(blend(A, B, 1, 1), null);
      }
      const colorBits = (src[colorAt + 4] | (src[colorAt + 5] << 8) | (src[colorAt + 6] << 16) | (src[colorAt + 7] << 24)) >>> 0;

      let alphaPalette = null, alphaLow = 0, alphaHigh = 0;
      if (kind === 5) {
        alphaPalette = dxt5AlphaPalette(src[block], src[block + 1]);
        alphaLow  = src[block + 2] | (src[block + 3] << 8) | (src[block + 4] << 16);
        alphaHigh = src[block + 5] | (src[block + 6] << 8) | (src[block + 7] << 16);
      }

      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;

        const color = palette[(colorBits >>> (2 * i)) & 3];
        const px = (y * width + x) * 4;
        if (!color) continue;

        let alpha = 255;
        if (kind === 5) alpha = alphaPalette[i < 8 ? (alphaLow >> (3 * i)) & 7 : (alphaHigh >> (3 * (i - 8))) & 7];
        if (kind === 3) alpha = ((src[block + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;

        out[px] = color[0]; out[px + 1] = color[1]; out[px + 2] = color[2]; out[px + 3] = alpha;
      }
    }
  }
  return out;
}

function decodeVTF(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  if (view.getUint32(0, true) !== 0x00465456) throw new Error("not a VTF file");

  const minorVersion = view.getUint32(8, true);
  const headerSize   = view.getUint32(12, true);
  const width        = view.getUint16(16, true);
  const height       = view.getUint16(18, true);
  const flags        = view.getUint32(20, true);
  const frames       = view.getUint16(24, true) || 1;
  const format       = view.getInt32(52, true);
  const mipmaps      = view.getUint8(56) || 1;
  const thumbFormat  = view.getInt32(57, true);
  const thumbWidth   = view.getUint8(61);
  const thumbHeight  = view.getUint8(62);

  let dataStart = 0;
  if (minorVersion >= 3) {
    const resourceCount = view.getUint32(68, true);
    for (let i = 0; i < resourceCount; i++) {
      const entry = 80 + i * 8;
      const tag = bytes[entry] | (bytes[entry + 1] << 8) | (bytes[entry + 2] << 16);
      if (tag === 0x30) dataStart = view.getUint32(entry + 4, true);
    }
  }
  if (!dataStart) {
    const hasThumb = thumbFormat >= 0 && thumbWidth && thumbHeight;
    dataStart = headerSize + (hasThumb ? mipmapBytes(thumbFormat, thumbWidth, thumbHeight) : 0);
  }

  const faces = flags & 0x4000 ? 6 : 1;
  let offset = dataStart;
  for (let m = 1; m < mipmaps; m++) {
    offset += mipmapBytes(format, Math.max(1, width >> m), Math.max(1, height >> m)) * frames * faces;
  }

  if (isDXT1(format)) return { width, height, rgba: decodeDXT(bytes, offset, width, height, 1) };
  if (format === FMT.DXT3) return { width, height, rgba: decodeDXT(bytes, offset, width, height, 3) };
  if (format === FMT.DXT5) return { width, height, rgba: decodeDXT(bytes, offset, width, height, 5) };

  const decodePixel = PIXEL_DECODERS[format];
  if (!decodePixel) throw new Error("unsupported VTF format " + format);

  const bpp = BYTES_PER_PIXEL[format];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++, offset += bpp) {
    rgba.set(decodePixel(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]), i * 4);
  }
  return { width, height, rgba };
}
