/**
 * PARALLELIZATION PATTERN EXAMPLE
 *
 * Demonstrates automatic parallel execution through simple for loops.
 *
 * HOW IT WORKS:
 * 1. Identify markets
 * 2. Find stocks (for loop - Cascada parallelizes)
 * 3. Analyze stocks (for loop - Cascada parallelizes)
 * 4. Rank in JS
 *
 * KEY CONCEPTS:
 * - Write simple for loops - Cascada parallelizes automatically
 * - Use capture:data with @data.push to collect parallel results
 * - TextGenerator for prose, ObjectGenerator for structured data
 * - Use output: 'array' for simple array outputs
 * - Do math and sorting in JS, not in LLM
 * - Templates for all text formatting (prompts and output)
 */

import { basicModel, advancedModel } from '../setup';
import { create, FileSystemLoader } from 'casai';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import inputData from './input.json';

// 1. Define model configurations
const quickConfig = create.Config({
	model: basicModel,
	temperature: 0.4,
});

const analyticalConfig = create.Config({
	model: advancedModel,
	temperature: 0.7,
});

// 2. Schemas - only where structure needed

const StockListSchema = z.object({
	stocks: z.array(z.object({
		companyName: z.string(),
		ticker: z.string(),
	})),
});

const ComponentScoresSchema = z.object({
	criteriaAlignment: z.number().min(0).max(10),
	financialStrength: z.number().min(0).max(10),
	growthPotential: z.number().min(0).max(10),
	marketPosition: z.number().min(0).max(10),
	contrarianScore: z.number().min(0).max(10),
	riskLevel: z.number().min(0).max(10),
});

// Derive type from schema
type ComponentScores = z.infer<typeof ComponentScoresSchema>;

// Reuse scores inside stock analysis (rank is kept out initially)
const StockAnalysisSchema = ComponentScoresSchema.extend({
	ticker: z.string(),
	companyName: z.string(),
	market: z.string(),
	analysis: z.string(),
	finalScore: z.number(),
});

// This is what we finally return from JS after ranking
const RankedStockAnalysisSchema = StockAnalysisSchema.extend({
	rank: z.number(),
});

const StockAnalysisResultSchema = z.object({
	markets: z.array(z.string()),
	total: z.number(),
	analyzed: z.number(),
	skipped: z.number(),
	topStocks: z.array(RankedStockAnalysisSchema),
});

// 2b. Shared loader for all templates (instead of path)
const templatesDir = fileURLToPath(new URL('./templates', import.meta.url));
const templateLoader = new FileSystemLoader(templatesDir);

// 3. Define generators - all loading from templates folder

const marketIdentifier = create.ObjectGenerator.loadsTemplate({
	loader: templateLoader,
	output: 'array',
	// Cascada wants schema even for string array outputs
	schema: z.string(),
	prompt: 'identify-markets.md',
}, analyticalConfig);

const stockFinder = create.ObjectGenerator.loadsTemplate({
	loader: templateLoader,
	output: 'object',
	schema: StockListSchema,
	prompt: 'find-stocks.md',
}, analyticalConfig);

const companyInfoExtractor = create.TextGenerator.loadsTemplate({
	loader: templateLoader,
	prompt: 'extract-info.md',
}, quickConfig);

const analysisWriter = create.TextGenerator.loadsTemplate({
	loader: templateLoader,
	prompt: 'analyze.md',
}, analyticalConfig);

const componentScorer = create.ObjectGenerator.loadsTemplate({
	loader: templateLoader,
	output: 'object',
	schema: ComponentScoresSchema,
	prompt: 'score-components.md',
}, analyticalConfig);

// 4. Load text templates

const investmentContextTemplate = create.Template.loadsTemplate({
	loader: templateLoader,
	template: 'investment-context.txt',
});

const outputTemplate = create.Template.loadsTemplate({
	loader: templateLoader,
	template: 'output.txt',
});

// 5. JS helper functions (with proper types)
// Now it THROWS so Cascada can detect with `is error` in the script
async function fetchYahooFinance(ticker: string): Promise<string> {
	const response = await fetch(`https://finance.yahoo.com/quote/${ticker}/`);
	if (!response.ok) {
		throw new Error(`Failed to fetch Yahoo Finance data for ${ticker}`);
	}
	const html = await response.text();
	return html.substring(0, 50000);
}

function calculateFinalScore(scores: ComponentScores): number {
	return (
		scores.criteriaAlignment * 0.30 +
		scores.financialStrength * 0.20 +
		scores.growthPotential * 0.25 +
		scores.marketPosition * 0.15 +
		scores.contrarianScore * 0.10 -
		scores.riskLevel * 0.25
	);
}

