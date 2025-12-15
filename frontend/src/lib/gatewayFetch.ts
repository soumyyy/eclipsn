import { getApiUrl } from './api';

/**
 * Simple fetch wrapper using Next.js environment configuration
 * No custom URL logic - let Next.js handle routing
 */

interface GatewayFetchOptions extends RequestInit {
  timeout?: number;
}

/**
 * Fetch wrapper that uses Next.js standard API configuration
 */
export function gatewayFetch(path: string, options: GatewayFetchOptions = {}): Promise<Response> {
  const { timeout = 45000, ...fetchOptions } = options;
  
  // Use Next.js API configuration - no custom logic needed
  const url = getApiUrl(path);
  
  // Prepare headers
  const headers = new Headers(fetchOptions.headers || {});
  headers.set('Accept', 'application/json');
  
  if (['POST', 'PUT', 'PATCH'].includes(fetchOptions.method?.toUpperCase() || 'GET')) {
    if (!headers.has('Content-Type')) {
      // Only set application/json if body is not FormData
      // FormData should use browser's automatic multipart/form-data
      if (!(fetchOptions.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }
  
  // Simple timeout using AbortController
  const controller = new AbortController();
  const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;
  
  const finalOptions: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: 'include',
    signal: controller.signal
  };
  
  return fetch(url, finalOptions).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Convenience wrappers
 */
export function gatewayGet(path: string, options: Omit<GatewayFetchOptions, 'method'> = {}) {
  return gatewayFetch(path, { ...options, method: 'GET' });
}

export function gatewayPost(path: string, data?: any, options: Omit<GatewayFetchOptions, 'method' | 'body'> = {}) {
  return gatewayFetch(path, {
    ...options,
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined
  });
}
