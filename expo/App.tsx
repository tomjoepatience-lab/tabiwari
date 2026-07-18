import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

// マネコ家計簿の本体は Render 上の既存Webアプリ（cookieセッション認証込み）。
// このExpoアプリは全画面WebViewでそれを表示するだけの「殻」。
const HOME_URL = 'https://tabiwari-dacx.onrender.com';
const HOME_HOST = 'tabiwari-dacx.onrender.com';

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // 別オリジンへのメインフレーム遷移だけを外部ブラウザへ逃がす。
  // 地図タイルの取得などのサブリソース読み込みは isTopFrame===false、
  // または navigation を伴わない通常のリクエストなのでここには来ない。
  const handleShouldStartLoad = useCallback((request: ShouldStartLoadRequest) => {
    const { url, isTopFrame } = request;
    if (!isTopFrame) {
      return true;
    }
    let sameOrigin = true;
    try {
      sameOrigin = new URL(url).hostname === HOME_HOST;
    } catch {
      // http/https 以外のスキーム（mailto: / tel: 等）はURLとして解析できないことがある。
      sameOrigin = url.startsWith(HOME_URL);
    }
    if (!sameOrigin) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  const reload = useCallback(() => {
    setHasError(false);
    setLoading(true);
    webViewRef.current?.reload();
  }, []);

  if (hasError) {
    return (
      <View style={styles.errorContainer}>
        <StatusBar barStyle="dark-content" />
        <Text style={styles.errorEmoji}>😿</Text>
        <Text style={styles.errorTitle}>読み込めませんでした</Text>
        <Text style={styles.errorBody}>
          通信状態をご確認のうえ、もう一度お試しください。
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={reload} accessibilityRole="button">
          <Text style={styles.retryButtonText}>再読み込み</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={webViewRef}
        source={{ uri: HOME_URL }}
        style={styles.webview}
        // Web側が env(safe-area-inset-*) でセーフエリアを扱っているため、
        // ネイティブ側では二重に余白を足さない（'never' が既定値だが明示しておく）。
        contentInsetAdjustmentBehavior="never"
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onLoadEnd={() => setLoading(false)}
        onError={() => setHasError(true)}
        onHttpError={(event) => {
          // 5xx（サーバー障害）のみ読み込み失敗として扱う。4xx（未ログイン等の画面）は
          // アプリ側で普通に描画されるべきなのでエラー扱いしない。
          if (event.nativeEvent.statusCode >= 500) {
            setHasError(true);
          }
        }}
      />
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.loadingOverlay]} pointerEvents="none">
          <ActivityIndicator size="large" color="#E8B62B" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#ffffff',
  },
  errorEmoji: {
    fontSize: 56,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333333',
  },
  errorBody: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#E8B62B',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3a2a00',
  },
});
