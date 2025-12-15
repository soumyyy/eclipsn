const BASE_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || '';

export function gatewayFetch(path: string, init: RequestInit = {}) {
  const url = BASE_URL ? `${BASE_URL}${path}` : path;
  const headers =
    init.headers instanceof Headers
      ? init.headers
      : init.headers
      ? new Headers(init.headers as Record<string, string>)
      : new Headers();
  return fetch(url, {
    ...init,
    headers,
    credentials: 'include'
  });
}
