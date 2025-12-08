'use client';

import { FormEvent, useState } from 'react';
import { ChatLayout } from '../components/ChatLayout';
import { Sidebar } from '../components/Sidebar';
import { MessageBubble } from '../components/MessageBubble';
import { post } from '../lib/apiClient';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsSending(true);

    try {
      const response = await post('/api/chat', {
        message: userMessage.content
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.reply ?? 'Pluto is thinking...'
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send chat', error);
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, something went wrong talking to Pluto.'
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }

  const sidebar = <Sidebar />;
  return (
    <ChatLayout sidebar={sidebar}>
      <div className="flex h-screen flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto bg-slate-950 p-6">
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">
              Start a conversation and Pluto will fetch context from Gmail and memories when
              available.
            </p>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} role={message.role} content={message.content} />
            ))
          )}
        </div>
        <form
          onSubmit={handleSubmit}
          className="border-t border-slate-900 bg-slate-900 p-4"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              placeholder="Ask Pluto anything..."
              onChange={(event) => setInput(event.target.value)}
              className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </ChatLayout>
  );
}
