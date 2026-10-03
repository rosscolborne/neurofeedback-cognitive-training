import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Import boundaries for the consumer app (NFCT-20, ADR-001).
//
// "Consumer code" is every non-test module under src/consumer/ (the consumer
// repositories and Firestore helpers, and the consumer game and progress UI
// that builds on them) plus the shared domain package, shared/. It makes no
// collection-group query: every consumer query stays inside users/{uid}.
//
// "App code" is every non-test module under src/ plus shared/: the code that
// ships to the browser and the iOS app.
// - Its Firestore code never addresses the retired clinical `clients` or
//   `sessions` collections, which the rules deny.
// - It must not import server-only modules (the Admin SDK, Cloud Functions,
//   the functions/ codebase, the Firebase CLI or the rules-testing harness).
//
// The path check sees literals passed to collection(), doc() or
// collectionGroup(), string and template literals with a clients/sessions path
// segment, and same-file `const X = 'clients'` constants passed to those
// calls. It does not follow constants imported from another module, computed
// strings or aliased path helpers.

// Every TypeScript source in src/ and shared/, keyed by repository path ('src/...').
const SOURCES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '/shared/**/*.ts', '!**/*.d.ts'],
  { query: '?raw', import: 'default', eager: true },
)).map(([path, text]) => [path.slice(1), text]));

const CONSUMER_ROOTS = ['src/consumer', 'shared'];
const APP_ROOTS = ['src', 'shared'];

const CLINICAL_COLLECTIONS = new Set(['clients', 'sessions']);
const PATH_CALLS = new Set(['collection', 'doc', 'collectionGroup']);
const SERVER_ONLY_PACKAGES = [/^firebase-admin(\/|$)/, /^firebase-functions(\/|$)/, /^@google-cloud\//, /^firebase-tools(\/|$)/, /^@firebase\/rules-unit-testing(\/|$)/];
const SERVER_ONLY_DIRECTORIES = ['functions'];

/** Joins and normalizes a POSIX path relative to the repository root ('..' past the root is kept). */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

const dirname = (path: string) => path.split('/').slice(0, -1).join('/');

function isTestFile(path: string): boolean {
  return /(^|\/)__tests__\//.test(path) || /\.(test|spec)\.tsx?$/.test(path);
}

function sourceFiles(root: string): string[] {
  return Object.keys(SOURCES).filter((path) => path.startsWith(`${root}/`) && !isTestFile(path)).sort();
}

interface SourceFacts {
  /** Every module specifier: static and type-only imports, re-exports, dynamic imports and import types. */
  specifiers: string[];
  /** Names imported from firebase/firestore. */
  firestoreImports: string[];
  /** Literals and calls that address a clinical collection. */
  clinicalPaths: string[];
}

function isClinicalPathLiteral(text: string): boolean {
  if (!text.includes('/')) return false;
  return text.split('/').some((segment) => CLINICAL_COLLECTIONS.has(segment));
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function analyze(fileName: string, text: string): SourceFacts {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const facts: SourceFacts = { specifiers: [], firestoreImports: [], clinicalPaths: [] };

  // `const X = 'clients'` and `const X = 'sessions'` in this file.
  const clinicalConstants = new Set<string>();
  const collectConstants = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isStringLiteralLike(node.initializer) && CLINICAL_COLLECTIONS.has(node.initializer.text)
      && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      clinicalConstants.add(node.name.text);
    }
    ts.forEachChild(node, collectConstants);
  };
  collectConstants(source);

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      facts.specifiers.push(node.moduleSpecifier.text);
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'firebase/firestore') {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          facts.firestoreImports.push(...bindings.elements.map((element) => (element.propertyName ?? element.name).text));
        }
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument)) facts.specifiers.push(argument.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      facts.specifiers.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && PATH_CALLS.has(calleeName(node.expression) ?? '')) {
      for (const argument of node.arguments) {
        if (ts.isStringLiteralLike(argument) && CLINICAL_COLLECTIONS.has(argument.text)) {
          facts.clinicalPaths.push(`${calleeName(node.expression)}(... '${argument.text}' ...)`);
        } else if (ts.isIdentifier(argument) && clinicalConstants.has(argument.text)) {
          facts.clinicalPaths.push(`${calleeName(node.expression)}(... ${argument.text} ...)`);
        }
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isClinicalPathLiteral(node.text)) {
      facts.clinicalPaths.push(`'${node.text}'`);
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('/x/');
      if (isClinicalPathLiteral(parts)) facts.clinicalPaths.push(`\`${node.getText(source)}\``);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return facts;
}

const factsCache = new Map<string, SourceFacts>();
function factsOf(file: string): SourceFacts {
  let facts = factsCache.get(file);
  if (!facts) {
    facts = analyze(file, SOURCES[file] ?? '');
    factsCache.set(file, facts);
  }
  return facts;
}

/** Resolves a specifier to a repository path, or null for a package. */
function resolveModule(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier === '@nfct/shared') base = 'shared/index.ts';
  else if (specifier.startsWith('./') || specifier.startsWith('../')) base = normalize(`${dirname(fromFile)}/${specifier}`);
  else if (specifier.startsWith('/src/') || specifier.startsWith('/shared/')) base = normalize(specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (candidate in SOURCES) return candidate;
  }
  // Keep other relative imports visible (for example an asset or a module outside src/ and shared/).
  return base;
}

