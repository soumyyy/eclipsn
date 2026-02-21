'use client';

import { FormEvent, useState } from 'react';
import { ChatLayout } from '../components/ChatLayout';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { post } from '../lib/apiClient';
import { useSessionGuard } from '@/hooks/useSessionGuard';

type Source = {
  title: string;
  url: string;
  snippet: string;
};

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
    const expectsWeb = shouldSuggestWebSearch(userMessage.content);
    const historyPayload = messages
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
    const placeholderMessage: ChatMessage = {
      id: placeholderId,
      role: 'assistant',
      content: 'Eclipsn is thinking…',
      sources: [],
      isPlaceholder: true,
      webSearchUsed: expectsWeb
    };

    setMessages((prev) => [...prev, userMessage, placeholderMessage]);
    setInput('');
    setIsSending(true);

    try {
      const response = await post('chat', {
        message: userMessage.content,
        history: historyPayload
      });

      const assistantMessage: ChatMessage = {
        id: placeholderId,
        role: 'assistant',
        content: response.reply ?? 'Eclipsn is thinking...',
        sources: response.sources ?? [],
        webSearchUsed: response.web_search_used ?? false,
        isPlaceholder: false
      };

      setMessages((prev) =>
        prev.map((message) => (message.id === placeholderId ? assistantMessage : message))
      );
    } catch (error) {
      console.error('Failed to send chat', error);
      const errorMessage: ChatMessage = {
        id: placeholderId,
        role: 'assistant',
        content: 'Sorry, something went wrong talking to Eclipsn.',
        isPlaceholder: false
      };
      setMessages((prev) =>
        prev.map((message) => (message.id === placeholderId ? errorMessage : message))
      );
    } finally {
      setIsSending(false);
    }
  }

  const sidebar = <Sidebar />;
  return (
    <ChatLayout sidebar={sidebar}>
      <div className="chat-view">
        <div className="chat-stream">
          {messages.length === 0 ? (
            <div className="idle-state">
              <div className="idle-beacon" />
              <p className="idle-text">Awaiting transmission</p>
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
        <form onSubmit={handleSubmit} className="chat-input-bar">
          <div className="chat-input-bar-inner">
            <div className="chat-input-wrap">
              <input
                type="text"
                value={input}
                placeholder="Transmit message…"
                onChange={(event) => setInput(event.target.value)}
                className="chat-input"
              />
              <button type="submit" disabled={isSending} className="chat-send">
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </ChatLayout>
  );
}

function shouldSuggestWebSearch(message: string): boolean {
  const lowered = message.toLowerCase();
  const triggerTokens = [
    'news',
    'latest',
    'current',
    'today',
    'who is',
    'what is',
    'research',
    'search',
    'find',
    'report',
    'update',
    'movie',
    'film',
    'show',
    'release',
    'box office',
    'actor',
    'actress',
    'music',
    'stock',
    'price',
    'review'
  ];

  if (message.includes('?') || message.split(' ').length > 15) {
    return true;
  }
  return triggerTokens.some((token) => lowered.includes(token));
}
