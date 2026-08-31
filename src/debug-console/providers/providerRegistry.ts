import type { EegProviderFactory } from "./eegProvider";
import { MockEegProvider } from "./mockEegProvider";
import { NeurasticityEngineProvider } from "./neurasticityEngineProvider";

export const eegProviderFactories = {
  brainflowMuseAthena: (events) =>
    new NeurasticityEngineProvider("brainflow", events),
  museAthenaBluetooth: (events) => new NeurasticityEngineProvider("bluetooth", events),
  mock: (events) => new MockEegProvider(events),
} satisfies Record<string, EegProviderFactory>;

export type EegProviderKey = keyof typeof eegProviderFactories;

export interface DeviceCatalogOption {
  id: string;
  label: string;
  detail: string;
  providerKey?: EegProviderKey;
  disabled?: boolean;
}

export const deviceCatalog: DeviceCatalogOption[] = [
  {
    id: "brainflow-muse-athena",
    label: "Muse Athena",
    detail: "BrainFlow",
    providerKey: "brainflowMuseAthena",
  },
  {
    id: "muse-athena-bluetooth",
    label: "Muse Athena - Bluetooth",
    detail: "Chrome Web Bluetooth",
    providerKey: "museAthenaBluetooth",
  },
  {
    id: "openbci",
    label: "OpenBCI",
    detail: "Coming soon",
    disabled: true,
  },
  {
    id: "brainflow",
    label: "BrainFlow device",
    detail: "Coming soon",
    disabled: true,
  },
  {
    id: "lsl",
    label: "Lab Streaming Layer",
    detail: "Coming soon",
    disabled: true,
  },
];

export function getConfiguredProviderKey(): EegProviderKey {
  const configured = import.meta.env.VITE_EEG_PROVIDER;

  if (configured && configured in eegProviderFactories) {
    return configured;
  }

  return "brainflowMuseAthena";
}

export function createEegProvider(
  key: EegProviderKey,
  events: Parameters<EegProviderFactory>[0],
) {
  return eegProviderFactories[key](events);
}

export function createConfiguredEegProvider(
  events: Parameters<EegProviderFactory>[0],
) {
  return createEegProvider(getConfiguredProviderKey(), events);
}
