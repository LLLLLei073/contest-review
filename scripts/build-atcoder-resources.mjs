import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = join('dist-pages', 'atcoder-resources');
const names = ['contests', 'problems', 'problem-models'];
await mkdir(output, { recursive: true });
let lastRequest = 0;
for (const name of names) {
  try {
    const wait = Math.max(0, lastRequest + 1200 - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const response = await fetch(`https://kenkoooo.com/atcoder/resources/${name}.json`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (
      name === 'problem-models'
        ? !data || typeof data !== 'object' || Array.isArray(data)
        : !Array.isArray(data)
    )
      throw new Error('数据格式不正确');
    await writeFile(join(output, `${name}.json`), JSON.stringify(data));
    console.log(`AtCoder ${name}: ${Array.isArray(data) ? data.length : Object.keys(data).length} records`);
  } catch (error) {
    if (process.env.CI) throw error;
    console.warn(`AtCoder ${name} snapshot unavailable: ${error}`);
  }
}
