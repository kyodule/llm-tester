import { fetchWithTimeout, measureLatency } from '../utils.js';

// 判断是否为 Responses API 端点
function isResponsesEndpoint(endpoint) {
  return endpoint && endpoint.includes('responses');
}

// 将 messages 格式转换为 Responses API 的 input 格式
// 参考 sub2api：content 必须是 [{type: "input_text", text}] 结构
function toResponsesInput(messages) {
  return messages.map(m => ({
    role: m.role,
    content: [{
      type: 'input_text',
      text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }]
  }));
}

// 默认 instructions（参考 sub2api，Responses API 需要带 instructions）
const DEFAULT_INSTRUCTIONS = 'You are a helpful AI assistant.';

// 构建请求体：根据端点自动选择格式
function buildRequestBody(endpoint, { model, messages, temperature, maxTokens, stream }) {
  if (isResponsesEndpoint(endpoint)) {
    // Responses API 格式（对齐 sub2api 实现）
    const body = {
      model,
      input: toResponsesInput(messages),
      instructions: DEFAULT_INSTRUCTIONS,
      stream
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_output_tokens = maxTokens;
    return body;
  }
  // Chat Completions 格式
  const body = {
    model,
    messages,
    stream
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  return body;
}

// 从响应中提取内容（兼容两种格式）
function extractContent(data, endpoint) {
  if (isResponsesEndpoint(endpoint)) {
    // Responses API 非流式响应
    if (data.output) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const part of item.content) {
            if (part.type === 'output_text') return part.text;
          }
        }
      }
    }
    return data.output_text || '';
  }
  // Chat Completions 非流式响应
  return data.choices?.[0]?.message?.content || '';
}

// 从流式响应中提取内容（兼容两种格式）
function extractStreamContent(parsed, endpoint) {
  if (isResponsesEndpoint(endpoint)) {
    if (parsed.type === 'response.output_text.delta') {
      return parsed.delta || '';
    }
    return '';
  }
  return parsed.choices?.[0]?.delta?.content || '';
}

// 判断流式响应是否结束
function isStreamDone(data, endpoint) {
  if (data === '[DONE]') return true;
  if (isResponsesEndpoint(endpoint)) {
    try {
      const parsed = JSON.parse(data);
      return parsed.type === 'response.completed';
    } catch (e) {
      return false;
    }
  }
  return false;
}

export const OpenAIProvider = {
  name: 'openai',

  async validate(baseUrl, apiKey) {
    const startTime = Date.now();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
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
      const response = await fetchWithTimeout(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.data?.map(m => m.id) || [];
    } catch (error) {
      throw new Error(`Failed to list models: ${error.message}`);
    }
  },

  async detectCapabilities(baseUrl, apiKey) {
    const capabilities = { chat: false, responses: false };

    try {
      const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        })
      }, 10000);

      if (response.ok || response.status === 400) {
        capabilities.chat = true;
      }
    } catch (error) {
      // Ignore
    }

    return capabilities;
  },

  async *chat(config) {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, maxTokens = 1000, apiType = 'chat', customEndpoint, stream = true, logCallback } = config;

    let endpoint;
    if (customEndpoint) {
      endpoint = customEndpoint.startsWith('/') ? customEndpoint : `/${customEndpoint}`;
    } else {
      endpoint = apiType === 'responses' ? '/responses' : '/v1/chat/completions';
    }

    const requestUrl = `${baseUrl}${endpoint}`;
    const requestBody = buildRequestBody(endpoint, { model, messages, temperature, maxTokens, stream });
    
    if (logCallback) {
      logCallback({ url: requestUrl, body: requestBody, headers: { Authorization: 'Bearer ***' } });
    }

    const response = await fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (logCallback) {
        logCallback({ status: response.status, body: errorText.substring(0, 1000), error: `HTTP ${response.status}` });
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    // 非流式模式
    if (!stream) {
      const data = await response.json();
      if (logCallback) {
        logCallback({ status: response.status, body: JSON.stringify(data).substring(0, 1000) });
      }
      const content = extractContent(data, endpoint);
      if (content) yield content;
      return;
    }

    // 流式模式
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      
      if (firstChunk && logCallback) {
        logCallback({ status: response.status, body: chunk.substring(0, 1000), isStream: true });
        firstChunk = false;
      }

      const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));

      for (const line of lines) {
        const data = line.replace(/^data: /, '').trim();
        if (isStreamDone(data, endpoint)) return;

        try {
          const parsed = JSON.parse(data);
          const content = extractStreamContent(parsed, endpoint);
          if (content) yield content;
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  },

  async testModel(baseUrl, apiKey, model, apiType = 'chat', customEndpoint = null) {
    const startTime = Date.now();
    
    let endpoint;
    if (customEndpoint) {
      endpoint = customEndpoint.startsWith('/') ? customEndpoint : `/${customEndpoint}`;
    } else {
      endpoint = apiType === 'responses' ? '/responses' : '/v1/chat/completions';
    }

    const messages = [{ role: 'user', content: 'Say hello in one word' }];
    const isCodex = model.toLowerCase().includes('codex');
    const requestBody = buildRequestBody(endpoint, {
      model,
      messages,
      temperature: isCodex ? undefined : 0.7,
      maxTokens: isCodex ? 100 : 10,
      stream: false
    });
    
    try {
      const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }, 15000);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`,
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
