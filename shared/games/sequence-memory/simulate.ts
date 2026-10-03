import { DEFAULT_SIMULATION_OPTIONS, formatSimulationReport, runSimulation } from './simulation';

// Prints the Sequence Memory v1 simulation report:
// npx tsx shared/games/sequence-memory/simulate.ts

const { console } = globalThis as unknown as { console: { log(text: string): void } };
console.log(formatSimulationReport(runSimulation(DEFAULT_SIMULATION_OPTIONS)));
