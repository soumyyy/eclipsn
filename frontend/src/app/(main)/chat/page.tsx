'use client';

import { FormEvent, useState } from 'react';
import { MessageBubble } from '@/components/MessageBubble';
import { post } from '@/lib/apiClient';
import { useSessionGuard } from '@/hooks/useSessionGuard';

type Source = { title: string; url: string; snippet: string };
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  webSearchUsed?: boolean;
  isPlaceholder?: boolean;
};

export default function ChatPage() {
  const authorized = useSessionGuard();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  if (!authorized) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim()
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

    setMessages((prev) => [...prev, userMessage, placeholderMessage]);
    setInput('');
    setIsSending(true);

    try {
      const response = await post('chat', {
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
            />
          ))
        )}
      </div>
      <form onSubmit={handleSubmit} className="chat-input-bar flex-shrink-0">
        <div className="chat-input-wrap">
          <input
            type="text"
            value={input}
            placeholder="Message…"
            onChange={(e) => setInput(e.target.value)}
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
