import { fetchWithTimeout, measureLatency } from '../utils.js';

export const GeminiProvider = {
  name: 'gemini',

  async validate(baseUrl, apiKey) {
    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1beta/models?key=${apiKey}`, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
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
  },

  async listModels(baseUrl, apiKey) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1beta/models?key=${apiKey}`, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.models
        ?.filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', '')) || [];
    } catch (error) {
      throw new Error(`Failed to list models: ${error.message}`);
    }
  },

  async detectCapabilities(baseUrl, apiKey) {
    return { chat: true, responses: false };
  },

  async *chat(config) {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, maxTokens = 1000 } = config;

    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const response = await fetchWithTimeout(
      `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens
          }
        })
      }
    );

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
          const content = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (content) yield content;
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  },

  async testModel(baseUrl, apiKey, model) {
    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Say hello in one word' }] }],
            generationConfig: { maxOutputTokens: 10 }
          })
        },
        15000
      );

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
