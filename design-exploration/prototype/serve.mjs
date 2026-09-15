// یک سرورِ ایستای بسیار کوچک، فقط برای دیدنِ همین نمونه.
// هیچ وابستگی‌ای ندارد و هیچ ربطی به سرورِ محصول ندارد.
//
//   node serve.mjs
//
// روی 0.0.0.0 گوش می‌دهد تا هم از خودِ رایانه، هم از شبیه‌سازِ اندروید و
// هم از گوشیِ واقعی روی همان وای‌فای در دسترس باشد.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 5180;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
};

createServer(async (req, res) => {
  // فقط همین پوشه سرو می‌شود؛ هر تلاشی برای بیرون رفتن رد می‌شود.
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = normalize(raw === '/' ? '/cosmos-world.html' : raw).replace(/^([/\\])+/, '');
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('پیدا نشد');
  }
}).listen(PORT, '0.0.0.0', () => {
  const addrs = Object.values(networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal)
    .map(n => n.address);

  console.log('');
  console.log('  Cosmos — نمونه‌ی جهان');
  console.log('  روی رایانه:        http://localhost:' + PORT);
  console.log('  شبیه‌ساز اندروید:  http://10.0.2.2:' + PORT);
  for (const a of addrs) console.log('  گوشی روی وای‌فای:  http://' + a + ':' + PORT);
  console.log('');
});
