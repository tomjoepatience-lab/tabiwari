import type { ExpoConfig, ConfigContext } from 'expo/config';
import base from './app.json';

export default ({ config }: ConfigContext): ExpoConfig => {
  const baseConfig = base.expo as unknown as ExpoConfig;
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_IOS_API_KEY ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY ??
    '';

  return {
    ...config,
    ...baseConfig,
    scheme: 'maneko',
    ios: {
      ...baseConfig.ios,
      associatedDomains: ['applinks:tabiwari-mu.vercel.app'],
      // Expo SDK 54が固定するreact-native-maps 1.20系では、キーはios.configに渡す。
      // SDK 55以降へ上げる際はreact-native-maps config plugin方式へ移行する。
      config: {
        googleMapsApiKey,
      },
      infoPlist: {
        ...baseConfig.ios?.infoPlist,
        NSLocationWhenInUseUsageDescription: '支出を記録した場所を地図で選ぶために使用します',
      },
    },
    plugins: [
      ...(baseConfig.plugins ?? []),
      [
        'expo-location',
        {
          locationWhenInUsePermission: '支出を記録した場所を地図で選ぶために使用します',
        },
      ],
    ],
  };
};
