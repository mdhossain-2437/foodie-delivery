import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View, Image as RNImage } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTheme } from '@/hooks/useTheme';
import { clearRefreshToken } from '@/auth/secureStorage';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { clearIsNewUser } from '../../auth/authSlice';
import { baseApi } from '@/api/baseApi';
import { ENV } from '@/constants/env';
import { useGetDeliveryProfileQuery } from '@/api/endpoints/deliveryApi';
import { KycStepper } from '@/features/kyc/components/KycStepper';
import {
  selectKycDocuments,
  selectUploadedDocCount,
} from '../kycFormSlice';
import type { KycStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<KycStackParamList, 'PendingVerification'>;

/**
 * P2-DEL-01 — Pending Verification Gate
 * Polls GET /delivery/me profile. Drops gate if VERIFIED.
 */
const THEME_EMERALD = '#14532D';

export function PendingVerificationScreen({ navigation }: Props) {
  const { tokens } = useTheme();
  const { isConnected } = useConnectivity();
  const dispatch = useAppDispatch();
  const documents = useAppSelector(selectKycDocuments);
  const uploadedCount = useAppSelector(selectUploadedDocCount);
  const { data: profile, isLoading, isFetching, refetch, isError } = useGetDeliveryProfileQuery(
    undefined,
    { skip: !isConnected, pollingInterval: 3000 }
  );
  const [toast, setToast] = useState<{
    message: string;
    variant: 'info' | 'success' | 'error' | 'warning';
  } | null>(null);

  useEffect(() => {
    trackAnalyticsEvent('delivery_pending_verification_viewed');
    trackAnalyticsEvent('delivery_kyc_pending');
  }, []);

  useEffect(() => {
    if (profile?.kycStatus === 'VERIFIED') {
      setToast({ message: 'KYC Verified! Taking you online...', variant: 'success' });
      setTimeout(() => {
        dispatch(clearIsNewUser());
        navigation.replace('DeliveryHome' as any);
      }, 1500);
    }
  }, [profile?.kycStatus, dispatch, navigation]);

  const onRefresh = () => {
    trackAnalyticsEvent('refresh_tapped');
    if (isConnected) {
      void refetch();
    }
  };

  const isVerified = profile?.kycStatus === 'VERIFIED';
  const isRejected = profile?.kycStatus === 'REJECTED';
  const isSuspended = profile?.kycStatus === 'SUSPENDED';

  let finalImgUri = profile?.profileImageUrl ?? null;
  if (finalImgUri) {
    const apiBaseUrl = ENV.apiBaseUrl;
    if (finalImgUri.includes('localhost') && apiBaseUrl) {
      const hostMatch = apiBaseUrl.match(/:\/\/(.[^:/]+)/);
      if (hostMatch && hostMatch[1]) {
        finalImgUri = finalImgUri.replace('localhost', hostMatch[1]);
      }
    } else if (finalImgUri.startsWith('/') && apiBaseUrl) {
      finalImgUri = `${apiBaseUrl.replace(/\/$/, '')}${finalImgUri}`;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View
        style={{
          paddingTop: 60,
          paddingBottom: 24,
          paddingHorizontal: 20,
          backgroundColor: THEME_EMERALD,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 4,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text variant="heading2" style={{ color: 'white' }}>Verification Status</Text>
        <Button
          label="LOGOUT"
          accessibilityLabel="Logout"
          variant="secondary"
          onPress={async () => {
            await clearRefreshToken();
            dispatch({ type: 'auth/clearCredentials' });
            setTimeout(() => {
              dispatch(baseApi.util.resetApiState());
            }, 500);
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
        refreshControl={<RefreshControl refreshing={isLoading || isFetching} onRefresh={onRefresh} />}
      >
        <KycStepper activeIndex={isVerified ? 2 : 1} />

        {(!isConnected || isError) && (
          <View style={{ backgroundColor: '#fffbeb', padding: 12, borderRadius: 8 }}>
            <Text variant="caption" color={tokens.color.warning} style={{ textAlign: 'center' }}>
              {!isConnected ? 'Offline — displaying local status.' : 'Network error — please swipe down to refresh.'}
            </Text>
          </View>
        )}

        <View style={{ backgroundColor: 'white', padding: 24, borderRadius: 16, alignItems: 'center', marginTop: 12, elevation: 2, shadowColor: '#000', shadowOffset: { height: 2, width: 0 }, shadowRadius: 4, shadowOpacity: 0.05 }}>
          {finalImgUri && (
            <View style={{ marginBottom: 16, borderWidth: 3, borderColor: isSuspended ? '#EF4444' : isVerified ? '#10B981' : isRejected ? '#EF4444' : THEME_EMERALD, borderRadius: 60, padding: 2 }}>
              <RNImage source={{ uri: finalImgUri }} style={{ width: 100, height: 100, borderRadius: 50 }} resizeMode="cover" />
            </View>
          )}
          <Text variant="heading1" style={{ color: isSuspended ? '#DC2626' : isVerified ? '#059669' : isRejected ? '#ef4444' : '#D97706', marginBottom: 8, fontSize: 36 }}>
            {isSuspended ? '🚫' : isVerified ? '✅' : isRejected ? '❌' : '⏳'}
          </Text>
          <View
            style={{
              backgroundColor: isSuspended ? '#FEE2E2' : isVerified ? '#D1FAE5' : isRejected ? '#FEE2E2' : '#FEF3C7',
              paddingHorizontal: 14,
              paddingVertical: 5,
              borderRadius: 14,
              marginBottom: 12,
            }}
          >
            <Text
              variant="caption"
              style={{
                fontWeight: '800',
                letterSpacing: 0.5,
                color: isSuspended ? '#DC2626' : isVerified ? '#047857' : isRejected ? '#DC2626' : '#B45309',
              }}
            >
              STATUS: {isSuspended ? 'ACCOUNT SUSPENDED' : (profile?.kycStatus ?? 'PENDING')}
            </Text>
          </View>
          <Text variant="heading2" style={{ textAlign: 'center', color: isSuspended ? '#DC2626' : '#1e293b', marginBottom: 12 }}>
            {isSuspended
              ? "Account Suspended"
              : isVerified
              ? "KYC Approved & Verified!"
              : isRejected
              ? "Verification Rejected"
              : "Review in Progress (Pending Admin Approval)"}
          </Text>
          <Text variant="body" style={{ textAlign: 'center', color: '#64748b', lineHeight: 22 }}>
            {isSuspended
              ? (profile?.kycRejectionReason
                  ? `Your delivery partner account has been suspended by the platform administrator.\n\nReason: "${profile.kycRejectionReason}"\n\nYou cannot accept delivery offers or go online while your account is suspended.`
                  : "Your delivery partner account has been suspended by the platform administrator. You are currently restricted from receiving or delivering orders. Please contact support for assistance.")
              : isVerified
              ? "Your KYC documents have been reviewed and accepted by the administrator. You are verified and ready to go online to deliver orders!"
              : isRejected
              ? "Unfortunately, your KYC documents were rejected. Please review them and re-submit."
              : "Your registration is currently in PENDING status. Once an Admin reviews and accepts your KYC in the Admin Panel, your account will automatically become VERIFIED!"}
          </Text>
          {!isVerified && !isRejected && (
            <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F8FAFC', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
              <Text variant="caption" style={{ color: '#64748B', fontSize: 12 }}>
                🔄 Live sync active (polling every 3s)
              </Text>
            </View>
          )}
        </View>

        {/* Delivery Zone & Location Request Status Card */}
        <View style={{ backgroundColor: 'white', padding: 20, borderRadius: 16, marginTop: 4, elevation: 2, shadowColor: '#000', shadowOffset: { height: 2, width: 0 }, shadowRadius: 4, shadowOpacity: 0.05 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text variant="heading3" style={{ color: '#1E293B', fontSize: 16 }}>
              📍 Delivery Zone Status
            </Text>
            <View
              style={{
                backgroundColor: isSuspended ? '#FEE2E2' : profile?.zoneVerified ? '#D1FAE5' : profile?.locationApprovalStatus === 'REJECTED' ? '#FEE2E2' : '#FEF3C7',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
              }}
            >
              <Text
                variant="caption"
                style={{
                  fontWeight: '800',
                  fontSize: 11,
                  color: isSuspended ? '#DC2626' : profile?.zoneVerified ? '#047857' : profile?.locationApprovalStatus === 'REJECTED' ? '#DC2626' : '#B45309',
                }}
              >
                {isSuspended ? 'OPERATIONS SUSPENDED' : profile?.zoneVerified ? 'ZONE APPROVED' : profile?.locationApprovalStatus === 'REJECTED' ? 'ZONE REJECTED' : 'LOCATION PENDING APPROVAL'}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: '#F8FAFC', padding: 12, borderRadius: 10, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" style={{ color: '#64748B' }}>Selected Zone:</Text>
              <Text variant="caption" style={{ fontWeight: '700', color: '#1E293B' }}>{profile?.zoneName || profile?.zoneId || 'Bengaluru Zone'}</Text>
            </View>
            {profile?.latitude && profile?.longitude ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="caption" style={{ color: '#64748B' }}>GPS Location:</Text>
                <Text variant="caption" style={{ fontFamily: 'monospace', color: '#2563EB' }}>{profile.latitude.toFixed(4)}, {profile.longitude.toFixed(4)}</Text>
              </View>
            ) : null}
          </View>

          <Text variant="caption" style={{ color: '#64748B', marginTop: 10, lineHeight: 18 }}>
            {isSuspended
              ? 'Your account suspension restricts active shifts and delivery dispatches in this zone until reviewed by Super Admin.'
              : profile?.zoneVerified
              ? 'Your location request has been APPROVED by the Super Admin. You are cleared to deliver in this zone once KYC is verified.'
              : profile?.locationApprovalStatus === 'REJECTED'
              ? 'Your location request for this zone was REJECTED by Super Admin. You cannot receive deliveries in this zone.'
              : 'Your location request is currently PENDING Super Admin review. You can complete document submission while awaiting approval.'}
          </Text>
        </View>

        {isSuspended ? (
          <View style={{ gap: 12 }}>
            <Button
              label="🎧 Help & Support"
              accessibilityLabel="Help and Support"
              variant="secondary"
              onPress={() => navigation.navigate('HelpAndSupport' as any)}
            />
            <Button
              label="🔄 Refresh Verification Status"
              accessibilityLabel="Refresh Verification Status"
              variant="primary"
              onPress={onRefresh}
            />
          </View>
        ) : isRejected ? (
          <Button
            label="Re-Upload Documents"
            accessibilityLabel="Re-Upload Documents"
            variant="primary"
            onPress={() => navigation.navigate('KycForm')}
          />
        ) : !isVerified ? (
          <Button
            label="📄 Upload / Update KYC Documents"
            accessibilityLabel="Upload / Update KYC Documents"
            variant="secondary"
            onPress={() => navigation.navigate('KycForm')}
          />
        ) : null}

        {!isSuspended && (
          isVerified ? (
            <Button
              label="Go to Online Dashboard"
              accessibilityLabel="Go to Online Dashboard"
              variant="primary"
              onPress={() => navigation.replace('DeliveryHome' as any)}
            />
          ) : (
            <Button
              label="🔄 Refresh Verification Status"
              accessibilityLabel="Refresh Verification Status"
              variant="primary"
              onPress={onRefresh}
            />
          )
        )}
      </ScrollView>
      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />
    </View >
  );
}
