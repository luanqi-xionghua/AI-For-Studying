export const DEFAULTS = Object.freeze({
  provider: 'deepseek', model: 'deepseek-flash', effort: 'high',
  theme: 'system', baseUrl: 'https://api.deepseek.com', rememberKey: false,
});

export function apiOrigin(baseUrl) {
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密码、查询参数或锚点。');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('API 地址需要 HTTPS；本机服务可以使用 HTTP。');
  return url.origin;
}
