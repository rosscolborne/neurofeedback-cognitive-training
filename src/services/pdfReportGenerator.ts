import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { ClientProfile, ClinicBrandConfig, SessionRecord } from '../types';
import type { ClinicalReportAnalytics } from '../components/clinician/clinicalReportAnalytics';
import { buildClinicalReportAnalytics, formatMetric } from '../components/clinician/clinicalReportAnalytics';
import { protocolDisplayName } from './protocols';
import { experienceDisplayName } from '../components/displayLabels';
import { getClinicalProtocolTemplate } from './clinicalProtocolTemplates';

export interface ReportTextContent {
  title: string;
  metadata: string[];
  metrics: string[];
  notes: string[];
  tableHeader: string;
  tableRows: string[];
  /** Presentation only: headline figures drawn as stat blocks. Each names the metric line it presents. */
  highlights?: ReportHighlight[];
  /** Presentation only: the single session a selected-session report is about, drawn as the page's hero. */
  sessionHero?: ReportSessionHero;
  /** Presentation only: clinic accent for rules and the scope band. */
  accent?: string;
}

export interface ReportHighlight {
  label: string;
  value: string;
  detail?: string;
  /** Label of the metric line this block presents, so the details list does not repeat it. */
  replaces?: string;
}

export interface ReportSessionHero {
  when: string;
  experience: string;
  protocol: string;
  facts: ReportHighlight[];
  reflection?: string;
  feedback?: string;
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
    accent: brand?.primaryAccent,
    highlights: [
      { label: 'Patients in cohort', value: `${analytics.clients.length}`, replaces: 'Selected cohort' },
      { label: 'Sessions recorded', value: `${analytics.totalSessions}`, detail: analytics.demoSessionCount > 0 ? `includes ${analytics.demoSessionCount} Demo (simulated)` : undefined, replaces: 'Persisted sessions' },
      { label: 'Adherence', value: formatMetric(analytics.adherencePercent, '%'), detail: analytics.expectedSessions == null ? 'no weekly target' : `${analytics.totalSessions} of ${analytics.expectedSessions} expected sessions`, replaces: 'Interval adherence' },
      { label: 'Average in zone', value: formatMetric(analytics.averageInZonePercent.value, '%'), detail: `${analytics.averageInZonePercent.recordedSessions}/${analytics.averageInZonePercent.eligibleSessions} sessions measured`, replaces: 'Average in-zone time' },
    ],
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
  const selected = scope === 'selected-session' ? sessions[0] : undefined;
  const sessionDuration = (session: SessionRecord) => typeof session.durationSeconds === 'number' && Number.isFinite(session.durationSeconds) && session.durationSeconds >= 0
    ? `${Math.round(session.durationSeconds / 60)} min`
    : 'Unavailable';
  const sessionInZone = (session: SessionRecord) => typeof session.timeInZonePercent === 'number' && Number.isFinite(session.timeInZonePercent) && session.timeInZonePercent >= 0 && session.timeInZonePercent <= 100
    ? `${session.timeInZonePercent}%`
    : 'Unavailable';
  const sessionSource = (session: SessionRecord) => session.isDemo === true ? 'Training Demo (simulated)' : 'Non-Demo';
  const sessionHero: ReportSessionHero | undefined = selected ? {
    when: formatSessionWhen(selected, timeZone),
    experience: selected.experience ? experienceDisplayName(selected.experience) : 'Experience not recorded',
    protocol: selected.protocol ? getClinicalProtocolTemplate(selected.protocol)?.name ?? protocolDisplayName(selected.protocol) : 'Protocol not recorded',
    facts: [
      { label: 'Duration', value: sessionDuration(selected), replaces: 'Session duration' },
      { label: 'In zone', value: sessionInZone(selected), replaces: 'In-zone time' },
      { label: 'Source', value: sessionSource(selected), replaces: 'Sessions in this report' },
      { label: 'Device', value: selected.device?.model?.trim() || 'Unavailable', replaces: 'Device snapshot coverage' },
    ],
    reflection: selected.patientNotes?.trim() || undefined,
    feedback: selected.clinicianNotes?.trim() || undefined,
  } : undefined;
  const highlights: ReportHighlight[] | undefined = selected ? undefined : [
    { label: 'Sessions recorded', value: `${row?.sessionCount ?? 0}`, replaces: 'Persisted sessions' },
    { label: 'Demo sessions', value: `${row?.demoSessionCount ?? 0}`, detail: 'simulated; included', replaces: 'Training Demo completions' },
    { label: 'Recorded duration', value: formatMetric(row?.durationMinutes ?? null, ' min'), replaces: 'Total recorded duration' },
    ...(scope === 'interval'
      ? [{ label: 'Adherence', value: formatMetric(row?.adherencePercent ?? null, '%'), detail: row?.expectedSessions == null ? 'no weekly target' : `${row.sessionCount} of ${row.expectedSessions} expected sessions`, replaces: 'Interval adherence' }]
      : []),
    { label: 'Average in zone', value: formatMetric(row?.averageInZonePercent ?? null, '%'), detail: `${row?.inZoneRecordedSessions ?? 0}/${row?.sessionCount ?? 0} sessions measured`, replaces: 'Average in-zone time' },
    { label: 'Device details', value: row && row.sessionCount > 0 ? `${Math.round(row.deviceRecordedSessions / row.sessionCount * 100)}%` : 'Unavailable', detail: `${row?.deviceRecordedSessions ?? 0}/${row?.sessionCount ?? 0} sessions`, replaces: 'Device snapshot coverage' },
  ];
  return {
    accent: brand?.primaryAccent,
    highlights,
    sessionHero,
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
        : 'Adherence is calculated in interval reports from the Reports view, where the reporting window is defined.',
      'Training Demo sessions are simulated; they are included and labeled Demo. Fictional sample-workspace records are separate and excluded.',
      'No peak-focus, spectral-band, QEEG, benchmark, significance, treatment outcome, or recommendation claim is included without a validated source contract.',
      'Unavailable values are not replaced with profile aggregates, cohort defaults, or zero.',
    ],
    tableHeader: 'Date/time | Source | Duration | In-zone | Device',
    tableRows: sessions.map(session => `${formatSessionWhen(session, timeZone)} | ${sessionSource(session)} | ${sessionDuration(session)} | ${sessionInZone(session)} | ${session.device?.model?.trim() || 'Unavailable'}`),
  };
}

