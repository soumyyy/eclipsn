# Eclipsn – Project Report

**What Eclipsn can achieve, how it works for users, and how it’s built to scale**

---

## 1. What Eclipsn Is

**Eclipsn** is a personal AI agent that acts like a single-user assistant: part Alfred, part Friday, part JARVIS. You talk to it in natural language, and it uses everything it knows about you—your saved memories, your email, your profile, and the web—to answer, remember, and help.

The product is **chat-first**: the main experience is a conversation. Behind that conversation, Eclipsn can save what you tell it, search your Gmail by meaning (not just keywords), look things up on the web when needed, and (optionally) use health data from Whoop to give tailored advice. All of this is wired together through **LangChain** in the “brain” so that one conversation can call on memory, email, search, and profile in a single flow.

---

## 2. What Eclipsn Can Achieve

### For the user

- **Talk naturally.** Ask questions, give instructions, or share personal details. Eclipsn replies in a clear, friendly way and can cite where it got information (e.g. “According to …” or “From your email …”).
- **Remember and forget.** You can say “remember this” or “save this” and Eclipsn stores it. Later you can ask “what do you know about X?” and it recalls. When you say “forget that,” it finds the right memory and removes it.
- **Use your email.** After you connect Gmail, Eclipsn can summarize recent mail, search by topic or sender, and pull in the full content of a thread when you ask about a specific email. It can also work with secondary inboxes (e.g. a college or work account) if you connect them.
- **Use the web.** For questions that need up-to-date information (news, facts, reviews), Eclipsn can search the web and summarize results, and show you which sources it used.
- **Use links you send.** If you paste a URL or domain, Eclipsn gets the page content and answers from that page instead of doing a generic web search.
- **Know who you are.** Your profile (name, timezone, notes) and saved memories form a stable picture of you. Eclipsn uses this to personalize answers and to store new facts when you share them.
- **Create tasks.** You can ask Eclipsn to add a task or reminder; it creates it and it can show up in your feed and task list.
- **Optional: health context.** If you connect Whoop, Eclipsn can use recovery, sleep, workout, and related data to give fitness and recovery advice in the same chat.

### In one sentence

Eclipsn gives you one place to chat, remember, search email, search the web, and manage profile and tasks—with memory and email search powered by the same brain that runs the conversation.

---

## 3. How Features Are Useable

### Chat

You type (or speak, if the UI supports it) in a single bar at the bottom of the screen. Messages appear as bubbles: yours on one side, Eclipsn’s on the other. Replies can include lists, links, and simple formatting. When Eclipsn used the web or your email, you see a “sources” section so you can check where the answer came from. The bar stays fixed at the bottom so you can scroll through long threads without losing the input.

### Memory: save, recall, forget

- **Save:** Say “remember that I’m from Boston” or “save this: my mom’s name is Namrata.” Eclipsn confirms when it has stored the fact. You don’t have to use a separate form; saving happens in the same chat.
- **Recall:** Ask “what do you know about my family?” or “what have I told you about work?” Eclipsn looks up relevant memories and answers in context. For very broad questions (“summarize everything you know about me”), it can return a condensed overview so the answer stays useful.
- **Forget:** Say “forget that” or “delete that about my mom.” Eclipsn finds the matching memory and removes it. You can also manage saved memories in Settings (list, search, delete by item) so power users have a direct way to control what’s stored.

Memory is **usable** because it’s part of the conversation: no separate “memory app”—you remember and forget in the same place you chat.

### Gmail

You connect Gmail once (OAuth). After that, Eclipsn can:

- Summarize what’s new (“what’s in my inbox?”, “what did I get from X?”).
- Answer questions like “find emails about the project” or “what did Sarah say about the meeting?” by searching mail by meaning, not just keywords.
- Open a specific thread when you ask for the contents of an email.

Gmail is **useable** because you don’t leave the chat: you ask in plain language and Eclipsn uses your mail to answer. Secondary inboxes (e.g. college email) work the same way once connected.

### Profile and tasks

