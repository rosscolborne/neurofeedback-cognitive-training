import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../types';
import type { ClinicalReportAnalytics } from '../components/clinician/clinicalReportAnalytics';
import { buildClinicalReportAnalytics, formatMetric } from '../components/clinician/clinicalReportAnalytics';
import { protocolDisplayName } from './protocols';
import { getClinicalProtocolTemplate } from './clinicalProtocolTemplates';

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
      'Source: stored session records (time, duration, in-zone measurement, device details); sample records are labeled.',
    ],
    metrics: [
      `Selected cohort: ${analytics.clients.length} patient profiles`,
      `Persisted sessions: ${analytics.totalSessions}`,
      `Training Demo completions: ${analytics.demoSessionCount} (simulated; included in aggregates)`,
      `Sample workspace records: ${analytics.sampleSessionCount} (fictional; excluded from aggregates)`,
      `Total recorded duration: ${formatMetric(analytics.totalDurationMinutes, ' minutes')}`,
      `Average session duration: ${formatMetric(analytics.averageDurationMinutes.value, ' minutes')} (${coverage(analytics.averageDurationMinutes.recordedSessions, analytics.averageDurationMinutes.eligibleSessions)})`,
      `Interval adherence: ${formatMetric(analytics.adherencePercent, '%')} (${analytics.expectedSessions == null ? 'no weekly target' : `${analytics.totalSessions} of ${analytics.expectedSessions} expected sessions`})`,
      `Average in-zone time: ${formatMetric(analytics.averageInZonePercent.value, '%')} (${coverage(analytics.averageInZonePercent.recordedSessions, analytics.averageInZonePercent.eligibleSessions)})`,
      `Device snapshot coverage: ${formatMetric(analytics.deviceCoverage.value, '%')} (${coverage(analytics.deviceCoverage.recordedSessions, analytics.deviceCoverage.eligibleSessions)})`,
      `Recorded device models: ${deviceModels}`,
      trend,
    ],
    notes: [
      `Adherence formula: recorded sessions, including Training Demo sessions, divided by expected sessions (weekly target × ${analytics.interval.dayCount}/7 days), capped at 100%.`,
      'Training Demo sessions are simulated; they are included in aggregates and labeled Demo. Fictional sample-workspace records are counted separately and excluded.',
      'In-zone values and their change are descriptive session measurements, not diagnoses, benchmark comparisons, treatment outcomes, or statistical significance claims.',
      'Spectral-band, QEEG, recommendation, and clinical outcome claims are not included because this report has no validated source contract for those claims.',
      'Unavailable values are not replaced with cohort defaults or zero.',
    ],
    // Same column priority as the on-screen report table.
    tableHeader: 'Patient | Sessions | Adherence | In-zone | Duration | Demo | Sample | Device',
    tableRows: analytics.patientRows.map(row => [
      `${row.client.name}${row.client.isDemo ? ' (Sample record)' : ''}`,
      row.sessionCount,
      formatMetric(row.adherencePercent, '%'),
      `${formatMetric(row.averageInZonePercent, '%')} (${row.inZoneRecordedSessions}/${row.sessionCount})`,
      formatMetric(row.durationMinutes, ' min'),
      row.demoSessionCount,
      row.sampleSessionCount,
      row.sessionCount === 0 ? 'Unavailable' : `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}% (${row.deviceRecordedSessions}/${row.sessionCount})`,
    ].join(' | ')),
  };
}

/**
 * What a patient PDF covers. Interval reports come from the Reports view and compute adherence;
 * patient-detail exports cover every recorded session or one selected session and do not.
 */
export type PatientReportScope = 'interval' | 'all-sessions' | 'selected-session';

function formatSessionWhen(session: SessionRecord, timeZone: string): string {
  return typeof session.timestamp === 'number' && Number.isFinite(session.timestamp) && session.timestamp > 0
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      }).format(new Date(session.timestamp))
    : 'Unavailable';
}

