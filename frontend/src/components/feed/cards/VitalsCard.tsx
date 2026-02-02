'use client';

import ReactMarkdown from 'react-markdown';

export interface VitalsCardData {
    title: string;
    content: string;
    metadata?: {
        sleep_minutes?: number;
        sleep_target_minutes?: number;
        sleep_vs_target?: string;
        hrv_ms?: number;
        hrv_vs_baseline?: string;
        rhr?: number;
        rhr_vs_baseline?: string;
        recovery_score?: number;
        avg_hrv_ms?: number;
        avg_rhr?: number;
        avg_sleep_minutes?: number;
        verdict?: string;
        sample_count?: number;
    };
}

const SLEEP_LABELS: Record<string, string> = {
    enough: 'Enough sleep',
    close: 'Near target',
    short: 'A bit short',
    low: 'Below target',
    unknown: '—'
};

const HRV_LABELS: Record<string, string> = {
    above_average: 'HRV above average',
    normal: 'HRV normal',
    below_average: 'HRV below average',
    unknown: '—'
};

const RHR_LABELS: Record<string, string> = {
    normal: 'RHR normal',
    elevated: 'RHR elevated',
    lower: 'RHR lower',
    unknown: '—'
};

function Chip({ label, variant }: { label: string; variant: 'good' | 'neutral' | 'caution' }) {
    const classes = {
        good: 'bg-[var(--surface)] text-[var(--text)] border-[var(--border-strong)]',
        neutral: 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]',
        caution: 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border-strong)]'
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-medium border ${classes[variant]}`}>
            {label}
        </span>
    );
}

export function VitalsCard({ data }: { data: VitalsCardData }) {
    const meta = data.metadata ?? {};
    const sleepVs = meta.sleep_vs_target ?? 'unknown';
    const hrvVs = meta.hrv_vs_baseline ?? 'unknown';
    const rhrVs = meta.rhr_vs_baseline ?? 'unknown';

    const sleepVariant = sleepVs === 'enough' || sleepVs === 'close' ? 'good' : sleepVs === 'short' ? 'caution' : 'neutral';
    const hrvVariant = hrvVs === 'above_average' ? 'good' : hrvVs === 'below_average' ? 'caution' : 'neutral';
    const rhrVariant = rhrVs === 'elevated' ? 'caution' : rhrVs === 'lower' ? 'good' : 'neutral';

    const sleepMinutes = meta.sleep_minutes;
    const sleepStr = sleepMinutes != null
        ? `${Math.floor(sleepMinutes / 60)}h ${Math.round(sleepMinutes % 60)}m`
        : null;

    return (
        <article className="card">
            <div className="space-y-4">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-[12px] text-[var(--text-muted)]">
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <h3 className="text-[15px] font-semibold text-[var(--text)]">{data.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                    {sleepStr != null && (
                        <Chip
                            label={`Sleep ${sleepStr} · ${SLEEP_LABELS[sleepVs] ?? sleepVs}`}
                            variant={sleepVariant}
                        />
                    )}
                    {hrvVs !== 'unknown' && (
                        <Chip label={HRV_LABELS[hrvVs] ?? hrvVs} variant={hrvVariant} />
                    )}
                    {rhrVs !== 'unknown' && (
                        <Chip label={RHR_LABELS[rhrVs] ?? rhrVs} variant={rhrVariant} />
                    )}
                </div>
                <div className="prose prose-invert prose-sm max-w-none text-[var(--dutch-white-soft)] prose-p:leading-relaxed prose-strong:text-[var(--text)]">
                    <ReactMarkdown>{data.content}</ReactMarkdown>
                </div>
                {meta.verdict && (
                    <p className="text-[13px] text-[var(--text)] font-medium border-t border-[var(--border)] pt-3">
                        {meta.verdict}
                    </p>
                )}
            </div>
        </article>
    );
}