- **Profile:** Your name, timezone, and free-form notes live in a profile. You can edit them in a profile/settings modal. When you tell Eclipsn something in chat (“I’m in IST”), it can update your profile so future answers are time-aware and consistent.
- **Tasks:** You say “add a task: reply to the client” or “remind me to buy milk.” Eclipsn creates the task; it appears in your feed/task list so you have one place for reminders and follow-ups.

### Attachments (images and PDFs)

You can attach images or PDFs to a message (e.g. drag-and-drop or paste). Eclipsn “sees” the content and can answer questions about it, summarize it, or pull facts from it. Attachments are shown as thumbnails or pills in the composer so you know what you’re sending before you hit send.

### Web and links

- **Web search:** For questions that need live information, Eclipsn can search the web and summarize results, with sources listed.
- **Link context:** When you paste a URL, Eclipsn fetches that page and uses it as the main source for the answer, so you get answers “from this article/site” instead of a generic search.

---

## 4. The User Interface

### Layout

- **Main view:** A large chat area in the center. On the left, a sidebar gives quick access to “Today / Feed,” “Memories,” “Index” (uploaded documents), and settings. Your profile (avatar and name) sits at the bottom of the sidebar; clicking it opens the profile modal.
- **Chat area:** Messages scroll from top to bottom. When there are no messages, a short line like “Awaiting transmission” or “Ask anything” invites you to start. The typing bar is fixed at the bottom so it’s always visible.

### Typing bar

- One rounded bar at the bottom with a text field and a send button. You can attach files (images, PDFs) via a paperclip or by pasting/dragging; attachments appear as small thumbnails or file pills above the bar, with the option to remove any of them before sending. There is no heavy “section line” above the bar—just a clean, minimal bar so the focus stays on the conversation.

### Messages and sources

- Your messages and Eclipsn’s replies appear as bubbles. Eclipsn’s replies can include formatted text and lists. When Eclipsn used the web or your email, a “View sources” control expands to show the links or labels so you can trust and verify the answer.

### Profile and memories in the UI

- **Profile modal:** Opens from the sidebar. Tabs for Profile (name, timezone, bio, etc.), Saved Memories (list of what Eclipsn has stored), Connections (Gmail, Whoop, etc.), and Settings. Saving a memory in chat can refresh the Saved Memories list so you see the new item without leaving the modal.
- **Settings / Memories:** A dedicated area to search and delete saved memories. This gives full control over what Eclipsn “knows” and supports privacy (e.g. “forget everything about X”).

The UI is built so that **chat is the main action** and memory, profile, and tasks are reachable from the same place—either by talking or by a short trip to the sidebar and modals.

---

## 5. Memory: How It Works for Users

### One memory layer

Eclipsn doesn’t have three separate “memories.” From your point of view there is **one** place it “remembers” from:

- Things you asked it to save in chat (“remember this”).
- Facts pulled automatically from your Gmail and documents (e.g. “Eclipsn learned from your email that …”).
- Your profile (name, timezone, notes).

When you ask “what do you know about X?”, Eclipsn looks across all of these and merges the best matches so you get one coherent answer. You don’t have to think “was that in Gmail or in a saved note?”—you just ask.

### Save

- You say what to save in plain language. Eclipsn turns it into a stored memory and confirms (e.g. “Stored.”). If something goes wrong (e.g. empty content), it says so instead of pretending it saved.

### Recall

- You ask in natural language. Eclipsn decides whether to do a broad “context” pull (e.g. “what do you know about me?”) or a targeted lookup (“what do you know about my mom?”) and returns an answer grounded in what it found. Sources (e.g. “from your saved memory” vs “from your email”) can be reflected in the answer or in the sources section.

### Forget

- You say “forget that” or point at a topic. Eclipsn finds the right memory (or note) and deletes it. In Settings you can also search memories and delete by item. So memory is **controllable**: you can scale up what Eclipsn knows and scale it back when you want something removed.

---

## 6. How Everything Is Wired via LangChain

Eclipsn’s “brain” is built around **LangChain**. LangChain doesn’t show up in the UI—it’s the layer that makes one conversation able to use memory, Gmail, web search, profile, and tasks without you switching apps or screens.

### One agent, many tools

