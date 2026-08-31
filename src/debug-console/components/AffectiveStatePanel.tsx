import { useState } from "react";
import { BrainCircuit } from "lucide-react";
import { InfoPopoverButton } from "./InfoPopoverButton";
import { affectiveEmotionRegions, type AffectiveStateSample } from "../metrics/affectiveStateMetric";
import type { MetricKey } from "./MetricMonitorPanel";

const affectiveMetricButtons: Array<[MetricKey, string]> = [
  ["arousal", "Arousal"],
  ["arousalRatio", "Arousal source ratio"],
  ["valence", "Valence"],
  ["valenceRatio", "Valence source ratio"],
];

export function AffectiveStatePanel({ sample, selectedMetric, onSelectMetric, rawMetrics, baselineMetrics }: { sample: AffectiveStateSample | null; selectedMetric: MetricKey; onSelectMetric: (metric: MetricKey) => void; rawMetrics: Record<string, number>; baselineMetrics: Record<string, number> }) {
  const [mode, setMode] = useState<"raw" | "baseline">("raw");
  const values = mode === "raw" ? rawMetrics : baselineMetrics;
  const valence = values.valence;
  const arousal = values.arousal;
  const x = valence == null ? 50 : toPlotPercent(valence);
  const y = arousal == null ? 50 : 100 - toPlotPercent(arousal);
  return (
    <section className="panel affective-card" aria-label="Valence arousal state">
      <div className="panel-header">
        <div className="panel-title"><div className="icon-tile"><BrainCircuit aria-hidden="true" /></div><div><h2>Valence / Arousal — Experimental</h2><p>Input-smoothed EEG band-power proxy, not a validated emotion measure.</p></div></div>
        <div className="panel-header-controls"><label className="metric-mode-selector"><span>Values</span><select value={mode} onChange={(event) => setMode(event.target.value as "raw" | "baseline")}><option value="raw">Absolute</option><option value="baseline">Relative</option></select></label><InfoPopoverButton ariaLabel="Explain valence and arousal" preferredSide="left"><p>Valence and arousal are experimental EEG band-power proxies, not BrainFlow emotion predictions.</p><p>Both values are derived from the shared smoothed band snapshot. Their live values and source ratios appear in the Metrics panel.</p></InfoPopoverButton></div>
      </div>
      <div className="affective-grid">
        <div className="affective-plane" role="img" aria-label="Valence arousal plot">
          <span className="axis-label axis-label-top">High arousal</span><span className="axis-label axis-label-bottom">Low arousal</span><span className="axis-label axis-label-left">Negative valence</span><span className="axis-label axis-label-right">Positive valence</span><span className="neutral-label">Neutral</span>
          {affectiveEmotionRegions.map((region) => <span className={`emotion-label ${sample?.label === region.label ? "is-active" : ""}`} key={region.label} style={{ left: `${((region.valence + 1) / 2) * 100}%`, top: `${(1 - (region.arousal + 1) / 2) * 100}%` }}>{region.label}</span>)}
          {sample && valence != null && arousal != null ? <span className="affective-point" style={{ left: `${x}%`, top: `${y}%` }} /> : <div className="empty-state affective-empty"><div className="icon-tile"><BrainCircuit aria-hidden="true" /></div><strong>{mode === "baseline" ? "No baseline yet" : "No affective proxy yet"}</strong><span>{mode === "baseline" ? "Calibrate to view baseline-relative values." : "Connect a provider with usable EEG band powers."}</span></div>}
        </div>
        <div className="affective-metric-buttons" aria-label="Affective metrics">
          {affectiveMetricButtons.map(([metric, label]) => <button className={`affective-metric-button ${selectedMetric === metric ? "is-selected" : ""}`} key={metric} type="button" onClick={() => onSelectMetric(metric)} aria-pressed={selectedMetric === metric}>
            <span>{label}</span><strong>{formatMetric(metricValue(values, metric))}</strong>
          </button>)}
        </div>
      </div>
    </section>
  );
}

function toPlotPercent(value: number) { return Math.min(96, Math.max(4, ((value + 1) / 2) * 100)); }
function metricValue(values: Record<string, number>, metric: MetricKey) {
  if (metric === "arousalRatio") return values["ratio:arousal"];
  if (metric === "valenceRatio") return values["ratio:valence"];
  return values[metric];
}
function formatMetric(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? "--" : value.toFixed(2); }
