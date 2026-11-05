// 生成 companion 立绘的分档 WebP。源是同名 .png 母本；若母本已被 --prune
// 删除（见 git 历史），则从现有的 1024×1536 .webp 解码重采样——webp 解码
// 是无损的，重采样质量与从 PNG 做一致。
// 分档按实测显示尺寸（2026-11-05）：非 compact 场景最大 330×453，2x 需要
// 660×906，主图取 720×1080；compact 头像显示 80×80，2x 用 160×240。
// alphaQuality 100 + smartSubsample false 保住半透明光晕边缘；q82 会在
// 低 alpha 区产生可见噪点，勿降。
// 用法：node scripts/build-companion-webp.mjs [--prune]（--prune 同时删除 PNG 母本）。
import { readdirSync, statSync, unlinkSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = 'src/assets/companion';
const prune = process.argv.includes('--prune');
// 优先 PNG 母本；母本被 --prune 删除后从现有 1024×1536 webp 解码重采样。
const names = readdirSync(dir)
  .filter((f) => f.endsWith('.png') || (f.endsWith('.webp') && !f.includes('.compact.')))
  .map((f) => f.replace(/\.(png|webp)$/, '.png'))
  .filter((n, i, all) => all.indexOf(n) === i);
if (names.length === 0) throw new Error(`no PNG/webp masters found in ${dir}`);

const formats = [
  { suffix: '', width: 720, height: 1080 },
  { suffix: '.compact', width: 160, height: 240 },
];

let before = 0;
let after = 0;
for (const name of names) {
  const base = name.replace(/\.png$/, '');
  const png = join(dir, name);
  const webp = join(dir, `${base}.webp`);
  const master = existsSync(png) ? png : webp;
  const masterSize = statSync(master).size;
  for (const { suffix, width, height } of formats) {
    const target = join(dir, `${base}${suffix}.webp`);
    // 母本先读进内存（webp 回退时输入与主图输出同名，且 Windows 会锁住
    // 正被解码的文件），所有编码都从内存 buffer 出。
    const buf = await sharp(readFileSync(master))
      .resize(width, height, { fit: 'inside' })
      .webp({ quality: 90, alphaQuality: 100, smartSubsample: false, effort: 6 })
      .toBuffer();
    writeFileSync(target, buf);
    const meta = await sharp(target).metadata();
    after += buf.length;
    console.log(
      `${name} -> ${base}${suffix}.webp ${meta.width}x${meta.height} ${(buf.length / 1024).toFixed(0)}KB`,
    );
    if (!suffix && buf.length >= masterSize)
      throw new Error(`${name}: webp not smaller than master, keep master and revisit`);
  }
  before += masterSize;
  if (prune && existsSync(png)) unlinkSync(png);
}
console.log(
  `master ${(before / 1024) | 0}KB -> all outputs ${(after / 1024) | 0}KB (7 compact thumbs included)`,
);
