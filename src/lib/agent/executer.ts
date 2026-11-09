import { ToolDef, LoopEvent, runAgentLoop } from "./loop";

export type SubResult =  {
    id: string;
    question: string;
    answer?: string;
    notes?: {
        url: string;
        title: string;
        snippet: string;
        from: "search" | "fetch";
    }[];
}

export async function executeSubQuestion(opts:{
    sub:{id: string; question: string;toolHint: string;};
    tools: ToolDef[];
    onEvent: (e: LoopEvent & {subtaskId: string}) => void;
    maxSteps: number;
}): Promise<SubResult> {
    const {sub, tools, onEvent, maxSteps} = opts;
    const system = `你在研究一个子问题，步骤是：
    1. 调用web_search搜索1次
    2. 选取相关的URL，调用fetch_url抓取正文
    3. 给出该子问题的简洁结论，标注来源URL
    禁止编造
    `;
    const {final, toolResults} = await runAgentLoop({
        system,
        user: sub.question,
        tools,
        maxSteps,
        onEvent: (e) => onEvent?.({...e, subtaskId: sub.id}),
    })

    const notes = toolResults.flatMap((tr) => {
        const r = tr.result??{};
        if(Array.isArray(r.results)) {
            return r.results.map((x) => ({
                url: x.url,
                title: x.title ?? x.url,
                snippet: (x.snippet ?? "").slice(0, 300),
                from: "search" as const,
            }));
        }
        if (typeof r.content === "string" && typeof r.url === "string") {
            return [{
                url: r.url,
                title: r.title ?? r.url,
                snippet: (r.snippet ?? "").slice(0, 300),
                from: "fetch" as const,
            }]
        }
        return [];
    })
    return {
        id: sub.id,
        question: sub.question,
        answer: final,
        notes
    }
}