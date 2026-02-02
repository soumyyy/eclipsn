import { gatewayFetch } from './gatewayFetch';

export async function post(path: string, body: unknown) {
  const response = await gatewayFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway error: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function postForm(path: string, formData: FormData) {
  const response = await gatewayFetch(path, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway error: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function get(path: string) {
  const response = await gatewayFetch(path, {
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`Gateway error: ${response.status}`);
  }

  return response.json();
}

export async function del(path: string) {
  const response = await gatewayFetch(path, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(`Gateway error: ${response.status}`);
  }

  return response.json();
}
