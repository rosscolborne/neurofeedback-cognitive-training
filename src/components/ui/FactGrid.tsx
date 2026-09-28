import React from 'react';

export interface Fact {
  label: string;
  value: React.ReactNode;
  /** Span the full row, for long values that read badly in a narrow column. */
  wide?: boolean;
}

interface FactGridProps {
  facts: Fact[];
  /** Narrowest column before the grid drops a column; keeps two columns on phones by default. */
  minColumnWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Structured label/value pairs, so related facts scan as a group rather than a run of prose. */
export const FactGrid: React.FC<FactGridProps> = ({ facts, minColumnWidth, className, style }) => (
  <dl
    className={className ? `fact-grid ${className}` : 'fact-grid'}
    style={minColumnWidth ? { ...style, ['--fact-min' as string]: `${minColumnWidth}px` } : style}
  >
    {facts.map((fact) => (
      <div key={fact.label} className={fact.wide ? 'fact-wide' : undefined}>
        <dt>{fact.label}</dt>
        <dd>{fact.value}</dd>
      </div>
    ))}
  </dl>
);
