import { wrapLanguageModel } from 'ai';
import {
	LanguageModelV2,
	LanguageModelV2CallOptions,
	LanguageModelV2StreamPart,
	LanguageModelV2Usage
} from '@ai-sdk/provider';

const PREVIEW_LIMIT = 40;

// Helper function for completion logging
function logCompletion(
	modelName: string,
	callId: number,
	startTime: number,
	usage: LanguageModelV2Usage | undefined,
	mode: 'generating' | 'streaming',
	activeCalls: number
) {
	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	const outputTokens = usage?.outputTokens ?? usage?.totalTokens ?? 0;
	process.stdout.write(
		`[${modelName} #${callId}] ✅ Complete ${mode}: ${String(outputTokens)} tokens in ${duration}s | active: ${activeCalls}\n`
	);
}

interface PromptPreview {
	text: string;
	truncated: boolean;
}

function getPromptPreview(params: LanguageModelV2CallOptions | undefined): PromptPreview | undefined {
	if (!params) {
		return undefined;
	}

	const prompt = params.prompt;
	if (!Array.isArray(prompt)) {
		return undefined;
	}

	let preview = '';
	let truncated = false;

	const appendText = (text: string) => {
		if (preview.length >= PREVIEW_LIMIT) {
			truncated = true;
			return;
		}

		const sanitized = text.replace(/\s+/g, ' ').trim();
		if (!sanitized) {
			return;
		}

		const segment = preview.length > 0 ? ` ${sanitized}` : sanitized;
		if (!segment) {
			return;
		}

		const remaining = PREVIEW_LIMIT - preview.length;
		if (segment.length > remaining) {
			truncated = true;
		}

		preview += segment.slice(0, remaining);
	};

	for (const message of prompt) {
		if (preview.length >= PREVIEW_LIMIT) {
			truncated = true;
			break;
		}

		if (message.role === 'system') {
			appendText(message.content);
			continue;
		}

		if (!Array.isArray(message.content)) {
			continue;
		}

		for (const part of message.content) {
			if (preview.length >= PREVIEW_LIMIT) {
				truncated = true;
				break;
			}

			if (part.type === 'text') {
				appendText(part.text);
			}

			if (preview.length >= PREVIEW_LIMIT) {
				truncated = true;
				break;
			}
		}
	}

	if (!preview) {
		return undefined;
	}

	return {
		text: preview,
		truncated
	};
}

function formatPromptSuffix(preview: PromptPreview | undefined) {
	if (!preview) {
		return '';
	}

	const escaped = preview.text.replace(/"/g, '\\"');
	const display = preview.truncated ? `${escaped}...` : escaped;

	return ` | prompt: "${display}"`;
}

// Progress indicator wrapper
export function withProgressIndicator(model: LanguageModelV2, modelName: string) {
	let callCounter = 0;
	let activeCalls = 0;

	return wrapLanguageModel({
		model,
		middleware: {
			wrapGenerate: async ({ doGenerate, params }) => {
				const callId = ++callCounter;
				const startTime = Date.now();
				const promptSuffix = formatPromptSuffix(getPromptPreview(params));

				activeCalls++;
				process.stdout.write(
					`[${modelName} #${callId}] 🚩 Start generating${promptSuffix} | active: ${activeCalls}\n`
				);

				try {
					const result = await doGenerate();
					activeCalls--;
					logCompletion(modelName, callId, startTime, result.usage, 'generating', activeCalls);

					return result;
				} catch (error) {
					activeCalls--;
					throw error;
				}
			},

			wrapStream: async ({ doStream, params }) => {
				const callId = ++callCounter;
				const startTime = Date.now();
				const promptSuffix = formatPromptSuffix(getPromptPreview(params));

				activeCalls++;
				process.stdout.write(
					`[${modelName} #${callId}] 🚩 Start streaming${promptSuffix} | active: ${activeCalls}\n`
				);

				let streamResult;
				try {
					streamResult = await doStream();
				} catch (error) {
					activeCalls--;
					throw error;
				}

				const { stream: originalStream, ...rest } = streamResult;

				const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
					transform(chunk: LanguageModelV2StreamPart, controller) {
						controller.enqueue(chunk);

						if (chunk.type === 'finish') {
							activeCalls--;
							logCompletion(modelName, callId, startTime, chunk.usage, 'streaming', activeCalls);
						}
					}
				});

				return {
					stream: originalStream.pipeThrough(transformStream),
					...rest
				};
			}
		}
	});
}
