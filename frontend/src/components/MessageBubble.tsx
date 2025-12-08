interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-xl rounded-2xl px-4 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-slate-800 text-slate-100'
        }`}
      >
        <p className="whitespace-pre-line">{content}</p>
        <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-300 opacity-70">
          {isUser ? 'You' : 'Pluto'}
        </span>
      </div>
    </div>
  );
}
