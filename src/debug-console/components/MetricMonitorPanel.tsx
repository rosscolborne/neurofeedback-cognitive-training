import { useState } from "react";
import { ChevronDown, Gauge, LineChart } from "lucide-react";
import { LiveEegPlot } from "./LiveEegPlot";
import type { AffectiveStateSample } from "../metrics/affectiveStateMetric";
import type { AffectiveCalibrationState } from "../metrics/affectiveStateMetric";

const metricOptions = [
  ["mindfulness", "Mindfulness"], ["restfulness", "Restfulness"], ["valence", "Valence"], ["arousal", "Arousal"], ["confidence", "Confidence"], ["ihc", "Interhemispheric coherence"],
  ["thetaBeta", "Theta / Beta"], ["betaTheta", "Beta / Theta"], ["alphaTheta", "Alpha / Theta"], ["thetaAlpha", "Theta / Alpha"], ["smrTheta", "SMR / Theta"], ["thetaAlphaBeta", "Theta / (Alpha + Beta)"], ["alphaBeta", "Alpha / Beta"], ["betaAlpha", "Beta / Alpha"], ["arousalRatio", "Arousal source ratio"], ["valenceRatio", "Valence source ratio"],
] as const;

const affectiveMetricKeys = new Set<MetricKey>(["valence", "arousal", "arousalRatio", "valenceRatio"]);

export type MetricKey = (typeof metricOptions)[number][0];

export function MetricMonitorPanel({ sample, coherence, history, baselineHistory, selectedMetric, onSelectMetric, calibration, rawMetrics, baselineMetrics }: { sample: AffectiveStateSample | null; coherence: number | null | undefined; history: Record<string, number[]>; baselineHistory: Record<string, number[]>; selectedMetric: MetricKey; onSelectMetric: (value: MetricKey) => void; calibration: AffectiveCalibrationState; rawMetrics: Record<string, number>; baselineMetrics: Record<string, number> }) {
  const [modes, setModes] = useState<Partial<Record<MetricKey, "raw" | "baseline">>>({});
  const values: Record<MetricKey, number | null> = {
    mindfulness: sample?.brainflowMindfulnessScore ?? null, restfulness: sample?.brainflowRestfulnessScore ?? null,
    valence: sample?.valence ?? null, arousal: sample?.arousal ?? null, confidence: sample?.confidence ?? null, ihc: coherence ?? null,
    thetaBeta: sample?.ratios.thetaBeta ?? null, betaTheta: sample?.ratios.betaTheta ?? null, alphaTheta: sample?.ratios.alphaTheta ?? null, thetaAlpha: sample?.ratios.thetaAlpha ?? null, smrTheta: sample?.ratios.smrTheta ?? null, thetaAlphaBeta: sample?.ratios.thetaAlphaBeta ?? null, alphaBeta: sample?.ratios.alphaBeta ?? null, betaAlpha: sample?.ratios.betaAlpha ?? null, arousalRatio: sample?.ratios.arousal ?? null, valenceRatio: sample?.ratios.valence ?? null,
  };
  const modeFor = (key: MetricKey) => modes[key] ?? "raw";
  const toggle = (key: MetricKey) => setModes((current) => ({ ...current, [key]: modeFor(key) === "raw" ? "baseline" : "raw" }));
  return <section className="panel metric-monitor-card">
    <div className="panel-header"><div className="panel-title"><div className="icon-tile"><Gauge aria-hidden="true" /></div><div><h2>Derived Metrics</h2><p>Use each card’s Absolute/Relative control to inspect its raw or baseline-relative value.</p></div></div></div>
    <div className="metric-monitor-body">
      <div className="derived-metric-grid">{metricOptions.filter(([key]) => !affectiveMetricKeys.has(key)).map(([key, label]) => { const mode = modeFor(key); const source = mode === "raw" ? rawMetrics : baselineMetrics; const value = metricValuesForMode(source, mode === "raw" ? values : undefined)[key]; return <div className="derived-metric" key={key}><span>{label}</span><button type="button" className="metric-value-mode" onClick={() => toggle(key)}>{mode === "raw" ? "Absolute" : "Relative"}</button><strong>{formatMetric(value)}</strong></div>; })}</div>
      <div className="metric-scope"><div className="scope-heading"><div><LineChart aria-hidden="true" /><div><h3>Metric Live Plot</h3><p>One derived metric at a time.</p></div></div><label className="metric-selector"><span>Metric</span><div className="select-wrap"><LineChart aria-hidden="true" /><select value={selectedMetric} onChange={(event) => onSelectMetric(event.target.value as MetricKey)}>{metricOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><ChevronDown aria-hidden="true" /></div></label></div><LiveEegPlot channelNames={[selectedMetric]} history={modeFor(selectedMetric) === "raw" ? history : baselineHistory} /></div>
    </div>
  </section>;
}

function formatMetric(value: number | null) { return value == null || !Number.isFinite(value) ? "--" : value.toFixed(2); }

function metricValuesForMode(source: Record<string, number>, fallback?: Record<MetricKey, number | null>): Record<MetricKey, number | null> {
  return Object.fromEntries(metricOptions.map(([key]) => {
    const sourceKey = key === "arousalRatio" ? "ratio:arousal" : key === "valenceRatio" ? "ratio:valence" : ["mindfulness", "restfulness", "valence", "arousal", "confidence", "ihc"].includes(key) ? key : `ratio:${key}`;
    return [key, source[sourceKey] ?? fallback?.[key] ?? null];
  })) as Record<MetricKey, number | null>;
}
