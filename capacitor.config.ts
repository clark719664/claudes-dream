import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.prismbreak.game',
  appName: 'Prism Break',
  webDir: 'dist',
  // Portrait-only, edge-to-edge, dark. The game draws its own background.
  backgroundColor: '#080a14',
  android: {
    backgroundColor: '#080a14',
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#080a14',
    contentInset: 'never',
    // The canvas handles its own bounce; the WebView must not scroll.
    scrollEnabled: false,
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#080a14',
      overlaysWebView: true,
    },
  },
};

export default config;
