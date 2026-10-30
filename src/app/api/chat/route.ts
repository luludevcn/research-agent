import { NextRequest } from "next/server";
import { client, model } from "../../../lib/llm/provider";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    const { messages } = await request.json() as {
        messages: {
            role: "user" | "assistant";
            content: string;
        }[];
    };
    const prompt = messages.map((message) => ({
        role: message.role,
        content: message.content,
    }))

    // TODO: handle stream
    const stream = await client.responses.create({
        model: model,
        instructions: "You are a helpful assistant. Provide a detailed answer in list.",
        input: prompt,
        stream: true,
    })

    const encoder = new TextEncoder();
    const body = new ReadableStream({
        async start(controller) {
            const send = (obj: unknown) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            try {
                for await (const event of stream as any) {
                    switch (event.type) {
                        case "response.output_text.delta":
                            if (event.delta) send({type: "delta", text: event.delta});
                            break;
                        case "response.completed":
                            send({type: "done", usage: event.response?.usage ?? null, id: event.response?.id ?? null});
                            break;
                        case "response.failed":
                        case "error":
                            send({type: "error", message: event.error?.message ?? "stream error"});
                            break;
                        default:
                            // other events are ignored
                            break;
                    }
                }
            } catch (e) {
                send({type: "error", message: String(e)});
            } finally {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
            }
        }
    })

    return new Response(body, {
        headers:{
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }   
    }
    )
}