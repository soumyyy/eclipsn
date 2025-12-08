export function Sidebar() {
  return (
    <div>
      <div>
        <h1>PLUTO</h1>
        <p className="text-accent">Operator Console</p>
      </div>
      <section className="sidebar-section">
        <h2>Activity</h2>
        <p>Awaiting mission data…</p>
      </section>
      <section className="sidebar-section">
        <h2>Tasks</h2>
        <p>Gmail-derived tasks will materialize here.</p>
      </section>
      <section className="sidebar-section">
        <h2>Gmail</h2>
        <p>Initiate OAuth linkup to ingest signals.</p>
      </section>
    </div>
  );
}
