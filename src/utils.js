// 智能处理 Base URL，避免 /v1 重复拼接
export function normalizeBaseUrl(baseUrl) {
  let url = baseUrl.replace(/\/+$/, ''); // 去掉尾部斜杠
  return url;
}

// 拼接 endpoint 时智能处理 /v1 前缀
export function buildUrl(baseUrl, endpoint) {
  const base = normalizeBaseUrl(baseUrl);
  // 如果 base 已经以 /v1 结尾，而 endpoint 也以 /v1 开头，去掉重复
  if (base.endsWith('/v1') && endpoint.startsWith('/v1')) {
    return base + endpoint.slice(3);
  }
  // 如果 base 不以 /v1 结尾，而 endpoint 不以 /v1 开头，自动加 /v1
  if (!base.endsWith('/v1') && !endpoint.startsWith('/v1') && endpoint.startsWith('/')) {
    return base + '/v1' + endpoint;
  }
  return base + endpoint;
}

export async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export function measureLatency(startTime) {
  return Date.now() - startTime;
}
