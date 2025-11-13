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
	activeCalls: number,
	text: string | undefined
) {
	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	const outputTokens = usage?.outputTokens ?? usage?.totalTokens ?? 0;

	let resultSuffix = '';
	if (text) {
		const preview = text.trim().replace(/\s+/g, ' ');
		const truncated =
			preview.length > PREVIEW_LIMIT ? `${preview.slice(0, PREVIEW_LIMIT)}...` : preview;
		resultSuffix = ` | result: "${truncated.replace(/"/g, '\\"')}"`;
	}

	process.stdout.write(
		`[${modelName} #${callId}] ✅ Complete ${mode}: ${String(
			outputTokens
		)} tokens in ${duration}s | active: ${activeCalls}${resultSuffix}\n`
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
export function withProgressIndicator(
	model: LanguageModelV2,
	modelName: string,
	showProgress = true
) {
	if (!showProgress) {
		return model;
	}

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

					const textParts: string[] = [];
					const toolCallMap = new Map<string, string>();

					result.content.forEach(part => {
						if (part.type === 'text') {
							textParts.push(part.text);
						} else if (part.type === 'tool-call') {
							textParts.push(`tool:${part.toolName}`);

							// Store tool call ID for matching with results
							const toolCallId = part.toolCallId;
							if (toolCallId) {
								toolCallMap.set(toolCallId, part.toolName);
							}

							// Log tool call with arguments
							try {
								// Check for both 'args' and 'input' properties
								const args = 'args' in part
									? part.args
									: ('input' in part ? (part as { input: unknown }).input : undefined);
								// If args is already a string, use it directly; otherwise stringify
								const argsStr = args
									? (typeof args === 'string' ? args : JSON.stringify(args))
									: '';
								process.stdout.write(
									`[${modelName} #${callId}] 🔧 ${part.toolName}(${argsStr})\n`
								);
							} catch {
								process.stdout.write(
									`[${modelName} #${callId}] 🔧 ${part.toolName}([stringify error])\n`
								);
							}
						} else if (part.type === 'tool-result') {
							const toolName = part.toolCallId ? toolCallMap.get(part.toolCallId) ?? 'unknown' : 'unknown';

							// Log tool result
							try {
								const resultStr = typeof part.result === 'string'
									? part.result
									: JSON.stringify(part.result);
								const preview = resultStr.length > 100
									? resultStr.substring(0, 100) + '...'
									: resultStr;
								process.stdout.write(
									`[${modelName} #${callId}] ✅ ${toolName} → ${preview}\n`
								);
							} catch {
								process.stdout.write(
									`[${modelName} #${callId}] ✅ ${toolName} → [stringify error]\n`
								);
							}
						}
					});

					const text = textParts.join(', ');

					logCompletion(
						modelName,
						callId,
						startTime,
						result.usage,
						'generating',
						activeCalls,
						text
					);

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

				let fullText = '';
				const toolNames = new Set<string>();
				const toolInputs = new Map<string, string>();
				const toolCallIds = new Map<string, string>();
				const loggedToolCalls = new Set<string>();

				const transformStream = new TransformStream<LanguageModelV2StreamPart, LanguageModelV2StreamPart>({
					transform(chunk: LanguageModelV2StreamPart, controller) {
						try {
							if (chunk.type === 'text-delta') {
								fullText += chunk.delta;
							} else if (chunk.type === 'tool-call') {
								toolNames.add(chunk.toolName);

								// Store tool call ID for matching with results
								const toolCallId = chunk.toolCallId;
								if (toolCallId) {
									toolCallIds.set(toolCallId, chunk.toolName);
								}

								const callKey = toolCallId ? `${chunk.toolName}-${toolCallId}` : `${chunk.toolName}-default`;
								if (!loggedToolCalls.has(callKey)) {
									loggedToolCalls.add(callKey);

									// Log tool call with arguments
									try {
										// Check for both 'args' and 'input' properties
										const args = 'args' in chunk
											? chunk.args
											: ('input' in chunk ? (chunk as { input: unknown }).input : undefined);
										// If args is already a string, use it directly; otherwise stringify
										const argsStr = args
											? (typeof args === 'string' ? args : JSON.stringify(args))
											: '';
										process.stdout.write(
											`[${modelName} #${callId}] 🔧 ${chunk.toolName}(${argsStr})\n`
										);
									} catch {
										process.stdout.write(
											`[${modelName} #${callId}] 🔧 ${chunk.toolName}([stringify error])\n`
										);
									}
								}
							} else if (chunk.type === 'tool-input-start') {
								toolNames.add(chunk.toolName);
								toolCallIds.set(chunk.id, chunk.toolName);
								toolInputs.set(chunk.id, '');
							} else if (chunk.type === 'tool-input-delta') {
								const currentInput = toolInputs.get(chunk.id) ?? '';
								toolInputs.set(chunk.id, currentInput + chunk.delta);
							} else if (chunk.type === 'tool-input-end') {
								const toolName = toolCallIds.get(chunk.id);
								if (toolName) {
									const callKey = `${toolName}-${chunk.id}`;
									if (!loggedToolCalls.has(callKey)) {
										loggedToolCalls.add(callKey);
										const input = toolInputs.get(chunk.id);
										if (input) {
											process.stdout.write(
												`[${modelName} #${callId}] 🔧 ${toolName}(${input})\n`
											);
										} else {
											process.stdout.write(
												`[${modelName} #${callId}] 🔧 ${toolName}()\n`
											);
										}
									}
									// Clean up input but keep toolCallIds for matching results
									toolInputs.delete(chunk.id);
								}
							} else if (chunk.type === 'tool-result') {
								const toolName = toolCallIds.get(chunk.toolCallId) ?? 'unknown';

								// Log tool result
								try {
									const resultStr = typeof chunk.result === 'string'
										? chunk.result
										: JSON.stringify(chunk.result);
									const preview = resultStr.length > 100
										? resultStr.substring(0, 100) + '...'
										: resultStr;
									process.stdout.write(
										`[${modelName} #${callId}] ✅ ${toolName} → ${preview}\n`
									);
								} catch {
									process.stdout.write(
										`[${modelName} #${callId}] ✅ ${toolName} → [stringify error]\n`
									);
								}
							}

							controller.enqueue(chunk);

							if (chunk.type === 'finish') {
								activeCalls--;

								const toolLog = Array.from(toolNames)
									.map(name => `tool:${name}`)
									.join(', ');

								let logText = fullText;
								if (fullText && toolLog) {
									logText += `, ${toolLog}`;
								} else if (toolLog) {
									logText = toolLog;
								}

								logCompletion(modelName, callId, startTime, chunk.usage, 'streaming', activeCalls, logText);

								// Cleanup maps
								toolInputs.clear();
								toolCallIds.clear();
								loggedToolCalls.clear();
							}
						} catch (error) {
							// Log unexpected errors during chunk processing
							process.stdout.write(
								`[${modelName} #${callId}] ⚠️  Error processing chunk: ${error instanceof Error ? error.message : 'unknown'}\n`
							);
							// Still enqueue the chunk to avoid breaking the stream
							controller.enqueue(chunk);
						}
					},

					flush() {
						// Cleanup on stream end if not finished normally
						toolInputs.clear();
						toolCallIds.clear();
						loggedToolCalls.clear();
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
