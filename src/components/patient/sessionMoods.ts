/** Subjective post-session ratings, shared by the check-in and session history. */
export const MOODS: Array<{ value: 1 | 2 | 3 | 4 | 5; label: string; score: string }> = [
  { value: 1, label: 'Tense', score: '1/5' },
  { value: 2, label: 'Neutral', score: '2/5' },
  { value: 3, label: 'Calm', score: '3/5' },
  { value: 4, label: 'Focused', score: '4/5' },
  { value: 5, label: 'Flow State', score: '5/5' },
];
