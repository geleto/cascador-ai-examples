import 'dotenv/config';
import fs from 'fs/promises';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { create } from 'cascador-ai';

// Base shared configuration
const baseConfig = create.Config({
	temperature: 0.7,
});

// Story generator using Claude 3
const storylineGen = create.TextGenerator({
	model: anthropic('claude-3-5-sonnet-20240620'),
	prompt: 'Expand the following synopsis into a short story: {{ synopsis }}'
}, baseConfig);

// Critique generator using GPT-4
const critiqueGen = create.TextGenerator({
	model: openai('gpt-4o'),
	prompt: 'Provide a critical analysis of the following story: {{ story }}'
}, baseConfig);

// Translation using GPT-4
const translateGen = create.TextGenerator({
	model: openai('gpt-4o'),
	prompt: 'Translate the following text to {{ language }}: {{ text }}'
}, baseConfig);

// Main template renderer for orchestrating the whole process
const mainGenerator = create.TemplateRenderer({
	filters: {
		translate: async (text: string, lang: string) => (await translateGen({ text, language: lang })).text
	},
	context: {
		anguage: 'Spanish',
		readFile: async (filePath: string) => await fs.readFile(filePath, 'utf-8'),
		storylineGen,
		critiqueGen,
		language: 'Spanish',
	},
	prompt: `
    {% set synopsis = readFile('./src/synopsis.txt') %}
    {% set storyContent = (storylineGen({ synopsis: synopsis })).text %}
	Story: {{ storyContent }}
    {% set critiqueContent = (critiqueGen({ story: storyContent })).text %}
    Critique : {{ critiqueContent }}
	Story: in {{ storyContent | translate(language) }}`
});

(async () => {
	const result = await mainGenerator();
	console.log(result);
})().catch(console.error);