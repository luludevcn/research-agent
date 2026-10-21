# Research Agent

基于 Next.js、LangGraph 与 Vercel AI SDK 构建的研究型 Agent。项目采用分层架构：LangGraph 负责研究流程编排与状态恢复，AI SDK 负责模型调用、工具循环和流式交互。

> 本文描述目标架构与实施路线。具体依赖版本、模型服务和功能状态应以项目实际配置及后续里程碑验收结果为准。

## 目录

- [项目目标](#项目目标)
- [架构与职责边界](#架构与职责边界)
- [研究流程](#研究流程)
- [技术选型](#技术选型)
- [实施路线](#实施路线)
- [M0：基础验证](#m0基础验证)
- [待确认事项](#待确认事项)

## 项目目标

- 接入本地 Qwen2.5 模型，验证文本生成与工具调用。
- 实现从问题规划、资料收集到报告生成的研究流程。
- 支持流式交互、引用管理和业务数据持久化。
- 使用 LangGraph checkpoint 实现状态保存，并在后续阶段演示人工审批与续跑。

## 架构与职责边界

核心原则：**LangGraph 管流程和状态，AI SDK 管模型和工具交互。**

| 能力 | 负责组件 | 说明 |
|---|---|---|
| 研究图、节点流转、条件边 | LangGraph | 表达 planner、executor、reporter 等阶段 |
| 全局研究状态 | LangGraph State | 保存问题、计划、消息、笔记、引用和报告 |
| checkpoint、恢复与人工介入 | LangGraph + SQLite checkpointer | 用于中断后续跑及 HITL 流程 |
| 模型调用与结构化输出 | AI SDK | 通过 OpenAI-compatible provider 接入本地模型 |
| 单个执行节点内的多轮工具调用 | AI SDK | `streamText` 的工具循环负责 ReAct 内循环 |
| MCP 工具 | MCP SDK + 适配层 | 将 MCP 工具转换为 AI SDK 可调用的工具 |
| Web 流式交互 | AI SDK + Next.js | `useChat` 与 API 流式响应 |
| Task、Note、Citation、Report 持久化 | Prisma + SQLite | 业务数据与图状态分开保存 |
| 引用校验、循环守卫、上下文压缩 | 应用层 | 通过小型业务逻辑补齐框架未覆盖的部分 |

### 需要保持的边界

1. **模型调用统一走 AI SDK。** LangGraph 节点可以调用 AI SDK，但不再引入另一套 LangChain 模型调用抽象。
2. **内循环交给 AI SDK，外循环交给 LangGraph。** AI SDK 在 executor 节点中处理模型与工具的多轮交互；LangGraph 决定研究阶段如何推进。
3. **LangGraph State 是流程状态的唯一来源。** AI SDK 请求所需的消息由 State 提供，并将新增结果写回 State，避免维护互不一致的平行状态。
4. **业务数据与 checkpoint 分库存放。** Prisma 保存供产品和评估使用的数据；SQLite checkpointer 保存图运行状态。通过 `taskId` 关联，不混用两种存储职责。

## 研究流程

```text
START
  │
  ▼
planner ──生成研究计划与子问题
  │
  ▼
executor ◀──────────────┐
  │                     │
  ├─需要更多信息？────── replanner
  │
  ├─预算耗尽或已足够
  ▼
reporter ──生成带引用的 Markdown 报告
  │
  ▼
 END
```

`executor` 节点内部使用 AI SDK 进行多步工具调用；图中的 replanner 回路属于研究流程的外循环。最大执行步数、预算耗尽行为和错误处理应由图逻辑显式定义。

### 状态建议

State 至少需要覆盖以下信息，并为可累积字段定义 reducer：

| 字段 | 用途 |
|---|---|
| `question` | 用户的研究问题 |
| `plan` | 当前研究计划 |
| `messages` | 对话及执行上下文 |
| `notes` | 执行过程中整理的研究笔记 |
| `citations` | 来源信息，按稳定 ID 去重 |
| `step` | 已完成的执行轮次 |
| `report` | 最终报告 |
| `status` | 当前阶段或完成/错误状态 |

## 技术选型

| 层 | 选型 | 用途 |
|---|---|---|
| Web 应用 | Next.js App Router、TypeScript strict | API 与前端 |
| 流式 UI | Vercel AI SDK `useChat`、React Markdown | 对话及报告展示 |
| 图编排 | `@langchain/langgraph` | 状态图、节点流转和中断恢复 |
| 图状态存储 | `@langchain/langgraph-checkpoint-sqlite` | LangGraph checkpoint |
| 模型接入 | `ai`、`@ai-sdk/openai-compatible` | 连接 OpenAI-compatible 本地推理服务 |
| 数据校验 | Zod | Planner 输出等结构化数据校验 |
| 工具协议 | `@modelcontextprotocol/sdk` | MCP Client 与自建 MCP Server |
| 搜索与抓取 | Tavily、Jina（通过工具层接入） | 研究资料获取 |
| 业务数据 | Prisma、SQLite | Task、Note、Citation、Report |
| 本地推理 | vLLM、Ollama 或 LM Studio | 提供模型服务 |
| 初始模型 | Qwen2.5-7B/14B-Instruct | 本地模型候选 |
| 测试与评估 | Vitest、评估脚本 | 单元测试与批量运行评估 |

模型调用不使用 `@langchain/openai`；LangGraph 只承担图编排、State 和 checkpoint 职责。这样可以避免重复维护模型与消息抽象。

## 实施路线

| 里程碑 | 内容 | 主要交付 |
|---|---|---|
| M0 | 脚手架、本地模型、工具调用、LangGraph 冒烟验证 | 三项基础验证全部通过 |
| M1 | 流式对话 | AI SDK `streamText`、`useChat` |
| M2 | 工具层与 MCP 适配骨架 | AI SDK 工具、MCP Client 适配器 |
| M3 | LangGraph 流程骨架 | planner → executor → reporter 空实现及 checkpoint |
| M3.5 | executor 接入多步工具调用 | AI SDK 内循环、图节点外循环 |
| M3.6 | 自建 research MCP | MCP Server 工具与服务切换 |
| M4 | Planner | 结构化计划生成、校验与失败处理 |
| M5 | Memory 与 Citation | Prisma 持久化、引用绑定与校验 |
| M6 | Reporter 与端到端流式链路 | 带引用报告及 API/UI 桥接 |
| M6.5 | 多 MCP、人工审批与续跑 | checkpoint、interrupt、恢复演示 |
| M7 | 上下文压缩与健壮性 | 摘要节点、循环守卫与错误处理 |
| M8 | Evaluation 与 Demo | 批量评估、文档和演示 |

重点展示 LangGraph 价值的阶段是 M6.5：研究计划经人工审批后继续执行，以及中断后恢复任务。工具调用内循环仍由 AI SDK 承担。

## M0：基础验证

### 验收目标

以下三项全部通过才算 M0 完成：

1. 本地 OpenAI-compatible 模型服务可访问。
2. AI SDK 能完成模型调用及至少一次工具调用。
3. LangGraph 最小图可运行，且 checkpoint 可以读取。

### 安装依赖

```bash
npm install ai @ai-sdk/openai-compatible zod
npm install @langchain/langgraph @langchain/langgraph-checkpoint-sqlite
npm install @modelcontextprotocol/sdk
npm install @prisma/client
npm install -D prisma tsx
```

### 建议目录

```text
lib/
  llm/provider.ts
  graph/state.ts
  graph/graph.ts
scripts/
  check-llm.ts
  check-graph.ts
```

### 本地模型 Provider

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const provider = createOpenAICompatible({
  name: "qwen-local",
  baseURL: process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:8000/v1",
  apiKey: process.env.LOCAL_LLM_API_KEY ?? "sk-local",
});

export const chatModel = provider.chatModel(
  process.env.LOCAL_LLM_MODEL ?? "Qwen2.5-7B-Instruct",
);
```

### 最小 LangGraph 与 checkpoint

```ts
import { END, START, StateGraph } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ResearchState } from "../lib/graph/state";

async function main() {
  const checkpointer = SqliteSaver.fromConnString("file:./graph.db");
  const graph = new StateGraph(ResearchState)
    .addNode("planner", async (state) => ({
      plan: `P:${state.question}`,
      status: "planning",
    }))
    .addNode("executor", async (state) => ({
      messages: [{ role: "assistant", content: `E:${state.plan}` }],
      status: "executing",
    }))
    .addNode("reporter", async (state) => ({
      report: `R:${state.messages.length}`,
      status: "done",
    }))
    .addEdge(START, "planner")
    .addEdge("planner", "executor")
    .addEdge("executor", "reporter")
    .addEdge("reporter", END)
    .compile({ checkpointer });

  const config = { configurable: { thread_id: "m0-smoke-test" } };
  const result = await graph.invoke({ question: "测试问题" }, config);

  console.log("图运行结果：", result);
  console.log("Checkpoint 存在：", Boolean(await checkpointer.getTuple(config)));
}

main().catch((error) => {
  console.error("M0 graph check failed:", error);
  process.exitCode = 1;
});
```

`ResearchState` 应按实际图字段定义 Annotation 与 reducer。上面的 `compile({ checkpointer })` 将 checkpoint 配置在编译后的图上，再通过带 `thread_id` 的调用配置读写运行状态。

### 验收清单

- [ ] `curl http://localhost:8000/v1/models` 能获取模型列表。
- [ ] `npx tsx scripts/check-llm.ts` 验证文本生成及工具调用成功。
- [ ] `npx tsx scripts/check-graph.ts` 验证图运行成功且 checkpoint 存在。
- [ ] 记录实际使用的推理服务、模型名称及验证结果。

## 待确认事项

- 本地推理服务选择：vLLM、Ollama 或 LM Studio。
- 模型规格：Qwen2.5-7B 或 14B，以及运行设备资源。
- 本地模型的工具调用能力和结构化输出稳定性；根据实测结果决定 Planner 的重试与降级策略。
