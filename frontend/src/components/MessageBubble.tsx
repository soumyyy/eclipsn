interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  const containerClass = `message-row ${isUser ? 'user' : 'assistant'}`;
  const bubbleClass = `message-bubble ${isUser ? 'user' : 'assistant'}`;
  return (
    <div className={containerClass}>
      <div className={bubbleClass}>
        <p className="message-text">{content}</p>
        <span className="message-label">{isUser ? 'USER' : 'PLUTO'}</span>
      </div>
    </div>
  );
}
