import { wrapLanguageModel } from 'ai';
import { LanguageModelV2, LanguageModelV2StreamPart, LanguageModelV2Usage } from '@ai-sdk/provider';

// Helper function for completion logging
function logCompletion(
	modelName: string,
	callId: number,
	startTime: number,
	usage: LanguageModelV2Usage | undefined,
	mode: 'generating' | 'streaming'
) {
	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	const outputTokens = usage?.outputTokens ?? usage?.totalTokens ?? 0;
	process.stdout.write(`[${modelName} #${callId}] ✅ Complete ${mode}: ${String(outputTokens)} tokens in ${duration}s\n`);
}

// Progress indicator wrapper
export function withProgressIndicator(model: LanguageModelV2, modelName: string) {
	let callCounter = 0;

	return wrapLanguageModel({
		model,
		middleware: {
			wrapGenerate: async ({ doGenerate }) => {
				const callId = ++callCounter;
				const startTime = Date.now();

				process.stdout.write(`[${modelName} #${callId}] 🚩 Start generating\n`);

				const result = await doGenerate();
				logCompletion(modelName, callId, startTime, result.usage, 'generating');

				return result;
			},

			wrapStream: async ({ doStream }) => {
				const callId = ++callCounter;
				const startTime = Date.now();

				process.stdout.write(`[${modelName} #${callId}] 🚩 Start streaming\n`);

				const { stream: originalStream, ...rest } = await doStream();

				const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
					transform(chunk: LanguageModelV2StreamPart, controller) {
						controller.enqueue(chunk);

						if (chunk.type === 'finish') {
							logCompletion(modelName, callId, startTime, chunk.usage, 'streaming');
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
