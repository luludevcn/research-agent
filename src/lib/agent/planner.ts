import {client} from "../../lib/llm/provider";
import z from "zod";
import { withRetry } from "../llm/retry";

export const PlanSchema = z.object({
    subQuestions: z.array(z.object({
        id: z.string(),
        question: z.string(),
        toolHint: z.enum(["both", "web_search", "fetch_url"]).default("both"),
    }))
    .min(1).max(4)
})

export type Plan = z.infer<typeof PlanSchema>;

const system =  `你是一个研究计划器，把用户问题拆成2-4个可独立检索的子问题，输出严格JSON：
    {"subQuestions":[{"id":"1", "question":"...", "toolHint":"both"}]}
    规则：
    1. 子问题要具体，可搜索，覆盖原问题的不同侧面
    2. toolHint取web_search|fetch_url|both
    3. 只输出JSON， 不要输出任何其他文本
`;

export async function plan(question: string): Promise<Plan> {
    try {
        const res = await client.responses.create({
            model: process.env.LOCAL_QWEN_MODEL ?? "qwen2.5:7b",
            instructions: system,
            input: `question: ${question}}`,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "plan",
                    strict: false,
                    schema: {
                        type: "object",
                        properties: {
                            subQuestions: {
                                type: "array",
                                properties: {
                                    id: { type: "string" },
                                    question: { type: "string" },
                                    toolHint: { type: "string", enum: ["both", "web_search", "fetch_url"] }
                                }
                            }
                        },
                        required: ["subQuestions"]
                    }
                }
            } as any
        })
        const parsed = PlanSchema.safeParse(JSON.parse(res.output_text));
        if(parsed.success) {
            return parsed.data;
        }
    } catch (e) {
        console.error("plan failed", e);
    }

    try {
        const res =  await withRetry(()=> client.responses.create({
            model: process.env.LOCAL_QWEN_MODEL ?? "qwen2.5:7b",
            instructions: system,
            input: `question: ${question}}`,
        }),{label: "plan"});
        
        const text = res.output_text??"";
        const m = /\{[\s\S]*}/.exec(text);
        if(m) {
            const parsed = PlanSchema.safeParse(JSON.parse(m[0]));
            if(parsed.success) {
                return parsed.data;
            }
        }
    } catch (e) {
        console.error("plan failed", e);
    }
    console.error("plan delevel to one step plan");
    return {
        subQuestions: [
            {
                id: "1",
                question,
                toolHint: "both"
            }
        ]
    }

}