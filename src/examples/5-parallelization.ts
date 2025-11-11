/**
 * PARALLELIZATION EXAMPLE
 *
 * This example demonstrates how to parallelize dependent tasks using Cascada.
 *
 * The workflow:
 *   1. Load demo data from a JSON file (mock API)
 *   2. Fetch general user/billing info (getData)
 *   3. Get list of project IDs (getProjectIDs)
 *   4. For each project ID (getProject):
 *        - simulate async delay (different per ID)
 *        - summarize project details with an LLM
 *        - push the enriched project into the captured array
 *   5. Generate an overall summary (summarizeAll)
 *   6. Evaluate whether the key data (e.g., “churn prediction”) was preserved
 *
 * This demonstrates:
 *   • parallelization of dependent data access (project list → per-project details)
 *   • dependent data access (project list → per-project details)
 *   • parallel-friendly logic with out-of-order completion
 *   • use of `capture :data` to build a list inside a script
 *   • LLM summarization and output validation
 */

import fs from "fs/promises";
import { create } from "casai";
import { basicModel } from "../setup";
import type { DemoData, DemoDataSchema, DashboardResultSchema, ProjectWithData } from "./5-parallelization-types";

// Load demo data (for themock API)

const demoDataPromise: Promise<DemoData> = (async () => {
	const raw = await fs.readFile("src/examples/5-parallelization-data.json", "utf-8");
	const parsed = DemoDataSchema.parse(JSON.parse(raw)) as unknown as DemoData;
	return parsed;
})();

// LLM components

const projectSummarizer = create.TextGenerator.withTemplate({
	prompt: `Summarize this project for a dashboard in 2–3 sentences.
		Focus on goals, recent progress, and potential issues.
		Project: {{ project | json }}`,
}, create.Config({ model: basicModel, temperature: 0.4 }));

const summarizeAll = create.TextGenerator.withTemplate({
	prompt: `We have {{ projects.length }} projects for this user.
		Write a concise dashboard introduction summarizing usage, value, and anything notable.
		Projects: {{ projects | json }}`,
}, create.Config({ model: basicModel, temperature: 0.4 }));

// Main Script
const parallelizationAgent = create.Script({
	schema: DashboardResultSchema, // validates the final output

	context: {
		// mock API: get base data
		getData: (async () => {
			const all = await demoDataPromise;
			return all.data;
		})(),

		// mock API: list project IDs
		getProjectIDs: async () => {
			const all = await demoDataPromise;
			return Object.keys(all.projects);
		},

		// mock API: get individual project (with artificial delay)
		getProject: async (id: string): Promise<ProjectWithData | null> => {
			const all = await demoDataPromise;
			const project = all.projects[id];

			const digit = Number(id[id.length - 1]); // e.g. "p-3" → 3
			await new Promise((r) => setTimeout(r, 150 - digit * 15)); // later projects finish earlier

			return project;
		},

		// validate presence of key phrase from data
		validateLLMOutputs: (overview: string) => {
			const REQUIRED = "churn prediction";
			return overview.toLowerCase().includes(REQUIRED)
				? null
				: `Overview did not mention required phrase from data: "${REQUIRED}"`;
		},

		projectSummarizer,
		summarizeAll
	},

	script: `:data
    var base = getData
    var ids = getProjectIDs()

    // capture block collects enriched projects
    var projectsWithSummary = capture :data
      for id in ids
        var project = getProject(id)
        var summary = projectSummarizer({ project: project }).text
        project.summary = summary
        @data.push(project)
      endfor
    endcapture

    // overall dashboard overview
    var overview = summarizeAll({ projects: projectsWithSummary }).text

    // final validation (string or null)
    var validationError = validateLLMOutputs(overview)

    // assemble final result
    @data.user = base.user
    @data.billing = base.billing
    @data.tickets = base.tickets
    @data.projects = projectsWithSummary
    @data.overview = overview
    @data.validationError = validationError`,
});

const result = await parallelizationAgent();
console.log(JSON.stringify(result, null, 2));