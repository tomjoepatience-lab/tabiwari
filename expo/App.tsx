import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

// マネコ家計簿の本体は Render 上の既存Webアプリ（cookieセッション認証込み）。
// このExpoアプリは全画面WebViewでそれを表示するだけの「殻」。
const HOME_URL = 'https://tabiwari-mu.vercel.app';
const HOME_HOST = 'tabiwari-mu.vercel.app';

type MapPoint = { lat: number; lng: number; name?: string | null; title?: string | null; subtitle?: string | null };
type PickedPlace = { lat: number; lng: number; name?: string | null };
type PlaceSearchResult = { lat: number; lng: number; name: string; detail: string };
type NativeMapRequest = {
  type: 'OPEN_MAP_PICKER' | 'OPEN_MAP_VIEWER';
  requestId: string;
  initial?: PickedPlace | null;
  points?: MapPoint[];
  title?: string;
};
type NativeIapRequest = {
  type: 'IAP_GET_STATE' | 'IAP_PURCHASE' | 'IAP_RESTORE';
  requestId: string;
  userId: number;
  productId?: string;
};

const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '';

const DEFAULT_REGION: Region = {
  latitude: 35.681,
  longitude: 139.767,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

function inviteWebUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const token = parsed.pathname.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1]
      ?? (parsed.host === 'invite' ? parsed.pathname.replace(/^\//, '') : null);
    return token ? `${HOME_URL}/invite/${token}` : null;
  } catch {
    return null;
  }
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const mapRef = useRef<MapView>(null);
  const revenueCatUserRef = useRef<string | null>(null);
  const revenueCatConfiguredRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [webUri, setWebUri] = useState(HOME_URL);
  const [mapRequest, setMapRequest] = useState<NativeMapRequest | null>(null);
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [placeSearching, setPlaceSearching] = useState(false);
  const [placeSearchMessage, setPlaceSearchMessage] = useState('');
  const loaderProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !REVENUECAT_IOS_API_KEY || revenueCatConfiguredRef.current) return;
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
    Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
    revenueCatConfiguredRef.current = true;
  }, []);

  const points = mapRequest?.points ?? [];
  const initialRegion = useMemo<Region>(() => {
    const p = mapRequest?.initial ?? points[0];
    return p
      ? { latitude: p.lat, longitude: p.lng, latitudeDelta: 0.025, longitudeDelta: 0.025 }
      : DEFAULT_REGION;
  }, [mapRequest]);

  const openInvite = useCallback((url: string) => {
    const next = inviteWebUrl(url);
    if (!next) return;
    setHasError(false);
    setLoading(true);
    setWebUri(next);
  }, []);

  useEffect(() => {
    void Linking.getInitialURL().then((url) => { if (url) openInvite(url); });
    const sub = Linking.addEventListener('url', ({ url }) => openInvite(url));
    return () => sub.remove();
  }, [openInvite]);

  useEffect(() => {
    if (!loading) {
      loaderProgress.setValue(0);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(loaderProgress, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(loaderProgress, {
          toValue: 0,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [loaderProgress, loading]);

  useEffect(() => {
    if (!mapRequest || !points.length) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        { edgePadding: { top: 90, right: 45, bottom: 110, left: 45 }, animated: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [mapRequest, points]);

  const sendMapResult = useCallback((cancelled: boolean, value?: unknown) => {
    if (!mapRequest) return;
    const message = JSON.stringify({
      type: 'NATIVE_MAP_RESULT',
      requestId: mapRequest.requestId,
      cancelled,
      value,
    });
    webViewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    );
    setMapRequest(null);
    setPicked(null);
    setPlaceQuery('');
    setPlaceResults([]);
    setPlaceSearchMessage('');
  }, [mapRequest]);

  const sendIapResult = useCallback((requestId: string, state: unknown, cancelled = false) => {
    const message = JSON.stringify({ type: 'NATIVE_IAP_RESULT', requestId, state, cancelled });
    webViewRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(message)}}));true;`,
    );
  }, []);

  const loadIapState = useCallback(async (userId: number) => {
    if (!revenueCatConfiguredRef.current) {
      return {
        configured: false,
        products: [],
        entitlements: [],
        error: 'RevenueCatの公開iOSキーが未設定です',
      };
    }
    const appUserId = `maneko-user-${userId}`;
    if (revenueCatUserRef.current !== appUserId) {
      await Purchases.logIn(appUserId);
      revenueCatUserRef.current = appUserId;
    }
    const [offerings, customerInfo] = await Promise.all([
      Purchases.getOfferings(),
      Purchases.getCustomerInfo(),
    ]);
    const packages = offerings.current?.availablePackages ?? [];
    return {
      configured: true,
      products: packages.map((item) => ({
        id: item.product.identifier,
        title: item.product.title,
        description: item.product.description,
        price: item.product.priceString,
        packageId: item.identifier,
      })),
      entitlements: Object.keys(customerInfo.entitlements.active),
      activeProductIds: customerInfo.activeSubscriptions,
    };
  }, []);

  const handleIapRequest = useCallback(async (message: NativeIapRequest) => {
    try {
      await loadIapState(message.userId);
      if (message.type === 'IAP_PURCHASE') {
        const offerings = await Purchases.getOfferings();
        const pack = offerings.current?.availablePackages.find(
          (item) => item.product.identifier === message.productId,
        );
        if (!pack) throw new Error('App Storeの商品が見つかりません');
        await Purchases.purchasePackage(pack);
      } else if (message.type === 'IAP_RESTORE') {
        await Purchases.restorePurchases();
      }
      sendIapResult(message.requestId, await loadIapState(message.userId));
    } catch (error: any) {
      if (error?.userCancelled) {
        sendIapResult(message.requestId, { configured: true, products: [], entitlements: [] }, true);
        return;
      }
      sendIapResult(message.requestId, {
        configured: revenueCatConfiguredRef.current,
        products: [],
        entitlements: [],
        error: error instanceof Error ? error.message : '購入処理に失敗しました',
      });
    }
  }, [loadIapState, sendIapResult]);

  const useCurrentLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const next = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    setPicked(next);
    mapRef.current?.animateToRegion({
      latitude: next.lat,
      longitude: next.lng,
      latitudeDelta: 0.015,
      longitudeDelta: 0.015,
    });
  }, []);

  const choosePlace = useCallback((place: PickedPlace) => {
    setPicked(place);
    setPlaceQuery(place.name ?? '');
    setPlaceResults([]);
    setPlaceSearchMessage('');
    mapRef.current?.animateToRegion({
      latitude: place.lat,
      longitude: place.lng,
      latitudeDelta: 0.012,
      longitudeDelta: 0.012,
    });
  }, []);

  const searchPlaces = useCallback(async () => {
    const query = placeQuery.trim();
    if (!query || placeSearching) return;
    setPlaceSearching(true);
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}` +
        '&accept-language=ja&limit=8&namedetails=1&addressdetails=1';
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      const json = response.ok ? await response.json() : [];
      const results = (Array.isArray(json) ? json : [])
        .map((item: any): PlaceSearchResult | null => {
          const lat = Number(item.lat);
          const lng = Number(item.lon);
          const name =
            item.namedetails?.['name:ja'] || item.namedetails?.name || item.name ||
            (typeof item.display_name === 'string' ? item.display_name.split(',')[0] : '');
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { lat, lng, name, detail: item.display_name ?? '' };
        })
        .filter((item: PlaceSearchResult | null): item is PlaceSearchResult => item != null)
        .slice(0, 4);
      setPlaceResults(results);
      setPlaceSearchMessage(results.length ? '' : '見つかりませんでした。地図を直接タップして選ぶこともできます。');
    } catch {
      setPlaceResults([]);
      setPlaceSearchMessage('検索できませんでした。地図を直接タップして選んでください。');
    } finally {
      setPlaceSearching(false);
    }
  }, [placeQuery, placeSearching]);

  const handleWebMessage = useCallback((event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as NativeMapRequest | NativeIapRequest;
      if (message.type === 'OPEN_MAP_PICKER' || message.type === 'OPEN_MAP_VIEWER') {
        setPicked(message.initial ?? null);
        setPlaceQuery(message.initial?.name ?? '');
        setPlaceResults([]);
        setPlaceSearchMessage('');
        setMapRequest(message);
      } else if (message.type === 'IAP_GET_STATE' || message.type === 'IAP_PURCHASE' || message.type === 'IAP_RESTORE') {
        void handleIapRequest(message);
      }
    } catch {
      // アプリが理解しないWebメッセージは無視する。
    }
  }, [handleIapRequest]);

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

  const loaderLift = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [5, -11],
  });
  const loaderTilt = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-1.5deg', '2deg'],
  });
  const loaderShadowScale = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.74],
  });
  const loaderShadowOpacity = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.22, 0.1],
  });
  const loaderCoinLift = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [7, -9],
  });
  const loaderCoinSpin = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['-10deg', '10deg'],
  });
  const loaderGlowScale = loaderProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <WebView
        ref={webViewRef}
        source={{ uri: webUri }}
        style={styles.webview}
        // Web側が env(safe-area-inset-*) でセーフエリアを扱っているため、
        // ネイティブ側では二重に余白を足さない（'never' が既定値だが明示しておく）。
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentInset={{ top: 0, right: 0, bottom: 0, left: 0 }}
        bounces={false}
        overScrollMode="never"
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        onMessage={handleWebMessage}
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
        <View
          style={[StyleSheet.absoluteFill, styles.loadingOverlay]}
          pointerEvents="none"
          accessibilityLabel="マネコタウンを読み込み中"
        >
          <View style={styles.loaderStage}>
            <Animated.View style={[styles.loaderGlow, { transform: [{ scale: loaderGlowScale }] }]} />
            <Animated.View
              style={[
                styles.loaderCoin,
                styles.loaderCoinLeft,
                { transform: [{ translateY: loaderCoinLift }, { rotate: loaderCoinSpin }] },
              ]}
            >
              <Text style={styles.loaderCoinText}>¥</Text>
            </Animated.View>
            <Animated.View
              style={[
                styles.loaderCoin,
                styles.loaderCoinRight,
                {
                  transform: [
                    { translateY: Animated.multiply(loaderCoinLift, -0.72) },
                    { rotate: loaderCoinSpin },
                  ],
                },
              ]}
            >
              <Text style={styles.loaderCoinText}>¥</Text>
            </Animated.View>
            <Animated.Image
              source={require('./assets/maneko-loader.png')}
              resizeMode="contain"
              style={[
                styles.loaderManeko,
                { transform: [{ translateY: loaderLift }, { rotate: loaderTilt }] },
              ]}
            />
            <Animated.View
              style={[
                styles.loaderShadow,
                { opacity: loaderShadowOpacity, transform: [{ scaleX: loaderShadowScale }] },
              ]}
            />
          </View>
          <Text style={styles.loaderTitle}>マネコタウンを準備中</Text>
          <Text style={styles.loaderMessage}>もうすぐ会えるにゃ…</Text>
        </View>
      )}
      <Modal visible={!!mapRequest} animationType="slide" presentationStyle="fullScreen">
        <View style={styles.mapContainer}>
          <StatusBar barStyle="dark-content" />
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            showsUserLocation
            showsMyLocationButton={false}
            onPress={(event) => {
              if (mapRequest?.type !== 'OPEN_MAP_PICKER') return;
              setPicked({
                lat: event.nativeEvent.coordinate.latitude,
                lng: event.nativeEvent.coordinate.longitude,
                name: null,
              });
            }}
            onPoiClick={(event) => {
              if (mapRequest?.type !== 'OPEN_MAP_PICKER') return;
              choosePlace({
                lat: event.nativeEvent.coordinate.latitude,
                lng: event.nativeEvent.coordinate.longitude,
                name: event.nativeEvent.name ?? null,
              });
            }}
          >
            {points.map((point, index) => (
              <Marker
                key={`${point.lat}:${point.lng}:${index}`}
                coordinate={{ latitude: point.lat, longitude: point.lng }}
                title={point.title ?? undefined}
                description={point.subtitle ?? undefined}
              />
            ))}
            {picked && mapRequest?.type === 'OPEN_MAP_PICKER' && (
              <Marker
                draggable
                coordinate={{ latitude: picked.lat, longitude: picked.lng }}
                onDragEnd={(event) => setPicked({
                  lat: event.nativeEvent.coordinate.latitude,
                  lng: event.nativeEvent.coordinate.longitude,
                  name: null,
                })}
                title={picked.name ?? 'この場所を選択'}
              />
            )}
          </MapView>
          <View style={styles.mapHeader}>
            <TouchableOpacity style={styles.mapHeaderButton} onPress={() => sendMapResult(true)}>
              <Text style={styles.mapHeaderButtonText}>閉じる</Text>
            </TouchableOpacity>
            <Text style={styles.mapTitle}>{mapRequest?.title ?? (mapRequest?.type === 'OPEN_MAP_PICKER' ? '場所を選ぶ' : '買い物マップ')}</Text>
            <View style={styles.mapHeaderSpacer} />
          </View>
          {mapRequest?.type === 'OPEN_MAP_PICKER' && (
            <View style={styles.mapSearch}>
              <View style={styles.mapSearchRow}>
                <TextInput
                  value={placeQuery}
                  onChangeText={setPlaceQuery}
                  onSubmitEditing={searchPlaces}
                  placeholder="店名・場所を検索"
                  returnKeyType="search"
                  autoCorrect={false}
                  style={styles.mapSearchInput}
                />
                <TouchableOpacity style={styles.mapSearchButton} onPress={searchPlaces}>
                  <Text style={styles.mapSearchButtonText}>{placeSearching ? '…' : '検索'}</Text>
                </TouchableOpacity>
              </View>
              {!!placeSearchMessage && !placeSearching && (
                <Text style={styles.mapSearchEmpty}>{placeSearchMessage}</Text>
              )}
              {placeResults.map((place, index) => (
                <TouchableOpacity
                  key={`${place.lat}:${place.lng}:${index}`}
                  style={styles.mapSearchResult}
                  onPress={() => choosePlace(place)}
                >
                  <Text style={styles.mapSearchResultName} numberOfLines={1}>{place.name}</Text>
                  <Text style={styles.mapSearchResultDetail} numberOfLines={1}>{place.detail}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {mapRequest?.type === 'OPEN_MAP_PICKER' && (
            <View style={styles.mapBottomSheet}>
              <Text style={styles.mapHint}>
                {picked?.name ?? (picked ? '選択した地点' : '店名を検索するか、地図をタップしてください')}
              </Text>
              <View style={styles.mapActions}>
                <TouchableOpacity style={styles.locationButton} onPress={useCurrentLocation}>
                  <Text style={styles.locationButtonText}>📍 現在地</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, !picked && styles.disabledButton]}
                  disabled={!picked}
                  onPress={() => picked && sendMapResult(false, picked)}
                >
                  <Text style={styles.confirmButtonText}>この場所に決定</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#d8ebf1',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff4d8',
  },
  loaderStage: {
    width: 220,
    height: 250,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  loaderGlow: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  loaderManeko: {
    width: 158,
    height: 225,
    zIndex: 2,
  },
  loaderShadow: {
    position: 'absolute',
    bottom: 7,
    width: 92,
    height: 17,
    borderRadius: 20,
    backgroundColor: '#7a4d18',
  },
  loaderCoin: {
    position: 'absolute',
    zIndex: 3,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: '#eda526',
    shadowColor: '#9b5707',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 7,
    elevation: 4,
  },
  loaderCoinLeft: {
    left: 10,
    top: 72,
  },
  loaderCoinRight: {
    right: 8,
    top: 43,
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  loaderCoinText: {
    color: '#fff4ba',
    fontSize: 15,
    fontWeight: '900',
  },
  loaderTitle: {
    color: '#65421e',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  loaderMessage: {
    marginTop: 4,
    color: '#9b713d',
    fontSize: 13,
    fontWeight: '700',
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
  mapContainer: {
    flex: 1,
    backgroundColor: '#f7f4ee',
  },
  mapHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.96)',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd5c8',
  },
  mapHeaderButton: {
    minWidth: 58,
    paddingVertical: 8,
  },
  mapHeaderButtonText: {
    color: '#6a5522',
    fontSize: 15,
    fontWeight: '700',
  },
  mapHeaderSpacer: {
    width: 58,
  },
  mapTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#302a24',
  },
  mapSearch: {
    position: 'absolute',
    top: 112,
    left: 12,
    right: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    overflow: 'hidden',
  },
  mapSearchRow: {
    padding: 8,
    flexDirection: 'row',
    gap: 8,
  },
  mapSearchInput: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 13,
    borderRadius: 13,
    backgroundColor: '#f4f1ea',
    color: '#302a24',
    fontSize: 14,
  },
  mapSearchButton: {
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: '#e8b62b',
  },
  mapSearchButtonText: {
    color: '#3a2a00',
    fontSize: 13,
    fontWeight: '800',
  },
  mapSearchEmpty: {
    paddingHorizontal: 13,
    paddingBottom: 9,
    color: '#847b6f',
    fontSize: 10,
  },
  mapSearchResult: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e6dfd3',
  },
  mapSearchResultName: {
    color: '#302a24',
    fontSize: 13,
    fontWeight: '800',
  },
  mapSearchResultDetail: {
    marginTop: 2,
    color: '#847b6f',
    fontSize: 10,
  },
  mapBottomSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 28,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.97)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  mapHint: {
    marginBottom: 12,
    textAlign: 'center',
    color: '#615a51',
    fontSize: 13,
  },
  mapActions: {
    flexDirection: 'row',
    gap: 10,
  },
  locationButton: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#f1ede5',
  },
  locationButtonText: {
    color: '#4a4238',
    fontWeight: '700',
  },
  confirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#e8b62b',
  },
  disabledButton: {
    opacity: 0.45,
  },
  confirmButtonText: {
    color: '#3a2a00',
    fontSize: 15,
    fontWeight: '800',
  },
});
