// Expo WebView ↔ ネイティブGoogle Maps SDKブリッジ。
// 通常ブラウザでは undefined を返し、既存のWeb地図へフォールバックする。

export type NativeMapPoint = {
  lat: number;
  lng: number;
  name?: string | null;
  title?: string | null;
  subtitle?: string | null;
};

type NativeWebView = { postMessage(message: string): void };
type Pending = { resolve: (value: any) => void; timer: number };

const pending = new Map<string, Pending>();

const nativeWebView = () => (window as any).ReactNativeWebView as NativeWebView | undefined;
export const hasNativeMap = () => typeof nativeWebView()?.postMessage === 'function';

function receive(raw: unknown) {
  let msg: any = raw;
  try { if (typeof raw === 'string') msg = JSON.parse(raw); } catch { return; }
  if (!msg || msg.type !== 'NATIVE_MAP_RESULT' || typeof msg.requestId !== 'string') return;
  const item = pending.get(msg.requestId);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(msg.requestId);
  item.resolve(msg.cancelled ? null : msg.value ?? null);
}

window.addEventListener('message', (e) => receive((e as MessageEvent).data));
document.addEventListener('message', (e: Event) => receive((e as MessageEvent).data));

function request<T>(type: string, payload: object): Promise<T | null> | null {
  const bridge = nativeWebView();
  if (!bridge) return null;
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise<T | null>((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, 10 * 60_000);
    pending.set(requestId, { resolve, timer });
    bridge.postMessage(JSON.stringify({ type, requestId, ...payload }));
  });
}

export function openNativeMapPicker(initial: { lat: number; lng: number } | null) {
  return request<{ lat: number; lng: number; name?: string | null }>('OPEN_MAP_PICKER', { initial });
}

export function openNativeMapViewer(points: NativeMapPoint[], title: string) {
  return request<null>('OPEN_MAP_VIEWER', { points, title });
}
