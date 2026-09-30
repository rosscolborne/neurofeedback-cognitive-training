import React from 'react';
import { Delete } from 'lucide-react';

// The on-screen numeric keypad. It is made of buttons only, so the device
// keyboard never opens. There is no minus key (answers are positive integers)
// and nothing submits except the Submit key.

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

export const Keypad: React.FC<KeypadProps> = ({ enabled, canSubmit, onDigit, onDelete, onSubmit }) => (
  <div className="mm-keypad" role="group" aria-label="Answer keypad">
    {DIGIT_ROWS.flat().map((digit) => (
      <button key={digit} type="button" className="mm-key" disabled={!enabled} onClick={() => onDigit(digit)}>
        {digit}
      </button>
    ))}
    <button type="button" className="mm-key mm-key-muted" aria-label="Delete" disabled={!enabled} onClick={onDelete}>
      <Delete size={22} aria-hidden="true" />
    </button>
    <button type="button" className="mm-key" disabled={!enabled} onClick={() => onDigit(0)}>
      0
    </button>
    <button type="button" className="mm-key mm-key-submit" disabled={!enabled || !canSubmit} onClick={onSubmit}>
      Submit
    </button>
  </div>
);
