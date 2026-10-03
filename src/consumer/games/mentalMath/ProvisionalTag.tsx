import React from 'react';

/**
 * Marks a value that counts a run trusted scoring has not scored yet: the
 * client preview's prediction, which the trusted result replaces (NFCT-52).
 * It is drawn dashed, like the summary's predicted records and unlocks. The
 * player sees one neutral word, not how the result is produced (NFCT-66).
 */
export const ProvisionalTag: React.FC = () => (
  <span className="status-tag mm-provisional-tag" data-provisional="true">Pending</span>
);
