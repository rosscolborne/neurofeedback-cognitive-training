import { execFileSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import capacitorConfig from '../../capacitor.config.ts';
import viteConfig from '../../vite.config.ts';
import { buildConfigurations, configurationLists, parsePlist } from '../ios/xcode-project.mjs';

// Pins the iOS project decisions of NFCT-30 (docs/nfct/ios.md, ADR-002), so
// that they change only deliberately.
const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');
const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
const configurations = buildConfigurations(pbxproj);
const lists = configurationLists(pbxproj);
const appTarget = configurations.filter(({ id }) => lists['PBXNativeTarget App'].includes(id));
const infoPlist = parsePlist(read('ios/App/App/Info.plist'));

describe('iOS identity and signing', () => {
  it('uses one NFCT bundle ID in Capacitor and every App configuration', () => {
    expect(capacitorConfig.appId).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/);
    expect(capacitorConfig.appId).not.toMatch(/waveable|brainswell|getcapacitor/i);
    expect(appTarget.map(({ name }) => name).sort()).toEqual(['Debug', 'Release']);
    for (const { settings } of appTarget) expect(settings.PRODUCT_BUNDLE_IDENTIFIER).toBe(capacitorConfig.appId);
    expect(infoPlist.CFBundleDisplayName).toBe(capacitorConfig.appName);
  });

  it('commits no signing team; signing is local and gitignored', () => {
    for (const { settings } of configurations) expect(settings).not.toHaveProperty('DEVELOPMENT_TEAM');
    for (const file of ['debug.xcconfig', 'release.xcconfig']) {
      expect(read(`ios/${file}`)).toMatch(/^#include\? "signing\.local\.xcconfig"$/m);
    }
    expect(execFileSync('git', ['check-ignore', 'ios/signing.local.xcconfig'], { cwd: root, encoding: 'utf8' }).trim())
      .toBe('ios/signing.local.xcconfig');
  });

  it('builds Debug from debug.xcconfig and Release from release.xcconfig', () => {
    for (const { name, base } of configurations) {
      expect(base).toBe(name === 'Debug' ? 'debug.xcconfig' : 'release.xcconfig');
    }
  });
});

describe('iOS origin and minimum version', () => {
  it('keeps the permanent capacitor://localhost origin', () => {
    expect(capacitorConfig.server?.iosScheme ?? 'capacitor').toBe('capacitor');
    expect(capacitorConfig.server?.hostname ?? 'localhost').toBe('localhost');
    expect(capacitorConfig.server).not.toHaveProperty('url');
    expect(capacitorConfig.ios?.webContentsDebuggingEnabled).not.toBe(true);
  });

  it('keeps the deployment target, the Vite build target and Package.swift in step', () => {
    const targets = new Set(configurations.map(({ settings }) => settings.IPHONEOS_DEPLOYMENT_TARGET));
    expect([...targets]).toEqual(['16.4']);
    const [target] = targets;
    expect(viteConfig.build.target).toEqual(expect.arrayContaining([`ios${target}`, `safari${target}`]));
    expect(read('ios/App/CapApp-SPM/Package.swift')).toContain(`platforms: [.iOS(.v${target.split('.')[0]})]`);
  });
});

describe('iOS device support (iPhone-only native app; decided 2026-10-01)', () => {
  it('targets iPhone only, and not Macs or Vision Pro', () => {
    for (const { settings } of appTarget) {
      expect(settings.TARGETED_DEVICE_FAMILY).toBe('1');
      expect(settings.SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD).toBe('NO');
      expect(settings.SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD).toBe('NO');
      expect(settings.SUPPORTS_MACCATALYST).toBe('NO');
    }
  });

  it('is portrait-only on iPhone and keeps the iPad orientations for a later iPad build', () => {
    expect(infoPlist.UISupportedInterfaceOrientations).toEqual(['UIInterfaceOrientationPortrait']);
    expect(infoPlist['UISupportedInterfaceOrientations~ipad']).toHaveLength(4);
  });
});

describe('Info.plist', () => {
  it('requires arm64 and not Bluetooth, because EEG is optional', () => {
    expect(infoPlist.UIRequiredDeviceCapabilities).toEqual(['arm64']);
  });

  it('describes Bluetooth in consumer terms, with the modern key only', () => {
    expect(infoPlist).not.toHaveProperty('NSBluetoothPeripheralUsageDescription');
    expect(infoPlist.NSBluetoothAlwaysUsageDescription).toMatch(/Muse/);
    expect(infoPlist.NSBluetoothAlwaysUsageDescription).not.toMatch(/waveable|neurofeedback|clinical/i);
  });

  it('has a camera string while an image file input can offer Take Photo', () => {
    const offersCamera = execFileSync('git', ['grep', '-l', 'image/\\*', '--', 'src'], { cwd: root, encoding: 'utf8' }).trim();
    expect(offersCamera).not.toBe('');
    expect(infoPlist.NSCameraUsageDescription).toMatch(/camera/i);
  });

  it('keeps dark status-bar text in Dark Mode', () => {
    expect(infoPlist.UIUserInterfaceStyle).toBe('Light');
    // Capacitor 8's SystemBars plugin overrides Info.plist's UIStatusBarStyle at launch.
    expect(capacitorConfig.plugins?.SystemBars?.style).toBe('LIGHT');
  });

  it('makes only Debug builds inspectable and has no ATS exception', () => {
    expect(infoPlist.CAPACITOR_DEBUG).toBe('$(CAPACITOR_DEBUG)');
    expect(read('ios/debug.xcconfig')).toMatch(/^CAPACITOR_DEBUG = true$/m);
    expect(read('ios/release.xcconfig')).not.toMatch(/CAPACITOR_DEBUG\s*=/);
    expect(infoPlist).not.toHaveProperty('NSAppTransportSecurity');
  });
});

describe('Release web-bundle guard build phase', () => {
  it('runs first in the App target and calls the committed, executable guard', () => {
    const phases = pbxproj.match(/buildPhases = \(\n([\s\S]*?)\n\t\t\t\);/)[1];
    expect(phases.trim().split('\n')[0]).toContain('Refuse a development web bundle in Release');
    expect(pbxproj).toContain('shellScript = "\\"${SRCROOT}/../scripts/release-web-bundle-guard.sh\\"\\n";');
    accessSync(root + 'ios/scripts/release-web-bundle-guard.sh', constants.X_OK);
    for (const { settings } of appTarget) expect(settings.ENABLE_USER_SCRIPT_SANDBOXING).toBe('NO');
  });
});
