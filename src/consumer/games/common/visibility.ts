// Whether the app is in the background. Backgrounding pauses a run; it never ends it.

export interface VisibilitySource {
  isHidden(): boolean;
  subscribe(onChange: () => void): () => void;
}

export const documentVisibility: VisibilitySource = {
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  subscribe: (onChange) => {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  },
};
