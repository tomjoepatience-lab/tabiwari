import type { CapacitorConfig } from '@capacitor/cli';

// マネコ家計簿 iOSシェル（M1）
// v1 はリモートURL方式: server.url で Render 上の既存Webアプリをそのまま読み込む。
// cookie セッション認証はそのまま WKWebView 内で機能する想定（同一オリジンへの
// fetch はアプリ内WebViewから直接行われるため、既存の認証フローに変更は不要）。
// www/ はプレースホルダ（server.url 使用時も Capacitor が webDir を要求するため）。
const config: CapacitorConfig = {
  appId: 'com.tomjo.maneko',
  appName: 'マネコ家計簿',
  webDir: 'www',
  server: {
    url: 'https://tabiwari-dacx.onrender.com',
    cleartext: false,
  },
  ios: {
    // 既定のまま（allowsLinkPreview 等は変更しない）
  },
};

export default config;
