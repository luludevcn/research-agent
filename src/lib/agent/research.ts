import { executeSubQuestion, SubResult } from "./executer";
import { ToolDef } from "./loop";
import { plan } from "./planner";
import { aggregateStream } from "./aggregator";
import { createTask, getNotes, saveNotes, saveReport } from "../db/memory";
import { normalizeCitation } from "./citation";

export type ResearchEvent =
    | {type: "plan", plan: any}
    | {type: "subtask_start", id: string, question: string}
    | {type: "thought", subtask_id: string, content: string}
    | {type: "tool_call", subtask_id: string, name: string, args: any}
    | {type: "tool_result", subtask_id: string, name: string, result: any}
    | {type: "subtask_end", id: string, answer?: string, notes?:any[]}
    | {type: "replan", added: {id: string, question: string}}
    | {type: "report_delta", text: string}
    | {type: "report_final", content: string, citedCount: number}
    | {type: "replan"}
    | {type: "timeout"}


export async function runResearch(opts:{
    question: string,
    tools: ToolDef[],
    onEvent: (event: ResearchEvent) => void
}): Promise<{taskId: string, report: string}> {

    const {question, tools, onEvent} = opts;
    const p = await plan(question);
    const task = await createTask(question, p);
    onEvent?.({type: "plan", plan: p});

    const queue = [...p.subQuestions];
    const results: SubResult[] = [];
    let extraAdded = false;
    const DEADLINE = Date.now() + 1000 * 60 * 5; // 5 minutes
    while(queue.length > 0) {
        if (Date.now() > DEADLINE) {
            onEvent?.({type: "timeout"});
            break;
        }
        const sub = queue.shift()!;
        onEvent?.({type: "subtask_start", id: sub.id, question: sub.question});

        const r = await executeSubQuestion({
            sub, 
            tools, 
            onEvent:(e)=> onEvent?.(e as any),
            maxSteps: 3
        })
        results.push(r);
        await saveNotes(task.id, r.notes?.map(n=> ({...n, subTaskId: sub.id})));
        onEvent?.({type: "subtask_end", id: sub.id, answer: r.answer});

        const tooShort = (r.answer?? "").length < 100;
        const noSource = r.notes?.length === 0;
        if (!extraAdded && (tooShort || noSource)) {
            extraAdded = true;
            const extra = {
                id: `${sub.id}-extra`,
                question: "Can you provide more details or additional sources for question ${sub.question}?",
                toolHint: "both"
            }
            queue.push(extra);
            onEvent?.({type: "replan", added: extra});
        }
    }

    const notes = await getNotes(task.id);
    const raw = await aggregateStream({
        question, 
        subResults: results.map(r=>({id: r.id, answer: r.answer,question: r.question})), 
        notes,
        onDelta: (text)=> onEvent?.({type: "report_delta", text})
    });
    const {report, citedCount} = normalizeCitation(raw, notes);
    await saveReport(task.id, report)
    onEvent?.({type: "report_final", content: report, citedCount})
    
    return {taskId: task.id, report}
}