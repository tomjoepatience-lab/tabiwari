export const PREF_KEYS = {
  familyNotifications: 'maneko_pref_family_notifications',
  recordNotifications: 'maneko_pref_record_notifications',
  speech: 'maneko_pref_speech',
  reduceMotion: 'maneko_pref_reduce_motion',
} as const;

export type PreferenceKey = typeof PREF_KEYS[keyof typeof PREF_KEYS];

export function preferenceEnabled(key: PreferenceKey, fallback = true): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored == null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

export function setPreference(key: PreferenceKey, enabled: boolean): void {
  try { localStorage.setItem(key, String(enabled)); } catch { /* 保存できない環境では今回の表示だけ反映 */ }
}

export function applyDisplayPreferences(): void {
  document.body.classList.toggle('maneko-reduce-motion', preferenceEnabled(PREF_KEYS.reduceMotion, false));
}
