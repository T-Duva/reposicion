import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.reposicion.app',
  appName: 'REPOSICIÓN',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      '*.tunnelmole.net',
      '*.loca.lt',
      '*.trycloudflare.com',
      'raw.githubusercontent.com',
      'cdn.jsdelivr.net',
      '192.168.1.27',
    ],
  },
};

export default config;
