import axios from 'axios';
import querystring from 'node:querystring';
import { config } from '../config';

const OUTLOOK_SCOPES = [
  'offline_access',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Files.Read'
];

const AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export function getOutlookAuthUrl(state: string) {
  const params = querystring.stringify({
    client_id: config.outlookClientId,
    response_type: 'code',
    redirect_uri: config.outlookRedirectUri,
    response_mode: 'query',
    scope: OUTLOOK_SCOPES.join(' '),
    state
  });
  return `${AUTH_BASE}/authorize?${params}`;
}

export async function exchangeOutlookCodeForTokens(code: string) {
  const body = querystring.stringify({
    client_id: config.outlookClientId,
    client_secret: config.outlookClientSecret,
    scope: OUTLOOK_SCOPES.join(' '),
    code,
    redirect_uri: config.outlookRedirectUri,
    grant_type: 'authorization_code'
  });

  const response = await axios.post(`${AUTH_BASE}/token`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return response.data as {
    token_type: string;
    scope: string;
    expires_in: number;
    ext_expires_in: number;
    access_token: string;
    refresh_token: string;
    id_token?: string;
  };
}

export async function refreshOutlookToken(refreshToken: string) {
  const body = querystring.stringify({
    client_id: config.outlookClientId,
    client_secret: config.outlookClientSecret,
    scope: OUTLOOK_SCOPES.join(' '),
    refresh_token: refreshToken,
    redirect_uri: config.outlookRedirectUri,
    grant_type: 'refresh_token'
  });

  const response = await axios.post(`${AUTH_BASE}/token`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return response.data as {
    token_type: string;
    scope: string;
    expires_in: number;
    ext_expires_in: number;
    access_token: string;
    refresh_token: string;
    id_token?: string;
  };
}
