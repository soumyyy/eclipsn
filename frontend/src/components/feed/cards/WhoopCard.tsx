interface WhoopData {
    title: string;
    content: string;
    metadata: {
        score: number;
        sleep: number;
        hrv: number;
        rhr?: number | null;
        spo2?: number | null;
        skinTempCelsius?: number | null;
        state: number;
        cycle?: Record<string, unknown>;
        sleep_data?: Record<string, unknown>;
        workout?: Record<string, unknown>;
        profile?: Record<string, unknown>;
        measurements?: Record<string, unknown>;
    };
}

export function WhoopCard({ data }: { data: WhoopData }) {
    const { score, sleep, hrv, rhr, spo2, skinTempCelsius, cycle, sleep_data, workout, measurements } = data.metadata;

    const getRecoveryColor = (s: number) => {
        if (s >= 67) return '#EDE6D6';
        if (s >= 34) return 'rgba(237,230,214,0.55)';
        return 'rgba(237,230,214,0.4)';
    };

    const ringColor = getRecoveryColor(score);

    // Calculations
    const cycleScore = cycle?.score as Record<string, unknown> | undefined;
    const strain = (cycleScore?.strain as number) ?? 0;
    const strainPercent = Math.min((strain / 21) * 100, 100);
    const calories = cycleScore?.kilojoule != null ? Math.round(Number(cycleScore.kilojoule) / 4.184) : 0;

    const sleepScore = sleep_data?.score as Record<string, unknown> | undefined;
    const stageSummary = sleepScore?.stage_summary as Record<string, unknown> | undefined;
    const totalBedMs = stageSummary?.total_in_bed_time_milli as number | undefined;
    const sleepHours = totalBedMs != null ? (totalBedMs / 3600000).toFixed(1) : '0.0';
    const sleepEfficiency = sleepScore?.sleep_efficiency_percentage != null ? Math.round(Number(sleepScore.sleep_efficiency_percentage)) : 0;

    const rhrDisplay = rhr ?? null;
    const workoutName = workout?.sport_name ?? workout?.name ?? null;
    const maxHR = measurements?.max_heart_rate != null ? Number(measurements.max_heart_rate) : null;

    const r = 24;
    const c = 2 * Math.PI * r;
    const off = c - (score / 100) * c;
    return (
        <div className="card">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <span className="text-[11px] text-[var(--text-muted)]">Health</span>
                    <h3 className="text-[15px] font-semibold text-[var(--text)] mt-0.5">Whoop</h3>
                </div>
                <div className="relative w-12 h-12 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                        <circle cx="24" cy="24" r={r} stroke="var(--border)" strokeWidth="3" fill="transparent" />
                        <circle cx="24" cy="24" r={r} stroke={ringColor} strokeWidth="3" fill="transparent" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[12px] font-semibold" style={{ color: ringColor }}>{score}%</span>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[11px] text-[var(--text-muted)]">Sleep</span>
                        <span className="text-[13px] font-medium text-[var(--text)]">{sleep}%</span>
                    </div>
                    <div className="w-full h-1 bg-[var(--border)] rounded-full mb-1">
                        <div className="h-full rounded-full bg-[var(--text-muted)]" style={{ width: `${Math.min(sleep, 100)}%` }} />
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">{sleepHours}h · Eff {sleepEfficiency}%</div>
                </div>
                <div className="p-3 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <div className="flex justify-between items-end mb-1">
                        <span className="text-[11px] text-[var(--text-muted)]">Strain</span>
                        <span className="text-[13px] font-medium text-[var(--text)]">{strain.toFixed(1)}</span>
                    </div>
                    <div className="w-full h-1 bg-[var(--border)] rounded-full mb-1">
                        <div className="h-full rounded-full bg-[var(--text-muted)]" style={{ width: `${strainPercent}%` }} />
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">{calories} cal</div>
                </div>
            </div>
            {workoutName && (
                <div className="mt-3 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                    Last: <span className="text-[var(--text)] capitalize">{String(workoutName)}</span>
                </div>
            )}
            <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
                <span>HRV <span className="text-[var(--text)] font-medium">{Math.round(hrv)} ms</span></span>
                <span>RHR <span className="text-[var(--text)] font-medium">{rhrDisplay != null ? rhrDisplay : '—'}</span></span>
                {spo2 != null && <span>SpO2 <span className="text-[var(--text)]">{Number(spo2).toFixed(1)}%</span></span>}
                {skinTempCelsius != null && <span>Skin <span className="text-[var(--text)]">{Number(skinTempCelsius).toFixed(1)}°C</span></span>}
                {maxHR != null && <span>Max HR <span className="text-[var(--text)]">{maxHR}</span></span>}
            </div>
        </div>
    );
}
