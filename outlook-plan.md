Completed groundwork:
- Azure config slots in `gateway/src/config.ts` (`OUTLOOK_CLIENT_ID/SECRET/REDIRECT_URI`).
- `outlook_tokens` table + helpers (`saveOutlookTokens`, `getOutlookTokens`, `deleteOutlookTokens`) in `db/schema.sql` and `gateway/src/services/db.ts`.
- OAuth utilities (`gateway/src/services/outlookOAuth.ts`) and router (`gateway/src/routes/outlook.ts`) with `/connect`, `/callback`, `/status`, `/disconnect`, wired via `gateway/src/index.ts`.
- Documented Azure app registration steps, scopes, and env vars.

Remaining work:
1. Build Microsoft Graph mail ingestion (client wrapper, `/me/messages` fetch, storage schema, incremental jobs).
2. Handle attachments/doc parsing (`/attachments`, storage, PDF/Office parsing pipeline).
3. Surface Outlook status/controls in the frontend UI.
4. Feed Outlook mail into the brain (memory search, provider tagging).
5. Add tests/logging/metrics for the new flow.
