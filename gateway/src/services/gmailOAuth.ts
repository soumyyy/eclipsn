import axios from 'axios';
import querystring from 'node:querystring';
import { config } from '../config';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export function getAuthUrl(state: string) {
  console.log('[Gmail OAuth] config:', config.googleClientId, config.googleRedirectUri);
  const params = querystring.stringify({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string) {
  const body = querystring.stringify({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: config.googleRedirectUri,
    grant_type: 'authorization_code'
  });

  const response = await axios.post(
    'https://oauth2.googleapis.com/token',
    body,
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
}

export async function revokeToken(token: string) {
  try {
    await axios.post(
      'https://oauth2.googleapis.com/revoke',
      querystring.stringify({ token }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
  } catch (error) {
    console.warn('Failed to revoke Gmail token', error);
  }
}
