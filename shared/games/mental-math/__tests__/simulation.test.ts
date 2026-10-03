import { describe, expect, it } from 'vitest';
import { formatSimulationReport, runSimulation, type SimulationOptions } from '../simulation';

const SMALL: SimulationOptions = { generatorRuns: 120, questionsPerRun: 40, scoringRuns: 8, seed: 7 };

describe('Mental Math v1 simulation', () => {
  const report = runSimulation(SMALL);

  it('generates no trivial, illegal or fallback questions at any level', () => {
    expect(report.generator).toHaveLength(10);
    for (const level of report.generator) {
      expect(level.questions).toBe(SMALL.generatorRuns * SMALL.questionsPerRun);
      expect({ level: level.level, trivial: level.trivial, illegal: level.illegal, fallbacks: level.fallbacks })
        .toEqual({ level: level.level, trivial: 0, illegal: 0, fallbacks: 0 });
      expect(level.answers.min).toBeGreaterThanOrEqual(1);
      expect(level.answers.max).toBeLessThanOrEqual(999);
    }
  });

  it('mixes steps as designed: one-step at levels 1-6, mostly two-step at 7-10', () => {
    for (const level of report.generator) {
      if (level.level <= 6) {
        expect(level.twoStepShare).toBe(0);
        expect(level.intermediates).toBeNull();
      } else {
        expect(level.twoStepShare).toBeGreaterThan(0.75);
        expect(level.twoStepShare).toBeLessThan(0.85);
      }
    }
  });

  it('finds no plausibility reason in any honest synthetic run, and scores rise with skill', () => {
    for (const cell of report.scoring) expect({ cell: `${cell.profile}@${cell.startLevel}`, reasons: cell.reasons }).toEqual({ cell: `${cell.profile}@${cell.startLevel}`, reasons: [] });
    const medianAt = (profile: string, startLevel: number) =>
      report.scoring.find((cell) => cell.profile === profile && cell.startLevel === startLevel)!.score.median;
    expect(medianAt('expert', 1)).toBeGreaterThan(medianAt('strong', 1));
    expect(medianAt('strong', 1)).toBeGreaterThan(medianAt('average', 1));
    expect(medianAt('average', 1)).toBeGreaterThan(medianAt('beginner', 1));
  });

  it('gives a higher start level no longer runs or meaningfully higher scores than level 1 (NFCT-60)', () => {
    const fairness = runSimulation({ generatorRuns: 1, questionsPerRun: 1, scoringRuns: 100, seed: 7 });
    const cell = (profile: string, startLevel: number) =>
      fairness.scoring.find((entry) => entry.profile === profile && entry.startLevel === startLevel)!;
    for (const profile of ['average', 'strong', 'expert']) {
      const fromOne = cell(profile, 1);
      for (let startLevel = 2; startLevel <= 10; startLevel += 1) {
        const higher = cell(profile, startLevel);
        expect({ profile, startLevel, length: higher.runLengthMs.median <= fromOne.runLengthMs.median })
          .toEqual({ profile, startLevel, length: true });
        expect({ profile, startLevel, score: higher.score.median <= 1.05 * fromOne.score.median })
          .toEqual({ profile, startLevel, score: true });
      }
    }
    // Every run ends, within the time bank's limit.
    for (const entry of fairness.scoring) expect(entry.runLengthMs.max).toBeLessThanOrEqual(180_000);
  });

  it('is deterministic and renders Markdown tables', () => {
    expect(runSimulation(SMALL)).toEqual(report);
    const text = formatSimulationReport(report);
    expect(text).toContain('## Generator, per level');
    expect(text).toContain('## Scoring: synthetic players');
    expect(text.split('\n').filter((line) => line.startsWith('| beginner |'))).toHaveLength(10);
  });
});
