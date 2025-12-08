export function Sidebar() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pluto</h1>
        <p className="text-sm text-slate-400">Personal agent prototype</p>
      </div>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Activity</h2>
        <p className="text-sm text-slate-300">Recent actions will appear here.</p>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Tasks</h2>
        <p className="text-sm text-slate-300">Pluto will list tasks extracted from Gmail.</p>
      </section>
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Gmail</h2>
        <p className="text-sm text-slate-300">Connect Gmail via the gateway OAuth flow.</p>
      </section>
    </div>
  );
}
