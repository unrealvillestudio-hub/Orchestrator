// Iconos de la app instalada (PWA) — se generan, no se dibujan a mano (2026-11-12).
//
// El Orchestrator se instala para recibir los avisos push propios, y Android pide iconos de 192 y 512 px y una
// insignia monocroma para la barra de estado. Se dibujan aquí, sin dependencias, para que cambiar un color sea
// cambiar una línea y volver a correr el script, no abrir un editor de imágenes.
//
//   node scripts/iconos-de-la-app.mjs     → public/icons/*.png
//
// El dibujo: el chevron «>» de la grafía de la marca, en el ámbar de la app (`--color-accent`), sobre el fondo de
// la app (`--color-bg`). El icono «maskable» deja el chevron dentro de la zona segura (el 80 % central), porque
// Android recorta el icono con la forma que elija el teléfono.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'public', 'icons');
const FONDO = [0x05, 0x05, 0x08];
const ACENTO = [0xff, 0xab, 0x00];

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
    for (let x = 0; x < lado; x++) fila.set(pixel(x + 0.5, y + 0.5), 1 + x * 4);
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

/** Distancia del punto al segmento AB. */
function aSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Cobertura del chevron (0..1) en coordenadas normalizadas, con borde suavizado de un píxel. */
function chevron(u, v, escala, lado) {
  const c = (n) => 0.5 + (n - 0.5) * escala;
  const d = Math.min(aSegmento(u, v, c(0.36), c(0.24), c(0.66), c(0.5)), aSegmento(u, v, c(0.66), c(0.5), c(0.36), c(0.76)));
  const grosor = 0.085 * escala;
  return Math.max(0, Math.min(1, (grosor - d) * lado + 0.5));
}

const mezcla = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

function icono(lado, escala) {
  return png(lado, (x, y) => [...mezcla(FONDO, ACENTO, chevron(x / lado, y / lado, escala, lado)), 255]);
}

function insignia(lado) {
  // Android pinta la insignia con su propio color: sólo cuenta el canal alfa.
  return png(lado, (x, y) => [255, 255, 255, Math.round(255 * chevron(x / lado, y / lado, 1.1, lado))]);
}

mkdirSync(SALIDA, { recursive: true });
const archivos = {
  'icon-192.png': icono(192, 1),
  'icon-512.png': icono(512, 1),
  'icon-maskable-512.png': icono(512, 0.72),
  'apple-touch-icon.png': icono(180, 0.85),
  'badge-96.png': insignia(96),
};
for (const [nombre, datos] of Object.entries(archivos)) {
  writeFileSync(join(SALIDA, nombre), datos);
  console.log(`${nombre}  ${datos.length} bytes`);
}