interface StockAnalysis {
	ticker: string;
	companyName: string;
	market: string;
	analysis: string;
	finalScore: number;
	criteriaAlignment: number;
	financialStrength: number;
	growthPotential: number;
	marketPosition: number;
	contrarianScore: number;
	riskLevel: number;
}

interface RankedStockAnalysis extends StockAnalysis {
	rank: number;
}

interface Config {
	marketContext: string;
	preferCriteria: string;
	avoidCriteria: string;
	numMarkets: number;
	numAdditionalMarkets: number;
	numStocksPerMarket: number;
	numTopStocks: number;
	numMaxStocksPerMarket: number;
}

// fixed version (no TS typos)
function rankAndFilter(analyses: StockAnalysis[], config: Config): RankedStockAnalysis[] {
	const sorted = [...analyses].sort((a, b) => b.finalScore - a.finalScore);
	const result: RankedStockAnalysis[] = [];
	const marketCounts: Record<string, number> = {};

	for (const stock of sorted) {
		const count = marketCounts[stock.market] || 0;
		if (count < config.numMaxStocksPerMarket && result.length < config.numTopStocks) {
			result.push({
				rank: result.length + 1,
				...stock,
			});
			marketCounts[stock.market] = count + 1;
		}
	}

	return result;
}

// 6. Create the orchestrator script
const stockAnalysisAgent = create.Script({
	schema: StockAnalysisResultSchema,
	context: {
		config: inputData,
		marketIdentifier,
		stockFinder,
		companyInfoExtractor,
		analysisWriter,
		componentScorer,
		investmentContextTemplate,
		fetchYahooFinance,
		calculateFinalScore,
		rankAndFilter,
	},
	script: `
		:data

		// Create reusable investment context string
		var investmentContext = investmentContextTemplate(config)

		// STEP 1: Identify markets (returns string array directly)
		var markets = marketIdentifier({
			marketContext: config.marketContext,
			numMarkets: config.numMarkets,
			numAdditionalMarkets: config.numAdditionalMarkets
		}).array

		// STEP 2: Find stocks (parallel per market via for loop)
		var allStocks = capture :data
		for market in markets
			var result = stockFinder({
				marketName: market,
				investmentContext: investmentContext,
				numStocksPerMarket: config.numStocksPerMarket
			}).object.stocks

			for stock in result
				@data.push({
					companyName: stock.companyName,
					ticker: stock.ticker,
					market: market
				})
			endfor
		endfor
		endcapture

		// repair if the capture was poisoned
		if allStocks is error
			allStocks = []
		endif

		// STEP 3: Analyze stocks (parallel via for loop)
		var analyses = capture :data
			for stock in allStocks
				// this will be 'error' if fetchYahooFinance threw in JS
				var yahooData = fetchYahooFinance(stock.ticker)

				if yahooData is not error
					var companyInfo = companyInfoExtractor({
						ticker: stock.ticker,
						yahooData: yahooData
					}).text

					if companyInfo is not error
						var analysis = analysisWriter({
							ticker: stock.ticker,
							companyName: stock.companyName,
							market: stock.market,
							companyInfo: companyInfo,
							investmentContext: investmentContext
						}).text

						var scores = componentScorer({
							ticker: stock.ticker,
							companyName: stock.companyName,
							analysis: analysis,
							investmentContext: investmentContext
						}).object

						var finalScore = calculateFinalScore(scores)

						@data.push({
							ticker: stock.ticker,
							companyName: stock.companyName,
							market: stock.market,
							analysis: analysis,
							criteriaAlignment: scores.criteriaAlignment,
							financialStrength: scores.financialStrength,
							growthPotential: scores.growthPotential,
							marketPosition: scores.marketPosition,
							contrarianScore: scores.contrarianScore,
							riskLevel: scores.riskLevel,
							finalScore: finalScore
						})
					endif
				endif
			endfor
		endcapture

		// repair analyses too, to avoid "analyses is not iterable"
		if analyses is error
			analyses = []
		endif

		// STEP 4: Rank and filter in JS
		var topStocks = rankAndFilter(analyses, config)

		// OUTPUT
		@data.markets = markets
		@data.total = allStocks.length
		@data.analyzed = analyses.length
		@data.skipped = allStocks.length - analyses.length
		@data.topStocks = topStocks
	`
});

// 7. Run the agent
console.log('Starting stock analysis agent...\n');
console.log('Watch Cascada automatically parallelize the for loops!\n');

const result = await stockAnalysisAgent();

// 8. Format and print output using template
const output = await outputTemplate(result);
console.log(output);
