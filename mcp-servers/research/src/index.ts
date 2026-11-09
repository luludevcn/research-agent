import z from "zod";
import dotenv from 'dotenv';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

dotenv.config()

const processStartedAt = Date.now();
let toolRequestNumber = 0;

function log(event: string, details: Record<string, unknown> = {}) {
    console.error(`[research-mcp ${new Date().toISOString()} +${Date.now() - processStartedAt}ms] ${event}`, details);
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function safeEndpoint(endpoint: string) {
    try {
        return `${new URL(endpoint).origin}/search`;
    } catch {
        return "invalid-endpoint";
    }
}

function nextRequestId(tool: string) {
    toolRequestNumber += 1;
    return `${tool}-${toolRequestNumber}`;
}

const WebSearchParams = z.object({
    query: z.string().describe("the key to search for"),
    maxResults: z.number().int().min(1).max(10).optional().describe("the number of results to return, default is 5")
})

async function webSearch(args: z.infer<typeof WebSearchParams>, requestId: string) {
    const key = process.env.TAVILY_API_KEY;
    const baseUrl = process.env.TAVILY_API_URL;
    if (!key) throw new Error("TAVILY_API_KEY is not set");
    if (!baseUrl) throw new Error("TAVILY_API_URL is not set");

    const endpoint = `${baseUrl.replace(/\/+$/, "")}/search`;
    const ctrl = new AbortController();
    const timeoutMs = 45000;
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    const startedAt = Date.now();
    log("Tavily request started", {
        requestId,
        endpoint: safeEndpoint(endpoint),
        queryLength: args.query.length,
        maxResults: args.maxResults ?? 5,
        timeoutMs,
    });

    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: key,
                query: args.query,
                maxResults: args.maxResults ?? 5,
                search_depth: "basic",
                include_answer: false,
            }),
            signal: ctrl.signal,
        });
        log("Tavily response headers received", {
            requestId,
            elapsedMs: Date.now() - startedAt,
            status: res.status,
            ok: res.ok,
        });
        if (!res.ok) {
            throw new Error(`Tavily API error: HTTP ${res.status} ${res.statusText}`);
        }

        log("Tavily response body parsing started", { requestId });
        const data: unknown = await res.json();
        if (
            typeof data !== "object" ||
            data === null ||
            !("results" in data) ||
            !Array.isArray(data.results)
        ) {
            throw new Error("Tavily response did not contain a results array");
        }
        const result = {
            query: args.query,
            results: data.results.map((item: unknown) => {
                if (
                    typeof item !== "object" ||
                    item === null ||
                    !("url" in item) ||
                    typeof item.url !== "string"
                ) {
                    throw new Error("Tavily returned a result with an invalid URL");
                }
                return {
                    title: "title" in item && typeof item.title === "string" ? item.title : item.url,
                    url: item.url,
                    score: "score" in item && typeof item.score === "number" ? item.score : undefined,
                    snippet: "content" in item && typeof item.content === "string"
                        ? item.content.slice(0, 100)
                        : "",
                };
            }),
        };
        log("Tavily response parsed", {
            requestId,
            elapsedMs: Date.now() - startedAt,
            resultCount: result.results.length,
        });
        return result;
    } catch (error) {
        log("Tavily request failed", {
            requestId,
            elapsedMs: Date.now() - startedAt,
            timedOut: ctrl.signal.aborted,
            message: errorMessage(error).replace(endpoint, safeEndpoint(endpoint)),
        });
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

const FetchUrlParams = z.object({
    url: z.string().url().describe("the URL to fetch")
})

async function fetchWithTimeout(url: string, init: RequestInit, timeout = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function stripeHtml(html: string) {
    return html
        .replace(/<script.*?>.*?<\/script>/g, "")
        .replace(/<style.*?>.*?<\/style>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\r?\n|\r/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

async function fetchUrl(args: z.infer<typeof FetchUrlParams>) {
    const startedAt = Date.now();
    const host = new URL(args.url).host;
    log("fetch_url HTTP request started", { host, timeoutMs: 15000 });
    try {
        const res = await fetchWithTimeout(args.url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
                Accept: "text/plain, text/html, application/json, */*",
            },
        });
        log("fetch_url response headers received", {
            host,
            elapsedMs: Date.now() - startedAt,
            status: res.status,
        });
        if (!res.ok) {
            throw new Error(`Failed to fetch ${args.url}: HTTP ${res.status}`);
        }

        log("fetch_url body read started", { host });
        const html = await res.text();
        log("fetch_url body read completed", { host, elapsedMs: Date.now() - startedAt, bytes: html.length });
        const text = stripeHtml(html).slice(0, 4000);
        if (text.length <= 50) {
            throw new Error(`Could not extract readable content from ${args.url}`);
        }
        log("fetch_url content extracted", { host, textLength: text.length });
        return { url: args.url, content: text, via: "direct" };
    } catch (error) {
        log("fetch_url failed", { host, elapsedMs: Date.now() - startedAt, message: errorMessage(error) });
        throw error;
    }
    // const base = process.env.JINA_READER_BASE ?? "https://r.jina.ai";
    // const res = await fetch(`${base}/${args.url}}`, {
    //     headers: {Accept: "text/plain"}
    // });
    // if(!res.ok) throw new Error("Jina Reader error: " + res.statusText);
    // const text = await res.text();
    // return {
    //     url: args.url,
    //     content: text.slice(0, 4000)
    // }
}

const server = new McpServer({ name: "research-mcp", version: "1.0.0" });

server.registerTool(
    "web_search", {
    description: "Search the web for information",
    inputSchema: WebSearchParams,
},

    async ({ query, maxResults }) => {
        const requestId = nextRequestId("web_search");
        const startedAt = Date.now();
        log("MCP tool request received", { requestId, tool: "web_search", queryLength: query.length, maxResults });
        try {
            const r = await webSearch({ query, maxResults }, requestId);
            log("MCP tool response ready", { requestId, tool: "web_search", resultCount: r.results.length, elapsedMs: Date.now() - startedAt });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        } catch (error) {
            log("MCP tool request failed", { requestId, tool: "web_search", elapsedMs: Date.now() - startedAt, message: errorMessage(error) });
            throw error;
        }
    }
)

server.registerTool(
    "fetch_url", {
    description: "Fetch the content of a URL",
    inputSchema: FetchUrlParams,
}
    ,
    async ({ url }) => {
        const requestId = nextRequestId("fetch_url");
        const startedAt = Date.now();
        log("MCP tool request received", { requestId, tool: "fetch_url", host: new URL(url).host });
        try {
            const r = await fetchUrl({ url });
            log("MCP tool response ready", { requestId, tool: "fetch_url", contentLength: r.content.length, elapsedMs: Date.now() - startedAt });
            return { content: [{ type: "text", text: JSON.stringify(r) }] };
        } catch (error) {
            log("MCP tool request failed", { requestId, tool: "fetch_url", elapsedMs: Date.now() - startedAt, message: errorMessage(error) });
            throw error;
        }
    }
)

const transport = new StdioServerTransport();
log("MCP server connecting to stdio");
await server.connect(transport);
log("MCP server connected and ready");