import 'dotenv/config';
import { openai } from '@ai-sdk/openai';
import { create } from 'casai';
import { z } from 'zod';

const baseConfig = create.Config({ model: openai('gpt-4.1-nano') });

const draftGenerator = create.TextGenerator.withTemplate({
	prompt: 'Write a short, engaging blog post about {{ topic }}.',
}, baseConfig);

const critiqueGenerator = create.ObjectGenerator.withTemplate({
	schema: z.object({
		score: z.number().describe('Quality score from 1-10.'),
		suggestions: z.array(z.string()).describe('Actionable suggestions for improvement.'),
	}),
	prompt: 'Critique this blog post: {{ draft }}',
}, baseConfig);

const revisionGenerator = create.TextGenerator.withTemplate({
	prompt: 'Rewrite the following post based on these suggestions:\n\nPOST:\n{{ draft }}\n\nSUGGESTIONS:\n- {{ suggestions | join("\n- ") }}',
}, baseConfig);

// Define the orchestration script for the agent
const contentAgent = create.Script({
	context: {
		draftGenerator, critiqueGenerator, revisionGenerator,
		topic: "the future of AI-powered development",
		qualityThreshold: 8, maxRevisions: 3, minRevisions: 1
	},
	script: `:data
      var revisionCount = 0
      var currentDraft = draftGenerator({ topic: topic }).text
      var critique = critiqueGenerator({ draft: currentDraft }).object

      // Iteratively revise until the quality threshold or maxRevisions is met
      while (critique.score < qualityThreshold or revisionCount < minRevisions) and revisionCount < maxRevisions
        revisionCount = revisionCount + 1
        currentDraft = revisionGenerator({ draft: currentDraft, suggestions: critique.suggestions }).text
        critique = critiqueGenerator({ draft: currentDraft }).object
      endwhile

      @data = { finalDraft: currentDraft, finalScore: critique.score, revisionCount: revisionCount }`,
});

// Run the agent
const result = await contentAgent();
console.log(JSON.stringify(result, null, 2));