import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../types';
import type { ClinicalReportAnalytics } from '../components/clinician/clinicalReportAnalytics';
import { buildClinicalReportAnalytics, formatMetric } from '../components/clinician/clinicalReportAnalytics';

export interface ReportTextContent {
  title: string;
  metadata: string[];
  metrics: string[];
  notes: string[];
  tableHeader: string;
  tableRows: string[];
}

function reportInterval(analytics: ClinicalReportAnalytics): string {
  const { interval } = analytics;
  return `${interval.startLabel} – ${interval.endLabel}`;
}

function generatedLabel(generatedAt: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(generatedAt));
}

function coverage(recorded: number, eligible: number): string {
  return `${recorded}/${eligible} eligible sessions recorded`;
}

export function buildPracticeReportText(
  analytics: ClinicalReportAnalytics,
  brand: ClinicBrandConfig,
  generatedAt = Date.now(),
): ReportTextContent {
  const deviceModels = analytics.deviceModels.length > 0
    ? analytics.deviceModels.map(item => `${item.model} (${item.sessions})`).join(', ')
    : 'Unavailable';
  const trend = analytics.timeInZoneTrend
    ? `Observed in-zone change: ${analytics.timeInZoneTrend.firstAverage}% first-half average to ${analytics.timeInZoneTrend.recentAverage}% recent-half average (${analytics.timeInZoneTrend.change > 0 ? '+' : ''}${analytics.timeInZoneTrend.change} percentage points; descriptive only).`
    : 'Observed in-zone change: Unavailable (fewer than two recorded measurements).';

  return {
    title: 'Practice Session Activity Report',
    metadata: [
      `Clinic: ${brand?.name?.trim() || 'Unavailable'}`,
      `Generated: ${generatedLabel(generatedAt, analytics.interval.timeZone)}`,
      `Reporting interval: ${reportInterval(analytics)}`,
      `Reporting timezone: ${analytics.interval.timeZone}`,
      'Source provenance: authenticated session repository fields (timestamp, duration, in-zone measurement, and device snapshot); sample records are labeled.',
    ],
    metrics: [
      `Selected cohort: ${analytics.clients.length} patient profiles`,
      `Clinical sessions: ${analytics.totalSessions}`,
      `Training Demo completions: ${analytics.demoSessionCount} (included in aggregates; synthetic provenance)`,
      `Total recorded duration: ${formatMetric(analytics.totalDurationMinutes, ' minutes')}`,
      `Average session duration: ${formatMetric(analytics.averageDurationMinutes.value, ' minutes')} (${coverage(analytics.averageDurationMinutes.recordedSessions, analytics.averageDurationMinutes.eligibleSessions)})`,
      `Interval adherence: ${formatMetric(analytics.adherencePercent, '%')} (${analytics.expectedSessions == null ? 'schedule unavailable' : `${analytics.totalSessions} of ${analytics.expectedSessions} scheduled sessions`})`,
      `Average in-zone time: ${formatMetric(analytics.averageInZonePercent.value, '%')} (${coverage(analytics.averageInZonePercent.recordedSessions, analytics.averageInZonePercent.eligibleSessions)})`,
      `Device snapshot coverage: ${formatMetric(analytics.deviceCoverage.value, '%')} (${coverage(analytics.deviceCoverage.recordedSessions, analytics.deviceCoverage.eligibleSessions)})`,
      `Recorded device models: ${deviceModels}`,
      trend,
    ],
    notes: [
      `Adherence formula: non-Demo interval sessions divided by scheduled sessions (weekly prescription × ${analytics.interval.dayCount}/7), capped at 100%.`,
      'Training Demo and sample-record sessions use synthetic input and are excluded from durations, adherence, in-zone measurements, trends, device coverage, device models, and clinical session rows.',
      'In-zone values and their change are descriptive session measurements, not diagnoses, benchmark comparisons, treatment outcomes, or statistical significance claims.',
      'Spectral-band, QEEG, recommendation, and clinical outcome claims are not included because this report has no validated source contract for those claims.',
      'Unavailable values are not replaced with cohort defaults or zero.',
    ],
    tableHeader: 'Patient | Clinical sessions | Demo completions | Duration | Adherence | In-zone | Device snapshots',
    tableRows: analytics.patientRows.map(row => [
      `${row.client.name}${row.client.isDemo ? ' (Sample record)' : ''}`,
      row.sessionCount,
      row.demoSessionCount,
      formatMetric(row.durationMinutes, ' min'),
      formatMetric(row.adherencePercent, '%'),
      `${formatMetric(row.averageInZonePercent, '%')} (${row.inZoneRecordedSessions}/${row.sessionCount})`,
      row.sessionCount === 0 ? 'Unavailable' : `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}% (${row.deviceRecordedSessions}/${row.sessionCount})`,
    ].join(' | ')),
  };
}

