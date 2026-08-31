import { useState } from "react";
import { AudioLines } from "lucide-react";
import { LiveEegPlot } from "./LiveEegPlot";
import { PlotSeriesSelector } from "./PlotSeriesSelector";

const bands = ["delta", "theta", "alpha", "smr", "beta", "gamma"];

export function BandPowerMonitorPanel({ latest, history }: { latest: Record<string, number>; history: Record<string, number[]> }) {
  const [selectedBands, setSelectedBands] = useState(["theta"]);
  const plottedBands = selectedBands.filter((band) => bands.includes(band));
  return <section className="panel band-monitor-card">
    <div className="panel-header"><div className="panel-title"><div className="icon-tile"><AudioLines aria-hidden="true" /></div><div><h2>Smoothed Band Powers</h2><p>Each lane and readout uses the service’s input-smoothed absolute band power.</p></div></div><PlotSeriesSelector options={bands} selected={selectedBands} onChange={setSelectedBands} /></div>
    <div className="band-monitor-body"><div className="band-chart-surface"><LiveEegPlot channelNames={plottedBands} history={history} /></div><div className="band-value-grid">{bands.map((band) => <div className="channel-row" key={band}><span className="channel-name">{band === "smr" ? "SMR (12–15 Hz)" : band}</span><strong>{formatPower(latest[band])}</strong></div>)}</div></div>
  </section>;
}

function formatPower(value: number | undefined) { return typeof value === "number" && Number.isFinite(value) ? value.toPrecision(3) : "--"; }
