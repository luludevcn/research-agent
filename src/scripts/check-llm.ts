import { Tool } from "openai/resources/responses/responses.mjs";
import { client, model } from "../lib/llm/provider";

async function main() {

    console.log("test 1: basic output");
    const basic_response = await client.responses.create({
        model,
        input: [{ role: "user", content: "Introduce yourself in one sentence." }],
    });
    console.log(basic_response.output_text);

    console.log("test 2: stream output");
    const stream = await client.responses.create({
        model,
        input: [{ role: "user", content: "Write numbers from 1 to 5, separated by commas." }],
        stream: true,
    });

    for await (const chunk of stream) {
        if (chunk.type === "response.output_text.delta" && chunk.delta) {
            process.stdout.write(chunk.delta);
        }
    }

    console.log("test 3: tool calling");
    const tools: Tool[] = [{
        type: "function",
            name: "get_weather",
            description: "Get the weather for a city.",
            parameters: {
                type: "object",
                properties: {
                    city: { type: "string", description: "City name" },
                },
                required: ["city"],
                additionalProperties: false,
            },
            strict: false,
    }];
    const prompt = "How is the weather in Beijing today? Use the weather tool and answer in Chinese.";
    const toolResponse = await client.responses.create({
        model,
        input: [{ role: "user", content: prompt }],
        tools,
        tool_choice: "auto",
    });

    const toolCall = toolResponse.output?.find(
        (call) => call.type === "function_call" && call.name === "get_weather",
    );
    if (!toolCall || toolCall.type !== "function_call") {
        throw new Error("test 3 failed: no get_weather tool call returned");
    }

    const args: unknown = JSON.parse(toolCall.arguments);
    if (!args || typeof args !== "object" || !("city" in args) || typeof args.city !== "string") {
        throw new Error("test 3 failed: get_weather returned invalid arguments");
    }
    const { city } = args;
    const toolResult = { city, weather: "sunshine", temperature: "30 C" };
    const finalResponse = await client.responses.create({
        model,
        input: [
            { role: "user", content: prompt },
            {role: "assistant", content:toolResponse.output_text},
            { role: "assistant", call_id: toolCall.call_id, content: JSON.stringify(toolResult) },
        ],
    });

    console.log("test 3 passed: tool called");
    console.log("tool result:", toolResult);
    console.log("llm output:", finalResponse.output_text);
}

main().catch((e)=> {
    console.error(e);
    process.exit(1);
})