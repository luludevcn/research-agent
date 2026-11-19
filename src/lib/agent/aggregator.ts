import { Note } from "@prisma/client";
import { client } from "../llm/provider";
import { SubResult } from "./executer";
import { buildSourceList } from "./citation";

const REPORT_INSTRUCTIONS = `你是研究助手，基于给定材料写一份结构化报告（markdown）:
            # 标题
            ## 摘要
            ##分节论述
            ##结论
            规则：
            - 只使用材料中的事实，不得编造
            - 在句末用【来源URL】标注引用材料
            - 禁止使用不存在的来源
`

function buildInput(question: string, subResults: SubResult[], notes: Note[]) {
    const material = subResults.map((r) => {
        `### sub question ${r.id}: ${r.question}\n final: ${r.answer}`
    }).join("\n\n");
    const source = buildSourceList(notes);
    return `## question: ${question}\n\n ## materials: ${material}\n\n ## sources: ${source}`
}

export async function aggregateStream(opts:{
    question: string;
    subResults: SubResult[];
    notes: Note[];
    onDelta?: (delta: string) => void;
    signal?: AbortSignal;
}) : Promise<string>{
    const {question, subResults, notes, onDelta, signal} = opts;
    const stream = await client.responses.create(
        {
            model: process.env.LOCAL_QWEN_MODEL ?? "qwen2.5:7b",
            instructions: `${REPORT_INSTRUCTIONS}`,
            input: buildInput(question, subResults, notes),
            stream: true,
        },
        {signal}
    );
    let full = "";
    for await (const event of stream as any) {
        if (event.type ==="response.output_text.delta" && event.delta) {
            full += event.delta;
            if (onDelta) {
                onDelta(event.delta);
            }
        }
    }
    return full;
}


export async function aggregate(opts:{
    question: string;
    subResults: SubResult[];
    notes: Note[];
    }): Promise<string> {
        const {question, subResults, notes} = opts;
        const sources = buildSourceList(notes);
        const materials = subResults.map((r) => {
            return (
                `子问题: ${r.question}\n` +
                `结论: ${r.answer ?? "无结论"}\n` +
                `参考资料:\n` +
                (r.notes?.map((n) => `- ${n.title} (${n.url})\n  摘要: ${n.snippet}`).join("\n") ?? "无参考资料")
            )
        }).join("\n\n");

        const res = await client.responses.create({
            model: process.env.LOCAL_QWEN_MODEL ?? "qwen2.5:7b",
            instructions: `${REPORT_INSTRUCTIONS}`,
            input: `原始问题：${question}, 材料：${materials}, 来源${sources}`,
        })

        return res.output_text??"";
}