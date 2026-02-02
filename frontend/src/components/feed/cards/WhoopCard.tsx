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
        if (s >= 67) return '#2ea084'; // Greenish
        if (s >= 34) return '#d4a017'; // Yellowish
        return '#cf3b3b'; // Reddish
    };

    const ringColor = getRecoveryColor(score);
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;

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

    return (
        <div className="group relative p-5 rounded-xl bg-gradient-to-br from-primary/5 to-black border border-primary/20 hover:border-primary/40 transition-all duration-300 shadow-lg shadow-black/50 overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div>
                    <span className="px-2 py-0.5 rounded-full bg-primary/10 text-[10px] text-primary/60 font-mono tracking-wider uppercase border border-primary/20 mb-1 inline-block">
                        Health
                    </span>
                    <h3 className="text-lg font-bold text-white tracking-tight">Whoop Metrics</h3>
                    <span className="text-[10px] text-white/30 font-mono">{new Date().toLocaleDateString()}</span>
                </div>

                {/* Recovery Ring (Right Top) */}
                <div className="relative w-16 h-16 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90">
                        <circle cx="32" cy="32" r={radius} stroke="currentColor" strokeWidth="4" fill="transparent" className="text-white/5" />
                        <circle cx="32" cy="32" r={radius} stroke={ringColor} strokeWidth="4" fill="transparent" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-1000 ease-out" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-sm font-bold" style={{ color: ringColor }}>{score}%</span>
                        <span className="text-[8px] text-white/40 uppercase">Rec</span>
                    </div>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-4">
                {/* Sleep Section */}
                <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-[10px] uppercase text-white/40 font-bold">Sleep</span>
                        <span className="text-xs font-mono text-blue-400">{sleep}%</span>
                    </div>
                    <div className="w-full h-1 bg-white/10 rounded-full mb-2">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(sleep, 100)}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-white/50">
                        <span>{sleepHours} hrs</span>
                        <span>Eff: {sleepEfficiency}%</span>
                    </div>
                </div>

                {/* Strain Section */}
                <div className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-[10px] uppercase text-white/40 font-bold">Strain</span>
                        <span className="text-xs font-mono text-blue-500">{strain.toFixed(1)}</span>
                    </div>
                    <div className="w-full h-1 bg-white/10 rounded-full mb-2">
                        <div className="h-full bg-blue-600 rounded-full" style={{ width: `${strainPercent}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-white/50">
                        <span>{calories} cal</span>
                        <span>{strain > 14 ? 'High' : 'Normal'}</span>
                    </div>
                </div>
            </div>

            {/* Last Workout (if available) */}
            {workoutName && (
                <div className="mt-3 pt-3 border-t border-white/5 text-[10px] text-white/50">
                    Last: <span className="text-white/70 capitalize">{String(workoutName)}</span>
                </div>
            )}

            {/* Recovery metrics: HRV, RHR (from Whoop recovery API) */}
            <div className="mt-4 pt-3 border-t border-white/5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
                <span>HRV: <span className="text-white/70 font-mono">{Math.round(hrv)} ms</span></span>
                <span>RHR: <span className="text-white/70 font-mono">{rhrDisplay != null ? rhrDisplay : '—'}</span></span>
                {spo2 != null && (
                    <span>SpO2: <span className="text-white/70 font-mono">{Number(spo2).toFixed(1)}%</span></span>
                )}
                {skinTempCelsius != null && (
                    <span>Skin: <span className="text-white/70 font-mono">{Number(skinTempCelsius).toFixed(1)}°C</span></span>
                )}
                {maxHR != null && (
                    <span>Max HR: <span className="text-white/70 font-mono">{maxHR}</span></span>
                )}
            </div>
        </div>
    );
}
