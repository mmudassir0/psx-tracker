/**
 * Draws the app icons (no image tooling needed): a rising price line with
 * bars on the site's dark slate, as PNGs in public/.
 *
 *   npx tsx src/scripts/make-icons.ts
 */
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

type RGBA = [number, number, number, number];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Distance from point p to segment ab. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface Style {
  background: RGBA | null;
  bars: RGBA;
  line: RGBA;
  /** Fraction of the canvas kept clear around the artwork (maskable safe zone). */
  inset: number;
  rounded: boolean;
}

/** Shape colour at a point in unit coordinates (0..1), or null for empty. */
function shade(u: number, v: number, s: Style): RGBA | null {
  if (s.background) {
    if (s.rounded) {
      const r = 0.22;
      const cx = Math.min(Math.max(u, r), 1 - r);
      const cy = Math.min(Math.max(v, r), 1 - r);
      if (Math.hypot(u - cx, v - cy) > r) return null;
    }
  }
  // Artwork lives inside the inset box.
  const a = (u - s.inset) / (1 - 2 * s.inset);
  const b = (v - s.inset) / (1 - 2 * s.inset);
  const line = [
    [0.08, 0.72],
    [0.34, 0.5],
    [0.56, 0.6],
    [0.92, 0.22],
  ];
  for (let i = 0; i < line.length - 1; i++) {
    if (segDist(a, b, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]) < 0.065) return s.line;
  }
  const bars = [
    [0.14, 0.82],
    [0.38, 0.66],
    [0.62, 0.74],
    [0.86, 0.46],
  ];
  for (const [x, top] of bars) {
    if (Math.abs(a - x) < 0.075 && b > top && b < 0.92) return s.bars;
  }
  return s.background;
}

function render(size: number, s: Style): Buffer {
  const pixels = new Uint8Array(size * size * 4);
  const SS = 4; // 4x4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, bl = 0, al = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, s);
          if (!c) continue;
          const w = c[3] / 255;
          r += c[0] * w; g += c[1] * w; bl += c[2] * w; al += w;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      pixels[i] = al ? Math.round(r / al) : 0;
      pixels[i + 1] = al ? Math.round(g / al) : 0;
      pixels[i + 2] = al ? Math.round(bl / al) : 0;
      pixels[i + 3] = Math.round((al / n) * 255);
    }
  }
  return png(size, pixels);
}

const SLATE: RGBA = [15, 23, 42, 255];
const BLUE: RGBA = [57, 135, 229, 255];
const BAR: RGBA = [71, 85, 105, 255];
const WHITE: RGBA = [255, 255, 255, 255];

const full: Style = { background: SLATE, bars: BAR, line: BLUE, inset: 0.18, rounded: false };
const rounded: Style = { ...full, rounded: true, inset: 0.16 };
const badge: Style = { background: null, bars: WHITE, line: WHITE, inset: 0.08, rounded: false };

const out = path.join(process.cwd(), "public");
const files: [string, number, Style][] = [
  ["icon-192.png", 192, rounded],
  ["icon-512.png", 512, rounded],
  // Square, full-bleed: Android crops "maskable" icons to its own shape.
  ["icon-maskable-512.png", 512, full],
  ["apple-touch-icon.png", 180, full],
  // Status-bar badge: Android shows only the alpha channel, in white.
  ["badge-72.png", 72, badge],
];
for (const [name, size, style] of files) {
  fs.writeFileSync(path.join(out, name), render(size, style));
  console.log(`wrote public/${name}`);
}