- **Conversation** is handled by a single LangChain-powered agent. You send one message; the agent can:
  - Call the **memory** tools (save, lookup, forget, or get a broad context).
  - Call **Gmail** (inbox summary, semantic search, or fetch a thread).
  - Call **web search** when the question needs live or general knowledge.
  - Call **profile** to update your name, timezone, or notes.
  - Call **tasks** to create a reminder.
  - Optionally call **Whoop** for recovery, sleep, or workout data.

So “how is it wired?”—**through one agent that chooses which tools to use for each turn.** LangChain provides the agent loop (reason, call tool, get result, reason again or reply), so the same chat can seamlessly mix memory, email, and web.

### Memory and embeddings

- Stored memories and email are searchable **by meaning**. LangChain is used with an embeddings model (e.g. OpenAI) so that:
  - When you save “my mom is Namrata,” it’s stored in a way that later queries about “mother” or “family” can find it.
  - When you ask “emails about the project,” the system finds relevant threads by semantic similarity, not just keyword match.

So memory and Gmail are wired into the agent **through embeddings and retrieval** that LangChain orchestrates (e.g. prompt templates, tool definitions, and the same embeddings stack for user memories and email).

### Extraction and growth

- Eclipsn can also **extract** facts from your Gmail and uploaded documents into the same memory store. That pipeline (what to extract, how to score it, when to run it) uses LangChain-style components (e.g. LLM calls for summarization or classification) so that the “brain” can grow what it knows from your data, not only from what you explicitly say in chat.

In short: **LangChain wires the conversation to memory, Gmail, web, profile, and tasks** so that one interface can achieve all of the outcomes above without separate tools or windows.

---

## 7. How It Can Scale

### Product and usage

- **More users:** The app is built in three layers (frontend, gateway, brain). Each can scale independently: more frontend instances, more gateway instances behind a load balancer, and more brain workers for chat and indexing. Session and auth live in the gateway; the brain is stateless per request, so horizontal scaling is straightforward.
- **More memory:** Memories and email are stored in a database with vector support so that as the number of memories or threads grows, search stays efficient. The same design (one memory layer, one agent) works for 100 or 100,000 memories; only capacity and indexing (e.g. background jobs) need to be sized.
- **More sources:** Today the agent uses memory, Gmail, web, profile, and tasks. New “tools” (e.g. calendar, another email provider, another API) can be added as additional tools the same LangChain agent can call. The UI stays one chat; the brain gains new capabilities without a redesign.
- **More data sources for memory:** Extraction today runs over Gmail and uploaded documents. The same idea (fetch candidates, score, store in the same memory layer) can be extended to more sources (e.g. notes app, calendar events) so that “what Eclipsn knows” scales with your data, not only with what you type in chat.

### UI and experience

- The UI is already built around one main chat and a sidebar. New features (e.g. a new connection type or a new feed card type) can be added as new panels or modals without changing the core flow. The typing bar, message bubbles, and sources pattern stay the same.

So **scaling** here means: more users (horizontal scaling of each layer), more memory and more sources (same architecture, larger data and more tools), and more product features (new tools and new UI panels) without rewiring the core “one chat, one agent, one memory layer” idea.

---

## 8. Summary

- **Eclipsn** is a personal AI agent that achieves: natural chat, save/recall/forget memory, Gmail-aware answers, web search, link-based answers, profile and tasks, optional health (Whoop), and attachments—all from one interface.
- **Features are useable** because they live in the same conversation (memory, email, web, profile, tasks) and in a simple UI (chat + sidebar + profile/settings), with a fixed typing bar and clear sources.
- **Memory** is one layer: you save and forget in chat or in Settings; Eclipsn recalls from saved memories, profile, and (when relevant) email in a single, merged answer.
- **Everything is wired via LangChain** in the brain: one agent, many tools (memory, Gmail, web, profile, tasks, Whoop), with embeddings and retrieval so that conversation, memory, and email search are one system.
- **It can scale** in users, in memory size, in data sources, and in new tools, without changing the idea that “one chat, one agent, one memory” is how Eclipsn achieves what it does.
