import { wrapLanguageModel } from 'ai';
import { LanguageModelV2, LanguageModelV2StreamPart } from '@ai-sdk/provider';

// Progress indicator wrapper with in-place updates
export function withProgressIndicator(model: LanguageModelV2, modelName: string) {
	let callCounter = 0;

	return wrapLanguageModel({
		model,
		middleware: {
			wrapGenerate: async ({ doGenerate }) => {
				const callId = ++callCounter;
				const startTime = Date.now();
				const prefix = callId > 1 ? `[${modelName}#${callId}]` : `[${modelName}]`;

				process.stdout.write(`${prefix} ⏳ Start generating ... `);

				const result = await doGenerate();

				const duration = ((Date.now() - startTime) / 1000).toFixed(2);
				const usage = result.usage;
				const outputTokens = usage.outputTokens ?? usage.totalTokens ?? 0;

				// Just append to the same line
				process.stdout.write(`✓ Complete generating: ${String(outputTokens)} tokens in ${duration}s\n`);

				return result;
			},

			wrapStream: async ({ doStream }) => {
				const callId = ++callCounter;
				const startTime = Date.now();
				const prefix = callId > 1 ? `[${modelName}#${callId}]` : `[${modelName}]`;

				process.stdout.write(`${prefix} ⏳ Start streaming\n`);

				const { stream: originalStream, ...rest } = await doStream();

				const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
					transform(chunk: LanguageModelV2StreamPart, controller) {
						controller.enqueue(chunk);

						// Only show final stats (no intermediate progress)
						if (chunk.type === 'finish') {
							const duration = ((Date.now() - startTime) / 1000).toFixed(2);
							const usage = chunk.usage;
							const outputTokens = usage.outputTokens ?? usage.totalTokens ?? 0;

							process.stdout.write(`${prefix} ✓ Complete streaming: ${String(outputTokens)} tokens in ${duration}s\n`);
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
