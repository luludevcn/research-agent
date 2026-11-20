import { runResearch } from "@/src/lib/agent/research";
import { prisma } from "@/src/lib/db/memory";
import { loadMcpTools } from "@/src/lib/tools/mcp-provider";
import { localTools } from "@/src/lib/tools/registry";
import {client, model} from "@/src/lib/llm/provider";
import "dotenv/config";
import path from "path";
import fs from "fs";

type Case = { id: string; level: string; question: string };

async function main() {
  const cases: Case[] = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), "src/evals/case.json"), "utf-8")
  );

  let tools = localTools;
  let mcp: any = null;
  if (process.env.USE_MCP === "1") {
    const loaded = await loadMcpTools();
    mcp = loaded.client;
    tools = loaded.tools;
  }

  const rows: any[] = [];

  for (const c of cases) {
    console.log(`\n=== ${c.id} [${c.level}] ${c.question}`);
    const t0 = Date.now();

    // 采集事件
    let planCount = 0;
    let subtasksDone = 0;
    let toolCalls = 0;
    let toolErrors = 0;
    let timedOut = false;
    let errored: string | null = null;

    let res: { taskId: string; report: string } | null = null;

    try {
      res = await runResearch({
        question: c.question,
        tools,
        onEvent: (e) => {
          switch (e.type) {
            case "plan": planCount = e.plan.subQuestions.length; break;
            case "subtask_end": subtasksDone++; break;
            case "tool_call": toolCalls++; break;
            case "tool_result": {
              const r = (e as any).result;
              if (r?.error) toolErrors++;
              break;
            }
            case "timeout": timedOut = true; break;
          }
        },
      });
    } catch (e) {
      errored = String(e);
    }

    const elapsed = (Date.now() - t0) / 1000;

    // 从库取 notes 算引用覆盖
    let noteCount = 0;
    let citedCount = 0;
    let judgeScore: number | null = null;

    if (res?.taskId) {
      const notes = await prisma.note.findMany({ where: { taskId: res.taskId } });
      noteCount = notes.length;
      const cited = new Set<number>();
      const re = /\[(\d+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(res.report))) cited.add(Number(m[1]));
      citedCount = [...cited].filter((n) => n >= 1 && n <= noteCount).length;
      judgeScore = await judge(c.question, res.report);
    }

    rows.push({
      id: c.id,
      level: c.level,
      planCount,
      subtasksDone,
      toolCalls,
      toolErrors,
      toolSuccessRate: toolCalls ? ((toolCalls - toolErrors) / toolCalls).toFixed(2) : "n/a",
      noteCount,
      citedCount,
      citationCoverage: noteCount ? (citedCount / noteCount).toFixed(2) : "n/a",
      judgeScore,
      elapsed: elapsed.toFixed(1),
      timedOut,
      errored: errored ? errored.slice(0, 80) : "",
    });

    console.log("  结果:", rows[rows.length - 1]);
  }

  await mcp?.close?.();
  await prisma.$disconnect();

  writeReport(rows);
}

/** LLM-as-judge：1–5 分 */
async function judge(question: string, report: string): Promise<number | null> {
  try {
    const res = await client.responses.create({
      model,
      instructions: "你是评审。给报告回答问题的质量打 1-5 分，只输出一个数字。1=完全没答，5=准确完整。",
      input: `问题：${question}\n\n报告：\n${report.slice(0, 3000)}`,
    });
    const n = parseInt((res.output_text ?? "").match(/[1-5]/)?.[0] ?? "", 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeReport(rows: any[]) {
  const lines: string[] = [];
  lines.push("# Evaluation Report\n");
  lines.push(`生成时间：${new Date().toISOString()}\n`);

  // 汇总
  const total = rows.length;
  const converged = rows.filter((r) => !r.errored && !r.timedOut).length;
  const avgElapsed = (rows.reduce((s, r) => s + Number(r.elapsed), 0) / total).toFixed(1);
  const covRows = rows.filter((r) => r.citationCoverage !== "n/a");
  const avgCov = covRows.length
    ? (covRows.reduce((s, r) => s + Number(r.citationCoverage), 0) / covRows.length).toFixed(2)
    : "n/a";
  const judgeRows = rows.filter((r) => r.judgeScore != null);
  const avgJudge = judgeRows.length
    ? (judgeRows.reduce((s, r) => s + r.judgeScore, 0) / judgeRows.length).toFixed(2)
    : "n/a";

  lines.push("## 汇总\n");
  lines.push(`- 用例数：${total}`);
  lines.push(`- 收敛率：${((converged / total) * 100).toFixed(0)}%`);
  lines.push(`- 平均耗时：${avgElapsed}s`);
  lines.push(`- 平均引用覆盖率：${avgCov}`);
  lines.push(`- 平均 judge 分：${avgJudge}\n`);

  // 明细表
  lines.push("## 明细\n");
  lines.push("| id | level | 计划 | 完成 | 工具 | 失败 | 成功率 | 来源 | 引用 | 覆盖 | judge | 耗时(s) | 备注 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.level} | ${r.planCount} | ${r.subtasksDone} | ${r.toolCalls} | ${r.toolErrors} | ${r.toolSuccessRate} | ${r.noteCount} | ${r.citedCount} | ${r.citationCoverage} | ${r.judgeScore ?? "-"} | ${r.elapsed} | ${r.timedOut ? "超时 " : ""}${r.errored ? "错误" : ""} |`
    );
  }

  const out = path.resolve(process.cwd(), "eval-report.md");
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`\n📄 报告已写入 ${out}`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); });