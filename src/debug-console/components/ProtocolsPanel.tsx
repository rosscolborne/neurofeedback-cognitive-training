import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ProtocolDefinition } from '../../services/protocols';
import type { ProtocolType } from '../../types';

interface ProtocolsPanelProps {
  protocol: ProtocolType;
  threshold: string;
  protocols: readonly ProtocolDefinition[];
  onProtocolChange: (protocol: ProtocolType) => void;
  onThresholdChange: (threshold: string) => void;
  onResetThreshold: () => void;
}

export function ProtocolsPanel({
  protocol,
  threshold,
  protocols,
  onProtocolChange,
  onThresholdChange,
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
          <small id="protocol-threshold-default">Default: {defaultThreshold}</small>
        </label>
        <button className="secondary-button protocol-reset-button" onClick={onResetThreshold}>
          <RotateCcw aria-hidden="true" />
          Reset to default
        </button>
      </div>
    </section>
  );
}
