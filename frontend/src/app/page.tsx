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
      <>
        <div className="chat-stream">
          {messages.length === 0 ? (
            <p className="message-bubble assistant">
              &gt; Awaiting input… Pluto will synthesize context from Gmail and memory banks when available.
            </p>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} role={message.role} content={message.content} />
            ))
          )}
        </div>
        <form onSubmit={handleSubmit} className="chat-input-bar">
          <input
            type="text"
            value={input}
            placeholder="Transmit message…"
            onChange={(event) => setInput(event.target.value)}
            className="chat-input"
          />
          <button type="submit" disabled={isSending} className="chat-send">
            {isSending ? 'SENDING…' : 'SEND'}
          </button>
        </form>
      </>
    </ChatLayout>
  );
}
