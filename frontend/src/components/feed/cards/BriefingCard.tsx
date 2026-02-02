import ReactMarkdown from 'react-markdown';

export function BriefingCard({ data }: { data: { title: string; content: string } }) {
    return (
        <article className="card">
            <div className="flex items-baseline gap-2 mb-3">
                <span className="text-[12px] text-[var(--text-muted)]">
                    {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <h3 className="text-[15px] font-semibold text-[var(--text)]">{data.title}</h3>
            </div>
            <div className="prose prose-invert prose-sm max-w-none text-[var(--text)] prose-p:text-[var(--dutch-white-soft)] prose-p:leading-relaxed prose-strong:text-[var(--text)] prose-li:text-[var(--dutch-white-soft)]">
                <ReactMarkdown>{data.content}</ReactMarkdown>
            </div>
        </article>
    );
}
