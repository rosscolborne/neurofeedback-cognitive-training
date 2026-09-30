import React from 'react';
import { Delete } from 'lucide-react';

// The on-screen numeric keypad. It is made of buttons only, so the device
// keyboard never opens. There is no minus key (answers are positive integers)
// and nothing submits except the Submit key.
//
// Keys that cannot act right now (during the feedback flash, or Submit with
// nothing typed) are marked aria-disabled rather than disabled, so a focused
// key keeps focus between questions; the handlers ignore them.

interface KeypadProps {
  /** Digits and Delete accept input. */
  readonly enabled: boolean;
  /** Submit is enabled (something is typed). */
  readonly canSubmit: boolean;
  readonly onDigit: (digit: number) => void;
  readonly onDelete: () => void;
  readonly onSubmit: () => void;
}

const DIGIT_ROWS = [[1, 2, 3], [4, 5, 6], [7, 8, 9]] as const;

const Key: React.FC<{ readonly active: boolean; readonly className?: string; readonly label?: string; readonly onPress: () => void; readonly children: React.ReactNode }> = ({ active, className = '', label, onPress, children }) => (
  <button
    type="button"
    className={`mm-key ${className}`.trim()}
    aria-label={label}
    aria-disabled={active ? undefined : 'true'}
    onClick={() => { if (active) onPress(); }}
  >
    {children}
  </button>
);

export const Keypad: React.FC<KeypadProps> = ({ enabled, canSubmit, onDigit, onDelete, onSubmit }) => (
  <div className="mm-keypad" role="group" aria-label="Answer keypad">
    {DIGIT_ROWS.flat().map((digit) => (
      <Key key={digit} active={enabled} onPress={() => onDigit(digit)}>{digit}</Key>
    ))}
    <Key active={enabled} className="mm-key-muted" label="Delete" onPress={onDelete}>
      <Delete size={22} aria-hidden="true" />
    </Key>
    <Key active={enabled} onPress={() => onDigit(0)}>0</Key>
    <Key active={enabled && canSubmit} className="mm-key-submit" onPress={onSubmit}>Submit</Key>
  </div>
);
