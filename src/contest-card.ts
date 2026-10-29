// 比赛战报卡片：canvas 2D 手绘 PNG，无外部依赖。
// 固定深色主题（与站点明暗主题无关），保证分享出去的观感一致。
export interface ContestCardPerformance {
  value: number | null;
  bound: 'lower' | 'upper' | null;
  label: string;
  caption?: string;
}
export interface ContestCardInput {
  platform: 'cf' | 'atcoder' | 'xcpc';
  title: string;
  dateText: string;
  typeText?: string;
  handle?: string;
  performance: ContestCardPerformance | null;
  facts: { label: string; value: string }[];
  ratingDelta?: { old: number; new: number } | null;
  fileName: string;
}
const palette = {
  cf: '#4d7cff',
  atcoder: '#f59e0b',
  xcpc: '#12a594',
} as const;
const platforms = { cf: 'CODEFORCES', atcoder: 'ATCODER', xcpc: 'XCPC' } as const;
const W = 1080,
  H = 560;
const bg = '#0f1724',
  ink = '#f2f6fb',
  muted = '#8fa1b8',
  line = 'rgba(255,255,255,0.08)';
const font = (weight: number | string, size: number) =>
  `${weight} ${size}px "Microsoft YaHei UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(text.slice(0, end) + '…').width > maxWidth) end--;
  return text.slice(0, end) + '…';
}
function chip(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string) {
  const text = `${label} ${value}`;
  ctx.font = font(600, 24);
  const width = ctx.measureText(text).width + 44;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, x, y, width, 56, 28);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, width, 56, 28);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 22, y + 29);
  const labelWidth = ctx.measureText(label).width;
  ctx.fillStyle = ink;
  ctx.fillText(value, x + 22 + labelWidth + 10, y + 29);
  return x + width + 16;
}
function drawContestCard(input: ContestCardInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持画布渲染，无法生成卡片');
  const accent = palette[input.platform];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // 顶部与左下的品牌色光晕
  const glow = ctx.createRadialGradient(180, -60, 40, 180, -60, 620);
  glow.addColorStop(0, accent + '33');
  glow.addColorStop(1, '#0000');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  // 顶栏：平台徽章 + 品牌
  ctx.font = font(700, 22);
  const badge = platforms[input.platform];
  const badgeWidth = ctx.measureText(badge).width + 44;
  ctx.fillStyle = accent;
  roundRect(ctx, 64, 56, badgeWidth, 46, 23);
  ctx.fill();
  ctx.fillStyle = '#0b1220';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, 64 + 22, 80);
  ctx.font = font(600, 22);
  ctx.fillStyle = muted;
  ctx.textAlign = 'right';
  ctx.fillText('回解 · CONTEST REVIEW', W - 64, 80);
  ctx.textAlign = 'left';
  // 标题（最多两行）+ 日期/类型
  ctx.font = font(700, 44);
  ctx.fillStyle = ink;
  const maxWidth = W - 128;
  let title = truncate(ctx, input.title, maxWidth);
  ctx.fillText(title, 64, 172);
  if (ctx.measureText(input.title).width > maxWidth) {
    const cut = Math.max(1, Math.floor((title.length * maxWidth) / ctx.measureText(input.title).width));
    const first = input.title.slice(0, cut).replace(/\s+\S*$/, '');
    ctx.fillText(truncate(ctx, first, maxWidth), 64, 172);
    ctx.fillText(truncate(ctx, input.title.slice(first.length).trim() || input.title, maxWidth), 64, 228);
  }
  const meta = [input.dateText, input.typeText, input.handle ? '@' + input.handle : '']
    .filter(Boolean)
    .join(' · ');
  ctx.font = font(400, 24);
  ctx.fillStyle = muted;
  ctx.fillText(truncate(ctx, meta, maxWidth), 64, 262);
  // 表现分大数字
  const perf = input.performance;
  const perfTop = 318;
  if (perf) {
    ctx.font = font(400, 26);
    ctx.fillStyle = muted;
    ctx.fillText(perf.label, 64, perfTop - 26);
    ctx.font = font(750, 96);
    ctx.fillStyle = accent;
    const prefix =
      perf.value === null ? '' : perf.bound === 'lower' ? '≤ ' : perf.bound === 'upper' ? '≥ ' : '';
    const display = perf.value === null ? '—' : prefix + String(perf.value);
    ctx.fillText(display, 64, perfTop + 58);
    if (perf.caption) {
      ctx.font = font(400, 22);
      ctx.fillStyle = muted;
      ctx.fillText(truncate(ctx, perf.caption, 520), 64, perfTop + 118);
    }
  }
  // Rating 变化（右上）
  if (input.ratingDelta && input.ratingDelta.new > 0) {
    const delta = input.ratingDelta.new - input.ratingDelta.old;
    ctx.textAlign = 'right';
    ctx.font = font(400, 24);
    ctx.fillStyle = muted;
    ctx.fillText('Rating', W - 64, perfTop - 26);
    ctx.font = font(750, 54);
    ctx.fillStyle = delta >= 0 ? '#4ade80' : '#f87171';
    ctx.fillText(
      `${input.ratingDelta.old} → ${input.ratingDelta.new}（${delta >= 0 ? '+' : ''}${delta}）`,
      W - 64,
      perfTop + 34,
    );
    ctx.textAlign = 'left';
  }
  // 赛时数据 chips（底部一行，自动换行）
  let x = 64;
  let y = H - 128;
  ctx.font = font(600, 24);
  for (const fact of input.facts) {
    const text = `${fact.label} ${fact.value}`;
    const width = ctx.measureText(text).width + 44;
    if (x + width > W - 64) {
      x = 64;
      y += 72;
    }
    x = chip(ctx, x, y, fact.label, fact.value);
  }
  // 底部分隔线与生成时间
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(64, H - 44);
  ctx.lineTo(W - 64, H - 44);
  ctx.stroke();
  ctx.font = font(400, 18);
  ctx.fillStyle = muted;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(new Date().toLocaleString('zh-CN'), 64, H - 22);
  return canvas;
}
export async function downloadContestCard(input: ContestCardInput): Promise<void> {
  const canvas = drawContestCard(input);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('卡片导出失败，请重试');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = input.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
