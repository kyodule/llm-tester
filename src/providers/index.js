import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

export const providers = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  'openai-compatible': OpenAIProvider
};

export async function detectProtocol(baseUrl, apiKey) {
  // 先尝试 OpenAI 兼容（大部分中继渠道都是这个）
  const openaiResult = await OpenAIProvider.validate(baseUrl, apiKey);
  if (openaiResult.success) {
    return { protocol: 'openai-compatible', latency: openaiResult.latency };
  }

  const anthropicResult = await AnthropicProvider.validate(baseUrl, apiKey);
  if (anthropicResult.success) {
    return { protocol: 'anthropic', latency: anthropicResult.latency };
  }

  return { protocol: null, latency: null };
}

export function getProvider(protocol) {
  return providers[protocol] || providers['openai-compatible'];
}
