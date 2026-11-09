import { report } from "process";
import { executeSubQuestion, SubResult } from "./executer";
import { ToolDef } from "./loop";
import { plan } from "./planner";
import { aggregate } from "./aggregator";

export type ResearchEvent = | {type: "plan", plan: any}
    | {type: "subtask_start", id: string, question: string}
    | {type: "thought", subtask_id: string, content: string}
    | {type: "tool_call", subtask_id: string, name: string, args: any}
    | {type: "tool_result", subtask_id: string, name: string, result: any}
    | {type: "subtask_end", id: string, answer?: string, notes?:any[]}
    | {type: "report", content: string}

export async function runResearch(opts:{
    question: string,
    tools: ToolDef[],
    onEvent: (event: ResearchEvent) => void
}): Promise<{plan: any, results: SubResult[], report: string}> {

    const {question, tools, onEvent} = opts
    const p = await plan(question)
    onEvent?.({type: "plan", plan: p});

    const results: SubResult[] = [];
    for(const sub of p.subQuestions) {
        onEvent?.({type: "subtask_start", id: sub.id, question: sub.question});
        const r = await executeSubQuestion({
            sub, 
            tools, 
            onEvent:(e)=> onEvent?.(e as any),
            maxSteps: 1
        })
        results.push(r)
        onEvent?.({type: "subtask_end", id: sub.id, answer: r.answer, notes: r.notes})
            }

            const report = await aggregate({question, plan: p, results})
            onEvent?.({type: "report", content: report})
    
    return {
        plan: p,
        results,
        report
    }
}