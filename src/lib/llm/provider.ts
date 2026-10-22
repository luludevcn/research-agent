import {createOpenAICompatible} from '@ai-sdk/openai-compatible'
import dotenv from 'dotenv';

dotenv.config()
export const provider = createOpenAICompatible({
    name: 'local-qwen',
    baseURL: process.env.LOCAL_QWEN_BASE_URL || '',
    apiKey: process.env.LOCAL_QWEN_API_KEY,
})

export const chatModel = provider.chatModel(process.env.LOCAL_QWEN_MODEL || '');