'use client';

import { useState } from 'react';
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
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const isUser = role === 'user';
  const containerClass = `message-row ${isUser ? 'user' : 'assistant'}`;
  const bubbleClass = `message-bubble ${isUser ? 'user' : 'assistant'}`;

  const hasSources = !isUser && (webSearchUsed || (sources && sources.length > 0));
  const sourceCount = (sources?.length ?? 0) + (webSearchUsed ? 1 : 0);

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
        {hasSources && !isPlaceholder && (
          <div className="source-list">
            <button
              type="button"
              onClick={() => setSourcesOpen((o) => !o)}
              className="source-dropdown-trigger"
              aria-expanded={sourcesOpen}
            >
              {sourcesOpen ? 'Hide' : 'View'} sources {sourceCount > 0 && `(${sourceCount})`}
            </button>
            {sourcesOpen && (
              <div className="source-pill-container">
                {sources?.map((source) => {
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
                    className="source-pill"
                  >
                    Tavily AI
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
