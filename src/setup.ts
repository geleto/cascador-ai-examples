import 'dotenv/config';

import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { withProgressIndicator } from './model-progress';

const showProgressIndicators = true;

// Export wrapped models with progress indicators
export const basicModel = withProgressIndicator(
	openai('gpt-4.1-nano'),
	'GPT-4o-nano',
	showProgressIndicators
);

export const advancedModel = withProgressIndicator(
	anthropic('claude-3-7-sonnet-latest'),
	'Claude-3.7-Sonnet',
	showProgressIndicators
);