import { ClinicBrandConfig } from '../types';
import { APP_DISPLAY_NAME } from '../config/appIdentity';

export interface ContrastResult {
  ratio: number;
  ratioFormatted: string;
  passesAALarge: boolean;
  passesAANormal: boolean;
  passesAAANormal: boolean;
}

export const BRAND_SMALL_TEXT_SURFACES = ['#FFFFFF', '#F8F7F4', '#FAFAFA'] as const;

export const isValidHexColor = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value.trim());

export const getWorstBrandAccentContrast = (value: string): ContrastResult => {
  if (!isValidHexColor(value)) return { ratio: 0, ratioFormatted: '0.00:1', passesAALarge: false, passesAANormal: false, passesAAANormal: false };
  return BRAND_SMALL_TEXT_SURFACES
    .map((surface) => calculateContrast(value, surface))
    .reduce((worst, current) => current.ratio < worst.ratio ? current : worst);
};

export const isBrandAccentUsable = (value: string): boolean => getWorstBrandAccentContrast(value).passesAANormal;

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

export function createBrandPalette(accentHex: string, clinicName = APP_DISPLAY_NAME, logoUrl = '/app-logo.png'): ClinicBrandConfig {
  if (!isValidHexColor(accentHex)) throw new Error('Enter a six-digit hexadecimal accent color.');
  if (!isBrandAccentUsable(accentHex)) throw new Error('Choose an accent with at least 4.5:1 contrast against all supported light surfaces.');
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
    name: APP_DISPLAY_NAME,
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

export function applyBrandToDOM(brand: ClinicBrandConfig) {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', brand.primaryAccent);
  root.style.setProperty('--brand-primary-hover', brand.primaryHover);
  root.style.setProperty('--brand-primary-subtle', brand.primarySubtle);
  root.style.setProperty('--brand-on-primary', brand.onPrimary);
  root.style.setProperty('--surface-patient-base', brand.patientBaseSurface);
}

const MAX_CLINIC_NAME = 120;
const MAX_TAGLINE = 180;
const MAX_LOGO_URL = 700_000;

const optionalText = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maximum);
};

const timestampString = (value: unknown): string | null => {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  if (value && typeof value === 'object') {
    const candidate = value as { seconds?: unknown; toDate?: unknown };
    if (typeof candidate.toDate === 'function') {
      const date = (candidate.toDate as () => Date)();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof candidate.seconds === 'number' && Number.isFinite(candidate.seconds)) {
      return new Date(candidate.seconds * 1000).toISOString();
    }
  }
  return null;
};

const safeLogoUrl = (value: unknown): string => {
  const candidate = optionalText(value, MAX_LOGO_URL);
  if (
    candidate.startsWith('/') ||
    candidate.startsWith('https://') ||
    candidate.startsWith('http://') ||
    candidate.startsWith('data:image/png;') ||
    candidate.startsWith('data:image/webp;') ||
    candidate.startsWith('data:image/svg+xml;')
  ) return candidate;
  return '/app-logo.png';
};

/** Maps a linked clinic's persisted, untrusted branding to a complete safe palette, or rejects it. */
export const mapClinicBrand = (value: unknown, expectedClinicId: string): ClinicBrandConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.clinicId !== expectedClinicId) return null;
  const name = optionalText(raw.name, MAX_CLINIC_NAME);
  const accent = typeof raw.primaryAccent === 'string' ? raw.primaryAccent.trim().toUpperCase() : '';
  if (!name || !isBrandAccentUsable(accent)) return null;
  const logoUrl = safeLogoUrl(raw.logoUrl);
  try {
    const mapped = createBrandPalette(accent, name, logoUrl);
    mapped.clinicId = expectedClinicId;
    mapped.tagline = optionalText(raw.tagline, MAX_TAGLINE);
    mapped.typographyStyle = raw.typographyStyle === 'modern-sans' ? 'modern-sans' : 'editorial-serif';
    mapped.createdAt = timestampString(raw.createdAt) ?? '';
    const updatedAt = timestampString(raw.updatedAt);
    if (updatedAt) mapped.updatedAt = updatedAt;
    mapped.schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
    return mapped;
  } catch {
    return null;
  }
};
