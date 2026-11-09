"use client";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ---------- 事件类型（与后端 ResearchEvent 对齐） ----------
type PlanStep = { id: string; question: string; toolHint: string };

type Evt =
  | { type: "start"; question: string }
  | { type: "plan"; plan: { subQuestions: PlanStep[] } }
  | { type: "subtask_start"; id: string; question: string }
  | { type: "thought"; subtaskId?: string; content: string }
  | { type: "tool_call"; subtaskId?: string; name: string; args: any }
  | { type: "tool_result"; subtaskId?: string; name: string; result: any }
  | { type: "subtask_done"; id: string; answer: string; notes: any[] }
  | { type: "report"; content: string }
  | { type: "done"; report?: string }
  | { type: "error"; message: string };

export default function ResearchPage() {
  const [question, setQuestion] = useState("");
  const [events, setEvents] = useState<Evt[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollBottom = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  };

  async function run() {
    const q = question.trim();
    if (!q || running) return;

    setEvents([]);
    setReport(null);
    setRunning(true);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!raw) continue;
          if (raw.startsWith(":")) continue; // 心跳

          const data = raw.startsWith("data:") ? raw.slice(5).trim() : raw;
          if (!data || data === "[DONE]") continue;

          try {
            const e = JSON.parse(data) as Evt;
            if (e.type === "report") setReport(e.content);
            if (e.type === "done" && e.report) setReport(e.report);
            setEvents((prev) => [...prev, e]);
            scrollBottom();
          } catch {
            // 非法帧忽略
          }
        }
      }
    } catch (e) {
      setEvents((p) => [...p, { type: "error", message: String(e) }]);
    } finally {
      setRunning(false);
      scrollBottom();
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6 flex flex-col h-screen gap-4">
      <header>
        <h1 className="text-xl font-semibold">AI Research Agent</h1>
        <p className="text-xs text-gray-500">
          Planner → Executor(逐子问题) → Aggregator，实时事件流
        </p>
      </header>

      {/* 输入区 */}
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run();
            }
          }}
          placeholder="输入一个复杂问题，例如：比较 LangGraph 与 LangChain AgentExecutor 的差异"
          className="flex-1 border rounded-lg px-3 py-2"
          disabled={running}
        />
        <button
          onClick={run}
          disabled={running}
          className="bg-black text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {running ? "研究中…" : "开始研究"}
        </button>
      </div>

      {/* 事件流 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto border rounded-lg p-3 bg-gray-50 space-y-2 text-sm"
      >
        {events.length === 0 && (
          <div className="text-gray-400">等待开始…</div>
        )}
        {events.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
        {running && <div className="text-gray-400 animate-pulse">…</div>}
      </div>

      {/* 报告区 */}
      {report && (
        <section className="border rounded-lg p-4 bg-white max-h-[45vh] overflow-y-auto">
          <div className="text-xs text-gray-500 mb-2">最终报告</div>
          <article className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
          </article>
        </section>
      )}
    </main>
  );
}

// ---------- 单条事件渲染 ----------
function EventRow({ e }: { e: Evt }) {
  switch (e.type) {
    case "start":
      return (
        <div className="text-blue-700 font-medium">
          ▶ 开始：{e.question}
        </div>
      );

    case "plan":
      return (
        <div className="text-indigo-700">
          <div className="font-medium mb-1">🗺️ 研究计划</div>
          <ol className="list-decimal ml-5 text-xs space-y-1">
            {e.plan.subQuestions.map((s) => (
              <li key={s.id}>
                {s.question}{" "}
                <span className="text-gray-400">({s.toolHint})</span>
              </li>
            ))}
          </ol>
        </div>
      );

    case "subtask_start":
      return (
        <div className="text-blue-700 font-medium mt-2">
          ▶ 子任务 {e.id}：{e.question}
        </div>
      );

    case "thought":
      return (
        <div className="text-gray-700">
          {e.subtaskId && (
            <span className="text-gray-400 mr-1">[{e.subtaskId}]</span>
          )}
          <span className="font-medium">💭 思考：</span>
          {e.content}
        </div>
      );

    case "tool_call":
      return (
        <div className="text-amber-700">
          {e.subtaskId && (
            <span className="text-gray-400 mr-1">[{e.subtaskId}]</span>
          )}
          <span className="font-medium">🔧 调用 {e.name}</span>
          <pre className="text-xs bg-amber-50 rounded p-1 mt-1 whitespace-pre-wrap break-all">
            {JSON.stringify(e.args, null, 2)}
          </pre>
        </div>
      );

    case "tool_result":
      return (
        <div className="text-green-700">
          {e.subtaskId && (
            <span className="text-gray-400 mr-1">[{e.subtaskId}]</span>
          )}
          <span className="font-medium">📄 {e.name} 返回</span>
          <pre className="text-xs bg-green-50 rounded p-1 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(e.result, null, 2)}
          </pre>
        </div>
      );

    case "subtask_done":
      return (
        <div className="text-green-800">
          ✔ 子任务 {e.id} 完成（{e.notes.length} 条来源）
          {e.answer && (
            <pre className="text-xs bg-white border rounded p-1 mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
              {e.answer}
            </pre>
          )}
        </div>
      );

    case "report":
      return (
        <div className="text-gray-900 font-medium">📝 报告已生成</div>
      );

    case "done":
      return <div className="text-gray-500">🏁 完成</div>;

    case "error":
      return <div className="text-red-600">❌ {e.message}</div>;

    default:
      return null;
  }
}