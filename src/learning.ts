import { api, notify } from './api';
export async function checkLearningAgent() {
  try {
    const result = await api<{ message?: string; fallback?: boolean }>('/learning/agent', {
      automatic: true,
    });
    if (result.fallback) notify(result.message || 'AI 调整失败，沿用规则题单');
  } catch {
    /* 正常练习不依赖 AI 可用性，失败信息保存在学习中心。 */
  }
}
// Stored ZIP: 无压缩，避免依赖服务或阻塞浏览器；UTF-8 文件名。
export function downloadFiles(name: string, files: Record<string, string>) {
  const encoder = new TextEncoder(),
    chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c ^= byte;
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  for (const [path, content] of Object.entries(files)) {
    const p = encoder.encode(path),
      data = encoder.encode(content),
      checksum = crc(data);
    const local = new Uint8Array(30 + p.length),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, checksum, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, p.length, true);
    local.set(p, 30);
    const entry = new Uint8Array(46 + p.length),
      e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(8, 0x800, true);
    e.setUint32(16, checksum, true);
    e.setUint32(20, data.length, true);
    e.setUint32(24, data.length, true);
    e.setUint16(28, p.length, true);
    e.setUint32(42, offset, true);
    entry.set(p, 46);
    chunks.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const url = URL.createObjectURL(
    new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
