import { generateText, tool } from "ai";
import z from "zod";
import { chatModel } from "../lib/llm/provider";

async function main() {
    console.log("Checking LLM...", process.env.LOCAL_QWEN_BASE_URL);

    console.log("test 1: basic output")
    const r1 = await generateText({model: chatModel, prompt:"Introduce yourself in on sentence"})
    console.log(r1.text);

    console.log("test 2: stream output")
    const r2 = await generateText({model: chatModel,
         prompt:"write from 1 to 5, divided by comma", 
         onStepFinish:()=>{},
        });
    console.log(r2.text);

    console.log("test 3: tool calling");

    const r3 = await generateText({
        model: chatModel,
         maxSteps:3,
         tools:{
            get_weather: tool({
                description:"get the weather for city",
                parameters:z.object({
                    city:z.string().describe('city name'),
                }),
                execute: async ({city})=> ({city, weather: "sunshine", temperature: "30℃"})

            })
         },
          prompt:"how about the weather in beijing today? please call tools to get the weather, and anwser in chinese finnally"
        });

        const called = r3.steps.some((s)=>s.toolCalls?.some(c=>c.toolName==="get_weather"));
        const toolResult = r3.steps.flatMap(s=>s.toolResults??[]);

        if(!called) {
            console.error("test 3 failed: no tool called");
            process.exit(1);
        }
        console.log("test 3 passed: tool called");
        console.log("tool called result: ",toolResult);
        console.log("llm output: ", r3.content);
}

main().catch((e)=> {
    console.error(e);
    process.exit(1);
})