import ReactMarkdown from 'react-markdown';

export function BriefingCard({ data }: { data: { title: string; content: string } }) {
    return (
        <div className="relative">
            <div className="space-y-3">
                {/* Minimalist Header */}
                <div className="flex items-baseline gap-3">
                    <span className="text-[10px] uppercase tracking-widest text-white/30 font-mono">
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <h3 className="text-sm font-medium text-white/50 tracking-wide">
                        {data.title}
                    </h3>
                </div>

                {/* Content - Pure Text */}
                <div className="prose prose-invert prose-sm prose-headings:text-white/90 prose-headings:font-normal prose-p:text-white/70 prose-p:leading-relaxed prose-strong:text-white/90 prose-strong:font-medium prose-li:text-white/70 max-w-none">
                    <ReactMarkdown>{data.content}</ReactMarkdown>
                </div>
            </div>
        </div>
    );
}
