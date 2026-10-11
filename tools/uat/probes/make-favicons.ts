/* DEF-2026-007: generate favicon.ico (ICO wrapping the portal logo PNG) for each portal. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const portals = ['admin-web', 'company-web', 'custodian-web', 'investor-web', 'onboarding-web'];

function makeIco(png) {
  const width = png.readUInt16LE(16) || 16;
  const height = png.readUInt16LE(20) || 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

for (const p of portals) {
  const logo = path.join('portals', p, 'public', 'assets', 'matanho-logo.png');
  const out = path.join('portals', p, 'public', 'favicon.ico');
  const png = readFileSync(logo);
  writeFileSync(out, makeIco(png));
  console.log(`${p}: favicon.ico written (${makeIco(png).length} bytes)`);
}
