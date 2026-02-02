# Vitals / Readiness Feed Card – Architecture

This doc describes how the **“How You’re Doing Today”** (vitals/readiness) feed card works end-to-end: data flow, baselines, and how the narrative is generated.

## Goals

- **Sleep vs target:** Compare last night’s sleep to a **7h 55min** standard and label it (enough / a bit short / below target).
- **HRV vs baseline:** Compare today’s HRV to the user’s **monthly average** (above average / normal / below average).
- **RHR vs baseline:** Compare today’s RHR to the user’s **monthly average** (normal / elevated / lower).
- **Actionable summary:** One-line verdict: “Take it a little easy”, “Steady pace”, or “Go conquer your day”.

## Data Flow

```
Whoop API (v2)
    → Gateway (whoop routes)
        → Brain (gateway_client + feed_engine)
            → DB (feed_cards)
                → Gateway GET /feed
                    → Frontend (FeedContext → VitalsCard)
```

## Components

### 1. Gateway – Whoop data and baselines

**Existing:**

- `GET /api/whoop/recovery` – latest recovery (score, RHR, HRV, SpO2, skin temp).
- `GET /api/whoop/sleep` – latest sleep (stage summary, performance %, efficiency %).
- `GET /api/whoop/cycles`, `/workout`, `/profile`, `/measurements` – other Whoop data.

**New:**

- **`GET /api/whoop/baselines?days=30`**  
  - Calls Whoop v2:
    - `GET /v2/recovery?limit=25&start=&end=` (last N days)
    - `GET /v2/activity/sleep?limit=25&start=&end=` (last N days)
  - Computes:
    - **avgHrvMs** – mean of `score.hrv_rmssd_milli` over recovery records.
    - **avgRhr** – mean of `score.resting_heart_rate` over recovery records.
    - **avgSleepMinutes** – mean of `score.stage_summary.total_in_bed_time_milli / 60000` over sleep records.
  - Returns `{ avgHrvMs, avgRhr, avgSleepMinutes, sampleCount }`.

- **whoopClient**
  - `fetchWhoopRecoveryHistory(userId, days)` – recovery records for last N days.
  - `fetchWhoopSleepHistory(userId, days)` – sleep records for last N days.
  - `fetchWhoopBaselines(userId, days)` – uses the two above and returns the aggregated baselines.

Session or internal auth: same as other whoop routes (`getWhoopUserId(req)` from session or `x-user-id` for brain).

### 2. Brain – Gateway client and feed engine

**Gateway client:**

- **`fetch_whoop_baselines(user_id, days=30)`** – `GET {gateway}/api/whoop/baselines?days=30` with internal headers + `x-user-id`. Returns the baselines dict or `None`.

**Feed engine:**

- **Sleep target constant:** `SLEEP_TARGET_MINUTES = 7*60+55` (7h 55min).
- **`_generate_vitals_card(user_id, recovery_data)`** (called from `generate_daily_briefing`):
  1. Fetches **sleep** (latest) and **baselines** (last 30 days) from gateway.
  2. From **recovery**: `hrv_rmssd_milli`, `resting_heart_rate`, `recovery_score`.
  3. From **sleep**: `score.stage_summary.total_in_bed_time_milli` → `sleep_minutes`.
  4. **Comparisons:**
     - **Sleep vs target:**  
       `sleep_vs_target` ∈ { `enough`, `close`, `short`, `low` } using `SLEEP_TARGET_MINUTES` and small buffers (e.g. −15 min = close, −60 min = short).
     - **HRV vs baseline:**  
       `hrv_vs_baseline` ∈ { `above_average`, `normal`, `below_average` } using ratio to `avgHrvMs` (e.g. ≥1.15, 0.85–1.15, &lt;0.85).
     - **RHR vs baseline:**  
       `rhr_vs_baseline` ∈ { `normal`, `elevated`, `lower` } using difference from `avgRhr` (e.g. ±3 bpm).
  5. **Narrative:**
     - Bullets for sleep (vs 7h 55m), HRV (vs baseline), RHR (vs baseline).
     - **Verdict:**  
       - “Take it a little easy” if sleep short/low, HRV below average, or RHR elevated.  
       - “Go conquer your day” if sleep enough/close, HRV normal/above, recovery ≥67%.  
       - “Steady pace” / “Steady effort” otherwise.
  6. **Saves** a feed card with `type='vitals'`, `priority_score=0.95`, and `data` containing:
     - `title`: “How You’re Doing Today”
     - `content`: markdown narrative (bullets + summary)
     - `metadata`: all of the above (sleep_minutes, sleep_vs_target, hrv_ms, hrv_vs_baseline, rhr, rhr_vs_baseline, recovery_score, baselines, verdict, sample_count).

### 3. Frontend – Vitals card

- **VitalsCard** (`feed/cards/VitalsCard.tsx`):
  - Renders `data.title`, `data.content` (markdown), and optional `data.metadata.verdict`.
  - Shows **chips** for:
    - Sleep: “Sleep Xh Ym · Enough sleep / Near target / A bit short / Below target” (green / amber by `sleep_vs_target`).
    - HRV: “HRV above average / normal / below average” (green / neutral / amber by `hrv_vs_baseline`).
    - RHR: “RHR normal / elevated / lower” (neutral / amber / green by `rhr_vs_baseline`).
  - Same card appears in feed when user hits “Regenerate Briefing” (vitals card is generated with the rest of the daily feed).

- **FeedCardRegistry** and **FeedTimeline**: card type `vitals` maps to `VitalsCard`; no filtering (vitals stay in the main feed).

## When the card is created

- The vitals card is created **when the daily briefing is generated** (e.g. “Regenerate Briefing” on the feed page).
- `generate_daily_briefing` in the brain:
  1. Fetches calendar, Gmail, Whoop recovery (and optionally sleep for briefing context).
  2. Generates and saves the **briefing** card.
  3. If Whoop recovery exists, saves the **recovery** (Whoop metrics) card.
  4. **Always** calls `_generate_vitals_card(user_id, whoop_recovery)` so the vitals card is created whenever Whoop recovery (or sleep) is available; baselines are fetched inside `_generate_vitals_card`.

## Summary

| Layer     | Responsibility |
|----------|-----------------|
| **Whoop API** | Source of truth for recovery, sleep, and history (v2). |
| **Gateway**   | Whoop proxies + **baselines** (recovery/sleep history → avg HRV, RHR, sleep). |
| **Brain**     | Fetch current + baselines, compare to 7h55m and baselines, build narrative and verdict, save **vitals** feed card. |
| **Frontend**  | Show vitals card in feed with chips (sleep / HRV / RHR vs target/baseline) and markdown narrative + verdict. |

The “standard” for enough sleep is **7 hours 55 minutes**; HRV and RHR are compared to the user’s **last 30 days** averages so the message is personalized (e.g. “HRV above your average”, “Take it a little easy today”).
