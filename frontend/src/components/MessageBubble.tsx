import { MarkdownRenderer } from './MarkdownRenderer';

interface Source {
  title: string;
  url: string;
  snippet: string;
}

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  webSearchUsed?: boolean;
  isPlaceholder?: boolean;
}

export function MessageBubble({
  role,
  content,
  sources,
  webSearchUsed,
  isPlaceholder
}: MessageBubbleProps) {
  const isUser = role === 'user';
  const containerClass = `message-row ${isUser ? 'user' : 'assistant'}`;
  const bubbleClass = `message-bubble ${isUser ? 'user' : 'assistant'}`;

  const renderSources = !!(!isUser && (webSearchUsed || (sources && sources.length > 0)));

  return (
    <div className={containerClass}>
      <div className={bubbleClass}>
        {isPlaceholder && !isUser ? (
          <div className="thinking-dots" aria-label="Eclipsn is thinking">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <MarkdownRenderer content={content} />
        )}
        {/* <span className="message-label">{isUser ? 'USER' : 'Eclipsn'}</span> */}
        {renderSources && !isPlaceholder && (
          <div className="source-list">
            <div className="source-title">Sources</div>
            <div className="source-pill-container">
              {sources?.slice(0, 4).map((source) => {
                const shortTitle =
                  source.title.length > 40 ? `${source.title.slice(0, 37)}…` : source.title;
                return (
                  <a
                    key={source.url + source.title}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="source-pill"
                  >
                    {shortTitle}
                  </a>
                );
              })}
              {webSearchUsed && (
                <a
                  key="tavily-pill"
                  href="https://www.tavily.com"
                  target="_blank"
                  rel="noreferrer"
                  className={`source-pill ${isPlaceholder ? 'pending' : ''}`}
                >
                  {isPlaceholder ? 'Tavily AI (searching…)' : 'Tavily AI'}
                </a>
              )}
            </div>
            {/* {webSearchUsed && <div className="sources-note">* web</div>} */}
          </div>
        )}
      </div>
    </div>
  );
}
