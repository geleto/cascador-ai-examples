
import 'dotenv/config';

import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

export const basicModel = openai('gpt-4.1-nano');
export const advancedModel = anthropic('claude-3-7-sonnet-latest');