const PAGE = { left: 16, right: 194, top: 18, bottom: 278, footer: 288 };
const INK = {
  primary: [26, 26, 26],
  secondary: [107, 101, 96],
  tertiary: [150, 143, 132],
  rule: [224, 221, 215],
  band: [244, 243, 240],
  zebra: [250, 249, 247],
} as const;
const DEFAULT_ACCENT = [168, 72, 47] as const;
type Rgb = readonly number[];

function accentColor(hex?: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!match) return DEFAULT_ACCENT;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function splitFact(line: string): { label: string | null; value: string } {
  const split = line.indexOf(': ');
  return split > 0 && split < 40 ? { label: line.slice(0, split), value: line.slice(split + 2) } : { label: null, value: line };
}

/**
 * Lays the report text out as a clinical document: identity header, scope band, headline figures
 * (or the selected session as the hero), a scannable table, and secondary data notes. Wording and
 * values come from the text builders unchanged; this only decides hierarchy and placement.
 */
function renderReport(content: ReportTextContent): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = PAGE.right - PAGE.left;
  const accent = accentColor(content.accent);
  let y = PAGE.top;
  const font = (size: number, bold = false, color: Rgb = INK.primary) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const fill = (color: Rgb) => doc.setFillColor(color[0], color[1], color[2]);
  const ensureSpace = (height: number) => {
    if (y + height <= PAGE.bottom) return false;
    doc.addPage();
    y = PAGE.top;
    return true;
  };
  const caption = (text: string, x: number, at: number, color: Rgb = INK.secondary) => {
    font(6.8, true, color);
    doc.text(text.toUpperCase(), x, at, { charSpace: 0.25 });
  };
  const section = (title: string) => {
    ensureSpace(20);
    y += 4;
    font(11, true);
    doc.text(title, PAGE.left, y);
    y += 2.2;
    doc.setDrawColor(INK.rule[0], INK.rule[1], INK.rule[2]);
    doc.setLineWidth(0.25);
    doc.line(PAGE.left, y, PAGE.right, y);
    y += 6;
  };

  const metadata = content.metadata.map(splitFact);
  const meta = new Map(metadata.filter((fact) => fact.label).map((fact) => [fact.label as string, fact.value]));
  const clinic = meta.get('Clinic');
  const patient = meta.get('Patient');
  const scopeLabel = meta.has('Report scope') ? 'Report scope' : meta.has('Reporting interval') ? 'Reporting interval' : null;
  const sourceLine = content.metadata.find((line) => line.startsWith('Source: '));

  // Identity header.
  caption(clinic && clinic !== 'Unavailable' ? clinic : 'Clinic', PAGE.left, y);
  y += 8;
  font(19, true);
  doc.text(content.title, PAGE.left, y);
  y += 7;
  if (patient) {
    font(12.5, true, INK.secondary);
    doc.text(patient, PAGE.left, y);
    y += 5.5;
  }
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.9);
  doc.line(PAGE.left, y, PAGE.left + 22, y);
  y += 6;

  // What this report covers, stated once and prominently.
  if (scopeLabel) {
    font(10, true);
    const lines = doc.splitTextToSize(meta.get(scopeLabel) ?? '', width - 12);
    const height = 8 + lines.length * 4.6;
    fill(INK.band);
    doc.roundedRect(PAGE.left, y, width, height, 1.5, 1.5, 'F');
    fill(accent);
    doc.rect(PAGE.left, y, 1.2, height, 'F');
    caption(scopeLabel, PAGE.left + 5, y + 4.8);
    font(10, true);
    doc.text(lines, PAGE.left + 5, y + 9.8);
    y += height + 6;
  }

  /** Label-over-value facts in columns (captions small and muted, values readable). */
  const factGrid = (facts: Array<{ label: string | null; value: string }>, columns: number) => {
    const columnWidth = width / columns;
    for (let index = 0; index < facts.length; index += columns) {
      const row = facts.slice(index, index + columns);
      font(9);
      const wrapped = row.map((fact) => doc.splitTextToSize(fact.value, columnWidth - 5));
      const height = Math.max(...wrapped.map((lines) => lines.length)) * 4 + 7.5;
      ensureSpace(height);
      row.forEach((fact, column) => {
        const x = PAGE.left + column * columnWidth;
        caption(fact.label ?? '', x, y);
        font(9);
        doc.text(wrapped[column], x, y + 4.6);
      });
      y += height;
    }
  };
  // The hero already states when the selected session was recorded.
  const shownElsewhere = ['Clinic', 'Patient', 'Source', scopeLabel, ...(content.sessionHero ? ['Session recorded'] : [])];
  factGrid(metadata.filter((fact) => fact.label && !shownElsewhere.includes(fact.label)), 3);

  /** Headline figures as quiet tiles: caption, large value, one line of context. */
  const statBlocks = (items: ReportHighlight[]) => {
    const columns = items.length <= 4 ? items.length : 3;
    const gap = 4;
    const blockWidth = (width - gap * (columns - 1)) / columns;
    for (let index = 0; index < items.length; index += columns) {
      const row = items.slice(index, index + columns);
      font(7.2);
      const details = row.map((item) => item.detail ? doc.splitTextToSize(item.detail, blockWidth - 8).slice(0, 2) : []);
      const height = 17 + Math.max(0, ...details.map((lines) => lines.length)) * 3.3;
      ensureSpace(height + gap);
      row.forEach((item, column) => {
        const x = PAGE.left + column * (blockWidth + gap);
        fill(INK.band);
        doc.roundedRect(x, y, blockWidth, height, 1.5, 1.5, 'F');
        caption(item.label, x + 4, y + 5.5);
        font(item.value.length > 11 ? 11 : 16, true);
        doc.text(item.value, x + 4, y + 13);
        if (details[column].length) {
          font(7.2, false, INK.secondary);
          doc.text(details[column], x + 4, y + 17.6);
        }
      });
      y += height + gap;
    }
  };

  /** The one session a selected-session report is about. */
  const sessionHero = (hero: ReportSessionHero) => {
    const factWidth = (width - 10) / hero.facts.length;
    font(10, false, INK.secondary);
    const context = doc.splitTextToSize(`${hero.experience} · ${hero.protocol}`, width - 10);
    const height = 34 + context.length * 4.4;
    ensureSpace(height + 4);
    fill(INK.band);
    doc.roundedRect(PAGE.left, y, width, height, 2, 2, 'F');
    fill(accent);
    doc.rect(PAGE.left, y, 1.2, height, 'F');
    caption('Selected session', PAGE.left + 5, y + 6, accent);
    font(15, true);
    doc.text(hero.when, PAGE.left + 5, y + 13.5);
    font(10, false, INK.secondary);
    doc.text(context, PAGE.left + 5, y + 19.5);
    const factsY = y + 22 + context.length * 4.4;
    hero.facts.forEach((fact, index) => {
      const x = PAGE.left + 5 + index * factWidth;
      caption(fact.label, x, factsY);
      const missing = fact.value === 'Unavailable';
      font(fact.value.length > 14 ? 9.5 : 12, true, missing ? INK.tertiary : INK.primary);
      doc.text(doc.splitTextToSize(fact.value, factWidth - 4).slice(0, 2), x, factsY + 5.6);
    });
    y += height + 6;
    const quote = (label: string, text: string) => {
      font(9.5);
      const lines = doc.splitTextToSize(text, width - 8);
      ensureSpace(Math.min(lines.length, 12) * 4.4 + 10);
      caption(label, PAGE.left, y);
      y += 4.6;
      doc.setDrawColor(INK.rule[0], INK.rule[1], INK.rule[2]);
      doc.setLineWidth(0.8);
      doc.line(PAGE.left + 0.6, y - 3.2, PAGE.left + 0.6, y - 3.2 + lines.length * 4.4);
      font(9.5);
      lines.forEach((line: string) => {
        ensureSpace(4.4);
        doc.text(line, PAGE.left + 4, y);
        y += 4.4;
      });
      y += 4;
    };
    if (hero.reflection) quote('Patient reflection', hero.reflection);
    if (hero.feedback) quote('Clinician feedback', hero.feedback);
  };

  /** Everything else in the summary, as a compact label/value list. */
  const detailList = (facts: Array<{ label: string | null; value: string }>) => {
    const labelWidth = 50;
    facts.forEach((fact) => {
      font(8.5);
      const lines = doc.splitTextToSize(fact.value, fact.label ? width - labelWidth : width);
      ensureSpace(lines.length * 4.1 + 1.6);
      if (fact.label) {
        font(8, false, INK.secondary);
        doc.text(fact.label, PAGE.left, y);
      }
      font(8.5, false, fact.value.startsWith('Unavailable') || fact.value.startsWith('Not calculated') ? INK.secondary : INK.primary);
      doc.text(lines, PAGE.left + (fact.label ? labelWidth : 0), y);
      y += lines.length * 4.1 + 1.6;
    });
  };

  const table = (header: string, rows: string[]) => {
    const headerCells = header.split(' | ');
    const rowCells = rows.map((row) => row.split(' | '));
    font(8.3);
    // Headers may wrap between words but never inside one; the first column gets extra room.
    const natural = headerCells.map((cell, column) => Math.max(
      doc.getTextWidth(cell) * 0.8,
      ...cell.split(' ').map((word) => doc.getTextWidth(word) + 1),
      ...rowCells.map((cells) => doc.getTextWidth(cells[column] ?? '')),
      12,
    ) * (column === 0 ? 1.1 : 1));
    const scale = width / natural.reduce((sum, value) => sum + value + 4, 0);
    const columns = natural.map((value) => (value + 4) * scale);
    const drawHeader = () => {
      font(7.2, true, INK.secondary);
      const wrapped = columns.map((columnWidth, column) => doc.splitTextToSize(headerCells[column] ?? '', columnWidth - 3));
      const height = Math.max(...wrapped.map((lines) => lines.length)) * 3.3 + 4.4;
      ensureSpace(height + 8);
      fill(INK.band);
      doc.rect(PAGE.left, y, width, height, 'F');
      let x = PAGE.left + 2;
      font(7.2, true, INK.secondary);
      wrapped.forEach((lines, column) => { doc.text(lines, x, y + 4.6); x += columns[column]; });
      y += height;
    };
    drawHeader();
    if (rows.length === 0) {
      font(8.5, false, INK.secondary);
      doc.text('No eligible sessions in the selected interval.', PAGE.left + 2, y + 5.5);
      y += 9;
      return;
    }
    rowCells.forEach((cells, index) => {
      font(8.3);
      const wrapped = columns.map((columnWidth, column) => doc.splitTextToSize(cells[column] ?? '', columnWidth - 3));
      const height = Math.max(...wrapped.map((lines) => lines.length)) * 3.6 + 3.1;
      if (ensureSpace(height)) drawHeader();
      if (index % 2 === 1) {
        fill(INK.zebra);
        doc.rect(PAGE.left, y, width, height, 'F');
      }
      let x = PAGE.left + 2;
      wrapped.forEach((lines, column) => {
        const value = cells[column] ?? '';
        // Repeated missing values stay visible but recede; the first column is the row's identity.
        font(8.3, column === 0, value.startsWith('Unavailable') ? INK.tertiary : INK.primary);
        doc.text(lines, x, y + 4.1);
        x += columns[column];
      });
      y += height;
    });
    doc.setDrawColor(INK.rule[0], INK.rule[1], INK.rule[2]);
    doc.setLineWidth(0.25);
    doc.line(PAGE.left, y, PAGE.right, y);
    y += 2;
  };

  section('Summary');
  if (content.sessionHero) sessionHero(content.sessionHero);
  else if (content.highlights?.length) statBlocks(content.highlights);
  const presented = new Set([...(content.highlights ?? []), ...(content.sessionHero?.facts ?? [])].map((item) => item.replaces).filter(Boolean));
  const remaining = content.metrics.map(splitFact).filter((fact) => !fact.label || !presented.has(fact.label));
  if (remaining.length) {
    y += 3;
    detailList(remaining);
  }

  // A selected-session report already shows its one session above; a one-row table would repeat it.
  if (!content.sessionHero) {
    const isPatientTable = content.tableHeader.startsWith('Patient');
    section(`${isPatientTable ? 'Patients' : 'Sessions'} (${content.tableRows.length})`);
    table(content.tableHeader, content.tableRows);
  }

  // Provenance and caveats stay complete but secondary, and are kept together on one page.
  const aboutLines = [...(sourceLine ? [sourceLine] : []), ...content.notes];
  font(7.6);
  const aboutWrapped = aboutLines.map((line) => doc.splitTextToSize(line, width - 4) as string[]);
  ensureSpace(11 + aboutWrapped.reduce((sum, lines) => sum + lines.length * 3.5 + 1.4, 0));
  y += 6;
  font(9, true, INK.secondary);
  doc.text('About this report', PAGE.left, y);
  y += 5;
  aboutWrapped.forEach((wrapped) => {
    font(7.6, false, INK.secondary);
    doc.text('•', PAGE.left, y);
    doc.text(wrapped, PAGE.left + 3.5, y);
    y += wrapped.length * 3.5 + 1.4;
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(INK.rule[0], INK.rule[1], INK.rule[2]);
    doc.setLineWidth(0.2);
    doc.line(PAGE.left, PAGE.footer - 4, PAGE.right, PAGE.footer - 4);
    font(7, false, INK.tertiary);
    doc.text([clinic && clinic !== 'Unavailable' ? clinic : null, content.title, patient].filter(Boolean).join(' · '), PAGE.left, PAGE.footer);
    doc.text(`Page ${page} of ${pages}`, PAGE.right, PAGE.footer, { align: 'right' });
  }
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
