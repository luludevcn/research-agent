import type OPENAI from 'openai';
import {client, model} from '../llm/provider';
import { withRetry } from '../llm/retry';

export type ToolDef = {
    name: string,
    description: string,
    parameters: Record<string, unknown>;
    execute:(args: any) => Promise<any>;
};

export type LoopEvent = 
    | {type: 'thought', content: string}
    | {type: 'delta', text: string}
    | {type: 'tool_call', name:string, args: any}
    | {type: 'tool_result', name:string, result: any}
    | {type: 'final', content: string};


type ResponseInputItem = 
    | {role: 'system' | 'user' | 'assistant'; content: string}
    | {role: 'function_call'; call_id:string; name: string; arguments: string}
    | {role: 'function_call_output'; call_id: string; output: string;}


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

    const input: ResponseInputItem[] = [{role:'user', content: user}];
    const toolResults: any[] = [];
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
        if (streamText) {
            const stream = await client.responses.create({
                model,
                instructions: system,
                input: input as any,
                tools: toolSpecs,
                temperature: 0.7,
                stream: true,
            }, {signal});

            let final = '';
            for await (const event of stream) {
                if (event.type === 'response.output_text.delta') {
                    final += event.delta;
                    onEvent?.({type: 'delta', text: event.delta});
                } else if (event.type === 'response.failed') {
                    throw new Error(event.response.error?.message ?? 'Response stream failed');
                } else if (event.type === 'error') {
                    throw new Error('Response stream failed');
                }
            }

            onEvent?.({type: 'final', content: final});
            if (final) input.push({role: 'assistant', content: final});
            return {final, input, toolResults};
        }

        const response = await withRetry(()=> client.responses.create({
            model: model,
            instructions: system,
            input: input as any,
            tools: toolSpecs,
            temperature: 0.7,
        }, {signal}), {label: "loop-step"});
        
        const textParts: string[] = [];
        const functionCalls: {call_id: string, name: string, arguments: string}[] = [];

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

         const thought = textParts.join("");
         if (thought) onEvent?.({type: 'thought', content: thought});

         if(functionCalls.length===0) {
            const final = thought || response.output_text || "";
            onEvent?.({type: 'final', content: final});
            if(final)  input.push({role:'assistant', content: final});
            return {final, input, toolResults};
         }

         for (const fc of functionCalls) {
            input.push({
                type: 'function_call',
                call_id: fc.call_id,
                name: fc.name,
                arguments: fc.arguments,
            });
        }

        for (const fc of functionCalls) {
            let args: any = {};
            try {
                args = JSON.parse(fc.arguments) || {};
            } catch (e) {
                // ignore
            }
            onEvent?.({type: 'tool_call', name: fc.name, args});

            const def = toolMap.get(fc.name);
            let result: any;
            try {
                result = def ? await def.execute(args) : {error: `Unknown tool: ${fc.name}}`};
            } catch (e: any) {
                result = {error: e.message};
            }
            toolResults.push({name: fc.name,args, result});

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