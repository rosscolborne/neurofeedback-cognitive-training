import { ClinicBrandConfig } from '../types';

export interface ContrastResult {
  ratio: number;
  ratioFormatted: string;
  passesAALarge: boolean;
  passesAANormal: boolean;
  passesAAANormal: boolean;
}

export interface BrandColorPreset {
  id: string;
  label: string;
  accent: string;
}

export const isValidHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value.trim());

export const isBrandAccentUsable = (value: string): boolean =>
  isValidHexColor(value) && calculateContrast(value, '#FFFFFF').passesAANormal;

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  if (!isValidHexColor(hex) && !/^#[0-9a-f]{3}$/i.test(hex.trim())) {
    throw new Error('Enter a valid hexadecimal color such as #D16D4D.');
  }
  let cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleanHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('');
}

export function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function calculateContrast(hex1: string, hex2: string): ContrastResult {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);

  return {
    ratio,
    ratioFormatted: ratio.toFixed(2) + ':1',
    passesAALarge: ratio >= 3.0,
    passesAANormal: ratio >= 4.5,
    passesAAANormal: ratio >= 7.0,
  };
}

export function getOnPrimaryColor(accentHex: string): '#FFFFFF' | '#1A1A1A' {
  return calculateContrast('#FFFFFF', accentHex).ratio >= calculateContrast('#1A1A1A', accentHex).ratio
    ? '#FFFFFF'
    : '#1A1A1A';
}

export function adjustColorBrightness(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const factor = 1 + percent / 100;
  return rgbToHex(r * factor, g * factor, b * factor);
}

export function createBrandPalette(accentHex: string, clinicName = 'Waveable', logoUrl = '/app-logo.png'): ClinicBrandConfig {
  if (!isValidHexColor(accentHex)) throw new Error('Enter a six-digit hexadecimal accent color.');
  if (!isBrandAccentUsable(accentHex)) throw new Error('Choose an accent with at least 4.5:1 contrast against white.');
  if (!clinicName.trim()) throw new Error('Clinic display name is required.');
  const { r, g, b } = hexToRgb(accentHex);
  
  // Decide best text on accent (white vs deep ink)
  const onPrimary = getOnPrimaryColor(accentHex);
  
  // Create hover (12% darker) and subtle tint (88% lighter)
  const primaryHover = adjustColorBrightness(accentHex, -15);
  
  // Blend with white for subtle
  const subtleR = Math.round(r * 0.12 + 255 * 0.88);
  const subtleG = Math.round(g * 0.12 + 255 * 0.88);
  const subtleB = Math.round(b * 0.12 + 255 * 0.88);
  const primarySubtle = rgbToHex(subtleR, subtleG, subtleB);

  return {
    clinicId: clinicName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-'),
    name: clinicName.trim(),
    tagline: 'Neurofeedback & Cognitive Training Suite',
    logoUrl: logoUrl || '/app-logo.png',
    primaryAccent: accentHex,
    primaryHover,
    primarySubtle,
    onPrimary,
    patientBaseSurface: '#F8F7F4',
    clinicianBaseSurface: '#FAFAFA',
    typographyStyle: 'editorial-serif',
    createdAt: new Date().toISOString(),
  };
}

export const BRAND_PRESETS: ClinicBrandConfig[] = [
  {
    clinicId: 'waveable-core',
    name: 'Waveable',
    tagline: 'Neurofeedback & Brain Training Suite',
    logoUrl: '/app-logo.png',
    primaryAccent: '#A8482F',
    primaryHover: '#8F3D28',
    primarySubtle: '#FBF2EE',
    onPrimary: '#FFFFFF',
    patientBaseSurface: '#F8F7F4',
    clinicianBaseSurface: '#FAFAFA',
    typographyStyle: 'editorial-serif',
    createdAt: '2026-08-20T00:00:00Z',
  },
];

/** Color-only choices: applying one never substitutes a fabricated clinic identity. */
export const BRAND_COLOR_PRESETS: BrandColorPreset[] = [
  { id: 'terracotta', label: 'Warm terracotta', accent: '#A8482F' },
  { id: 'soft-coral', label: 'Deep coral', accent: '#9E4D36' },
  { id: 'amber', label: 'Burnished amber', accent: '#A65024' },
  { id: 'lavender', label: 'Deep lavender', accent: '#74507D' },
  { id: 'ochre', label: 'Antique ochre', accent: '#795D1C' },
];

export function applyBrandToDOM(brand: ClinicBrandConfig) {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', brand.primaryAccent);
  root.style.setProperty('--brand-primary-hover', brand.primaryHover);
  root.style.setProperty('--brand-primary-subtle', brand.primarySubtle);
  root.style.setProperty('--brand-on-primary', brand.onPrimary);
  root.style.setProperty('--surface-patient-base', brand.patientBaseSurface);
  root.style.setProperty('--surface-clinician-base', brand.clinicianBaseSurface);
}
