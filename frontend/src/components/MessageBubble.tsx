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
  attachments?: Array<{ name: string; size: number }>;
  /** Preview URLs for image attachments (same order as attachments; undefined for non-images) */
  attachmentPreviews?: (string | undefined)[];
}

function isImageAttachment(name: string): boolean {
  const lower = name.toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some((ext) => lower.endsWith(ext));
}

function isPdfAttachment(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

function AttachmentIcon({ name }: { name: string }) {
  if (isPdfAttachment(name)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="message-attachment-icon">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h2" />
        <path d="M9 17h2" />
        <path d="M13 13h4" />
      </svg>
    );
  }
  if (isImageAttachment(name)) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="message-attachment-icon">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="message-attachment-icon">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function MessageBubble({
  role,
  content,
  sources,
  webSearchUsed,
  isPlaceholder,
  attachments,
  attachmentPreviews
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
          <>
            <MarkdownRenderer content={content} />
            {isUser && attachments && attachments.length > 0 && (
              <div className="message-attachments">
                {attachments.map((file, i) => {
                  const previewUrl = attachmentPreviews?.[i];
                  if (previewUrl && isImageAttachment(file.name)) {
                    return (
                      <div key={`${file.name}-${i}`} className="message-attachment-thumb-wrap">
                        <img
                          src={previewUrl}
                          alt={file.name}
                          className="message-attachment-thumb"
                          loading="lazy"
                        />
                      </div>
                    );
                  }
                  return (
                    <span key={`${file.name}-${i}`} className="message-attachment-item">
                      <AttachmentIcon name={file.name} />
                      <span className="message-attachment-name" title={file.name}>
                        {file.name}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </>
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
