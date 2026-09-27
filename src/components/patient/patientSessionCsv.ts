import type { SessionRecord } from '../../types';

const HEADERS = [
  'Date', 'Protocol', 'Experience', 'Duration (s)', 'Time In Zone %',
  'Coherence %', 'Peak Score', 'Mood', 'Training Demo',
];

type CsvCell = string | number | null | undefined;

function serializeCell(value: CsvCell): string {
  let text = value == null ? '' : String(value);
  // A quoted CSV field can still be evaluated as a spreadsheet formula.
  if (typeof value === 'string' && /^[\s\p{Cc}]*[=+@-]/u.test(text)) {
    text = `'${text}`;
  }
  return /[,"\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function serializePatientSessionCsv(sessions: readonly SessionRecord[]): string {
  const rows: CsvCell[][] = sessions.map((session) => [
    session.date,
    session.protocol,
    session.experience,
    session.durationSeconds,
    session.timeInZonePercent,
    session.averageCoherence,
    session.peakFocusScore,
    session.moodRating || 'N/A',
    session.isDemo === true ? 'Yes' : session.isDemo === false ? 'No' : 'Unknown',
  ]);
  return [HEADERS, ...rows].map((row) => row.map(serializeCell).join(',')).join('\n');
}

/** The caller owns eligibility and error/empty gates; delivery is identical in both views. */
export function exportPatientSessionCsv(
  sessions: readonly SessionRecord[],
  setExportStatus: (status: 'idle' | 'done') => void,
): void {
  const blob = new Blob([serializePatientSessionCsv(sessions)], { type: 'text/csv;charset=utf-8;' });
  const filename = `waveable_progress_${new Date().toISOString().split('T')[0]}.csv`;

  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, { type: 'text/csv' });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Session Progress' }).then(() => {
        setExportStatus('done');
        setTimeout(() => setExportStatus('idle'), 3000);
      }).catch(() => {
        setExportStatus('idle');
      });
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 200);
  setExportStatus('done');
  setTimeout(() => setExportStatus('idle'), 3000);
}
