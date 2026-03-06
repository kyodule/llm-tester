import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import db, { decryptApiKey } from '../db.js';
import { getProvider } from '../providers/index.js';

const chat = new Hono();

chat.post('/', async (c) => {
  const { channelId, model, messages, temperature, maxTokens, stream: useStream = true } = await c.req.json();

  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const apiKey = decryptApiKey(channel.api_key_encrypted);
  const protocol = channel.force_protocol || channel.detected_protocol || channel.protocol;
  const provider = getProvider(protocol);

  // 获取实际 API 类型
  let apiType = channel.force_api_type;
  if (!apiType) {
    try {
      const capabilities = JSON.parse(channel.capabilities || '{}');
      apiType = capabilities.chat ? 'chat' : 'responses';
    } catch (e) {
      apiType = 'chat';
    }
  }

  // 日志记录
  const logData = { request: null, response: null };
  const logCallback = (data) => {
    if (data.url) {
      logData.request = data;
    } else {
      logData.response = data;
    }
  };

  return streamSSE(c, async (stream) => {
    try {
      const chatStream = provider.chat({
        baseUrl: channel.base_url,
        apiKey,
        model,
        messages,
        temperature,
        maxTokens,
        apiType,
        customEndpoint: channel.custom_endpoint,
        stream: useStream,
        logCallback
      });

      for await (const chunk of chatStream) {
        await stream.writeSSE({
          data: JSON.stringify({ content: chunk })
        });
      }

      // 保存日志到数据库
      if (logData.request && logData.response) {
        db.prepare(`
          INSERT INTO request_logs (channel_id, request_type, model_name, request_url, request_body, response_status, response_body)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          channelId,
          'chat',
          model,
          logData.request.url,
          JSON.stringify(logData.request.body),
          logData.response.status,
          logData.response.body
        );
      }

      await stream.writeSSE({
        data: JSON.stringify({ done: true })
      });
    } catch (error) {
      // 保存错误日志
      if (logData.request) {
        db.prepare(`
          INSERT INTO request_logs (channel_id, request_type, model_name, request_url, request_body, error_message)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          channelId,
          'chat',
          model,
          logData.request.url,
          JSON.stringify(logData.request.body),
          error.message
        );
      }

      await stream.writeSSE({
        data: JSON.stringify({ error: error.message })
      });
    }
  });
});

export default chat;
