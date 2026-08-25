import { ClinicBrandConfig } from '../types';

export interface ContrastResult {
  ratio: number;
  ratioFormatted: string;
  passesAALarge: boolean;
  passesAANormal: boolean;
  passesAAANormal: boolean;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
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

export function adjustColorBrightness(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const factor = 1 + percent / 100;
  return rgbToHex(r * factor, g * factor, b * factor);
}

export function createBrandPalette(accentHex: string, clinicName = 'Brainswell', logoUrl = '/app-logo.png'): ClinicBrandConfig {
  const { r, g, b } = hexToRgb(accentHex);
  const lum = getRelativeLuminance(r, g, b);
  
  // Decide best text on accent (white vs deep ink)
  const onPrimary = lum > 0.45 ? '#1A1A1A' : '#FFFFFF';
  
  // Create hover (12% darker) and subtle tint (88% lighter)
  const primaryHover = adjustColorBrightness(accentHex, -15);
  
  // Blend with white for subtle
  const subtleR = Math.round(r * 0.12 + 255 * 0.88);
  const subtleG = Math.round(g * 0.12 + 255 * 0.88);
  const subtleB = Math.round(b * 0.12 + 255 * 0.88);
  const primarySubtle = rgbToHex(subtleR, subtleG, subtleB);

  return {
    clinicId: clinicName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    name: clinicName,
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
    clinicId: 'brainswell-core',
    name: 'Brainswell',
    tagline: 'Neurofeedback & Brain Training Suite',
    logoUrl: '/app-logo.png',
    primaryAccent: '#D16D4D', // Warm Terracotta Coral
    primaryHover: '#BA5B3D',
    primarySubtle: '#FBF2EE',
    onPrimary: '#FFFFFF',
    patientBaseSurface: '#F8F7F4',
    clinicianBaseSurface: '#FAFAFA',
    typographyStyle: 'editorial-serif',
    createdAt: '2026-08-20T00:00:00Z',
  },
  {
    clinicId: 'evolve-brain-training',
    name: 'Evolve Brain Training',
    tagline: 'Personalized Neurofeedback & Focus Therapy',
    logoUrl: '/app-logo.png',
    primaryAccent: '#E8967A', // Soft Warm Coral
    primaryHover: '#D4805E',
    primarySubtle: '#FDF0EB',
    onPrimary: '#FFFFFF',
    patientBaseSurface: '#F8F7F4',
    clinicianBaseSurface: '#FAFAFA',
    typographyStyle: 'editorial-serif',
    createdAt: '2026-08-20T00:00:00Z',
  },
  {
    clinicId: 'apex-neuro',
    name: 'Apex Neuro Institute',
    tagline: 'Executive Focus & Cognitive Optimization',
    logoUrl: 'waves-amber',
    primaryAccent: '#E4894E', // Warm Terracotta / Amber
    primaryHover: '#C86E35',
    primarySubtle: '#FCF3EB',
    onPrimary: '#FFFFFF',
    patientBaseSurface: '#FAF8F5',
    clinicianBaseSurface: '#F8F9FA',
    typographyStyle: 'modern-sans',
    createdAt: '2026-08-20T00:00:00Z',
  },
  {
    clinicId: 'serenity-mind-clinic',
    name: 'Serenity Mind Clinic',
    tagline: 'Anxiety Relief & Calming Alpha Conditioning',
    logoUrl: 'lotus-lavender',
    primaryAccent: '#9E7CA6', // Muted Dusty Lavender
    primaryHover: '#85618D',
    primarySubtle: '#F6F0F8',
    onPrimary: '#FFFFFF',
    patientBaseSurface: '#F9F7FA',
    clinicianBaseSurface: '#FAFAFC',
    typographyStyle: 'editorial-serif',
    createdAt: '2026-08-20T00:00:00Z',
  },
  {
    clinicId: 'komorebi-biofeedback',
    name: 'Komorebi Biofeedback',
    tagline: 'Mindfulness & Neural Synchrony',
    logoUrl: 'sun-gold',
    primaryAccent: '#C49B45', // Warm Antique Ochre Gold
    primaryHover: '#A8802E',
    primarySubtle: '#FBF6EA',
    onPrimary: '#FFFFFF',
    patientBaseSurface: '#FAF7F1',
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
  root.style.setProperty('--surface-clinician-base', brand.clinicianBaseSurface);
}
