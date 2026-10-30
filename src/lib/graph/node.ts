import { runAgentLoop } from "../agent/loop";
import { localTools } from "../tools/registry";
import { ResearchState } from "./state";

const max_steps = 5;

export async function plannerNode(state: typeof ResearchState.State) {
    const plan = [
        {
            id: "1", subQuestion: `research: ${state.question}`
        },
        {
            id: "2", subQuestion: `buchong: the realiaty of ${state.question}`
        }
    ]
    return {plan, status:"planning" as const};
}

export async function executorNode(state: typeof ResearchState.State) {
    const planText = state.plan?.map((p:any)=>`- ${p.subQuestion}`).join("\n");
    const system = `
        You are a researcher executor. You should execute tools depends on subQuestion and collect the realiaty.
        subQuestion: 
        ${planText}
        only collect the realiaty, do not fake, stop when you have enough infomation.
        `;
    const {final, toolResults} = await runAgentLoop({
        system,
        user: `original question: ${state.question}`,
        tools: localTools,
        maxSteps: max_steps,
    })

    const notes = toolResults.flatMap((tr)=>{
        const r = tr.result;
        if(r?.result) {
            return r.result.map((x:any)=>({url: x.url, title: x.title, snippet: x.snippet}))
        }
        if(r?.content) {
            return [{url: r.url , snippet: String(r.content).slice(0, 100), title: r.title}]
        }
        return []
    });

    return {
        message: [{role: "assistant", content: final}],
        notes,
        status: "executing" as const,
        step: state.step + 1,
    }

}

export async function reporterNode(state: typeof ResearchState.State) {
    const notesLines = state.notes.map((n:any,i:number)=>`- [${i+1}] ${n.title??" "} ${n.url}\n${n.snippet}`).join("\n\n");
    const text = `research report (draft) \n\n question: ${state.question}\n\n## notes\n${notesLines||"none"}\n\n## ...`;
    return {
        report: text,
        status: "done" as const,
    }
}

