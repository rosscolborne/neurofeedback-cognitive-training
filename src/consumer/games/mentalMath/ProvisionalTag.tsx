import React from 'react';

/**
 * Marks a value that counts a run trusted scoring has not checked yet: the
 * client preview's prediction, which the server's result replaces (NFCT-52).
 * It is drawn dashed, like the summary's predicted records and unlocks.
 */
export const ProvisionalTag: React.FC = () => (
  <span className="status-tag mm-provisional-tag" data-provisional="true">Provisional</span>
);
