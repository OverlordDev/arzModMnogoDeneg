"use strict";
/* Генерирует иконки приложения (PNG) без зависимостей: node scripts/make_icons.js
 * Рисунок: тёмная плитка и белая восходящая «ломаная» цены с точкой. Размеры — для Android (192/512, maskable)
 * и iOS (apple-touch-icon 180). Результат кладётся в icons/ и коммитится (генерировать на телефоне не нужно). */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // фильтр none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const BG = [14, 15, 17];      // #0e0f11 — фон сайта
const TILE = [24, 26, 30];    // #181a1e — панели
const WHITE = [244, 244, 245];
const GREEN = [158, 255, 0];  // акцент, как в игре

/** Расстояние от точки до отрезка. */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * size — сторона; maskable — без скруглённых углов и с содержимым в «безопасной» зоне (80%),
 * остальное просто заливается фоном (Android сам вырежет форму).
 */
function render(size, maskable) {
  const SS = 3; // сглаживание суперсэмплингом
  const S = size * SS;
  const buf = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0.2 : 0.14;                // отступ от края до рисунка
  const lo = pad, hi = 1 - pad;
  const pts = [[0.00, 0.78], [0.25, 0.52], [0.45, 0.64], [0.72, 0.22], [1.00, 0.10]]
    .map(([x, y]) => [(lo + x * (hi - lo)) * S, (lo + 0.11 + y * (hi - lo - 0.1)) * S]); // чуть ниже геометрического центра: линия растёт вверх, «масса» уходит вниз
  const lw = 0.075 * S;                              // толщина линии
  const dot = pts[pts.length - 1];
  const r = maskable ? 0 : 0.22 * S;                 // скругление плитки
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5, py = y * SS + sy + 0.5;
          // плитка со скруглёнными углами
          let inTile = true;
          if (r > 0) {
            const cx = Math.min(Math.max(px, r), S - r), cy = Math.min(Math.max(py, r), S - r);
            inTile = Math.hypot(px - cx, py - cy) <= r;
          }
          if (!inTile) continue;
          let col = maskable ? BG : TILE;
          // тонкая рамка плитки
          if (!maskable && r > 0) {
            const cx = Math.min(Math.max(px, r), S - r), cy = Math.min(Math.max(py, r), S - r);
            if (Math.hypot(px - cx, py - cy) > r - 0.012 * S) col = [44, 47, 53];
          }
          // линия цены
          let d = 1e9;
          for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
          if (d <= lw / 2) col = WHITE;
          // акцентная точка на конце
          if (Math.hypot(px - dot[0], py - dot[1]) <= lw * 0.95) col = GREEN;
          rr += col[0]; gg += col[1]; bb += col[2]; aa += 255;
        }
      }
      const n = SS * SS, o = (y * size + x) * 4;
      const cov = aa / (255 * n); // доля покрытия внутри плитки
      buf[o] = cov ? Math.round(rr / (cov * n)) : 0;
      buf[o + 1] = cov ? Math.round(gg / (cov * n)) : 0;
      buf[o + 2] = cov ? Math.round(bb / (cov * n)) : 0;
      buf[o + 3] = Math.round(cov * 255);
    }
  }
  return png(size, size, buf);
}

const out = path.join(__dirname, "..", "icons");
fs.mkdirSync(out, { recursive: true });
const files = [
  ["icon-192.png", render(192, false)],
  ["icon-512.png", render(512, false)],
  ["icon-maskable-512.png", render(512, true)],
  ["apple-touch-icon.png", render(180, true)],   // iOS сам скругляет углы, прозрачности быть не должно
];
for (const [name, data] of files) {
  fs.writeFileSync(path.join(out, name), data);
  console.log(name, data.length + " байт");
}