export function buildPatientReportText(
  client: ClientProfile,
  analytics: ClinicalReportAnalytics,
  brand: ClinicBrandConfig,
  generatedAt = Date.now(),
): ReportTextContent {
  const row = analytics.patientRows.find(item => item.client.id === client.id);
  const sessions = row?.sessions ?? [];
  return {
    title: 'Patient Session Activity Report',
    metadata: [
      `Clinic: ${brand?.name?.trim() || 'Unavailable'}`,
      `Patient: ${client.name || 'Unavailable'}${client.isDemo ? ' (Sample record)' : ''}`,
      `Configured indication: ${client.condition || 'Unavailable'}`,
      `Configured protocol: ${client.assignedProtocol?.replace(/-/g, ' ') || 'Unavailable'}`,
      `Generated: ${generatedLabel(generatedAt, analytics.interval.timeZone)}`,
      `Reporting interval: ${reportInterval(analytics)}`,
      `Reporting timezone: ${analytics.interval.timeZone}`,
      'Source provenance: authenticated session repository fields (timestamp, duration, in-zone measurement, and device snapshot); sample records are labeled.',
    ],
    metrics: [
      `Clinical sessions: ${row?.sessionCount ?? 0}`,
      `Training Demo completions: ${row?.demoSessionCount ?? 0} (included in aggregates; synthetic provenance)`,
      `Total recorded duration: ${formatMetric(row?.durationMinutes ?? null, ' minutes')}`,
      `Interval adherence: ${formatMetric(row?.adherencePercent ?? null, '%')} (${row?.expectedSessions == null ? 'schedule unavailable' : `${row.sessionCount} of ${row.expectedSessions} scheduled sessions`})`,
      `Average in-zone time: ${formatMetric(row?.averageInZonePercent ?? null, '%')} (${coverage(row?.inZoneRecordedSessions ?? 0, row?.sessionCount ?? 0)})`,
      `Device snapshot coverage: ${row && row.sessionCount > 0 ? `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}%` : 'Unavailable'} (${coverage(row?.deviceRecordedSessions ?? 0, row?.sessionCount ?? 0)})`,
    ],
    notes: [
      `Adherence formula: non-Demo interval sessions divided by scheduled sessions (weekly prescription × ${analytics.interval.dayCount}/7), capped at 100%.`,
      'Training Demo and sample-record sessions use synthetic input and are excluded from durations, adherence, in-zone measurements, trends, device coverage, device models, and clinical session rows.',
      'No peak-focus, spectral-band, QEEG, benchmark, significance, treatment outcome, or recommendation claim is included without a validated source contract.',
      'Unavailable values are not replaced with profile aggregates, cohort defaults, or zero.',
    ],
    tableHeader: 'Date/time | Duration | In-zone | Device',
    tableRows: sessions.map(session => {
      const when = typeof session.timestamp === 'number' && Number.isFinite(session.timestamp) && session.timestamp > 0
        ? new Intl.DateTimeFormat('en-US', {
            timeZone: analytics.interval.timeZone,
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          }).format(new Date(session.timestamp))
        : 'Unavailable';
      const duration = typeof session.durationSeconds === 'number' && Number.isFinite(session.durationSeconds) && session.durationSeconds >= 0
        ? `${Math.round(session.durationSeconds / 60)} min`
        : 'Unavailable';
      const inZone = typeof session.timeInZonePercent === 'number' && Number.isFinite(session.timeInZonePercent) && session.timeInZonePercent >= 0 && session.timeInZonePercent <= 100
        ? `${session.timeInZonePercent}%`
        : 'Unavailable';
      return `${when} | ${duration} | ${inZone} | ${session.device?.model?.trim() || 'Unavailable'}`;
    }),
  };
}

