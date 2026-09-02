import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ProtocolDefinition } from '../../services/protocols';
import type { ProtocolType } from '../../types';

interface ProtocolsPanelProps {
  protocol: ProtocolType;
  threshold: string;
  totalInZonePercent: number | null;
  recentInZonePercent: number | null;
  recentWindowSeconds: string;
  protocols: readonly ProtocolDefinition[];
  onProtocolChange: (protocol: ProtocolType) => void;
  onThresholdChange: (threshold: string) => void;
  onRecentWindowSecondsChange: (windowSeconds: string) => void;
  onResetThreshold: () => void;
}

export function ProtocolsPanel({
  protocol,
  threshold,
  totalInZonePercent,
  recentInZonePercent,
  recentWindowSeconds,
  protocols,
  onProtocolChange,
  onThresholdChange,
  onRecentWindowSecondsChange,
  onResetThreshold,
}: ProtocolsPanelProps) {
  const selectedProtocol = protocols.find((definition) => definition.value === protocol);
  const defaultThreshold = selectedProtocol?.defaultThreshold ?? 1.85;

  return (
    <section id="protocols" className="panel protocols-card" aria-label="Training protocol controls">
      <div className="panel-header">
        <div className="panel-title">
          <div className="icon-tile"><SlidersHorizontal aria-hidden="true" /></div>
          <div>
            <h2>Protocols</h2>
            <p>Choose the feedback program and its in-zone threshold.</p>
          </div>
        </div>
      </div>
      <div className="protocol-controls">
        <label>
          <span>Program</span>
          <select value={protocol} onChange={(event) => onProtocolChange(event.target.value as ProtocolType)}>
            {protocols.map((definition) => (
              <option key={definition.value} value={definition.value}>{definition.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Threshold</span>
          <input
            type="text"
            inputMode="decimal"
            value={threshold}
            onChange={(event) => onThresholdChange(event.target.value)}
            aria-describedby="protocol-threshold-default"
          />
        </label>
        <div className="protocol-reset-control">
          <small id="protocol-threshold-default">Default: {defaultThreshold}</small>
          <button className="secondary-button protocol-reset-button" onClick={onResetThreshold}>
            <RotateCcw aria-hidden="true" />
            Reset to default
          </button>
        </div>
      </div>
      <div className="protocol-in-zone-metrics">
        <div className="protocol-metric-value">
          <span>Total in-zone</span>
          <strong>{totalInZonePercent == null ? '--' : `${totalInZonePercent}%`}</strong>
        </div>
        <div className="protocol-metric-value">
          <span>Recent in-zone</span>
          <strong>{recentInZonePercent == null ? '--' : `${recentInZonePercent}%`}</strong>
        </div>
        <label className="protocol-window-control">
          <span>Recent window (seconds)</span>
          <input
            type="text"
            inputMode="numeric"
            value={recentWindowSeconds}
            onChange={(event) => onRecentWindowSecondsChange(event.target.value)}
          />
        </label>
      </div>
    </section>
  );
}
