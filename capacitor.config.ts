import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // The bundle ID is the owner's choice, provisional until its App ID is
  // registered; it is permanent once an App Store Connect record uses it. The
  // display name is a working name until NFCT-34 (docs/nfct/ios.md#identity).
  // appId must equal PRODUCT_BUNDLE_IDENTIFIER in ios/App/App.xcodeproj.
  appId: 'com.neurofeedbackcognitivetraining.app',
  appName: 'NFCT',
  webDir: 'dist',
  server: {
    // The iOS origin is capacitor://localhost, permanently (ADR-002). Auth,
    // the Firestore cache and every other on-device store are keyed by it,
    // so changing it would orphan installed users' data. 'https' cannot be
    // used on iOS: WKWebView handles it itself, and Capacitor silently falls
    // back to 'capacitor'.
    iosScheme: 'capacitor',
    hostname: 'localhost',
    androidScheme: 'https',
  },
  plugins: {
    // Dark status-bar text over the light UI. Capacitor's built-in SystemBars
    // plugin applies its style at launch, after Info.plist's UIStatusBarStyle
    // is read, so the style is set here (Info.plist also forces Light).
    SystemBars: { style: 'LIGHT' },
  },
};

export default config;
