import React from 'react';
import type { Line } from './summaryLines';

/** One record or unlock line of a post-session summary. */
export const Highlight: React.FC<{ readonly icon: React.ReactNode; readonly line: Line; readonly name: string }> = ({ icon, line, name }) => (
  <li className={`mm-highlight mm-highlight-${line.tone}${line.pending ? ' mm-highlight-pending' : ''}`} data-summary={name} data-pending={line.pending ? 'true' : 'false'}>
    <span className="mm-highlight-icon" aria-hidden="true">{icon}</span>
    <span className="mm-highlight-text">
      <strong className="mm-highlight-title">
        {line.title}
        {line.pending && <span className="mm-visually-hidden"> (pending)</span>}
      </strong>
      <span className="mm-highlight-detail">{line.detail}</span>
    </span>
  </li>
);
