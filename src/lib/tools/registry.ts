import z from "zod";
import { ToolDef } from "../agent/loop";
import { toJsonSchema } from "./schema";
import dotenv from 'dotenv';

dotenv.config()

const WebSearchParams = z.object({
    query: z.string().describe("the key to search for"),
    maxResults: z.number().int().min(1).max(10).optional().describe("the number of results to return, default is 5")
})

async function webSearch(args: z.infer<typeof WebSearchParams>) {
    const key = process.env.TAVILY_API_KEY;
    const url = process.env.TAVILY_API_URL;
    if (!key) throw new Error("TAVILY_API_KEY is not set");

    const res = await fetch(url + "/search", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            api_key: key,
            query: args.query,
            maxResults: args.maxResults ?? 5,
            search_depth: "basic",
            include_answer: false,
        })
    })

    if(!res.ok) throw new Error("Tavily API error: " + res.statusText);
    const data = await res.json();

    return {
        query: args.query,
        results: data.results.map((r: any) => ({
            title: r.title,
            url: r.url,
            score: r.score,
            snippet: r.content.slice(0, 100)
        }))
    }
}

const FetchUrlParams = z.object({
    url: z.string().url().describe("the URL to fetch")
})

async function fetchWithTimeout(url: string, init: RequestInit, timeout = 15000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, {...init, signal: ctrl.signal}).finally(() => clearTimeout(t));
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
    const res = await fetchWithTimeout(args.url,{
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
            Accept: "text/plain, text/html, application/json, */*",
        },
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch ${args.url}: HTTP ${res.status}`);
    }

    const html = await res.text();
    const text = stripeHtml(html).slice(0, 4000);
    if (text.length <= 50) {
        throw new Error(`Could not extract readable content from ${args.url}`);
    }
    return {url: args.url, content: text, via: "direct"};
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

export const localTools: ToolDef[] = [
    {
        name: "web_search",
        description: "Search the web for information, return some results",
        parameters: toJsonSchema(WebSearchParams),
        execute: async (args) => {
            const parsed = WebSearchParams.safeParse(args);
            if (!parsed.success) throw new Error(`Invalid parameters: ${parsed.error.message}`);
            return webSearch(parsed.data);
        }
    },
    {
        name: "fetch_url",
        description: "Fetch a URL and return the content",
        parameters: toJsonSchema(FetchUrlParams),
        execute: async (args) => {
            const parsed = FetchUrlParams.safeParse(args);
            if (!parsed.success) throw new Error(`Invalid parameters: ${parsed.error.message}`);
            return fetchUrl(parsed.data);
        }
    }
]