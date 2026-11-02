import z from "zod";
export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape;
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key,val] of Object.entries(shape)) {
            const v = val as z.ZodTypeAny;
            properties[key] = zodToProp(v);
            if (!v.isOptional()) required.push(key);
        }
        return {
            type: "object",
            properties,
            required,
            additionalProperties: false,
        };
    }
    return {type: "object", properties: {}, required: []};
}

function zodToProp(v: z.ZodTypeAny): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if(v.description) out.description = v.description;
    if(v instanceof z.ZodString) return {...out, type: "string"};
    if(v instanceof z.ZodNumber) return {...out, type: "number"};
    if(v instanceof z.ZodBoolean) return {...out, type: "boolean"};
    if(v instanceof z.ZodArray) return {...out, type: "array", items: zodToProp(v.element as z.ZodTypeAny)};
    if(v instanceof z.ZodObject) return toJsonSchema(v);
    if(v instanceof z.ZodOptional) return {...out, ...zodToProp(v.unwrap() as z.ZodTypeAny), nullable: true};
    if(v instanceof z.ZodEnum) return {...out, type: "string", enum: v.options};
    if(v instanceof z.ZodLiteral) return {...out, const: v.value};
    throw new Error("Unsupported Zod type: " + v.constructor.name);
}