export function buildPatientReportText(
  client: ClientProfile,
  analytics: ClinicalReportAnalytics,
  brand: ClinicBrandConfig,
  generatedAt = Date.now(),
  scope: PatientReportScope = 'interval',
): ReportTextContent {
  const row = analytics.patientRows.find(item => item.client.id === client.id);
  const sessions = row?.sessions ?? [];
  const timeZone = analytics.interval.timeZone;
  const prescription = client.prescribedSessionsPerWeek != null
    ? `weekly prescription: ${client.prescribedSessionsPerWeek} ${client.prescribedSessionsPerWeek === 1 ? 'session' : 'sessions'}`
    : 'no weekly prescription set';
  const deviceCoverage = `${row && row.sessionCount > 0 ? `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}%` : 'Unavailable'} (${coverage(row?.deviceRecordedSessions ?? 0, row?.sessionCount ?? 0)})`;
  const scopeMetadata = scope === 'selected-session'
    ? [
        `Report scope: 1 selected session (other sessions are not included)`,
        `Session recorded: ${sessions[0] ? formatSessionWhen(sessions[0], timeZone) : 'Unavailable'}`,
      ]
    : scope === 'all-sessions'
      ? [`Report scope: All recorded sessions (${row?.sessionCount ?? 0})`, `Period covered: ${reportInterval(analytics)}`]
      : [`Reporting interval: ${reportInterval(analytics)}`];
  const metrics = scope === 'selected-session'
    ? [
        `Sessions in this report: ${row?.sessionCount ?? 0} (selected session only)`,
        `Session duration: ${formatMetric(row?.durationMinutes ?? null, ' minutes')}`,
        `In-zone time: ${formatMetric(row?.averageInZonePercent ?? null, '%')}`,
        `Adherence: Not calculated for a single-session report (${prescription})`,
        `Device snapshot coverage: ${deviceCoverage}`,
      ]
    : [
        `Persisted sessions: ${row?.sessionCount ?? 0}`,
        `Training Demo completions: ${row?.demoSessionCount ?? 0} (simulated; included in aggregates)`,
        `Sample workspace records: ${row?.sampleSessionCount ?? 0} (fictional; excluded from aggregates)`,
        `Total recorded duration: ${formatMetric(row?.durationMinutes ?? null, ' minutes')}`,
        scope === 'interval'
          ? `Interval adherence: ${formatMetric(row?.adherencePercent ?? null, '%')} (${row?.expectedSessions == null ? 'no weekly target' : `${row.sessionCount} of ${row.expectedSessions} expected sessions`})`
          : `Adherence: Not calculated for an all-sessions export (${prescription})`,
        `Average in-zone time: ${formatMetric(row?.averageInZonePercent ?? null, '%')} (${coverage(row?.inZoneRecordedSessions ?? 0, row?.sessionCount ?? 0)})`,
        `Device snapshot coverage: ${deviceCoverage}`,
      ];
  return {
    title: scope === 'selected-session' ? 'Selected Session Report' : 'Patient Session Activity Report',
    metadata: [
      `Clinic: ${brand?.name?.trim() || 'Unavailable'}`,
      `Patient: ${client.name || 'Unavailable'}${client.isDemo ? ' (Sample record)' : ''}`,
      `Configured indication: ${client.condition || 'Unavailable'}`,
      `Configured protocol: ${client.assignedProtocol ? getClinicalProtocolTemplate(client.assignedProtocol)?.name ?? protocolDisplayName(client.assignedProtocol) : 'Unavailable'}`,
      `Generated: ${generatedLabel(generatedAt, timeZone)}`,
      ...scopeMetadata,
      `Reporting timezone: ${timeZone}`,
      'Source: stored session records (time, duration, in-zone measurement, device details); sample records are labeled.',
    ],
    metrics,
    notes: [
      scope === 'interval'
        ? `Adherence formula: recorded sessions, including Training Demo sessions, divided by expected sessions (weekly target × ${analytics.interval.dayCount}/7 days), capped at 100%.`
        : 'Adherence is calculated in interval reports from the Reports view, where the scheduling window is defined.',
      'Training Demo sessions are simulated; they are included and labeled Demo. Fictional sample-workspace records are separate and excluded.',
      'No peak-focus, spectral-band, QEEG, benchmark, significance, treatment outcome, or recommendation claim is included without a validated source contract.',
      'Unavailable values are not replaced with profile aggregates, cohort defaults, or zero.',
    ],
    tableHeader: 'Date/time | Source | Duration | In-zone | Device',
    tableRows: sessions.map(session => {
      const duration = typeof session.durationSeconds === 'number' && Number.isFinite(session.durationSeconds) && session.durationSeconds >= 0
        ? `${Math.round(session.durationSeconds / 60)} min`
        : 'Unavailable';
      const inZone = typeof session.timeInZonePercent === 'number' && Number.isFinite(session.timeInZonePercent) && session.timeInZonePercent >= 0 && session.timeInZonePercent <= 100
        ? `${session.timeInZonePercent}%`
        : 'Unavailable';
      const source = session.isDemo === true ? 'Training Demo (simulated)' : 'Non-Demo';
      return `${formatSessionWhen(session, timeZone)} | ${source} | ${duration} | ${inZone} | ${session.device?.model?.trim() || 'Unavailable'}`;
    }),
  };
}

const PAGE = { left: 15, right: 195, top: 18, bottom: 282 };
const INK = { primary: [26, 26, 26], secondary: [107, 101, 96], rule: [220, 217, 211], band: [242, 241, 238] } as const;

