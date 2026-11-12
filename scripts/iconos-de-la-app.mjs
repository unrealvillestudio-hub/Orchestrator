// Iconos y favicon de la app instalada (PWA) — se generan, no se dibujan a mano (2026-11-12).
//
// El Orchestrator se instala para recibir los avisos push propios, y Android pide iconos de 192 y 512 px y una
// insignia monocroma para la barra de estado. Se dibujan aquí, sin dependencias, para que cambiar un color sea
// cambiar una línea y volver a correr el script, no abrir un editor de imágenes.
//
//   node scripts/iconos-de-la-app.mjs     → public/icons/*.png y public/favicon.svg
//
// EL DIBUJO ES EL DE SAM (2026-11-12, «favicon y icon»): el chevron «>» en cian `#00FFD1` sobre `#080808`, de puntas
// rectas. `CHEVRON` son sus siete vértices medidos sobre la imagen que entregó (400 × 400 px), sin redondear: si el
// dibujo cambia, se vuelven a medir y se cambia esa lista. El icono «maskable» lo encoge dentro de la zona segura
// (el 80 % central), porque Android recorta el icono con la forma que elija el teléfono.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'icons');
const FONDO = [0x08, 0x08, 0x08];
const CIAN = [0x00, 0xff, 0xd1];
const LADO_ORIGEN = 400;
/** Los vértices del chevron, en píxeles de la imagen de Sam (400 × 400), en orden. */
const CHEVRON = [[112, 60], [288, 175], [288, 216], [112, 340], [112, 295], [255.5, 195], [112, 104]];

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function trozo(tipo, datos) {
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(lado, pixel) {
  const filas = [];
  for (let y = 0; y < lado; y++) {
    const fila = Buffer.alloc(1 + lado * 4);
    for (let x = 0; x < lado; x++) fila.set(pixel(x, y), 1 + x * 4);
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr), trozo('IDAT', deflateSync(Buffer.concat(filas), { level: 9 })), trozo('IEND', Buffer.alloc(0)),
  ]);
}

/** ¿El punto (en coordenadas de la imagen de Sam) cae dentro del polígono? Regla par-impar. */
function dentro(px, py, pol) {
  let si = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, yi] = pol[i], [xj, yj] = pol[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) si = !si;
  }
  return si;
}

/** El polígono encogido hacia el centro por `escala` (1 = como lo dibujó Sam). */
const escalado = (escala) => CHEVRON.map(([x, y]) => [200 + (x - 200) * escala, 200 + (y - 200) * escala]);

/** Cobertura del píxel (0..1): 4 × 4 muestras por píxel, para un borde suave sin perder las puntas rectas. */
function cobertura(x, y, lado, pol) {
  const k = LADO_ORIGEN / lado;
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if (dentro((x + (i + 0.5) / 4) * k, (y + (j + 0.5) / 4) * k, pol)) n++;
  }
  return n / 16;
}

const mezcla = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function icono(lado, escala) {
  const pol = escalado(escala);
  return png(lado, (x, y) => [...mezcla(FONDO, CIAN, cobertura(x, y, lado, pol)), 255]);
}

function insignia(lado) {
  // Android pinta la insignia con su propio color: sólo cuenta el canal alfa.
  const pol = escalado(1);
  return png(lado, (x, y) => [255, 255, 255, Math.round(255 * cobertura(x, y, lado, pol))]);
}

function faviconSvg() {
  const puntos = CHEVRON.map(([x, y]) => `${x},${y}`).join(' ');
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" fill="${hex(FONDO)}"/><polygon points="${puntos}" fill="${hex(CIAN)}"/></svg>\n`;
}

mkdirSync(SALIDA, { recursive: true });
const archivos = {
  'icons/icon-192.png': icono(192, 1),
  'icons/icon-512.png': icono(512, 1),
  'icons/icon-maskable-512.png': icono(512, 0.75),
  'icons/apple-touch-icon.png': icono(180, 0.9),
  'icons/favicon-32.png': icono(32, 1),
  'icons/badge-96.png': insignia(96),
  'favicon.svg': Buffer.from(faviconSvg(), 'utf8'),
};
for (const [nombre, datos] of Object.entries(archivos)) {
  writeFileSync(join(RAIZ, 'public', nombre), datos);
  console.log(`${nombre}  ${datos.length} bytes`);
}
