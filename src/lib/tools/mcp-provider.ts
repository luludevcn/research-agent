import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { ToolDef } from "../agent/loop";

const startedAt = Date.now();

function log(event: string, details: Record<string, unknown> = {}) {
    console.error(`[mcp-client ${new Date().toISOString()} +${Date.now() - startedAt}ms] ${event}`, details);
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export async function loadMcpTools(): Promise<{ client: Client; tools: ToolDef[] }> {
    const serverEntry = path.resolve(process.cwd(), "mcp-servers/research/src/index.ts");

    const transport = new StdioClientTransport({
        command: "npx",
        args: ["tsx", serverEntry],
        env: { ...process.env },
        stderr: "pipe",
    });
    transport.onerror = (error) => log("transport error", { message: error.message });
    transport.onclose = () => log("transport closed");
    transport.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[mcp-server] ${chunk.toString()}`);
    });

    const client = new Client({ name: "research-agent", version: "1.0.0" }, { capabilities: {} });
    try {
        log("starting MCP server process", { command: "npx", args: ["tsx", serverEntry] });
        await client.connect(transport);
        log("MCP client connected");

        log("listTools request started");
        const {tools} = await client.listTools();
        log("listTools request completed", { count: tools.length, names: tools.map((tool) => tool.name) });
        const toolDefs: ToolDef[] = tools.map(t => ({
            name: t.name,
            description: t.description ?? "",
            parameters: t.inputSchema as Record<string, unknown> ?? { type: "object", properties: {} },
            execute: async (args) => {
                const callStartedAt = Date.now();
                log("callTool request started", { name: t.name, argumentKeys: Object.keys(args ?? {}) });
                try {
                    const res = await client.callTool({ name: t.name, arguments: args });
                    const content = Array.isArray(res.content) ? res.content : [];
                    log("callTool response received", {
                        name: t.name,
                        elapsedMs: Date.now() - callStartedAt,
                        isError: res.isError ?? false,
                        contentTypes: content.map((item) => item.type),
                    });
                    if (res.isError) {
                        const message = content
                            .filter((item) => item.type === "text")
                            .map((item) => item.text)
                            .join("\n");
                        throw new Error(message || `MCP tool ${t.name} returned an error`);
                    }

                    const first = content[0];
                    if (first?.type === "text") {
                        try {
                            return JSON.parse(first.text);
                        } catch {
                            log("tool response was not JSON", { name: t.name, textLength: first.text.length });
                            return { raw: first.text };
                        }
                    }
                    log("tool response had no text content", { name: t.name });
                    return undefined;
                } catch (error) {
                    log("callTool failed", {
                        name: t.name,
                        elapsedMs: Date.now() - callStartedAt,
                        message: errorMessage(error),
                    });
                    throw error;
                }
            }
        }));
        return { client, tools: toolDefs }
    } catch (error) {
        log("MCP initialization failed", { message: errorMessage(error) });
        try {
            await client.close();
        } catch (closeError) {
            log("failed to close MCP client after initialization error", { message: errorMessage(closeError) });
        }
        throw error;
    }
}