import { google } from 'googleapis';
import { config } from '../config';
import {
    getServiceAccountById,
    updateServiceAccountTokens,
    ServiceAccount
} from './db';

// Reuse the same error constant or make a new one?
export const NO_SERVICE_TOKENS = 'NO_SERVICE_TOKENS';

async function getAuthorizedOAuthClient(account: ServiceAccount) {
    const oauth2Client = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret,
        config.googleRedirectUri
    );

    oauth2Client.setCredentials({
        access_token: account.tokens.access_token,
        refresh_token: account.tokens.refresh_token,
        expiry_date: account.tokens.expiry_date
    });

    oauth2Client.on('tokens', async (newTokens) => {
        if (!newTokens.access_token) return;
        try {
            console.log(`[ServiceAccount] Refreshing tokens for account ${account.id}`);
            const updatedTokens = {
                ...account.tokens,
                access_token: newTokens.access_token,
                expiry_date: newTokens.expiry_date
            };
            if (newTokens.refresh_token) {
                updatedTokens.refresh_token = newTokens.refresh_token;
            }
            await updateServiceAccountTokens(account.id, updatedTokens);
        } catch (error) {
            console.warn('[ServiceAccount] Failed to persist refreshed tokens', error);
        }
    });

    return oauth2Client;
}

export async function getAuthorizedServiceGmail(accountId: string) {
    const account = await getServiceAccountById(accountId);
    if (!account || !account.tokens) {
        const error = new Error(NO_SERVICE_TOKENS);
        error.name = NO_SERVICE_TOKENS;
        throw error;
    }

    const auth = await getAuthorizedOAuthClient(account);
    return google.gmail({ version: 'v1', auth });
}

export async function fetchServiceAccountThreadBody(accountId: string, threadId: string) {
    const gmail = await getAuthorizedServiceGmail(accountId);
    try {
        const response = await gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'full'
        });

        const messages = response.data.messages || [];
        let bodyText = '';
        const attachments: Array<{ id: string; messageId: string; filename: string; mimeType: string; size: number }> = [];

        for (const message of messages) {
            if (message.payload && message.id) {
                const msgAttachments = extractAttachments(message.payload, message.id);
                attachments.push(...msgAttachments);
            }
        }

        // Process in chronological order for body text? No, reverse usually gets latest reply first.
        // Actually for reading a thread, chronological is often better for context, but summary usually wants latest.
        // I'll stick to reverse to match gmailClient.ts behavior.
        const reversedMessages = [...messages].reverse();
        for (const message of reversedMessages) {
            const text = extractPlainText(message.payload);
            if (text) {
                bodyText += text.trim() + '\n\n';
            }
        }
        bodyText = bodyText.trim() || response.data.snippet || '';

        // Extract metadata from the LAST message (which is the most recent one)
        const lastMessage = messages[messages.length - 1];
        const headers = lastMessage?.payload?.headers || [];
        const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
        const sender = headers.find((h) => h.name === 'From')?.value || 'Unknown sender';
        const lastMessageAt = lastMessage?.internalDate ? new Date(Number(lastMessage.internalDate)).toISOString() : null;

        return {
            id: threadId,
            subject,
            summary: bodyText,
            sender,
            lastMessageAt,
            body: bodyText,
            link: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
            attachments
        };

    } catch (error) {
        console.error('[ServiceAccount] Failed to fetch thread body:', error);
        throw error;
    }
}

export async function getServiceAccountAttachment(accountId: string, messageId: string, attachmentId: string) {
    // We get the account first to get the email address explicitly
    const account = await getServiceAccountById(accountId);
    if (!account || !account.tokens) {
        throw new Error(NO_SERVICE_TOKENS);
    }

    // We already have the account, so we can build the auth client directly
    const auth = await getAuthorizedOAuthClient(account);
    const gmail = google.gmail({ version: 'v1', auth });

    console.log(`[ServiceAccount] Fetching attachment for ${account.email}, message: ${messageId}`);

    try {
        const response = await gmail.users.messages.attachments.get({
            userId: account.email, // Explicitly use the email address instead of 'me' for robustness
            messageId,
            id: attachmentId
        });
        return response.data;
    } catch (error: any) {
        console.error(`[ServiceAccount] Failed to fetch attachment for ${account.email}: ${error.message}`, error.response?.data);
        throw error;
    }
}

// Helpers duplicated from gmailClient.ts

function extractAttachments(payload: any, messageId: string): Array<{ id: string; messageId: string; filename: string; mimeType: string; size: number }> {
    const attachments: Array<{ id: string; messageId: string; filename: string; mimeType: string; size: number }> = [];

    if (payload.body?.attachmentId) {
        attachments.push({
            id: payload.body.attachmentId,
            messageId: messageId,
            filename: payload.filename || 'unknown',
            mimeType: payload.mimeType || 'application/octet-stream',
            size: payload.body.size || 0
        });
    }

    if (payload.parts) {
        for (const part of payload.parts) {
            attachments.push(...extractAttachments(part, messageId));
        }
    }

    return attachments;
}

function extractPlainText(payload: any): string {
    if (!payload) return '';
    const { mimeType, body, parts } = payload;
    if (mimeType === 'text/plain' && body?.data) {
        return decodeBase64(body.data);
    }
    if (mimeType === 'text/html' && body?.data) {
        return stripHtml(decodeBase64(body.data));
    }
    if (parts && parts.length) {
        for (const part of parts) {
            const text = extractPlainText(part);
            if (text) return text;
        }
    }
    if (body?.data) {
        return decodeBase64(body.data);
    }
    return '';
}

function decodeBase64(data: string): string {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ');
}
