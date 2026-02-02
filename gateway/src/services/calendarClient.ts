import { google } from 'googleapis';
import { config } from '../config';
import { getGmailTokens, getServiceAccounts, ServiceAccount } from './db';

const calendar = google.calendar('v3');

async function getClient(accessToken: string, refreshToken: string) {
    const oauth2Client = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret,
        config.googleRedirectUri
    );
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken
    });
    return oauth2Client;
}

export interface CalendarEvent {
    id: string;
    summary: string;
    start: string;
    end: string;
    link: string;
    source: string; // 'primary' or service account email
}

export async function fetchAllCalendarEvents(
    userId: string,
    timeMin: string,
    timeMax: string
): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];

    // 1. Primary Account
    const primaryTokens = await getGmailTokens(userId);
    if (primaryTokens) {
        try {
            const auth = await getClient(primaryTokens.accessToken, primaryTokens.refreshToken!);
            const res = await calendar.events.list({
                auth,
                calendarId: 'primary',
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime'
            });

            const primaryEvents = res.data.items || [];
            primaryEvents.forEach(e => {
                if (e.start?.dateTime || e.start?.date) {
                    events.push({
                        id: e.id || '',
                        summary: e.summary || '(No Title)',
                        start: e.start.dateTime || e.start.date || '',
                        end: e.end?.dateTime || e.end?.date || '',
                        link: e.htmlLink || '',
                        source: 'Primary'
                    });
                }
            });
        } catch (err) {
            console.warn(`[Calendar] Failed to fetch primary events for ${userId}`, err);
        }
    }

    // 2. Service Accounts
    try {
        const accounts = await getServiceAccounts(userId);
        for (const account of accounts) {
            if (account.provider === 'google' || account.provider === 'gmail') {
                try {
                    const auth = await getClient(account.tokens.access_token, account.tokens.refresh_token);
                    const res = await calendar.events.list({
                        auth,
                        calendarId: 'primary', // 'primary' relative to the service account
                        timeMin,
                        timeMax,
                        singleEvents: true,
                        orderBy: 'startTime'
                    });
                    const accountEvents = res.data.items || [];
                    accountEvents.forEach(e => {
                        if (e.start?.dateTime || e.start?.date) {
                            events.push({
                                id: e.id || '',
                                summary: e.summary || '(No Title)',
                                start: e.start.dateTime || e.start.date || '',
                                end: e.end?.dateTime || e.end?.date || '',
                                link: e.htmlLink || '',
                                source: account.email
                            });
                        }
                    });
                } catch (err) {
                    console.warn(`[Calendar] Failed to fetch events for service account ${account.email}`, err);
                }
            }
        }
    } catch (err) {
        console.warn(`[Calendar] Failed to fetch service accounts for ${userId}`, err);
    }

    // Sort by start time
    return events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}
