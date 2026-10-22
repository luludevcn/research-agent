import { StateGraph, START, END } from "@langchain/langgraph";
import { ResearchState } from "./state";

export function buildGraph() {
    return new StateGraph(ResearchState)
    .addNode("planner", async (s) => ({plan: `P: ${s.question}`, status: "planning"}))
    .addNode("executor", async (s) => ({messages: [{role: "assitant", content:`E:${s.plan}`}], status: "executing"}))
    .addNode("reporter", async (s) => ({report: `R: ${s.messages.length}`, status: "done"}))
    .addEdge(START, "planner")
    .addEdge("planner", "executor")
    .addEdge("executor", "reporter")
    .addEdge("reporter", END);
}