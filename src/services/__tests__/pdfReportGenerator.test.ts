import { describe, expect, it } from 'vitest';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../../types';
import { buildClinicalReportAnalytics, createReportInterval } from '../../components/clinician/clinicalReportAnalytics';
import { buildPatientReportText, buildPatientSelectionReportAnalytics, buildPracticeReportText } from '../pdfReportGenerator';

const brand = { name: 'Evidence Clinic' } as ClinicBrandConfig;
const client = {
  id: 'patient-1', name: 'Patient One', email: 'patient@example.com', condition: 'Generalized Anxiety',
  assignedProtocol: 'alpha-enhancement', prescribedSessionsPerWeek: 1, isDemo: false,
} as ClientProfile;
const session = (overrides: Partial<SessionRecord> = {}) => ({
  id: 'session-1', patientId: client.id, patientName: client.name, clinicId: 'clinic-1',
  timestamp: Date.parse('2026-09-19T10:00:00Z'), durationSeconds: 600, timeInZonePercent: 0,
  device: { model: 'Muse 2' }, ...overrides,
} as SessionRecord);
const generatedAt = Date.parse('2026-09-19T12:00:00Z');
const interval = createReportInterval('30d', generatedAt, 'UTC');

describe('deterministic PDF report text', () => {
  it('renders empty practice values as unavailable without fabricated claims', () => {
    const content = buildPracticeReportText(buildClinicalReportAnalytics([client], [], interval), brand, generatedAt);
    expect(content.metadata).toContain('Reporting interval: Aug 21, 2026 – Sep 19, 2026');
    expect(content.metrics).toContain('Average in-zone time: Unavailable (0/0 eligible sessions recorded)');
    expect(content.metrics).toContain('Device snapshot coverage: Unavailable (0/0 eligible sessions recorded)');
    expect(content.tableRows).toEqual(['Patient One | 0 | 0 | Unavailable | 0% | Unavailable (0/0) | Unavailable']);
    expect([...content.metadata, ...content.metrics, ...content.notes].join(' ')).not.toMatch(/significant|recommend continuing|Muse S Athena|Brain Capacity/i);
  });

  it('keeps patient zero measurements and interval provenance in PDF text', () => {
    const analytics = buildClinicalReportAnalytics([client], [session()], interval);
    const content = buildPatientReportText(client, analytics, brand, generatedAt);
    expect(content.metadata).toContain('Reporting timezone: UTC');
    expect(content.metadata).toContain('Source provenance: authenticated session repository fields (timestamp, duration, in-zone measurement, and device snapshot); sample records are labeled.');
    expect(content.metrics).toContain('Average in-zone time: 0% (1/1 eligible sessions recorded)');
    expect(content.tableRows).toEqual(['Sep 19, 2026, 10:00 AM | 10 min | 0% | Muse 2']);
  });

  it('reports partial coverage rather than substituting missing values', () => {
    const analytics = buildClinicalReportAnalytics([client], [
      session(),
      session({ id: 'partial', timestamp: generatedAt - 1, durationSeconds: Number.NaN, timeInZonePercent: Number.NaN, device: undefined }),
    ], interval);
    const content = buildPracticeReportText(analytics, brand, generatedAt);
    expect(content.metrics).toContain('Average session duration: 10 minutes (1/2 eligible sessions recorded)');
    expect(content.metrics).toContain('Average in-zone time: 0% (1/2 eligible sessions recorded)');
    expect(content.metrics).toContain('Device snapshot coverage: 50% (1/2 eligible sessions recorded)');
  });

  it('includes persisted training Demo activity and labels its provenance', () => {
    const analytics = buildClinicalReportAnalytics([client], [
      session({ id: 'real-zero', timeInZonePercent: 0, device: undefined }),
      session({ id: 'demo', isDemo: true, timeInZonePercent: 100, device: { model: 'Synthetic Headset' } }),
    ], interval);
    const content = buildPatientReportText(client, analytics, brand, generatedAt);
    expect(content.metrics).toContain('Clinical sessions: 2');
    expect(content.metrics).toContain('Training Demo completions: 1 (included in aggregates; synthetic provenance)');
    expect(content.metrics).toContain('Average in-zone time: 50% (2/2 eligible sessions recorded)');
    expect(content.tableRows).toContain('Sep 19, 2026, 10:00 AM | 10 min | 100% | Synthetic Headset');
  });

  it('retains explicit legacy selections with an invalid timestamp and renders date unavailable', () => {
    const legacy = session({ id: 'legacy', timestamp: 0, timeInZonePercent: 0 });
    const analytics = buildPatientSelectionReportAnalytics(client, [legacy], generatedAt);
    const content = buildPatientReportText(client, analytics, brand, generatedAt);
    expect(analytics.totalSessions).toBe(1);
    expect(content.metrics).toContain('Clinical sessions: 1');
    expect(content.tableRows).toEqual(['Unavailable | 10 min | 0% | Muse 2']);
  });
});
