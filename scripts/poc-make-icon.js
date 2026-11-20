// Gerador de ícone do Corretor CNA (sem dependências: PNG + ICO com PNG embutido).
// Uso: node scripts/poc-make-icon.js <saida.png> [tamanho]
// Marca: escudo branco + barra de capelo verde sobre fundo verde-azulado (#0F6157).
const zlib = require('zlib');
const fs = require('fs');

const BG = [15, 97, 87];        // #0F6157
const WHITE = [255, 255, 255];
const CAP = [15, 97, 87];

// --- desenho (coordenadas normalizadas) -------------------------------
function insideShield(x, y) {
  // polígono do escudo (origem no topo-esquerdo; y cresce para baixo)
  const pts = [[0.22, 0.16], [0.78, 0.16], [0.78, 0.50], [0.50, 0.88], [0.22, 0.50]];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function colorAt(x, y) {
  if (!insideShield(x, y)) return BG;
  // capelo: banda horizontal + botão central (recorte verde sobre o escudo branco)
  const inBand = y >= 0.30 && y <= 0.40 && x >= 0.30 && x <= 0.70;
  const dx = x - 0.50, dy = y - 0.50;
  const inButton = dx * dx + dy * dy <= 0.032 * 0.032;
  if (inBand || inButton) return CAP;
  return WHITE;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngRGBA(width, height) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filtro none
    for (let x = 0; x < width; x++) {
      // supersampling 2x2
      let r = 0, g = 0, b = 0, cover = 0;
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const [cr, cg, cb] = colorAt((x + sx) / width, (y + sy) / height);
        r += cr; g += cg; b += cb; cover++;
      }
      raw[o++] = Math.round(r / cover);
      raw[o++] = Math.round(g / cover);
      raw[o++] = Math.round(b / cover);
      raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icoFromPng(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // 0 = 256
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);  // 1 plano
  entry.writeUInt16LE(32, 6); // 32 bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset após header+entry
  return Buffer.concat([header, entry, png]);
}

const out = process.argv[2] || 'cna-icon.png';
const size = parseInt(process.argv[3] || '1024', 10);
fs.writeFileSync(out, pngRGBA(size, size));
console.log('PNG gerado:', out, size + 'x' + size);

const icoOut = require('path').join(require('path').dirname(out), 'poc-source.ico');
const big = pngRGBA(256, 256);
fs.writeFileSync(icoOut, icoFromPng(big, 256));
console.log('ICO gerado:', icoOut);
