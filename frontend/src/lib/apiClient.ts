const BASE_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

export async function post(path: string, body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
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