/** Lays out the report text as labelled facts, notes and a column table; the wording is unchanged. */
function renderReport(content: ReportTextContent): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = PAGE.right - PAGE.left;
  let y = PAGE.top;
  const font = (size: number, bold = false, color: readonly number[] = INK.primary) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const ensureSpace = (height: number) => {
    if (y + height <= PAGE.bottom) return false;
    doc.addPage();
    y = PAGE.top;
    return true;
  };
  const rule = (color: readonly number[] = INK.rule) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(0.2);
    doc.line(PAGE.left, y, PAGE.right, y);
  };
  const heading = (text: string) => {
    ensureSpace(14);
    y += 5;
    font(11, true);
    doc.text(text, PAGE.left, y);
    y += 2;
    rule();
    y += 5;
  };
  /** "Label: value" lines become a two-column list; other lines span the full width. */
  const facts = (lines: string[]) => {
    const labelWidth = 48;
    lines.forEach((line) => {
      const split = line.indexOf(': ');
      const label = split > 0 && split < 40 ? line.slice(0, split) : null;
      const value = label ? line.slice(split + 2) : line;
      font(9);
      const valueLines = doc.splitTextToSize(value, label ? width - labelWidth : width);
      ensureSpace(valueLines.length * 4.4 + 1);
      if (label) {
        font(8.5, false, INK.secondary);
        doc.text(label, PAGE.left, y);
        font(9);
      }
      doc.text(valueLines, PAGE.left + (label ? labelWidth : 0), y);
      y += valueLines.length * 4.4 + 1;
    });
  };
  const notes = (lines: string[]) => {
    lines.forEach((line) => {
      font(8.5, false, INK.secondary);
      const wrapped = doc.splitTextToSize(line, width - 4);
      ensureSpace(wrapped.length * 4 + 1.5);
      doc.text('•', PAGE.left, y);
      doc.text(wrapped, PAGE.left + 4, y);
      y += wrapped.length * 4 + 1.5;
    });
  };
  const table = (header: string, rows: string[]) => {
    const headerCells = header.split(' | ');
    const rowCells = rows.map((row) => row.split(' | '));
    font(8);
    // Headers may wrap between words but never inside one.
    const natural = headerCells.map((cell, column) => Math.max(
      doc.getTextWidth(cell) * 0.75,
      ...cell.split(' ').map((word) => doc.getTextWidth(word) + 1),
      ...rowCells.map((cells) => doc.getTextWidth(cells[column] ?? '')),
      12,
    ));
    const scale = width / natural.reduce((sum, value) => sum + value + 3, 0);
    const columns = natural.map((value) => (value + 3) * scale);
    const drawRow = (cells: string[], bold: boolean) => {
      font(8, bold, bold ? INK.secondary : INK.primary);
      const wrapped = columns.map((columnWidth, column) => doc.splitTextToSize(cells[column] ?? '', columnWidth - 2));
      const height = Math.max(...wrapped.map((lines) => lines.length)) * 3.6 + 2.6;
      if (ensureSpace(height) && !bold) drawRow(headerCells, true);
      if (bold) {
        doc.setFillColor(INK.band[0], INK.band[1], INK.band[2]);
        doc.rect(PAGE.left, y - 3.6, width, height, 'F');
      }
      font(8, bold, bold ? INK.secondary : INK.primary);
      let x = PAGE.left + 1.5;
      wrapped.forEach((lines, column) => { doc.text(lines, x, y); x += columns[column]; });
      y += height;
      if (!bold) { y -= 3.1; rule(); y += 3.1; }
    };
    drawRow(headerCells, true);
    if (rows.length === 0) {
      font(8, false, INK.secondary);
      doc.text('No eligible sessions in the selected interval.', PAGE.left + 1.5, y);
      y += 5;
    }
    rowCells.forEach((cells) => drawRow(cells, false));
  };

  font(17, true);
  doc.text(content.title, PAGE.left, y);
  y += 4;
  rule(INK.primary);
  y += 7;
  facts(content.metadata);
  heading('Summary');
  facts(content.metrics);
  heading('Session detail');
  table(content.tableHeader, content.tableRows);
  heading('Data interpretation');
  notes(content.notes);
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
  selectionScope?: Exclude<PatientReportScope, 'interval'>,
): Promise<void> {
  const generatedAt = Date.now();
  const analytics = Array.isArray(analyticsOrSessions)
    ? buildPatientSelectionReportAnalytics(client, analyticsOrSessions, generatedAt)
    : analyticsOrSessions;
  const scope: PatientReportScope = Array.isArray(analyticsOrSessions) ? selectionScope ?? 'all-sessions' : 'interval';
  const doc = renderReport(buildPatientReportText(client, analytics, brand, generatedAt, scope));
  const filenamePrefix = scope === 'selected-session' ? 'Selected_Session' : 'Session_Activity';
  const filename = `${filenamePrefix}_${(client.name || 'Patient').replace(/\s+/g, '_')}_${new Date(generatedAt).toISOString().slice(0, 10)}.pdf`;
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
  // Same local-timezone resolution the Reports view uses, so both exports agree on dates.
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
): ClinicalReportAnalytics {
  const validTimes = sessions.map(session => session.timestamp).filter(time => Number.isFinite(time) && time > 0);
  const startMs = validTimes.length ? Math.min(...validTimes) : generatedAt;
  const endMs = Math.max(generatedAt, ...(validTimes.length ? validTimes : [generatedAt]));
  const label = (timestamp: number) => new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(timestamp));
  const analytics = buildClinicalReportAnalytics([client], sessions, {
    range: 'ytd',
    label: 'Selected sessions',
    startMs,
    endMs,
    startLabel: label(startMs),
    endLabel: label(endMs),
    dayCount: Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1),
    timeZone,
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
