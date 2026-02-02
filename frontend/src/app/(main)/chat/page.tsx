'use client';

import { ClipboardEvent, DragEvent, FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import { MessageBubble } from '@/components/MessageBubble';
import { post, postForm } from '@/lib/apiClient';
import { useSessionGuard } from '@/hooks/useSessionGuard';

type Source = { title: string; url: string; snippet: string };
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  webSearchUsed?: boolean;
  isPlaceholder?: boolean;
  attachments?: Array<{ name: string; size: number }>;
};

type QueuedAttachment = {
  file: File;
  previewUrl?: string;
  kind: 'image' | 'pdf' | 'other';
};

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];

function isAllowedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some((ext) => lower.endsWith(ext));
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="attachment-pill-icon">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h2" />
      <path d="M9 17h2" />
      <path d="M13 13h4" />
    </svg>
  );
}

function ImageThumb({ src, alt, onRemove }: { src: string; alt: string; onRemove: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="attachment-thumb-wrap">
        <div className="attachment-thumb-fallback">Image</div>
        <button type="button" className="attachment-thumb-remove" onClick={onRemove} aria-label="Remove attachment">
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="attachment-thumb-wrap">
      <img
        src={src}
        alt={alt}
        className="attachment-thumb"
        onError={() => setFailed(true)}
        loading="lazy"
      />
      <button type="button" className="attachment-thumb-remove" onClick={onRemove} aria-label="Remove attachment">
        ×
      </button>
    </div>
  );
}

export default function ChatPage() {
  const authorized = useSessionGuard();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<QueuedAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAttachmentSelect = useCallback((files: File[]) => {
    const next = files.filter((file) => isAllowedFile(file.name));
    if (!next.length) return;
    const mapped = next.map((file) => {
      const isImage = file.type.startsWith('image/');
      return {
        file,
        kind: isImage ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'other',
        previewUrl: isImage ? URL.createObjectURL(file) : undefined
      };
    });
    setAttachments((prev) => [...prev, ...mapped]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const item = prev[index];
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const items = event.clipboardData?.files;
      if (!items || items.length === 0) return;
      handleAttachmentSelect(Array.from(items));
    },
    [handleAttachmentSelect]
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) handleAttachmentSelect(files);
    },
    [handleAttachmentSelect]
  );
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const imagePreviews = useMemo(
    () => attachments.filter((item) => item.kind === 'image' && item.previewUrl),
    [attachments]
  );
  const nonImageAttachments = useMemo(
    () => attachments.filter((item) => item.kind !== 'image'),
    [attachments]
  );

  if (!authorized) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() && attachments.length === 0) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim() || 'Shared an attachment.',
      attachments: attachments.map((item) => ({ name: item.file.name, size: item.file.size }))
    };
    const placeholderId = crypto.randomUUID();
    const historyPayload = messages.slice(-6).map(({ role, content }) => ({ role, content }));
    const placeholderMessage: ChatMessage = {
      id: placeholderId,
      role: 'assistant',
      content: 'Thinking…',
      sources: [],
      isPlaceholder: true,
      webSearchUsed: false
    };

    const filesToSend = attachments.map((item) => item.file);
    setMessages((prev) => [...prev, userMessage, placeholderMessage]);
    setInput('');
    attachments.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setAttachments([]);
    setIsSending(true);

    try {
      const response =
        userMessage.attachments && userMessage.attachments.length > 0
          ? await (() => {
              const formData = new FormData();
              formData.append('message', userMessage.content);
              formData.append('history', JSON.stringify(historyPayload));
              filesToSend.forEach((file) => {
                formData.append('attachments', file, file.name);
              });
              return postForm('chat', formData);
            })()
          : await post('chat', {
              message: userMessage.content,
              history: historyPayload
            });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                content: response.reply ?? '…',
                sources: response.sources ?? [],
                webSearchUsed: response.web_search_used ?? false,
                isPlaceholder: false
              }
            : m
        )
      );
      if (response.memories_saved === true || (response.used_tools && response.used_tools.includes('memory_save'))) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('memories-saved'));
        }
      }
    } catch (error) {
      console.error('Chat error', error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, content: 'Something went wrong. Try again.', isPlaceholder: false }
            : m
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chat-view flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="chat-stream flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {messages.length === 0 ? (
          <div className="idle-state">
            <p className="idle-text">Ask anything</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
              sources={message.sources}
              webSearchUsed={message.webSearchUsed}
              isPlaceholder={message.isPlaceholder}
              attachments={message.attachments}
            />
          ))
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className={`chat-input-bar flex-shrink-0 ${dragOver ? 'chat-input-bar-dragover' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {attachments.length > 0 && (
          <div className="chat-attachment-queue">
            {imagePreviews.map((item) => {
              const globalIndex = attachments.findIndex((a) => a === item);
              return (
                <ImageThumb
                  key={`img-${globalIndex}-${item.file.name}`}
                  src={item.previewUrl!}
                  alt={item.file.name}
                  onRemove={() => removeAttachment(globalIndex)}
                />
              );
            })}
            {nonImageAttachments.map((item) => {
              const globalIndex = attachments.findIndex((a) => a === item);
              return (
                <div key={`pill-${globalIndex}-${item.file.name}`} className="attachment-pill-wrap">
                  <PdfIcon />
                  <span className="attachment-pill-name" title={item.file.name}>
                    {item.file.name}
                  </span>
                  <button
                    type="button"
                    className="attachment-pill-remove"
                    onClick={() => removeAttachment(globalIndex)}
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="chat-input-wrap">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="chat-attachment-input"
            onChange={(e) => {
              handleAttachmentSelect(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="chat-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            aria-label="Add attachment"
            title="Add attachment (images, PDF)"
          >
            <AttachIcon />
          </button>
          <input
            type="text"
            value={input}
            placeholder="Message…"
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            className="chat-input"
          />
          <button type="submit" disabled={isSending} className="chat-send">
            {isSending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
