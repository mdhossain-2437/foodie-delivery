import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from '@/auth/secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initAnalytics, noOpAnalyticsClient } from '@/utils/analytics';
import { initCrashReporting, noOpCrashReporter } from '@/utils/crashReporting';
import { logger } from '@/utils/logger';
import { performTokenRefresh } from '@/auth/tokenRefresh';
import { ENV } from '@/constants/env';
import { baseApi } from '@/api/baseApi';
import { clearCredentials, setAuthStatus, setCredentials } from '@/features/auth/authSlice';
import type { AppDispatch } from '@/store/store';

/** TD-011: clear SecureStore + Redux + RTK on forced session end. */
async function terminateSession(dispatch: AppDispatch): Promise<void> {
  await clearRefreshToken();
  dispatch(clearCredentials());
  dispatch(baseApi.util.resetApiState());
}

/**
 * Cold-start sequence — Blueprint §2.1 bootstrap / §11.3.
 * Initializes crash/analytics, restores refresh token, refreshes session.
 * Does not implement login UI.
 */
export async function runBootstrap(dispatch: AppDispatch): Promise<void> {
  dispatch(setAuthStatus('authenticating'));

  await initCrashReporting(noOpCrashReporter, {
    appName: ENV.appName,
    appVersion: ENV.appVersion,
  });

  await initAnalytics(noOpAnalyticsClient, {
    appName: ENV.appName,
    appVersion: ENV.appVersion,
  });

  logger.info('Bootstrap started', { app: ENV.appName });

  try {
    const refreshToken = await loadRefreshToken();
    if (!refreshToken) {
      await terminateSession(dispatch);
      logger.info('Bootstrap: no refresh token — unauthenticated');
      return;
    }

    const pair = await performTokenRefresh({
      baseUrl: ENV.apiBaseUrl,
      refreshToken,
      callbacks: {
        onCredentialsRefreshed: async (tokens, raw) => {
          await saveRefreshToken(tokens.refreshToken);
          let savedPhone: string | undefined;
          try {
            savedPhone = (await AsyncStorage.getItem('@foodie_delivery_registered_phone')) || undefined;
            if (!savedPhone && typeof window !== 'undefined' && window.localStorage) {
              savedPhone = window.localStorage.getItem('foodie_delivery_phone') || undefined;
            }
          } catch {}
          dispatch(
            setCredentials({
              accessToken: String(tokens.accessToken),
              refreshToken: String(tokens.refreshToken),
              userType: (raw?.userType as 'DELIVERY_PARTNER') ?? 'DELIVERY_PARTNER',
              userId: raw?.userId ?? '',
              phoneNumber: savedPhone,
              isNewUser: raw?.isNewUser,
            }),
          );
        },
        onTokenReuseDetected: async () => {
          await terminateSession(dispatch);
        },
        onRefreshFailed: async () => {
          await terminateSession(dispatch);
        },
      },
    });

    if (!pair) {
      await terminateSession(dispatch);
    }
  } catch (error) {
    logger.error('Bootstrap failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    await terminateSession(dispatch);
  }
}
