import { Hono } from 'hono';
import db, { encryptApiKey, decryptApiKey } from '../db.js';
import { detectProtocol, getProvider } from '../providers/index.js';

const channels = new Hono();

// 获取渠道实际使用的协议：force_protocol > detected_protocol > protocol
function getEffectiveProtocol(channel) {
  return channel.force_protocol || channel.detected_protocol || channel.protocol;
}

// 获取模型列表使用的协议：models_protocol > force_protocol > detected_protocol > protocol
function getModelsProtocol(channel) {
  return channel.models_protocol || channel.force_protocol || channel.detected_protocol || channel.protocol;
}

// 获取渠道实际使用的 API 类型
function getEffectiveApiType(channel) {
  if (channel.force_api_type) {
    return channel.force_api_type;
  }
  try {
    const capabilities = JSON.parse(channel.capabilities || '{}');
    return capabilities.chat ? 'chat' : 'responses';
  } catch (e) {
    return 'chat';
  }
}

channels.get('/', (c) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all();
  return c.json(rows.map(row => ({
    ...row,
    api_key_encrypted: undefined,
    hasApiKey: !!row.api_key_encrypted,
    effective_protocol: getEffectiveProtocol(row),
    models_protocol_display: getModelsProtocol(row),
    effective_api_type: getEffectiveApiType(row),
    custom_endpoint: row.custom_endpoint || ''
  })));
});

channels.post('/', async (c) => {
  const { name, baseUrl, apiKey, protocol = 'auto' } = await c.req.json();

  if (!name || !baseUrl || !apiKey) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const encrypted = encryptApiKey(apiKey);
  const stmt = db.prepare(`
    INSERT INTO channels (name, base_url, api_key_encrypted, protocol)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(name, baseUrl, encrypted, protocol);
  return c.json({ id: result.lastInsertRowid }, 201);
});

channels.put('/:id', async (c) => {
  const id = c.req.param('id');
  const { name, baseUrl, apiKey, protocol } = await c.req.json();

  const updates = [];
  const values = [];

  if (name) {
    updates.push('name = ?');
    values.push(name);
  }
  if (baseUrl) {
    updates.push('base_url = ?');
    values.push(baseUrl);
  }
  if (apiKey) {
    updates.push('api_key_encrypted = ?');
    values.push(encryptApiKey(apiKey));
  }
  if (protocol) {
    updates.push('protocol = ?');
    values.push(protocol);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const stmt = db.prepare(`UPDATE channels SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);

  return c.json({ success: true });
});

channels.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  return c.json({ success: true });
});

