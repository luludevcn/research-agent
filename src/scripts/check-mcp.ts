import { loadMcpTools } from "../lib/tools/mcp-provider";

const startedAt = Date.now();

function log(event: string, details: Record<string, unknown> = {}) {
    console.log(`[check-mcp ${new Date().toISOString()} +${Date.now() - startedAt}ms] ${event}`, details);
}

async function main() {
    log("starting MCP connection and tool discovery");
    const {client, tools} = await loadMcpTools();
    log("MCP tools loaded", { names: tools.map(t => t.name) });
    try {
        const search = tools.find(t => t.name === "web_search");
        if (!search) {
            throw new Error("web_search tool was not returned by the MCP server");
        }

        log("web_search test call starting", { argumentKeys: ["query", "maxResults"] });
        const result = await search.execute({ query: "What is the capital of France?", maxResults: 3 });
        log("web_search test call completed", {
            resultType: typeof result,
            serializedLength: JSON.stringify(result).length,
            preview: JSON.stringify(result).slice(0, 200),
        });
    } finally {
        log("closing MCP client");
        await client.close();
        log("MCP client closed");
    }
}

main().catch((err) => {
    console.error(`[check-mcp ${new Date().toISOString()} +${Date.now() - startedAt}ms] test failed`, err);
    process.exit(1);
});