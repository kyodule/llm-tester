import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';

export const providers = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  'openai-compatible': OpenAIProvider,
  gemini: GeminiProvider
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

  // 尝试 Gemini 原生 API
  const geminiResult = await GeminiProvider.validate(baseUrl, apiKey);
  if (geminiResult.success) {
    return { protocol: 'gemini', latency: geminiResult.latency };
  }

  return { protocol: null, latency: null };
}

export function getProvider(protocol) {
  return providers[protocol] || providers['openai-compatible'];
}