channels.post('/:id/validate', async (c) => {
  const id = c.req.param('id');
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);

  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const apiKey = decryptApiKey(channel.api_key_encrypted);
  let protocol = channel.protocol;
  let detectedProtocol = null;
  let latency = null;

  if (protocol === 'auto') {
    const detection = await detectProtocol(channel.base_url, apiKey);
    detectedProtocol = detection.protocol;
    latency = detection.latency;

    if (!detectedProtocol) {
      db.prepare('UPDATE channels SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('unavailable', id);
      return c.json({ success: false, error: 'Failed to detect protocol' });
    }

    protocol = detectedProtocol;
  } else {
    const provider = getProvider(protocol);
    const result = await provider.validate(channel.base_url, apiKey);

    if (!result.success) {
      db.prepare('UPDATE channels SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('unavailable', id);
      return c.json({ success: false, error: result.error });
    }

    latency = result.latency;
    detectedProtocol = protocol;
  }

  const provider = getProvider(protocol);
  const capabilities = await provider.detectCapabilities(channel.base_url, apiKey);

  db.prepare(`
    UPDATE channels 
    SET status = ?, detected_protocol = ?, capabilities = ?, latency_ms = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run('available', detectedProtocol, JSON.stringify(capabilities), latency, id);

  return c.json({
    success: true,
    protocol: detectedProtocol,
    capabilities,
    latency
  });
});

channels.get('/:id/models', async (c) => {
  const id = c.req.param('id');
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);

  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const apiKey = decryptApiKey(channel.api_key_encrypted);
  const protocol = getModelsProtocol(channel);  // 使用模型列表专用协议
  const provider = getProvider(protocol);

  const tests = db.prepare('SELECT model_name, status, latency_ms, error_message FROM model_tests WHERE channel_id = ?')
    .all(id);
  const testMap = Object.fromEntries(tests.map(t => [t.model_name, t]));

  let apiModels = [];
  try {
    apiModels = await provider.listModels(channel.base_url, apiKey);
  } catch (error) {
    // listModels failed (e.g. channel doesn't support /v1/models), fall back to model_tests only
  }

  const seen = new Set(apiModels);
  // Merge models from model_tests that aren't in the API response
  for (const t of tests) {
    if (!seen.has(t.model_name)) {
      apiModels.push(t.model_name);
    }
  }

  return c.json(apiModels.map(name => ({
    name,
    status: testMap[name]?.status || 'untested',
    latency: testMap[name]?.latency_ms,
    error: testMap[name]?.error_message
  })));
});

// 手动添加模型（持久化到 model_tests 表）
channels.post('/:id/models', async (c) => {
  const id = c.req.param('id');
  const { model } = await c.req.json();

  if (!model || !model.trim()) {
    return c.json({ error: 'Model name is required' }, 400);
  }

  db.prepare(`
    INSERT INTO model_tests (channel_id, model_name, status)
    VALUES (?, ?, 'untested')
    ON CONFLICT(channel_id, model_name) DO NOTHING
  `).run(id, model.trim());

  return c.json({ success: true });
});

channels.post('/:id/models/:model/test', async (c) => {
  const id = c.req.param('id');
  const model = c.req.param('model');
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id);

  if (!channel) {
    return c.json({ error: 'Channel not found' }, 404);
  }

  const apiKey = decryptApiKey(channel.api_key_encrypted);
  const protocol = getEffectiveProtocol(channel);
  const apiType = getEffectiveApiType(channel);
  const provider = getProvider(protocol);

  const result = await provider.testModel(channel.base_url, apiKey, model, apiType, channel.custom_endpoint);

  db.prepare(`
    INSERT INTO model_tests (channel_id, model_name, status, latency_ms, error_message)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, model_name) DO UPDATE SET
      status = excluded.status,
      latency_ms = excluded.latency_ms,
      error_message = excluded.error_message,
      tested_at = CURRENT_TIMESTAMP
  `).run(
    id,
    model,
    result.success ? 'available' : 'unavailable',
    result.latency,
    result.error || null
  );

  return c.json(result);
});

// 新增：手动切换协议（对话/测试用）
channels.post('/:id/switch-protocol', async (c) => {
  const id = c.req.param('id');
  const { protocol } = await c.req.json();

  if (!['openai', 'anthropic', 'openai-compatible'].includes(protocol)) {
    return c.json({ error: 'Invalid protocol' }, 400);
  }

  db.prepare('UPDATE channels SET force_protocol = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(protocol, id);

  return c.json({ success: true });
});

// 新增：手动切换模型列表协议
channels.post('/:id/switch-models-protocol', async (c) => {
  const id = c.req.param('id');
  const { protocol } = await c.req.json();

  if (!['openai', 'anthropic', 'openai-compatible'].includes(protocol)) {
    return c.json({ error: 'Invalid protocol' }, 400);
  }

  db.prepare('UPDATE channels SET models_protocol = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(protocol, id);

  return c.json({ success: true });
});

// 新增：手动切换 API 类型
channels.post('/:id/switch-api-type', async (c) => {
  const id = c.req.param('id');
  const { apiType } = await c.req.json();

  if (!['chat', 'responses'].includes(apiType)) {
    return c.json({ error: 'Invalid API type, must be chat or responses' }, 400);
  }

  db.prepare('UPDATE channels SET force_api_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(apiType, id);

  return c.json({ success: true });
});

// 新增：设置自定义端点路径
channels.post('/:id/set-custom-endpoint', async (c) => {
  const id = c.req.param('id');
  const { endpoint } = await c.req.json();

  // endpoint 可以为空字符串（清除自定义端点）
  db.prepare('UPDATE channels SET custom_endpoint = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(endpoint || null, id);

  return c.json({ success: true });
});

// 新增：获取请求日志
channels.get('/:id/logs', (c) => {
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '20');
  
  const logs = db.prepare(`
    SELECT * FROM request_logs 
    WHERE channel_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(id, limit);

  return c.json(logs);
});

// 新增：清除请求日志
channels.delete('/:id/logs', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM request_logs WHERE channel_id = ?').run(id);
  return c.json({ success: true });
});

export default channels;
