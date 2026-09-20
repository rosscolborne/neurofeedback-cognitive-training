import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicBrandConfig } from '../../types';

const repository = vi.hoisted(() => ({
  load: vi.fn(),
  saveSettings: vi.fn(),
  saveBrand: vi.fn(),
}));

const brandEffects = vi.hoisted(() => ({ applyBrandToDOM: vi.fn() }));

const hooks = vi.hoisted(() => {
  let stateSlots: unknown[] = [];
  let stateCursor = 0;
  let effectCursor = 0;
  let refCursor = 0;
  let effectDependencies: Array<unknown[] | undefined> = [];
  let refs: Array<{ current: unknown }> = [];
  let pendingEffects: Array<() => void | (() => void)> = [];

  const dependenciesMatch = (left: unknown[] | undefined, right: unknown[] | undefined) =>
    Boolean(left && right && left.length === right.length && left.every((entry, index) => Object.is(entry, right[index])));

  return {
    reset() {
      stateSlots = [];
      effectDependencies = [];
      refs = [];
      pendingEffects = [];
    },
    beginRender() {
      stateCursor = 0;
      effectCursor = 0;
      refCursor = 0;
    },
    useState(initial: unknown) {
      const index = stateCursor++;
      if (!(index in stateSlots)) stateSlots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const setState = (next: unknown) => {
        stateSlots[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(stateSlots[index]) : next;
      };
      return [stateSlots[index], setState];
    },
    useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
      const index = effectCursor++;
      if (!dependenciesMatch(effectDependencies[index], dependencies)) {
        effectDependencies[index] = dependencies;
        pendingEffects.push(effect);
      }
    },
    useRef(initial: unknown) {
      const index = refCursor++;
      if (!refs[index]) refs[index] = { current: initial };
      return refs[index];
    },
    runEffects() {
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((effect) => effect());
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: hooks.useState, useEffect: hooks.useEffect, useRef: hooks.useRef };
});

vi.mock('../../services/clinicSettingsRepository', () => ({ clinicSettingsRepository: repository }));
vi.mock('../../services/brandEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/brandEngine')>();
  return { ...actual, applyBrandToDOM: brandEffects.applyBrandToDOM };
});

import { ClinicCustomizerModal } from '../brand/ClinicCustomizerModal';
import { ClinicSettingsView } from '../clinician/ClinicSettingsView';

const safeBrand: ClinicBrandConfig = {
  clinicId: 'clinic-1', name: 'Clinic One', tagline: 'Care', logoUrl: '/app-logo.png',
  primaryAccent: '#A8482F', primaryHover: '#8F3D28', primarySubtle: '#FBF2EE', onPrimary: '#FFFFFF',
  patientBaseSurface: '#F8F7F4', clinicianBaseSurface: '#FAFAFA', typographyStyle: 'editorial-serif', createdAt: '',
};

const emptySnapshot = {
  clinic: null, practitioner: null, brand: null, brandSource: 'default' as const,
  clinicId: 'clinic-1', needsOnboarding: true,
};

const populatedSnapshot = {
  clinic: { id: 'clinic-1', name: 'Clinic One', timezone: 'America/Toronto' },
  practitioner: {
    id: 'user-1', userId: 'user-1', clinicId: 'clinic-1', displayName: 'Dr. Rivera',
    credentials: [{ id: 'primary-license', type: 'medical-license' as const, label: 'Ontario license', identifier: 'ON-123', status: 'verified' as const, verifiedAt: { seconds: 10 } }],
  },
  brand: safeBrand, brandSource: 'clinic' as const, clinicId: 'clinic-1', needsOnboarding: false,
};

type ElementNode = ReactElement<Record<string, unknown>>;
const isElement = (value: unknown): value is ElementNode => Boolean(value && typeof value === 'object' && 'props' in value);
const childrenOf = (node: ElementNode): unknown[] => {
  const children = node.props.children;
  return Array.isArray(children) ? children : [children];
};
const walk = (node: unknown, output: ElementNode[] = []): ElementNode[] => {
  if (Array.isArray(node)) node.forEach((child) => walk(child, output));
  else if (isElement(node)) {
    output.push(node);
    childrenOf(node).forEach((child) => walk(child, output));
  }
  return output;
};
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return isElement(node) ? childrenOf(node).map(textOf).join(' ') : '';
};

const mount = (component: () => ReactElement) => {
  hooks.reset();
  let tree: ReactElement;
  const render = () => {
    hooks.beginRender();
    tree = component();
  };
  render();
  hooks.runEffects();
  return {
    text: () => textOf(tree),
    find: (type: string, predicate: (node: ElementNode) => boolean) => {
      const node = walk(tree).find((candidate) => candidate.type === type && predicate(candidate));
      if (!node) throw new Error(`Could not find ${type} in mounted component.`);
      return node;
    },
    async settle() {
      for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
        render();
        hooks.runEffects();
      }
    },
  };
};

const settings = () => mount(() => ClinicSettingsView({
  brand: safeBrand,
  onOpenRebrand: vi.fn(),
}) as ReactElement);
const customizer = (onSave = vi.fn(), onClose = vi.fn()) => ({
  mounted: mount(() => ClinicCustomizerModal({ currentBrand: safeBrand, onSave, onClose }) as ReactElement),
  onSave,
  onClose,
});

