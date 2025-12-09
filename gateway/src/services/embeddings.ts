import { Embeddings } from 'openai/resources';
import OpenAI from 'openai';
import { config } from '../config';

let client: OpenAI | null = null;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for email embeddings');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function embedEmailText(text: string): Promise<number[]> {
  const openai = getClient();
  const response = await openai.embeddings.create({
    input: text,
    model: 'text-embedding-3-small'
  });
  return response.data[0].embedding;
}
