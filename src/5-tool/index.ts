/**
 * Tool Use Example
 *
 * Demonstrates how to create tools that an LLM can use to answer queries.
 * Shows both API-based tools and LLM-powered tools working together.
 */

import { create } from 'casai';
import { basicModel, advancedModel } from '../setup';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stepCountIs } from 'ai';

// Tool 1: LLM-powered time interpreter
const timeInterpreterTool = create.ObjectGenerator.withTemplate.asTool({
	model: advancedModel,
	temperature: 0,
	prompt: `Current datetime: {{ currentTime }}

Parse this time reference: "{{ timeString }}"

Determine how many days from now it represents.
- For "today", "now", "currently": 0 days from now
- For "tonight", "this evening": 0 days from now
- For "tomorrow": 1 day from now
- For "day after tomorrow": 2 days from now
- For specific days like "Monday", "next Friday": calculate days from current date
- For "this week", "next week": use the nearest relevant date

Return days from now (0-7) and a human-readable interpretation.`,
	schema: z.object({
		daysFromNow: z.number().min(0).max(7).describe('Number of days from today (0-7)'),
		interpretation: z.string().describe('Human-readable interpretation')
	}),
	description: 'Interprets natural language time references (like "tomorrow", "next Monday") and calculates days from now.',
	inputSchema: z.object({
		currentTime: z.string().describe('Current datetime in ISO format'),
		timeString: z.string().describe('Natural language time reference')
	})
});

// Tool 2: Convert location name to coordinates
const geocodeTool = create.Function.asTool({
	description: 'Converts a location name to coordinates (latitude and longitude).',
	inputSchema: z.object({
		location: z.string().describe('Location name (e.g., "London", "Paris, France")')
	}),
	execute: async ({ location }) => {
		const response = await fetch(
			`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
			{ headers: { 'User-Agent': 'CasaiWeatherExample/1.0' } }
		);

		if (!response.ok) {
			throw new Error(`Geocoding failed: ${response.statusText}`);
		}

		const data = await response.json() as { lat: string, lon: string, display_name: string }[];
		if (!Array.isArray(data) || data.length === 0) {
			throw new Error(`Location not found: ${location}`);
		}

		return {
			lat: parseFloat(data[0].lat),
			lon: parseFloat(data[0].lon),
			displayName: data[0].display_name
		};
	}
});

// Tool 3: Fetch weather data for coordinates
const weatherFetchTool = create.Function.asTool({
	description: 'Fetches weather data. Use daysFromNow=0 for current weather, 1-7 for daily forecast. Weather codes: 0=clear, 1-3=cloudy, 45-48=fog, 51-67=rain, 71-86=snow, 95-99=thunderstorm',
	inputSchema: z.object({
		lat: z.number().describe('Latitude'),
		lon: z.number().describe('Longitude'),
		daysFromNow: z.number().min(0).max(7).describe('Days from now: 0=current, 1-7=daily forecast')
	}),
	execute: async ({ lat, lon, daysFromNow }: { lat: number, lon: number, daysFromNow: number }) => {
		if (daysFromNow === 0) {
			// Fetch current weather
			const response = await fetch(
				`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&temperature_unit=celsius&timezone=auto`
			);

			if (!response.ok) {
				throw new Error(`Weather API failed: ${response.statusText}`);
			}

			const data = await response.json() as { current: { temperature_2m: number, relative_humidity_2m: number, precipitation: number, weather_code: number, wind_speed_10m: number } };
			return {
				temperature: data.current.temperature_2m,
				humidity: data.current.relative_humidity_2m,
				precipitation: data.current.precipitation,
				weatherCode: data.current.weather_code,
				windSpeed: data.current.wind_speed_10m,
				isForecast: false
			};
		} else {
			// Fetch daily forecast
			const response = await fetch(
				`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&temperature_unit=celsius&timezone=auto&forecast_days=${daysFromNow + 1}`
			);

			if (!response.ok) {
				throw new Error(`Weather API failed: ${response.statusText}`);
			}

			const data = await response.json() as { daily: { time: string[], temperature_2m_max: number[], temperature_2m_min: number[], precipitation_sum: number[], weather_code: number[] } };

			if (!Array.isArray(data.daily.time) || data.daily.time.length <= daysFromNow) {
				throw new Error('Forecast data not available for requested day');
			}

			return {
				date: data.daily.time[daysFromNow],
				temperatureMax: data.daily.temperature_2m_max[daysFromNow],
				temperatureMin: data.daily.temperature_2m_min[daysFromNow],
				precipitation: data.daily.precipitation_sum[daysFromNow],
				weatherCode: data.daily.weather_code[daysFromNow],
				isForecast: true
			};
		}
	}
});

// Agent that uses all three tools to answer weather queries
const weatherAssistant = create.TextGenerator({
	model: basicModel,
	temperature: 0.3,
	system: `You are a weather assistant. Answer weather questions using these tools:

1. If the query mentions time (tomorrow, tonight, next Monday, etc.), use timeInterpreterTool first to get daysFromNow
2. Use geocodeTool to get coordinates for the location
3. Use weatherFetchTool with the daysFromNow value (0 for current, 1-7 for forecast)
4. Provide clear, friendly answers with temperature and conditions

Weather data format:
- Current weather (isForecast=false): has temperature, humidity, precipitation, weatherCode, windSpeed
- Forecast (isForecast=true): has date, temperatureMax, temperatureMin, precipitation, weatherCode`,
	tools: { timeInterpreterTool, geocodeTool, weatherFetchTool },
	stopWhen: stepCountIs(10),
	/*onStepFinish: ({ toolCalls }) => {
		toolCalls?.forEach(call =>
			console.log(`🔧 ${call.toolName}(${JSON.stringify(call.input)})`)
		);
	}*/
});

// Main example
async function main() {
	const query = readFileSync(join(__dirname, 'input.txt'), 'utf-8').trim();
	const currentTime = new Date().toISOString();

	console.log('Weather Intelligence Tools Example');
	console.log('='.repeat(60));
	console.log(`Current time: ${currentTime}`);
	console.log(`Query: ${query}\n`);

	const result = (await weatherAssistant(query, { currentTime })).text;

	console.log(`\nAnswer: ${result}\n`);
}

// Direct tool testing
/*async function testToolsDirectly() {
	const currentTime = new Date().toISOString();

	console.log('\nDirect Tool Testing');
	console.log('='.repeat(60));
	console.log(`Current time: ${currentTime}\n`);

	// Test time interpreter
	const timeResult = await timeInterpreterTool.execute(
		{ currentTime, timeString: 'tomorrow' },
		{ toolCallId: 'test-1', messages: [] }
	);
	console.log('1. Time interpreter result:', timeResult);

	// Test geocoding
	const coords = await geocodeTool.execute(
		{ location: 'London' },
		{ toolCallId: 'test-2', messages: [] }
	);
	console.log('\n2. Geocode result:', coords);

	// Test current weather
	const currentWeather = await weatherFetchTool.execute(
		{ lat: coords.lat, lon: coords.lon, daysFromNow: 0 },
		{ toolCallId: 'test-3', messages: [] }
	);
	console.log('\n3. Current weather result:', currentWeather);

	// Test forecast
	const forecast = await weatherFetchTool.execute(
		{ lat: coords.lat, lon: coords.lon, daysFromNow: 1 },
		{ toolCallId: 'test-4', messages: [] }
	);
	console.log('\n4. Tomorrow forecast result:', forecast);
}*/

// Run
if (require.main === module) {
	// Uncomment to test tools directly:
	// testToolsDirectly().then(() => main());

	main().catch(console.error);
}