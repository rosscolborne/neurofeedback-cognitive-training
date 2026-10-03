// Kept apart from gameScreens.tsx so plain .ts modules (and tsconfig projects
// without JSX, such as the repositories typecheck) can use the type.

/** Where a game screen opens: its start screen, or its progress and history (NFCT-22). */
export type GameScreenView = 'start' | 'progress';
