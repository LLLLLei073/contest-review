// 把 src/assets/companion/*.png 母本压缩为同名 .webp：1024×1536 立绘在
// 页面里最大显示 360×540，PNG 每张约 2.3MB 是构建产物体积的大头。
// 用法：node scripts/build-companion-webp.mjs [--prune]（--prune 同时删除 PNG 母本）。
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = 'src/assets/companion';
const prune = process.argv.includes('--prune');
const names = readdirSync(dir).filter((f) => f.endsWith('.png'));
if (names.length === 0) throw new Error(`no PNG masters found in ${dir}`);

let before = 0;
let after = 0;
for (const name of names) {
  const png = join(dir, name);
  const webp = join(dir, name.replace(/\.png$/, '.webp'));
  const pngSize = statSync(png).size;
  // alphaQuality 100 + smartSubsample false 保住半透明光晕边缘；浏览器白底合成
  // 与 PNG 像素级一致（q82 会在低 alpha 区产生可见噪点，勿降）。
  await sharp(png).webp({ quality: 90, alphaQuality: 100, smartSubsample: false, effort: 6 }).toFile(webp);
  const webpSize = statSync(webp).size;
  before += pngSize;
  after += webpSize;
  console.log(
    `${name} -> ${webp.split(/[\\/]/).pop()} ${(pngSize / 1024).toFixed(0)}KB -> ${(webpSize / 1024).toFixed(0)}KB`,
  );
  if (webpSize >= pngSize) throw new Error(`${name}: webp not smaller, keep PNG and revisit`);
  if (prune) unlinkSync(png);
}
console.log(`total ${(before / 1024 / 1024).toFixed(1)}MB -> ${(after / 1024 / 1024).toFixed(1)}MB`);
