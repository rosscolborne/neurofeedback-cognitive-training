import { DEFAULT_SIMULATION_OPTIONS, formatSimulationReport, runSimulation } from './simulation';

// Prints the Mental Math v1 simulation report as Markdown:
//   npm run simulate:mental-math
// shared/ is type-checked without Node or DOM types, so the script reaches
// the runtime's console through globalThis.

const { console } = globalThis as unknown as { console: { log(text: string): void } };
console.log(formatSimulationReport(runSimulation(DEFAULT_SIMULATION_OPTIONS)));
