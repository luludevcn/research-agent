"use client";

import { useRef, useState } from "react";

// ---------- 事件类型（与后端 ResearchEvent 对齐） ----------
type Evt =
  | { type: "start"; question: string }
  | { type: "plan"; plan: { subQuestions: { id: string; question: string; toolHint?: string }[] } }
  | { type: "subtask_start"; id: string; question: string }
  | { type: "thought"; subtaskId: string; content: string }
  | { type: "tool_call"; subtaskId: string; name: string; args: any }
  | { type: "tool_result"; subtaskId: string; name: string; result: any }
  | { type: "subtask_done"; id: string; answer: string }
  | { type: "report_delta"; text: string }
  | { type: "report_final"; content: string; citedCount: number }
  | { type: "done"; taskId?: string; report?: string }
  | { type: "error"; message: string }
  | {type: "replan", added: {question: string}}
  | {type: "timeout"}

// 渲染用：事件流里排除 report_*，报告单独面板展示
type TimelineEvt = Exclude<Evt, { type: "report_delta" } | { type: "report_final" }>;

export default function ResearchPage() {
  const [question, setQuestion] = useState("");
  const [events, setEvents] = useState<TimelineEvt[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 报告：流式原文 + 校验后最终版
  const [reportDraft, setReportDraft] = useState("");
  const [reportFinal, setReportFinal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  }

  async function run() {
    const q = question.trim();
    if (!q || running) return;

    // 重置
    setEvents([]);
    setError(null);
    setReportDraft("");
    setReportFinal(null);
    setCopied(false);
    setRunning(true);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // SSE 以 \n\n 分帧
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!raw || raw.startsWith(":")) continue; // 心跳注释
          const data = raw.replace(/^data:\s?/, "");
          if (data === "[DONE]") continue;

          let e: Evt;
          try {
            e = JSON.parse(data);
          } catch {
            continue;
          }
          handleEvent(e);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(e: Evt) {
    switch (e.type) {
      case "report_delta":
        setReportDraft((prev) => prev + e.text);
        return;
      case "report_final":
        setReportFinal(e.content);
        return;
      case "error":
        setError(e.message);
        break;
      case "replan":
        return <div className="text-purple-700">追加子任务：${e.added.question}</div>;
      case "timeout":
        return <div className="text-orange-600">达到时间上限，以已有活动汇总</div>;
      case "start":
        // 已在 run() 重置，这里只记录
        break;
      default:
        break;
    }
    // 其余事件进时间线
    setEvents((prev) => [...prev, e as TimelineEvt]);
    scrollToBottom();
  }

  const displayedReport = reportFinal ?? reportDraft;

  function copyReport() {
    if (!displayedReport) return;
    navigator.clipboard.writeText(displayedReport).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function exportMd() {
    if (!displayedReport) return;
    const blob = new Blob([displayedReport], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-report-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-3xl p-6 flex flex-col h-screen gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">AI Research Agent</h1>
        <span className="text-xs text-gray-400">Planner · Executor · Citation</span>
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
          placeholder="输入一个复杂问题，例如：比较 LangGraph 与 LangChain AgentExecutor"
          className="flex-1 border rounded-lg px-3 py-2"
          disabled={running}
        />
        <button
          onClick={run}
          disabled={running || !question.trim()}
          className="bg-black text-white px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {running ? "研究中…" : "开始研究"}
        </button>
      </div>

      {error && <div className="text-red-600 text-sm">错误：{error}</div>}

      {/* 执行时间线 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto border rounded-lg p-3 bg-gray-50 space-y-2 text-sm"
      >
        {events.length === 0 && !running && (
          <div className="text-gray-400">等待开始…</div>
        )}
        {events.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
        {running && <div className="text-gray-400 animate-pulse">…</div>}
      </div>

      {/* 报告面板 */}
      {(displayedReport || running) && (
        <div className="border rounded-lg p-4 bg-white max-h-[45vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-500">
              {reportFinal
                ? "最终报告（含参考文献）"
                : displayedReport
                ? "报告生成中…"
                : "等待报告…"}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyReport}
                disabled={!displayedReport}
                className="text-xs border rounded px-2 py-1 disabled:opacity-40"
              >
                {copied ? "已复制" : "复制"}
              </button>
              <button
                onClick={exportMd}
                disabled={!displayedReport}
                className="text-xs border rounded px-2 py-1 disabled:opacity-40"
              >
                导出 .md
              </button>
            </div>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {displayedReport}
            {!reportFinal && displayedReport && <span className="animate-pulse">▍</span>}
          </div>
        </div>
      )}
    </main>
  );
}

// ---------- 单条事件渲染 ----------
function EventRow({ e }: { e: TimelineEvt }) {
  switch (e.type) {
    case "start":
      return <div className="text-blue-600">▶ 开始：{e.question}</div>;

    case "plan":
      return (
        <div className="text-indigo-700">
          <div className="font-medium mb-1">🗺️ 研究计划</div>
          <ol className="list-decimal ml-5 text-xs space-y-0.5">
            {e.plan.subQuestions.map((s) => (
              <li key={s.id}>
                {s.question}
                {s.toolHint && <span className="text-gray-400">（{s.toolHint}）</span>}
              </li>
            ))}
          </ol>
        </div>
      );

    case "subtask_start":
      return (
        <div className="text-blue-600 font-medium">
          ▶ 子任务 {e.id}：{e.question}
        </div>
      );

    case "thought":
      return (
        <div className="text-gray-700 pl-3 border-l-2 border-gray-200">
          <span className="text-xs text-gray-400">[子任务 {e.subtaskId}] </span>
          💭 {e.content}
        </div>
      );

    case "tool_call":
      return (
        <div className="text-amber-700 pl-3">
          <span className="text-xs text-gray-400">[子任务 {e.subtaskId}] </span>
          🔧 调用 <span className="font-mono">{e.name}</span>
          <pre className="text-xs bg-amber-50 rounded p-1 mt-1 whitespace-pre-wrap">
            {JSON.stringify(e.args, null, 2)}
          </pre>
        </div>
      );

    case "tool_result":
      return (
        <div className="text-green-700 pl-3">
          <span className="text-xs text-gray-400">[子任务 {e.subtaskId}] </span>
          📄 <span className="font-mono">{e.name}</span> 返回
          <pre className="text-xs bg-green-50 rounded p-1 mt-1 max-h-32 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(e.result, null, 2)}
          </pre>
        </div>
      );

    case "subtask_done":
      return (
        <div className="text-green-800 font-medium">
          ✔ 子任务 {e.id} 完成
        </div>
      );

    case "done":
      return <div className="text-gray-500">🏁 完成</div>;

    case "error":
      return <div className="text-red-600">❌ {e.message}</div>;

    default:
      return null;
  }
}