"use client";

import { useEffect, useRef, useState } from "react";
import { ENERGY_LIMIT_ERROR_CODE } from "@/components/EnergyLimitWatcher";

const SUGGESTIONS = [
  "Top 5 shows for me right now",
  "Something funny, under 2 hours",
  "I'm feeling a bit down tonight, what should I watch?",
];

export default function ChatPageClient({ initialMessages }) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const windowRef = useRef(null);

  // "Clear chat" asks for confirmation first - same reasoning as deleting a
  // rating elsewhere in the app: it's destructive (wipes the AI's memory of
  // the conversation too, not just what's on screen - see the DELETE
  // handler's comment in app/api/chat/route.js) and can't be undone.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (windowRef.current) {
      windowRef.current.scrollTop = windowRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setError("");
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Already communicated by the global EnergyLimitWatcher modal -
        // don't also show its raw machine code as an inline error here.
        if (data.error === ENERGY_LIMIT_ERROR_CODE) return;
        throw new Error(data.error || "The chatbot ran into a problem.");
      }
      setMessages((prev) => [...prev, { id: `reply-${Date.now()}`, role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function confirmClear() {
    setClearing(true);
    setError("");
    try {
      const res = await fetch("/api/chat", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not clear the chat.");
      setMessages([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  }

  return (
    <>
      {messages.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <button className="btn btn-outline" onClick={() => setConfirmingClear(true)}>
            Clear chat
          </button>
        </div>
      )}

      {confirmingClear && (
        <div className="modal-backdrop" onClick={() => !clearing && setConfirmingClear(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Clear this conversation?</h3>
            <p className="muted" style={{ marginBottom: 16 }}>
              This deletes the whole chat history - not just what&apos;s on screen. The AI won&apos;t remember
              anything from this conversation afterward. Your ratings, wishlist, and taste profile aren&apos;t
              affected. This can&apos;t be undone.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button className="btn btn-danger-outline" onClick={confirmClear} disabled={clearing}>
                {clearing ? "Clearing..." : "Clear chat"}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirmingClear(false)} disabled={clearing}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="chat-window" ref={windowRef}>
        {messages.length === 0 && (
          <div className="chat-bubble assistant">
            Hey! Want a recommendation, or want to tell me about something you just watched?
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {sending && <div className="chat-bubble assistant">...</div>}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="chip-row">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip chip-add" onClick={() => sendMessage(s)}>
            &quot;{s}&quot;
          </button>
        ))}
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
      >
        <input type="text" placeholder="Type a message..." value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={sending}>
          Send
        </button>
      </form>
    </>
  );
}