function inModule(file: string, module: string): boolean {
  return file === module || file.startsWith(`${module}/`);
}

const consumerFiles = CONSUMER_ROOTS.flatMap(sourceFiles);
const appFiles = APP_ROOTS.flatMap(sourceFiles);

describe('consumer import boundary', () => {
  it('finds the consumer code it guards', () => {
    expect(consumerFiles).toEqual(expect.arrayContaining([
      'src/consumer/repositories/gameSessionRepository.ts',
      'src/consumer/repositories/index.ts',
      'shared/index.ts',
    ]));
    expect(appFiles).toEqual(expect.arrayContaining(['src/App.tsx', 'src/contexts/AuthContext.tsx']));
  });

  it('never addresses the retired clients or sessions collections anywhere in app code', () => {
    // Only a module that uses the Firestore SDK can address a Firestore path;
    // others, such as the BrainFlow client, may have HTTP routes named "sessions".
    const firestoreFiles = appFiles.filter((file) => factsOf(file).specifiers.includes('firebase/firestore'));
    const violations = firestoreFiles.flatMap((file) => factsOf(file).clinicalPaths.map((path) => `${file}: ${path}`));

    expect(firestoreFiles).toEqual(expect.arrayContaining(['src/consumer/firestore/context.ts']));

    expect(violations).toEqual([]);
  });

  it('never queries across users with a collection group', () => {
    const violations = consumerFiles.filter((file) => factsOf(file).firestoreImports.includes('collectionGroup'));

    expect(violations).toEqual([]);
  });

  it('keeps server-only modules out of app code', () => {
    const violations = appFiles.flatMap((file) => factsOf(file).specifiers
      .filter((specifier) => {
        if (SERVER_ONLY_PACKAGES.some((pattern) => pattern.test(specifier))) return true;
        const target = resolveModule(file, specifier);
        return target !== null && SERVER_ONLY_DIRECTORIES.some((directory) => inModule(target, directory));
      })
      .map((specifier) => `${file} -> ${specifier}`));

    expect(appFiles.length).toBeGreaterThan(consumerFiles.length);
    expect(violations).toEqual([]);
  });
});

describe('import boundary checker', () => {
  // Proves the checks above are not vacuous.
  it('sees every kind of import', () => {
    const facts = analyze('probe.ts', [
      "import { a } from '../services/eegEngine';",
      "import type { EEGDataPoint } from '../../types';",
      "export { b } from './reexported';",
      "const lazy = await import('firebase-admin/firestore');",
      "type T = import('firebase-functions/v2').CloudEvent<unknown>;",
      "import { collectionGroup as group, doc } from 'firebase/firestore';",
    ].join('\n'));

    expect(facts.specifiers).toEqual([
      '../services/eegEngine', '../../types', './reexported', 'firebase-admin/firestore', 'firebase-functions/v2', 'firebase/firestore',
    ]);
    expect(facts.firestoreImports).toEqual(['collectionGroup', 'doc']);
  });

  it('flags clinical collection paths and nothing else', () => {
    const flagged = analyze('probe.ts', [
      "doc(db, 'clients', uid);",
      "collection(db, 'sessions');",
      "admin.collection('sessions');",
      "const path = 'clients/' + uid;",
      'const other = `users/${uid}/sessions/${id}`;',
      "const nested = `sessions/${id}`;",
      "const CLIENTS = 'clients'; doc(db, CLIENTS, uid);",
    ].join('\n')).clinicalPaths;
    const clean = analyze('probe.ts', [
      "collection(db, 'users', uid, 'gameSessions');",
      "const goal = z.enum(['sessions', 'minutes', 'activeDays']);",
      "const copy = 'No sessions yet';",
      'const fine = `users/${uid}/gameSessions`;',
      "const kind = 'sessions'; setGoal(kind); doc(db, 'users', uid);",
      "let mutable = 'clients'; doc(db, 'users', mutable);",
    ].join('\n')).clinicalPaths;

    expect(flagged).toHaveLength(7);
    expect(clean).toEqual([]);
  });

  it('follows relative imports and the shared alias', () => {
    expect(resolveModule('src/consumer/repositories/index.ts', '../../services/firebase')).toBe('src/services/firebase.ts');
    expect(resolveModule('src/consumer/repositories/index.ts', '@nfct/shared')).toBe('shared/index.ts');
    expect(resolveModule('src/components/x.ts', '../types')).toBe('src/types/index.ts');
    expect(resolveModule('src/x.ts', 'firebase/firestore')).toBeNull();
    expect(resolveModule('src/components/x.ts', '../../functions/src/scoring')).toBe('functions/src/scoring');
  });
});
