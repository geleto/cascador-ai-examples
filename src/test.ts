import dotenv from 'dotenv';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { create } from 'cascador-ai';
dotenv.config();


const { text } = await generateText({
	model: anthropic('claude-3-7-sonnet-latest'),
	prompt: 'What is the capital of France?',
});

console.log(text);



// 1. Define a reusable base configuration using GPT-4o
export const baseLLMConfig = create.Config({
	model: anthropic('claude-3-7-sonnet-latest')
});