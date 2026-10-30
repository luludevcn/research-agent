import z from "zod";
import { ToolDef } from "../agent/loop";

function zToJsonSchema(_schema: z.ZodType<any>): Record<string, unknown> {
  return {type: 'object', properties: {}, required: []};
}

export const localTools: ToolDef[] = [
    {
        name: "web_search",
        description: "Search the web for information, return some results",
        parameters:{
            type: "object",
            properties: {
                query: {type: "string", description: "The key to search for"}
            },
            required: ["query"]
        },
        execute: async ({query}: {query: string}) => ({
            query,
            results: [
                {
                    title: "the resources about query: A",
                    url: "https://www.google.com/search?q=" + encodeURIComponent(query),
                    description: "Search the web with Google",
                    snippet: "Google Search example"
                },
                {
                    title: "the resources about query: B",
                    url: "https://duckduckgo.com/?q=" + encodeURIComponent(query),
                    description: "Search the web with DuckDuckGo",
                    snippet: "DuckDuckGo Search example"
                }
            ]
        })
    },
    {
        name: "fetch_url",
        description: "Fetch a URL and return the content",
        parameters: {
            type: "object",
            properties: {
                url: {type: "string", description: "The URL to fetch"}
            },
            required: ["url"]
        },
        execute: async ({url}: {url: string}) => ({url, content: `[content] ${url}`})
    }
]