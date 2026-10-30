import OpenAI from "openai";
import dotenv from 'dotenv';

dotenv.config()

export const client = new OpenAI({
    baseURL: process.env.LOCAL_QWEN_BASE_URL || undefined,
    apiKey: process.env.LOCAL_QWEN_API_KEY ||  "",
})

export const model = process.env.LOCAL_QWEN_MODEL || "";
