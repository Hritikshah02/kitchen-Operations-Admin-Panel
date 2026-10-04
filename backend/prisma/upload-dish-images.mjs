// One-off: copies the sample dishes' stock photos onto our own Cloudinary account (fast CDN, auto-sized images)
// and rewrites prisma/seed-data/dish-images.json to the Cloudinary links. Safe to re-run (public ids are the SKUs,
// uploads overwrite). Needs CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name> in the environment.
//   CLOUDINARY_URL='cloudinary://...' npm run images:upload          (add -- --dry-run to only list the plan)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('./seed-data/dish-images.json', import.meta.url);
const match = process.env.CLOUDINARY_URL?.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
if (!match) { console.error('Set CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name> first.'); process.exit(1); }
const [, apiKey, apiSecret, cloudName] = match;
const dryRun = process.argv.includes('--dry-run');
const images = JSON.parse(readFileSync(FILE, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wikimedia asks for a descriptive User-Agent and throttles hotlinking, so we download politely, once, and upload the bytes.
async function download(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'kitchenops-demo-setup/1.0 (one-off copy of sample photos to Cloudinary)' } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 429 && response.status < 500) throw new Error(`download ${response.status}`);
    await sleep(attempt * 5000);
  }
  throw new Error('download kept failing');
}

async function upload(sku, bytes) {
  const params = { overwrite: 'true', public_id: `kitchen/dishes/${sku}`, timestamp: String(Math.floor(Date.now() / 1000)) };
  const toSign = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, value);
  form.append('api_key', apiKey);
  form.append('signature', createHash('sha1').update(toSign + apiSecret).digest('hex'));
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), `${sku}.jpg`);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.secure_url) throw new Error(body.error?.message ?? `upload ${response.status}`);
  return body.secure_url;
}

let moved = 0; const failed = [];
for (const [sku, url] of Object.entries(images)) {
  if (url.includes('res.cloudinary.com')) { console.log(`${sku}: already on Cloudinary`); continue; }
  if (dryRun) { console.log(`${sku}: would copy ${url}`); continue; }
  try {
    images[sku] = await upload(sku, await download(url));
    moved++; console.log(`${sku}: ok`);
    writeFileSync(FILE, `${JSON.stringify(images, null, 2)}\n`); // saved as we go, so a re-run continues where it stopped
  } catch (error) { failed.push(sku); console.error(`${sku}: FAILED (${error.message})`); }
  await sleep(600);
}
console.log(`\nCopied ${moved} image(s). ${failed.length ? `Failed: ${failed.join(', ')} (run it again).` : 'All done.'}`);
