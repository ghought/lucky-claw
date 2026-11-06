// Renders every favicon and app icon into public/ from one drawing.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4264a"/>
      <stop offset="1" stop-color="#8c0a24"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0a8"/>
      <stop offset="1" stop-color="#ffc21f"/>
    </linearGradient>
  </defs>`;

// A claw closing on a little bear, drawn on a 512 grid.
const artwork = `
  <rect x="242" y="-20" width="28" height="150" fill="url(#metal)"/>
  <g fill="#fff3d6">
    <circle cx="205" cy="272" r="30"/>
    <circle cx="307" cy="272" r="30"/>
    <circle cx="256" cy="330" r="82"/>
  </g>
  <g fill="#3a1620">
    <circle cx="226" cy="318" r="11"/>
    <circle cx="286" cy="318" r="11"/>
    <ellipse cx="256" cy="348" rx="14" ry="10"/>
  </g>
  <g fill="none" stroke="url(#metal)" stroke-width="42" stroke-linecap="round">
    <path d="M214 176 C 112 214, 84 340, 176 424"/>
    <path d="M298 176 C 400 214, 428 340, 336 424"/>
  </g>
  <rect x="176" y="112" width="160" height="78" rx="34" fill="url(#metal)"/>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}${body}</svg>`;
const rounded = svg(`<rect width="512" height="512" rx="112" fill="url(#bg)"/><g clip-path="inset(0 round 112px)">${artwork}</g>`);
const square = svg(`<rect width="512" height="512" fill="url(#bg)"/>${artwork}`);
// Android masks can crop to a circle, so the art sits inside the safe zone.
const maskable = svg(`<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(66 58) scale(0.74)">${artwork}</g>`);

const png = (source, size) => sharp(Buffer.from(source), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** An .ico is a tiny directory in front of ordinary PNGs. */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    header.writeUInt8(size, at);
    header.writeUInt8(size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

await writeFile('public/favicon.svg', rounded);
await writeFile('public/apple-touch-icon.png', await png(square, 180));
await writeFile('public/icon-192.png', await png(rounded, 192));
await writeFile('public/icon-512.png', await png(rounded, 512));
await writeFile('public/icon-maskable-512.png', await png(maskable, 512));
await writeFile(
  'public/favicon.ico',
  ico([
    { size: 16, data: await png(rounded, 16) },
    { size: 32, data: await png(rounded, 32) },
    { size: 48, data: await png(rounded, 48) },
  ]),
);
