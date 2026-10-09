import { aiConfigSchema, maskApiKey, type AiConfig, type FetchLike } from './ai-review.js';

export const aiModelsInputSchema = aiConfigSchema.pick({ baseUrl: true, apiKey: true });

/** Lists models without saving credentials or requiring a model to be chosen first. */
export async function listAiModels(
  input: unknown,
  saved: AiConfig | null,
  fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit),
): Promise<{ models: string[] }> {
  const config = aiModelsInputSchema.parse(input);
  const base = new URL(config.baseUrl);
  if (base.username || base.password || base.search || base.hash)
    throw new Error('请填写不含认证信息、查询参数或片段的 Base URL');
  let apiKey = config.apiKey;
  if (saved && apiKey && apiKey === maskApiKey(saved.apiKey)) {
    if (config.baseUrl.replace(/\/+$/, '') !== saved.baseUrl.replace(/\/+$/, ''))
      throw new Error('接口地址已更改，请重新填写 API 密钥后获取模型');
    apiKey = saved.apiKey;
  }
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(config.baseUrl.replace(/\/+$/, '') + '/models', {
      method: 'GET',
      headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {},
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch (e) {
    if (e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name))
      throw new Error('获取模型列表超时，请重试或手动填写模型名称');
    throw new Error('无法连接模型列表接口，请检查地址、网络及跨域支持，或手动填写模型名称');
  }
  if ([401, 403].includes(response.status)) throw new Error('API 密钥无效或无权获取模型，请检查密钥');
  if (response.status === 429) throw new Error('获取模型过于频繁，请稍后重试');
  if (!response.ok) throw new Error(`模型列表接口不可用（HTTP ${response.status}），可手动填写模型名称`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('模型列表返回格式异常，可手动填写模型名称');
  }
  if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data))
    throw new Error('接口未返回 OpenAI 兼容模型列表，可手动填写模型名称');
  const models = [
    ...new Set(
      data.data.flatMap((row: unknown) => {
        if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') return [];
        const id = row.id.trim();
        return id && id.length <= 120 ? [id] : [];
      }),
    ),
  ].sort();
  return { models };
}
