import { Annotation } from "@langchain/langgraph";

export const ResearchState = Annotation.Root({
    question: Annotation<string>,
    plan: Annotation<string|null>({reducer: (_,b)=> b, default: ()=>null}),
    messages: Annotation<any[]>({reducer: (a,b)=> [...a, ...b], default: ()=>[]}),
    notes: Annotation<any[]>({reducer: (a,b)=> [...a, ...b], default: ()=>[]}),
    citations: Annotation<any[]>({reducer: (a,b)=> [...a, ...b], default: ()=>[]}),
    report: Annotation<string|null>({reducer: (_,b)=> b, default: ()=>null}),
    status: Annotation<string>({reducer: (_,b)=> b, default: ()=>"init"})
})