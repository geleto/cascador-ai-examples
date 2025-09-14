import 'dotenv/config';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { create } from 'cascador-ai';
import { z } from 'zod';

// 1. Define a reusable base configuration using GPT-4o
const baseLLMConfig = create.Config({
	model: openai('gpt-4o'),
	temperature: 0.7,
	//debug: true,
});

// 2. Define the Agent's Core Capabilities (Renderers)

// A renderer to write drafts (inherits GPT-4o from baseConfig)
const draftGenerator = create.TextGenerator.withTemplate({
	prompt: 'Write a short, engaging blog post about {{ topic }}.',
}, baseLLMConfig);

// A renderer to critique drafts using a structured schema.
// This overrides the base model to use Claude Sonnet for critique.
const critiqueGenerator = create.ObjectGenerator.withTemplate({
	model: anthropic('claude-3-7-sonnet-latest'),
	output: 'object',
	schema: z.object({
		score: z.number().describe('Quality score from 1-10 on clarity and engagement.'),
		suggestions: z.array(z.string()).describe('Specific, actionable suggestions for improvement.'),
	}),
	prompt: 'Critique this blog post. Provide a quality score and concrete suggestions for improvement.\n\nPOST:\n{{ draft }}',
}, baseLLMConfig);

// A renderer to rewrite a draft based on feedback (inherits GPT-4o)
const revisionGenerator = create.TextGenerator.withTemplate({
	prompt: 'Rewrite the following blog post based on the suggestions provided.\n\nORIGINAL POST:\n{{ draft }}\n\nSUGGESTIONS:\n- {{ suggestions | join("\n- ") }}\n\nREVISED POST:',
}, baseLLMConfig);


// 3. Define the Orchestrator Script
const contentAgent = create.Script({
	//debug: true,
	context: {
		// Provide the renderers to the script
		draftGenerator,
		critiqueGenerator,
		revisionGenerator,
		// Define workflow parameters
		topic: 'the future of AI-powered development',
		qualityThreshold: 8,
		minRevisions: 1,
		maxRevisions: 3,
	},
	script:
		`// This script orchestrates the agent's "thought process".
		:data

		// --- Generate and critique the initial draft ---
		var currentDraft = draftGenerator({ topic: topic }).text
		var critiqueResult = critiqueGenerator({ draft: currentDraft }).object
		var qualityScore = critiqueResult.score
		var suggestions = critiqueResult.suggestions
		var revisionCount = 0
		var break = false

		// --- Start the revision loop ---
		while (qualityScore < qualityThreshold or revisionCount < minRevisions) and revisionCount < maxRevisions and not break
			var previousDraft = currentDraft
			var previousScore = qualityScore
			revisionCount = revisionCount + 1

			// Revise the draft based on the latest suggestions
			var revisedDraft = revisionGenerator({ draft: currentDraft, suggestions: suggestions }).text

			// --- Critique the NEW revised draft ---
			var newCritiqueResult = critiqueGenerator({ draft: revisedDraft }).object
			var newScore = newCritiqueResult.score

			// --- Decide whether to keep the revision ---
			if newScore < previousScore
				// Score got worse. Reject the revision and exit by forcing the loop to end.
				break = true
				revisionCount = revisionCount - 1
			else
				// Revision is an improvement. Accept it and update our state for the next loop.
				currentDraft = revisedDraft
				qualityScore = newScore
				suggestions = newCritiqueResult.suggestions
			endif
		endwhile

		// --- Assemble the final result ---
		@data.finalDraft = currentDraft
		@data.finalScore = qualityScore
		@data.revisionsMade = revisionCount
		`,
});

// 4. Run the Agent
(async () => {
	const result = await contentAgent();
	console.log(JSON.stringify(result, null, 2));
})().catch(console.error);