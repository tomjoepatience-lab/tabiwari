// Expo WebView ↔ RevenueCat IAP ブリッジ。
// Web版では購入ボタンを無効化し、App Store版だけがネイティブ購入を開始する。

type NativeWebView = { postMessage(message: string): void };

export type NativeIapProduct = {
  id: string;
  title: string;
  description: string;
  price: string;
  packageId: string;
};

export type NativeIapState = {
  configured: boolean;
  products: NativeIapProduct[];
  entitlements: string[];
  activeProductIds?: string[];
  error?: string;
};

type Pending = {
  resolve(value: NativeIapState): void;
  reject(error: Error): void;
  timer: number;
};

const pending = new Map<string, Pending>();
const bridge = () => (window as any).ReactNativeWebView as NativeWebView | undefined;

const onMessage = (event: MessageEvent) => {
  let message: any;
  try {
    message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (message?.type !== 'NATIVE_IAP_RESULT' || typeof message.requestId !== 'string') return;
  const request = pending.get(message.requestId);
  if (!request) return;
  window.clearTimeout(request.timer);
  pending.delete(message.requestId);
  if (message.cancelled) request.reject(new Error('購入をキャンセルしました'));
  else request.resolve(message.state as NativeIapState);
};

window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage as EventListener);

export const hasNativeIap = () => typeof bridge()?.postMessage === 'function';

function requestIap(
  type: 'IAP_GET_STATE' | 'IAP_PURCHASE' | 'IAP_RESTORE',
  userId: number,
  productId?: string,
): Promise<NativeIapState> {
  const native = bridge();
  if (!native) return Promise.reject(new Error('購入はApp Store版で利用できます'));
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('App Storeとの通信がタイムアウトしました'));
    }, 45_000);
    pending.set(requestId, { resolve, reject, timer });
    native.postMessage(JSON.stringify({ type, requestId, userId, productId }));
  });
}

export const getNativeIapState = (userId: number) => requestIap('IAP_GET_STATE', userId);
export const purchaseNativeIap = (userId: number, productId: string) =>
  requestIap('IAP_PURCHASE', userId, productId);
export const restoreNativeIap = (userId: number) => requestIap('IAP_RESTORE', userId);
