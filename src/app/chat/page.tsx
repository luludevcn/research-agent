"use client";
import { useState } from "react";

type Role = "user" | "assistant";
type Msg = { role: Role; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Msg = { role: "user", content: text };
    const history = [...messages, userMsg];

    // 先占位一条 assistant 空消息，后续逐字填充
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 只传对话历史（不含占位的空 assistant）
          messages: history,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // 逐块读取 SSE
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 以 \n\n 分隔事件
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleSSELine(raw);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleSSELine(raw: string) {
    // raw 形如 "data: {...}" 或 "data: [DONE]"
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    const data = line.replace(/^data:\s?/, "");
    if (!data || data === "[DONE]") return;

    let evt: any;
    try { evt = JSON.parse(data); } catch { return; }

    if (evt.type === "delta" && typeof evt.text === "string") {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: last.content + evt.text };
        }
        return copy;
      });
    } else if (evt.type === "error") {
      setError(evt.message ?? "stream error");
    }
    // done 事件可忽略，[DONE] 已兜底
  }

  return (
    <main className="mx-auto max-w-2xl p-6 flex flex-col h-screen">
      <h1 className="text-xl font-semibold mb-1">M1 · Responses API 流式对话</h1>
      <p className="text-xs text-gray-500 mb-4">
        事件协议：response.output_text.delta → 前端逐字渲染
      </p>

      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg whitespace-pre-wrap ${
              m.role === "user" ? "bg-blue-50 ml-12" : "bg-gray-100 mr-12"
            }`}
          >
            <div className="text-xs text-gray-500 mb-1">{m.role}</div>
            {m.content || (loading && m.role === "assistant" ? "▍" : "")}
          </div>
        ))}
        {error && <div className="text-red-500 text-sm">错误：{error}</div>}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="问点什么…（Enter 发送）"
          className="flex-1 border rounded-lg px-3 py-2"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading}
          className="bg-black text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {loading ? "生成中…" : "发送"}
        </button>
      </div>
    </main>
  );
}