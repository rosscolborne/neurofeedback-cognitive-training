import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.brainswell.app',
  appName: 'Brainswell',
  webDir: 'dist',
  server: {
    iosScheme: 'https',
    androidScheme: 'https'
  }
};

export default config;
