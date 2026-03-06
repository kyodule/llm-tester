import { fetchWithTimeout, measureLatency } from '../utils.js';

export const AnthropicProvider = {
  name: 'anthropic',

  async validate(baseUrl, apiKey) {
    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        })
      }, 15000);

      if (response.ok || response.status === 400) {
        return {
          success: true,
          latency: measureLatency(startTime)
        };
      }

      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        latency: measureLatency(startTime)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        latency: measureLatency(startTime)
      };
    }
  },

  async listModels(baseUrl, apiKey) {
    return [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ];
  },

  async detectCapabilities(baseUrl, apiKey) {
    return { chat: true, responses: false };
  },

  async *chat(config) {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, maxTokens = 1000 } = config;

    const response = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));

      for (const line of lines) {
        const data = line.replace(/^data: /, '').trim();

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta') {
            const content = parsed.delta?.text;
            if (content) yield content;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  },

  async testModel(baseUrl, apiKey, model) {
    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say hello in one word' }]
        })
      }, 15000);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
          latency: measureLatency(startTime)
        };
      }

      return {
        success: true,
        latency: measureLatency(startTime)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        latency: measureLatency(startTime)
      };
    }
  }
};
