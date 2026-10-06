"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  type: "chat" | "system";
  name?: string;
  text: string;
  time: number;
};

type ServerMessage = ChatMessage & {
  users?: string[];
};

function wsUrl() {
  return process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Chat() {
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"offline" | "connecting" | "online">(
    "offline",
  );
  const [users, setUsers] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const uniqueUsers = useMemo(
    () => Array.from(new Set(users)).sort((a, b) => a.localeCompare(b)),
    [users],
  );

  function connect(displayName: string) {
    socketRef.current?.close();
    setStatus("connecting");
    setMessages([]);

    const socket = new WebSocket(wsUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("online");
      socket.send(JSON.stringify({ type: "join", name: displayName }));
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as ServerMessage;
      if (data.users) {
        setUsers(data.users);
      }
      if (data.type === "chat" || data.type === "system") {
        setMessages((prev) => [
          ...prev,
          {
            type: data.type,
            name: data.name,
            text: data.text,
            time: data.time,
          },
        ]);
      }
    };

    socket.onerror = () => {
      setStatus("offline");
    };

    socket.onclose = () => {
      setStatus("offline");
    };
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setJoined(true);
    connect(trimmed);
  }

  function onSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const socket = socketRef.current;
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "chat", text }));
    setDraft("");
  }

  if (!joined) {
    return (
      <main className="flex h-dvh items-center justify-center px-6">
        <form
          onSubmit={onJoin}
          className="w-full max-w-sm space-y-8"
        >
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">
              webchat
            </p>
            <h1 className="text-3xl font-medium tracking-tight">Enter a name</h1>
            <p className="text-sm text-zinc-500">Then join the room.</p>
          </div>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="Your name"
            className="w-full border-b border-zinc-800 bg-transparent py-3 text-lg outline-none placeholder:text-zinc-600 focus:border-white"
          />
          <button
            type="submit"
            className="w-full rounded-full bg-white py-3 text-sm font-medium text-black transition hover:bg-zinc-200"
          >
            Join
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto grid h-dvh max-w-5xl grid-rows-[auto_1fr_auto] lg:grid-cols-[1fr_220px] lg:grid-rows-[auto_1fr_auto]">
      <header className="flex items-center justify-between border-b border-zinc-900 px-5 py-4 lg:col-span-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">
            webchat
          </p>
          <p className="mt-1 text-sm text-zinc-300">{name}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "online"
                ? "bg-emerald-400"
                : status === "connecting"
                  ? "bg-amber-400"
                  : "bg-zinc-600"
            }`}
          />
          {status}
        </div>
      </header>

      <div
        ref={listRef}
        className="overflow-y-auto px-5 py-6"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-600">No messages yet.</p>
        ) : (
          <ul className="space-y-5">
            {messages.map((msg, i) =>
              msg.type === "system" ? (
                <li
                  key={`${msg.time}-${i}`}
                  className="text-center text-xs text-zinc-600"
                >
                  {msg.text}
                </li>
              ) : (
                <li key={`${msg.time}-${i}`} className="max-w-2xl">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-sm font-medium">{msg.name}</span>
                    <span className="font-mono text-[11px] text-zinc-600">
                      {formatTime(msg.time)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">
                    {msg.text}
                  </p>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <aside className="hidden border-l border-zinc-900 px-5 py-6 lg:block">
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">
          online {uniqueUsers.length}
        </p>
        <ul className="mt-4 space-y-2">
          {uniqueUsers.map((user) => (
            <li key={user} className="text-sm text-zinc-400">
              {user}
            </li>
          ))}
        </ul>
      </aside>

      <form
        onSubmit={onSend}
        className="border-t border-zinc-900 p-4 lg:col-span-2"
      >
        <div className="flex gap-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              status === "online" ? "Write a message" : "Reconnecting…"
            }
            disabled={status !== "online"}
            className="flex-1 rounded-full border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status !== "online" || !draft.trim()}
            className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            Send
          </button>
        </div>
      </form>
    </main>
  );
}
