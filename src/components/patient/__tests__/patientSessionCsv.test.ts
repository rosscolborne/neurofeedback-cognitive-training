import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../../types';
import { serializePatientSessionCsv } from '../patientSessionCsv';

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-1', patientId: 'patient-1', patientName: 'Synthetic Patient', clinicId: 'clinic-1',
  date: 'Sep 27, 2026', timestamp: Date.parse('2026-09-27T12:00:00Z'),
  protocol: 'theta-beta-ratio', experience: 'neuro-gambit', durationSeconds: 0,
  timeInZonePercent: 0, averageCoherence: null, peakFocusScore: 0,
  timeSeries: [], adaptiveAdjustmentsCount: 0, finalThreshold: 0,
  ...overrides,
});

// Parse records independently, including quoted newlines, to assert actual column boundaries.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      row.push(field); rows.push(row); row = []; field = '';
      if (char === '\r' && csv[i + 1] === '\n') i += 1;
    } else {
      field += char;
    }
  }
  row.push(field); rows.push(row);
  return rows;
}

describe('patient session CSV', () => {
  it('keeps nine stable columns and round-trips commas, quotes, CR, LF, and mixed text', () => {
    const input = [
      session({ id: 'demo', isDemo: true, date: 'Sep 27, 2026', experience: 'a,"b"\r\nc' as SessionRecord['experience'] }),
      session({ id: 'real', isDemo: false, date: 'line\none', protocol: 'quote "and", comma' as SessionRecord['protocol'], moodRating: 5 }),
      session({ id: 'legacy', date: 'carriage\rreturn', durationSeconds: 45, averageCoherence: 12.5, peakFocusScore: undefined }),
    ];
    const csv = serializePatientSessionCsv(input);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.length === 9)).toBe(true);
    expect(rows[0]).toEqual([
      'Date', 'Protocol', 'Experience', 'Duration (s)', 'Time In Zone %',
      'Coherence %', 'Peak Score', 'Mood', 'Training Demo',
    ]);
    expect(rows[1]).toEqual(['Sep 27, 2026', 'theta-beta-ratio', 'a,"b"\r\nc', '0', '0', '', '0', 'N/A', 'Yes']);
    expect(rows[2]).toEqual(['line\none', 'quote "and", comma', 'neuro-gambit', '0', '0', '', '0', '5', 'No']);
    expect(rows[3]).toEqual(['carriage\rreturn', 'theta-beta-ratio', 'neuro-gambit', '45', '0', '12.5', '', 'N/A', 'Unknown']);
    expect(csv).toContain('"a,""b""\r\nc"');
  });

  it('neutralizes formula-shaped legacy text even after leading whitespace or controls', () => {
    const rows = parseCsv(serializePatientSessionCsv([
      session({ date: '=SUM(1,1)', protocol: '  +command' as SessionRecord['protocol'], experience: '\t@function' as SessionRecord['experience'] }),
      session({ date: '\n-1+2', protocol: 'normal' as SessionRecord['protocol'] }),
    ]));
    expect(rows[1].slice(0, 3)).toEqual(["'=SUM(1,1)", "'  +command", "'\t@function"]);
    expect(rows[2][0]).toBe("'\n-1+2");
    expect(rows[2][1]).toBe('normal');
  });

  it('emits only the schema for an empty selection', () => {
    expect(parseCsv(serializePatientSessionCsv([]))).toHaveLength(1);
  });
});