function renderReport(content: ReportTextContent): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 18;
  const write = (text: string, options: { bold?: boolean; size?: number; indent?: number } = {}) => {
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(options.size ?? 9);
    const lines = doc.splitTextToSize(text, 180 - (options.indent ?? 0));
    if (y + lines.length * 5 > 282) {
      doc.addPage();
      y = 18;
    }
    doc.text(lines, 15 + (options.indent ?? 0), y);
    y += lines.length * 5;
  };

  write(content.title, { bold: true, size: 16 });
  y += 2;
  content.metadata.forEach(line => write(line));
  y += 4;
  write('Summary', { bold: true, size: 11 });
  content.metrics.forEach(line => write(line, { indent: 2 }));
  y += 4;
  write('Data interpretation', { bold: true, size: 11 });
  content.notes.forEach(line => write(line, { indent: 2 }));
  y += 4;
  write('Session detail', { bold: true, size: 11 });
  write(content.tableHeader, { bold: true, size: 8 });
  if (content.tableRows.length === 0) write('No eligible sessions in the selected interval.', { size: 8 });
  content.tableRows.forEach(line => write(line, { size: 8 }));
  return doc;
}

export async function saveOrExportPDF(doc: jsPDF, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const dataUri = doc.output('datauristring');
      const fileResult = await Filesystem.writeFile({
        path: filename,
        data: dataUri.includes(',') ? dataUri.split(',')[1] : dataUri,
        directory: Directory.Cache,
      });
      await Share.share({ title: filename, url: fileResult.uri, dialogTitle: 'Export PDF Report' });
      return;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if ((error instanceof Error && error.name === 'AbortError') || /cancell?ed/i.test(message)) return;
      console.warn('Native share failed; trying browser export.', error);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn('Browser share failed; downloading the PDF.', error);
    }
  }
  doc.save(filename);
}

export async function generatePatientClinicalPDF(
  client: ClientProfile,
  analyticsOrSessions: ClinicalReportAnalytics | SessionRecord[],
  brand: ClinicBrandConfig,
): Promise<void> {
  const generatedAt = Date.now();
  const analytics = Array.isArray(analyticsOrSessions)
    ? buildPatientSelectionReportAnalytics(client, analyticsOrSessions, generatedAt)
    : analyticsOrSessions;
  const doc = renderReport(buildPatientReportText(client, analytics, brand, generatedAt));
  const filename = `Session_Activity_${(client.name || 'Patient').replace(/\s+/g, '_')}_${new Date(generatedAt).toISOString().slice(0, 10)}.pdf`;
  await saveOrExportPDF(doc, filename);
}

/**
 * Compatibility for the patient-detail export buttons. That screen supplies an
 * explicit session selection rather than a report window, so adherence is kept
 * unavailable instead of being inferred from an arbitrary subset.
 */
export function buildPatientSelectionReportAnalytics(
  client: ClientProfile,
  sessions: SessionRecord[],
  generatedAt: number,
): ClinicalReportAnalytics {
  const validTimes = sessions.map(session => session.timestamp).filter(time => Number.isFinite(time) && time > 0);
  const startMs = validTimes.length ? Math.min(...validTimes) : generatedAt;
  const endMs = Math.max(generatedAt, ...(validTimes.length ? validTimes : [generatedAt]));
  const label = (timestamp: number) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(timestamp));
  const analytics = buildClinicalReportAnalytics([client], sessions, {
    range: 'ytd',
    label: 'Selected sessions',
    startMs,
    endMs,
    startLabel: label(startMs),
    endLabel: label(endMs),
    dayCount: Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1),
    timeZone: 'UTC',
  }, { mode: 'explicit-selection' });
  return {
    ...analytics,
    adherencePercent: null,
    expectedSessions: null,
    patientRows: analytics.patientRows.map(row => ({ ...row, adherencePercent: null, expectedSessions: null })),
  };
}

export async function generatePracticeOutcomePDF(
  analytics: ClinicalReportAnalytics,
  brand: ClinicBrandConfig,
): Promise<void> {
  const generatedAt = Date.now();
  const doc = renderReport(buildPracticeReportText(analytics, brand, generatedAt));
  const filename = `Practice_Session_Activity_${(brand?.name || 'Clinic').replace(/\s+/g, '_')}_${new Date(generatedAt).toISOString().slice(0, 10)}.pdf`;
  await saveOrExportPDF(doc, filename);
}
