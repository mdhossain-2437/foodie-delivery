import { clearRefreshToken, saveRefreshToken } from '@/auth/secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type UserType } from '@/types/auth';
import { baseApi } from '@/api/baseApi';
import type { AuthTokenData } from '@/api/endpoints/authApi';
import { authApi } from '@/api/endpoints/authApi';
import { clearCredentials, setCredentials } from './authSlice';
import type { AppDispatch, RootState } from '@/store/store';

/** Apply contracted token data to SecureStore + authSlice (P2-AUTH-03). */
export async function applyAuthSession(
  dispatch: AppDispatch,
  data: AuthTokenData,
  phoneNumber?: string,
): Promise<void> {
  await saveRefreshToken(data.refreshToken);
  if (phoneNumber) {
    try {
      await AsyncStorage.setItem('@foodie_delivery_registered_phone', phoneNumber);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('foodie_delivery_phone', phoneNumber);
      }
    } catch {}
  }
  dispatch(
    setCredentials({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      userType: (data.userType as UserType) || 'DELIVERY_PARTNER',
      userId: data.userId,
      phoneNumber,
      isNewUser: data.isNewUser,
    }),
  );
}

/**
 * Backend logout then local teardown — System Design §7.
 * Always clears local session even if the network call fails.
 */
export async function logoutDelivery(
  dispatch: AppDispatch,
  getState: () => RootState,
): Promise<void> {
  const refreshToken = getState().auth.refreshToken;
  if (refreshToken) {
    try {
      await dispatch(
        authApi.endpoints.logout.initiate({ refreshToken }),
      ).unwrap();
    } catch {
      // Still clear local session.
    }
  }
  await clearRefreshToken();
  dispatch(clearCredentials());
  // CRITICAL FIX: Give React a tick to unmount MainNavigator before wiping API cache, 
  // otherwise RTK Query's active subscriptions instantly refetch with the old token zombie-style.
  setTimeout(() => {
    dispatch(baseApi.util.resetApiState());
  }, 500);
}
