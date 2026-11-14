import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.diocres.hardwaresolutions',
  appName: 'Gmeck POS',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SystemBars: {
      style: 'DARK',
      hidden: false
    }
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
