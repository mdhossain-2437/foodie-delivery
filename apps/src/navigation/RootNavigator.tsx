import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { selectAccessToken, selectAuthStatus, selectIsNewUser, clearCredentials } from '@/features/auth/authSlice';
import { clearRefreshToken } from '@/auth/secureStorage';
import { baseApi } from '@/api/baseApi';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { SplashScreen } from '@/features/auth/screens/SplashScreen';
import { AuthNavigator } from './AuthNavigator';
import { MainNavigator } from './MainNavigator';
import { linking } from './linking';
import { useGetDeliveryProfileQuery } from '@/api/endpoints/deliveryApi';
import type { RootStackParamList, MainStackParamList } from './types';
import { KycNavigator } from './KycNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const dispatch = useAppDispatch();
  const authStatus = useAppSelector(selectAuthStatus);
  const accessToken = useAppSelector(selectAccessToken);
  const isNewUser = useAppSelector(selectIsNewUser);

  // Conditionally fetch profile only when authenticated and access token is present
  const profileQuery = useGetDeliveryProfileQuery(undefined, {
    skip: authStatus !== 'authenticated' || !accessToken,
    pollingInterval: 3000,
  });

  useEffect(() => {
    if (authStatus === 'authenticated' && profileQuery.isError) {
      const err = profileQuery.error as any;
      const status = err?.status ?? err?.data?.status;
      const code = err?.data?.code;
      if (status === 401 || status === 403 || code === 'FORBIDDEN' || code === 'UNAUTHORIZED') {
        // Automatically clear invalid session and redirect to login
        void (async () => {
          await clearRefreshToken();
          dispatch(clearCredentials());
          dispatch(baseApi.util.resetApiState());
        })();
      }
    }
  }, [authStatus, profileQuery.isError, profileQuery.error, dispatch]);

  if (authStatus === 'authenticating' || authStatus === 'idle') {
    return <SplashScreen />;
  }

  // Wait for profile query to initialize and finish its first fetch if loading
  if (authStatus === 'authenticated' && accessToken && (profileQuery.isLoading || profileQuery.isFetching || profileQuery.isUninitialized)) {
    if (!profileQuery.data && !profileQuery.isError) {
      return <SplashScreen />;
    }
  }

  let flow: 'auth' | 'kyc' | 'main' = 'auth';
  let initialRouteName: any = undefined;

  if (authStatus === 'authenticated' && accessToken && profileQuery.data) {
    const kycStatus = profileQuery.data.kycStatus;
    const hasUploadedDocs = profileQuery.data.documents && profileQuery.data.documents.length >= 3;
    const hasProfileImage = !!profileQuery.data.profileImageUrl;
    const hasName = Boolean(
      profileQuery.data.fullName &&
      profileQuery.data.fullName.trim() !== 'Delivery Partner' &&
      profileQuery.data.fullName.trim() !== 'delivery_partner' &&
      profileQuery.data.fullName.trim().length > 0
    );
    const hasZone = Boolean(
      profileQuery.data.zoneVerified ||
      profileQuery.data.zoneId ||
      profileQuery.data.locationApprovalStatus === 'PENDING' ||
      profileQuery.data.locationApprovalStatus === 'APPROVED' ||
      profileQuery.data.locationApprovalStatus === 'REJECTED'
    );
    const hasSubmittedKyc = Boolean(hasUploadedDocs && hasProfileImage && hasName);

    if (kycStatus !== 'VERIFIED') {
      flow = 'kyc';
      if (kycStatus === 'SUSPENDED') {
        initialRouteName = 'PendingVerification';
      } else if (isNewUser || !hasZone) {
        initialRouteName = 'DeliveryZone';
      } else if (!hasSubmittedKyc) {
        initialRouteName = 'KycForm';
      } else {
        initialRouteName = 'PendingVerification';
      }
    } else {
      flow = 'main';
      initialRouteName = 'DeliveryHome';
    }
  } else if (authStatus === 'authenticated' && accessToken && !profileQuery.isError) {
    flow = isNewUser ? 'kyc' : 'main';
    if (flow === 'kyc') {
      initialRouteName = 'DeliveryZone';
    }
  }

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {flow === 'main' ? (
          <Stack.Screen name="Main">
            {(props) => <MainNavigator {...props} initialRouteName={initialRouteName} />}
          </Stack.Screen>
        ) : flow === 'kyc' ? (
          <Stack.Screen name="Kyc">
            {(props) => <KycNavigator {...props} initialRouteName={initialRouteName} />}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
