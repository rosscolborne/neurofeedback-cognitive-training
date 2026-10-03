import { describe, expect, it } from 'vitest';
import { formatSimulationReport, recallChance, runSimulation, type SimulationOptions } from '../simulation';

const SMALL: SimulationOptions = { generatorSequences: 3_000, scoringRuns: 24, seed: 7 };

// The simulation sets v1's provisional parameters (NFCT-93). These tests pin
// what the parameters were chosen for, so a later tuning keeps them true or
// changes them deliberately.
describe('Sequence Memory v1 simulation', () => {
  const report = runSimulation(SMALL);
  const cell = (profile: string, startLevel: number) =>
    report.scoring.find((entry) => entry.profile === profile && entry.startLevel === startLevel)!;

  it('generates only legal sequences, spread evenly over the board', () => {
    expect(report.generator).toHaveLength(10);
    for (const level of report.generator) {
      expect({ level: level.level, illegal: level.illegal }).toEqual({ level: level.level, illegal: 0 });
      expect(level.tileBalance.min).toBeGreaterThan(0.75);
      expect(level.tileBalance.max).toBeLessThan(1.25);
    }
  });

  it('finds no plausibility reason in any honest synthetic run', () => {
    for (const entry of report.scoring) {
      expect({ cell: `${entry.profile}@${entry.startLevel}`, reasons: entry.reasons }).toEqual({ cell: `${entry.profile}@${entry.startLevel}`, reasons: [] });
    }
  });

  it('keeps a run to about two to three minutes', () => {
    for (const profile of ['beginner', 'average', 'strong', 'expert']) {
      expect(cell(profile, 1).elapsedMs.median).toBeGreaterThanOrEqual(100_000);
      expect(cell(profile, 10).elapsedMs.median).toBeLessThanOrEqual(200_000);
    }
    // Every run ends within the definition's bound, even for slow players.
    for (const entry of report.scoring) expect(entry.activeMs.max).toBeLessThanOrEqual(358_000);
  });

  it('scores and climbs higher with skill', () => {
    expect(cell('expert', 1).score.median).toBeGreaterThan(cell('strong', 1).score.median);
    expect(cell('strong', 1).score.median).toBeGreaterThan(cell('average', 1).score.median);
    expect(cell('average', 1).score.median).toBeGreaterThan(cell('beginner', 1).score.median);
    expect(cell('expert', 1).peakLevel.median).toBeGreaterThan(cell('beginner', 1).peakLevel.median);
  });

  it('models recall as a half chance at the player\'s span', () => {
    expect(recallChance(5, 5)).toBe(0.5);
    expect(recallChance(5, 4)).toBeGreaterThan(0.5);
    expect(recallChance(5, 6)).toBeLessThan(0.5);
  });

  it('is deterministic and renders Markdown tables', () => {
    expect(runSimulation(SMALL)).toEqual(report);
    const text = formatSimulationReport(report);
    expect(text).toContain('## Generator, per level');
    expect(text.split('\n').filter((line) => line.startsWith('| beginner |'))).toHaveLength(10);
  });
});
