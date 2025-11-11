/**
 * TYPES + SCHEMAS for 5-parallelization.ts
 *
 * Putting both here keeps the main example focused on orchestration.
 */

import { z } from "zod";

/* ---------- Primitive pieces ---------- */

export const UserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const BillingSchema = z.object({
	plan: z.string(),
	nextCharge: z.string(),
	amount: z.number(),
});
export type Billing = z.infer<typeof BillingSchema>;

export const TicketSchema = z.object({
	id: z.string(),
	subject: z.string(),
	status: z.string(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const ProjectActivityEntrySchema = z.object({
	ts: z.string(),
	message: z.string(),
});
export type ProjectActivityEntry = z.infer<typeof ProjectActivityEntrySchema>;

export const ProjectAnalyticsSchema = z.object({
	monthlyActive: z.number(),
	errors: z.number(),
	latencyMs: z.number(),
});
export type ProjectAnalytics = z.infer<typeof ProjectAnalyticsSchema>;

/* ---------- Project as stored in JSON (already has analytics/activity) ---------- */

export const ProjectWithDataSchema = z.object({
	id: z.string(),
	name: z.string(),
	tier: z.string(),
	description: z.string(),
	analytics: ProjectAnalyticsSchema.optional(),
	activity: z.array(ProjectActivityEntrySchema).optional(),
});
export type ProjectWithData = z.infer<typeof ProjectWithDataSchema>;

/* ---------- Top-level JSON shape ---------- */

export const DemoDataSchema = z.object({
	data: z.object({
		user: UserSchema,
		billing: BillingSchema,
		tickets: z.array(TicketSchema),
	}),
	projects: z.record(ProjectWithDataSchema),
});
export type DemoData = z.infer<typeof DemoDataSchema>;

/* ---------- Orchestrator output ---------- */

export const EnrichedProjectSchema = ProjectWithDataSchema.extend({
	summary: z.string(),
});
export type EnrichedProject = z.infer<typeof EnrichedProjectSchema>;

export const DashboardResultSchema = z.object({
	user: UserSchema,
	billing: BillingSchema,
	tickets: z.array(TicketSchema),
	projects: z.array(EnrichedProjectSchema),
	overview: z.string(),
	validationError: z.string().nullable(),
});
export type DashboardResult = z.infer<typeof DashboardResultSchema>;
