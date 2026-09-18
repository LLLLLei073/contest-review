import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = 'dist-pages',
  base = process.env.PAGES_BASE_PATH || '/contest-review/';
const files = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile() && f.name !== 'sw.js')
  .map((f) =>
    join(f.parentPath || f.path, f.name)
      .replaceAll('\\', '/')
      .replace(/^dist-pages\//, ''),
  );
const hash = createHash('sha256');
for (const f of files) hash.update(readFileSync(join(root, f)));
const prefix = 'contest-review-' + base + '-',
  cache = prefix + hash.digest('hex').slice(0, 12);
writeFileSync(
  join(root, 'sw.js'),
  `
const CACHE=${JSON.stringify(cache)},PREFIX=${JSON.stringify(prefix)},BASE=${JSON.stringify(base)},ASSETS=${JSON.stringify(files.map((f) => base + f))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).slice(0,-1).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match(BASE+'index.html')));
  else event.respondWith(caches.match(event.request,{ignoreVary:true}).then(cached=>cached||fetch(event.request)));
});
`,
);
console.log('Offline shell generated for ' + base + ' (' + files.length + ' files).');
