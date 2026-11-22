const origin = 'https://bridgelens.johnfaben.com';
const site = 'https://fdmathbridge.top';
const sizeLimit = 10 * 1024 * 1024;
const requestLimit = sizeLimit + 64 * 1024;
const accepted = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function sameOriginPath(path) {
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('Unexpected recognition service address');
  return url;
}

function textFromMarkup(markup) {
  return markup.replace(/&(?:#34|#x22|quot);/gi, '"').replace(/&nbsp;/g, ' ');
}

async function completion(response) {
  if (!response.body) throw new Error('No recognition events');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5));
        if (event.stage === 'error') return null;
        if (event.stage === 'done') return event.redirect;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return null;
}

async function recognize(request, fetchUpstream) {
  if (Number(request.headers.get('content-length')) > requestLimit) {
    return Response.json({ error: '照片超过 10 MB' }, { status: 413 });
  }
  let bytes = 0;
  const body = request.body?.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > requestLimit) throw new Error('Request too large');
      controller.enqueue(chunk);
    },
  }));
  let incoming;
  try { incoming = (await new Response(body, { headers: request.headers }).formData()).get('photo'); }
  catch {
    if (bytes > requestLimit) return Response.json({ error: '照片超过 10 MB' }, { status: 413 });
  }
  if (!incoming || typeof incoming === 'string' || !accepted[incoming.type] || !incoming.size || incoming.size > sizeLimit) {
    return Response.json({ error: '仅支持 10 MB 以内的 JPG、PNG 或 WebP' }, { status: 400 });
  }
  const cookies = new Map();
  const signal = AbortSignal.timeout(55000);
  async function visit(path, options = {}, redirects = 0) {
    const url = sameOriginPath(path);
    const headers = new Headers(options.headers);
    if (cookies.size) headers.set('cookie', [...cookies].map(([key, value]) => key + '=' + value).join('; '));
    const response = await fetchUpstream(url, { ...options, headers, redirect: 'manual', signal });
    const setCookies = response.headers.getSetCookie?.() ?? response.headers.getAll?.('Set-Cookie')
      ?? [response.headers.get('set-cookie')].filter(Boolean);
    setCookies.forEach(line => {
      const segment = line.split(';', 1)[0];
      const delimiter = segment.indexOf('=');
      if (delimiter > 0) cookies.set(segment.slice(0, delimiter).trim(), segment.slice(delimiter + 1));
    });
    const location = response.headers.get('location');
    if (location && [301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 4) throw new Error('Too many recognition redirects');
      const next = response.status === 307 || response.status === 308 ? options : {};
      return visit(new URL(location, url).href, next, redirects + 1);
    }
    if (!response.ok) throw new Error('Recognition service HTTP ' + response.status);
    return response;
  }
  try {
    const home = await (await visit('/')).text();
    const token = home.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
    if (!token) throw new Error('Recognition form unavailable');
    const form = new FormData();
    form.set('csrf_token', token);
    form.set('file', incoming, 'bridge-photo.' + accepted[incoming.type]);
    const upload = await visit('/infer', { method: 'POST', body: form, headers: { referer: origin + '/' } });
    let markup = await upload.text();
    const stream = markup.match(/new EventSource\(['"]([^'"]+)['"]\)/)?.[1];
    if (stream) {
      const events = await visit(stream, { headers: { accept: 'text/event-stream' } });
      const result = await completion(events);
      if (result) markup = await (await visit(result)).text();
    }
    const text = textFromMarkup(markup);
    const pbn = text.match(/\[Deal\s+"[NESW]:[AKQJT2-9. ]+"\]/i)?.[0];
    const detected = text.match(/(\d+)\s+unique cards? detected/i)?.[1]
      ?? text.match(/(\d+)\s*\/\s*52\s+cards? detected/i)?.[1]
      ?? text.match(/(\d+)\s+cards? detected/i)?.[1] ?? null;
    if (!pbn) return Response.json({
      error: '没识别出牌面',
    }, { status: 422 });
    return Response.json({ pbn, detected: detected === null ? null : Number(detected) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return Response.json({ error: 'BridgeLens 响应超时，可重试' }, { status: 504 });
    }
    return Response.json({ error: 'BridgeLens 暂时连不上' }, { status: 502 });
  }
}

export async function handleRequest(request, fetchUpstream = fetch) {
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (new URL(request.url).pathname !== '/api/recognize') {
    return new Response(null, { status: 404, headers });
  }
  if (request.headers.get('Origin') !== site) return new Response(null, { status: 403, headers });
  headers.set('Access-Control-Allow-Origin', site);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'POST');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers });
  const response = await recognize(request, fetchUpstream);
  response.headers.forEach((value, name) => headers.set(name, value));
  return new Response(response.body, { status: response.status, headers });
}

export default { fetch(request) { return handleRequest(request); } };
