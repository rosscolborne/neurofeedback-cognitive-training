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
    expect(content.tableRows).toEqual(['Patient One | 0 | 0% | Unavailable (0/0) | Unavailable | 0 | 0 | Unavailable']);
    expect([...content.metadata, ...content.metrics, ...content.notes].join(' ')).not.toMatch(/significant|recommend continuing|Muse S Athena|Brain Capacity/i);
  });

  it('keeps patient zero measurements and interval provenance in PDF text', () => {
    const analytics = buildClinicalReportAnalytics([client], [session()], interval);
    const content = buildPatientReportText(client, analytics, brand, generatedAt);
    expect(content.metadata).toContain('Reporting timezone: UTC');
    expect(content.metadata).toContain('Source: stored session records (time, duration, in-zone measurement, device details); sample records are labeled.');
    expect(content.metrics).toContain('Average in-zone time: 0% (1/1 eligible sessions recorded)');
    expect(content.tableRows).toEqual(['Sep 19, 2026, 10:00 AM | Non-Demo | 10 min | 0% | Muse 2']);
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
    expect(content.metrics).toContain('Persisted sessions: 2');
    expect(content.metrics).toContain('Training Demo completions: 1 (included in aggregates; synthetic provenance)');
    expect(content.metrics).toContain('Average in-zone time: 50% (2/2 eligible sessions recorded)');
    expect(content.tableRows).toContain('Sep 19, 2026, 10:00 AM | Training Demo (synthetic) | 10 min | 100% | Synthetic Headset');
    expect(content.notes.join(' ')).toContain('Intentional training Demo sessions are included and labeled as synthetic');
  });

  it('retains explicit legacy selections with an invalid timestamp and renders date unavailable', () => {
    const legacy = session({ id: 'legacy', timestamp: 0, timeInZonePercent: 0 });
    const analytics = buildPatientSelectionReportAnalytics(client, [legacy], generatedAt);
    const content = buildPatientReportText(client, analytics, brand, generatedAt);
    expect(analytics.totalSessions).toBe(1);
    expect(content.metrics).toContain('Persisted sessions: 1');
    expect(content.tableRows).toEqual(['Unavailable | Non-Demo | 10 min | 0% | Muse 2']);
  });

  it('dates selection exports in the given local timezone rather than UTC', () => {
    const lateEvening = session({ timestamp: Date.parse('2026-09-20T02:00:00Z') });
    const analytics = buildPatientSelectionReportAnalytics(client, [lateEvening], generatedAt + 86_400_000, 'America/Toronto');
    const content = buildPatientReportText(client, analytics, brand, generatedAt + 86_400_000, 'all-sessions');
    expect(content.metadata).toContain('Reporting timezone: America/Toronto');
    expect(content.tableRows).toEqual(['Sep 19, 2026, 10:00 PM | Non-Demo | 10 min | 0% | Muse 2']);
  });

  it('labels a single selected session as scoped, without account-wide counts or a false schedule reason', () => {
    const analytics = buildPatientSelectionReportAnalytics(client, [session()], generatedAt, 'UTC');
    const content = buildPatientReportText(client, analytics, brand, generatedAt, 'selected-session');
    expect(content.title).toBe('Selected Session Report');
    expect(content.metadata).toContain('Report scope: 1 selected session (other sessions are not included)');
    expect(content.metrics).toContain('Sessions in this report: 1 (selected session only)');
    expect(content.metrics).toContain('Adherence: Not calculated for a single-session report (weekly prescription: 1 session)');
    expect(content.metrics.join(' ')).not.toMatch(/Persisted sessions|schedule unavailable/);
    expect(content.notes.join(' ')).not.toContain('Adherence formula');
  });

  it('marks an all-sessions export as covering every recorded session', () => {
    const analytics = buildPatientSelectionReportAnalytics(client, [session(), session({ id: 'two' })], generatedAt, 'UTC');
    const content = buildPatientReportText(client, analytics, brand, generatedAt, 'all-sessions');
    expect(content.title).toBe('Patient Session Activity Report');
    expect(content.metadata).toContain('Report scope: All recorded sessions (2)');
    expect(content.metrics).toContain('Persisted sessions: 2');
    expect(content.metrics).toContain('Adherence: Not calculated for an all-sessions export (weekly prescription: 1 session)');
  });
});
