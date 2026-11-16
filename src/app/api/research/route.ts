import { runResearch } from "@/src/lib/agent/research";
import { loadMcpTools } from "@/src/lib/tools/mcp-provider";
import { localTools } from "@/src/lib/tools/registry";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { question } = (await request.json()) as { question: string };
  if (!question?.trim()) {
    return new NextResponse("Please provide a question", { status: 400 });
  }

  const useMcp = process.env.USE_MCP === "true";
  const encoder = new TextEncoder();
  let mcpClient: Client | undefined;

  const body = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

      try {
        send({ type: "start", question });

        let tools = localTools;
        if (useMcp) {
          try {
            const loaded = await loadMcpTools();
            mcpClient = loaded.client;
            tools = loaded.tools;
          } catch (error) {
            throw error;
          }
        }

      const {taskId, report } = await runResearch({
        question,
        tools,
        onEvent: (event) => {
          send(event);
        },
      })

      send({ type: "done", taskId, report})

      } catch (e) {
        send({ type: "error", message: String(e) });
      } finally {
        clearInterval(heartbeat);
        if (mcpClient) {
          try {
            await mcpClient.close();
          } catch (error) {
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}