describe('mounted clinic settings interactions', () => {
  beforeEach(() => {
    repository.load.mockReset();
    repository.saveSettings.mockReset();
    repository.saveBrand.mockReset();
    brandEffects.applyBrandToDOM.mockReset();
  });

  it('moves from loading to an honest empty onboarding form', async () => {
    repository.load.mockResolvedValue(emptySnapshot);
    const view = settings();
    expect(view.text()).toContain('Loading clinic settings');
    await view.settle();
    expect(view.text()).toContain('Complete your clinic and practitioner profile');
    expect(view.find('input', (node) => node.props.placeholder === 'Enter your clinic name').props.value).toBe('');
  });

  it('loads persisted data and distinguishes preserved verification from a changed identifier', async () => {
    repository.load.mockResolvedValue(populatedSnapshot);
    const view = settings();
    await view.settle();
    expect(view.find('input', (node) => node.props.placeholder === 'Enter your professional display name').props.value).toBe('Dr. Rivera');
    expect(view.text()).toMatch(/Current saved credential status:\s+Verified/);
    expect(view.text()).toContain('preserves its Verified status');

    const license = view.find('input', (node) => node.props.placeholder === 'Enter an identifier; verification is separate');
    (license.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'ON-999' } });
    await view.settle();
    expect(view.text()).toContain('replacement as Unverified');

    (view.find('input', (node) => node.props.placeholder === 'Enter an identifier; verification is separate').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '' } });
    await view.settle();
    expect(view.text()).toContain('remove the saved primary credential');
    expect(view.text()).not.toContain('replacement as Unverified');
  });

  it.each([
    ['malformed identifier', { ...populatedSnapshot.practitioner.credentials[0], identifier: 42 as unknown as string }],
    ['unknown status', { ...populatedSnapshot.practitioner.credentials[0], status: 'mystery' as unknown as 'verified' }],
  ])('labels a %s primary credential as legacy-invalid', async (_caseName, credential) => {
    repository.load.mockResolvedValue({
      ...populatedSnapshot,
      practitioner: {
        ...populatedSnapshot.practitioner,
        credentials: [credential],
      },
    });
    const view = settings();
    await view.settle();
    expect(view.text()).toContain('Unavailable — incomplete legacy record');
    expect(view.text()).toContain('verification status is unavailable');
    expect(view.text()).not.toMatch(/\bVerified\b|\bUnverified\b/);
  });

  it('shows profile save success, resets Saved on edit, and reports save failure', async () => {
    repository.load.mockResolvedValue(populatedSnapshot);
    repository.saveSettings.mockResolvedValue(populatedSnapshot);
    const view = settings();
    await view.settle();
    const form = view.find('form', () => true);
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
    await view.settle();
    expect(view.text()).toContain('Saved');

    const name = view.find('input', (node) => node.props.placeholder === 'Enter your clinic name');
    (name.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Clinic Renamed' } });
    await view.settle();
    expect(view.text()).not.toContain(' Saved');

    repository.saveSettings.mockRejectedValue(new Error('Profile write denied'));
    await (view.find('form', () => true).props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({ preventDefault: vi.fn() });
    await view.settle();
    expect(view.text()).toContain('Profile write denied');
  });
});

describe('mounted clinic branding interactions', () => {
  beforeEach(() => {
    repository.load.mockReset();
    repository.saveSettings.mockReset();
    repository.saveBrand.mockReset();
    brandEffects.applyBrandToDOM.mockReset();
  });

  it('reports load errors and displays a tenant-validated migration notice', async () => {
    repository.load.mockRejectedValueOnce(new Error('Brand read denied'));
    const failed = customizer().mounted;
    await failed.settle();
    expect(failed.text()).toContain('Brand read denied');

    repository.load.mockResolvedValueOnce({ ...populatedSnapshot, brandSource: 'legacy-local' });
    const migrated = customizer().mounted;
    await migrated.settle();
    expect(migrated.text()).toContain('matching local theme was found');
  });

  it('reports an authoritative brand write failure', async () => {
    repository.load.mockResolvedValue(populatedSnapshot);
    repository.saveBrand.mockRejectedValue(new Error('Brand write denied'));
    const { mounted } = customizer();
    await mounted.settle();
    (mounted.find('button', (node) => textOf(node).includes('Save and apply')).props.onClick as () => void)();
    await mounted.settle();
    expect(mounted.text()).toContain('Brand write denied');
  });

  it('restores the persisted preview on cancel', async () => {
    repository.load.mockResolvedValue(populatedSnapshot);
    const { mounted, onClose } = customizer();
    await mounted.settle();
    brandEffects.applyBrandToDOM.mockClear();
    (mounted.find('button', (node) => textOf(node).trim() === 'Cancel').props.onClick as () => void)();
    expect(brandEffects.applyBrandToDOM).toHaveBeenCalledWith(safeBrand);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['preview', 'throw'],
    ['preview', 'reject'],
    ['onSave', 'throw'],
    ['onSave', 'reject'],
    ['onClose', 'throw'],
    ['onClose', 'reject'],
  ] as const)('contains a post-persistence %s %s and leaves the modal unlocked', async (target, failureMode) => {
    repository.load.mockResolvedValue(populatedSnapshot);
    repository.saveBrand.mockResolvedValue(safeBrand);
    const onSave = vi.fn();
    const onClose = vi.fn();
    const failure = () => {
      if (failureMode === 'throw') throw new Error(`${target} failed`);
      return Promise.reject(new Error(`${target} failed`));
    };
    if (target === 'onSave') onSave.mockImplementation(failure);
    if (target === 'onClose') onClose.mockImplementation(failure);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { mounted } = customizer(onSave, onClose);
    await mounted.settle();
    if (target === 'preview') brandEffects.applyBrandToDOM.mockImplementation(failure);

    (mounted.find('button', (node) => textOf(node).includes('Save and apply')).props.onClick as () => void)();
    await mounted.settle();

    expect(repository.saveBrand).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith(safeBrand);
    expect(onClose).toHaveBeenCalledOnce();
    expect(mounted.text()).not.toContain('could not be saved');
    expect(mounted.find('button', (node) => textOf(node).includes('Save and apply')).props.disabled).toBe(false);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
