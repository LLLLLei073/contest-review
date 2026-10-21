import { aiConfigSchema, maskApiKey, type AiConfig } from './ai-review.js';
export function resolveAiConfiguration(input: unknown, saved: AiConfig | null): AiConfig {
  if (!input || (typeof input === 'object' && !Object.keys(input).length)) {
    if (!saved) throw new Error('请先填写 AI 配置');
    return saved;
  }
  const config = aiConfigSchema.parse(input);
  if (saved && config.apiKey && config.apiKey === maskApiKey(saved.apiKey)) {
    if (config.baseUrl.replace(/\/+$/, '') !== saved.baseUrl.replace(/\/+$/, ''))
      throw new Error('接口地址已更改，请重新填写 API 密钥');
    config.apiKey = saved.apiKey;
  }
  return config;
}
