import type OPENAI from 'openai';
import {client, model} from '../llm/provider';
import { withRetry } from '../llm/retry';

export type ToolDef = {
    name: string,
    description: string,
    parameters: Record<string, unknown>;
    execute:(args: any) => Promise<any>;
};

// Agent Loop 在执行过程中向外层发布的事件类型。
export type LoopEvent = 
    | {type: 'thought', content: string}
    | {type: 'delta', text: string}
    | {type: 'tool_call', name:string, args: any}
    | {type: 'tool_result', name:string, result: any}
    | {type: 'final', content: string};


type ResponseInputItem = 
    | {role: 'system' | 'user' | 'assistant'; content: string}
    | {type: 'function_call'; call_id:string; name: string; arguments: string}
    | {type: 'function_call_output'; call_id: string; output: string;}


// 粗略估算输入数据的 token 数量，用于触发压缩或长度控制逻辑。
function approxTokens(items: any[]): number {
    return JSON.stringify(items).length / 4; // rough approximation
}

// 当估算 token 数达到该阈值时，后续逻辑会考虑压缩历史输入。
const COMPRESS_AT = 12000; // compress input when it's this many tokens or more


// 运行模型与工具之间的多轮交互循环，直到模型给出最终答案或达到步数上限。
export async function runAgentLoop(opts:{
    system:string,
    user:string,
    tools: ToolDef[],
    maxSteps: number,
    onEvent?: (event: LoopEvent) => void,
    signal?: AbortSignal,
    streamText?: boolean,
}): Promise<{final: string; input: ResponseInputItem[]; toolResults:any[]}> {
    const {system, user, tools, maxSteps = 5, onEvent, signal, streamText = false} = opts;

    if (streamText && tools.length > 0) {
        throw new Error('streamText can only be used when no tools are provided');
    }

    let input: ResponseInputItem[] = [{role:'user', content: user}];
    const toolResults: any[] = [];
    let idleRounds = 0;
    const toolMap = new Map<string, ToolDef>(tools.map(t => [t.name, t]));

    const toolSpecs: OPENAI.Responses.Tool[] = tools.map(t => ({
        type: 'function',
        name: t.name, 
        description: t.description,
        parameters: t.parameters,
        strict:false,
    }));

    for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) {
            throw new Error('Aborted');
        }

        if(approxTokens(input) > COMPRESS_AT) {
            input = compressInput(input);
        }
        // 流式文本模式：直接请求文本增量，不解析或执行工具调用。
        if (streamText) {
            const stream = await client.responses.create({
                model,
                instructions: system,
                input: input as any,
                tools: toolSpecs,
                temperature: 0.7,
                stream: true,
            }, {signal});

            // 累积流式输出，以便在结束时返回完整文本。
            let final = '';
            for await (const event of stream) {
                // 收到普通文本增量时，追加到最终文本并通知外层。
                if (event.type === 'response.output_text.delta') {
                    final += event.delta;
                    onEvent?.({type: 'delta', text: event.delta});
                // 服务端明确报告失败时，将错误信息抛给调用方。
                } else if (event.type === 'response.failed') {
                    throw new Error(event.response.error?.message ?? 'Response stream failed');
                // 收到流式通用错误事件时，转换为统一错误。
                } else if (event.type === 'error') {
                    throw new Error('Response stream failed');
                }
            }

            // 发布最终文本，并将助手回复加入后续输入记录。
            onEvent?.({type: 'final', content: final});
            if (final) input.push({role: 'assistant', content: final});
            return {final, input, toolResults};
        }

        // 非流式模式通过带重试逻辑的请求获取一次完整响应。
        const response = await withRetry(()=> client.responses.create({
            model: model,
            instructions: system,
            input: input as any,
            tools: toolSpecs,
            temperature: 0.7,
        }, {signal}), {label: "loop-step"});
        
        // 分别收集模型输出的文本片段和函数调用。
        const textParts: string[] = [];
        const functionCalls: {call_id: string, name: string, arguments: string}[] = [];

        // 遍历响应中的所有输出项，按类型提取内容。
        for(const item of response.output) {
            if (item.type === "message") {
                for(const c of item.content) {
                    if (c.type === "output_text") {
                        textParts.push(c.text);
                    }
                }
            } else if (item.type === "function_call") {
                functionCalls.push({call_id: item.call_id, name: item.name, arguments: item.arguments});
            }
        }

         // 合并当前模型文本，并在存在内容时发布 thought 事件。
         const thought = textParts.join("");
         if (thought) onEvent?.({type: 'thought', content: thought});

         // 如果没有函数调用，说明模型已给出最终答案，结束整个循环。

         if(functionCalls.length===0) {
            idleRounds++;
            if(idleRounds >= 2) {
                const final = thought || response.output_text || "信息不足，已尽力";
                onEvent?.({type: 'final', content: final});
                return {final, input, toolResults};
            }
            const final = thought || response.output_text || "";
            onEvent?.({type: 'final', content: final});
            if(final)  input.push({role:'assistant', content: final});
            return {final, input, toolResults};
         } else {
            idleRounds = 0;
         }

         // 将所有函数调用写入输入历史，使下一轮请求可以包含调用上下文。
         for (const fc of functionCalls) {
            input.push({
                type: 'function_call',
                call_id: fc.call_id,
                name: fc.name,
                arguments: fc.arguments,
            });
        }

        // 逐个解析并执行函数调用，收集结果并补充到下一轮输入。
        for (const fc of functionCalls) {
            // 参数解析失败时使用空对象，避免整个 Agent Loop 因单次参数异常中断。
            let args: any = {};
            try {
                args = JSON.parse(fc.arguments) || {};
            } catch (e) {
                // 忽略 JSON 解析错误，由空参数继续尝试执行工具。
            }
            // 工具调用开始时通知外层，并提供解析后的参数。
            onEvent?.({type: 'tool_call', name: fc.name, args});

            // 查找本次调用对应的工具定义。
            const def = toolMap.get(fc.name);
            let result: any;
            try {
                // 找到工具则执行；找不到则返回未知工具错误。
                result = def ? await def.execute(args) : {error: `Unknown tool: ${fc.name}}`};
            } catch (e: any) {
                // 将工具执行异常转换为可序列化的错误结果。
                result = {error: e.message};
            }
            // 保存本轮工具名称、参数和执行结果。
            toolResults.push({name: fc.name,args, result});

            // 将工具结果作为 function_call_output 加入输入历史。
            input.push({
                type: 'function_call_output',
                call_id: fc.call_id,
                output: JSON.stringify(result),
            })
        }
    }

    const final = "reach the max steps, unfinished";
    onEvent?.({type: 'final', content: final});
    return {final, input, toolResults};
}

function compressInput(items: any[]): any[] {
    const head = items.slice(0,1);
    const tail = items.slice(-4);
    const middle = items.slice(1, -4);
    const urls = middle.map((m)=> {
        if(m.type === 'function_call_output') {
            try{
                const o = JSON.parse(m.output);
                const u = o?.result?.[0]?.url ?? o?.url;
                return u ? `- ${u}`: '';
            } catch(e) {
                return '';
            }
        }
        return '';
    })
    .filter(Boolean).join('\n');
    const summary = {
        role: "user" as const,
        content: `[上下文以压缩]，先前工具调用产生的来源摘要：\n${urls||"无"}\n请基于已有信息继续`,
    }
    return [...head, summary, ...tail];
}
