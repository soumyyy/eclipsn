import {
    getServiceAccountById,
    updateServiceAccountJob,
    ServiceAccountJob,
    getServiceAccountJob
} from '../services/db';
import { getAuthorizedServiceGmail } from '../services/serviceAccountClient';
import { ingestSchedulePdf } from '../services/brainClient';

export async function runServiceAccountSync(jobId: string) {
    const job = await getServiceAccountJob(jobId);
    if (!job) return;

    try {
        const account = await getServiceAccountById(job.accountId);
        if (!account) throw new Error('Account not found');

        await log(jobId, 'Starting sync...');
        await updateServiceAccountJob({ jobId, status: 'processing', progress: 5, message: 'Connecting to Gmail...' });

        const gmail = await getAuthorizedServiceGmail(account.id);

        // 1. Calculate 3 month lookback
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const afterDate = Math.floor(threeMonthsAgo.getTime() / 1000); // seconds
        const q = `has:attachment filename:pdf after:${afterDate}`;

        await log(jobId, `Fetching threads with query: ${q}`);
        const threadsRes = await gmail.users.threads.list({
            userId: 'me',
            q,
            maxResults: 20 // Reasonable batch
        });

        const threads = threadsRes.data.threads || [];
        await log(jobId, `Found ${threads.length} potential threads.`);
        await updateServiceAccountJob({ jobId, progress: 10, message: `Found ${threads.length} emails. Filtering...` });

        let processedCount = 0;
        const allowedKeywords = (account.filterKeywords || []).map(k => k.toLowerCase());

        for (const [index, threadRef] of threads.entries()) {
            if (!threadRef.id) continue;

            const threadDetail = await gmail.users.threads.get({
                userId: 'me',
                id: threadRef.id,
                format: 'full'
            });

            const messages = threadDetail.data.messages || [];
            const lastMessage = messages[messages.length - 1]; // Check latest
            if (!lastMessage) continue;

            const headers = lastMessage.payload?.headers || [];
            const fromHeader = headers.find(h => h.name === 'From')?.value || '';
            const subject = headers.find(h => h.name === 'Subject')?.value || '';

            // 2. Dynamic Filter
            if (allowedKeywords.length > 0) {
                const fromLower = fromHeader.toLowerCase();
                const matches = allowedKeywords.some(keyword => fromLower.includes(keyword));
                if (!matches) {
                    await log(jobId, `Skipping "${subject}" from "${fromHeader}" (Filtered)`);
                    continue;
                }
            }

            await log(jobId, `Processing "${subject}"...`);

            // 3. Find PDF attachments
            const parts = lastMessage.payload?.parts || [];
            for (const part of parts) {
                if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body?.attachmentId) {
                    await log(jobId, `Downloading ${part.filename}...`);

                    const attachment = await gmail.users.messages.attachments.get({
                        userId: 'me',
                        messageId: lastMessage.id!,
                        id: part.body.attachmentId
                    });

                    if (attachment.data.data) {
                        // 4. Send to Brain
                        await log(jobId, `Sending ${part.filename} to Brain for extraction...`);
                        await ingestSchedulePdf({
                            userId: account.userId,
                            fileData: attachment.data.data, // base64
                            filename: part.filename
                        });
                        processedCount++;
                    }
                }
            }

            const progress = 10 + Math.floor(((index + 1) / threads.length) * 80);
            await updateServiceAccountJob({ jobId, progress, message: `Processed ${index + 1}/${threads.length} emails` });
        }

        await updateServiceAccountJob({
            jobId,
            status: 'completed',
            progress: 100,
            message: `Sync complete. Processed ${processedCount} relevant attachments.`
        });
        await log(jobId, 'Sync finished successfully.');

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        await updateServiceAccountJob({
            jobId,
            status: 'failed',
            message: 'Sync failed: ' + (error instanceof Error ? error.message : String(error))
        });
        await log(jobId, `Error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function log(jobId: string, text: string) {
    await updateServiceAccountJob({ jobId, log: text });
}
