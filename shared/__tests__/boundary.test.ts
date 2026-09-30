import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SHARED_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

describe('shared package boundary', () => {
  const files = sourceFiles(SHARED_DIR);

  it('imports only zod and its own modules', () => {
    const outside = files.flatMap((file) => importsOf(file)
      .filter((specifier) => {
        if (specifier === 'zod') return false;
        if (!specifier.startsWith('.')) return true;
        return relative(SHARED_DIR, join(dirname(file), specifier)).startsWith('..');
      })
      .map((specifier) => `${relative(SHARED_DIR, file)} -> ${specifier}`));

    expect(files.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });

  it('keeps EEG out of progression', () => {
    const progressionFiles = files.filter((file) => relative(SHARED_DIR, file).startsWith('progress/'));
    const eegImports = progressionFiles.flatMap((file) => importsOf(file)
      .filter((specifier) => /eeg/i.test(specifier))
      .map((specifier) => `${relative(SHARED_DIR, file)} -> ${specifier}`));

    expect(progressionFiles.length).toBeGreaterThan(0);
    expect(eegImports).toEqual([]);
  });
});
