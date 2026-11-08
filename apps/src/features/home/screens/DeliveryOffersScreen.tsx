import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View, Pressable } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ENV } from '@/constants/env';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  }),
});

import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTheme } from '@/hooks/useTheme';
import { useAcceptAssignmentMutation, useRejectAssignmentMutation, useGetDeliveryOffersQuery, useGetDeliveryProfileQuery } from '@/api/endpoints/deliveryApi';
import { toUnwrappedApiError } from '../../auth/apiError';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  selectIsOnline,
  setActiveAssignment,
  addRejectedOffer,
  selectRejectedOffers
} from '../availabilitySlice';
import { OfferCard } from '@/features/home/components/OfferCard';
import { OfferListSkeleton } from '@/features/home/components/OfferListSkeleton';
import type { MainStackParamList } from '@/navigation/types';
import { BottomNav } from '@/navigation/BottomNav';
import { startOrderOfferAlert, stopOrderOfferAlert } from '@/utils/orderOfferAlert';

type Props = NativeStackScreenProps<MainStackParamList, 'DeliveryOffers'>;

export function DeliveryOffersScreen({ navigation }: Props) {
  const { tokens } = useTheme();
  const { isConnected } = useConnectivity();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const reduxIsOnline = useAppSelector(selectIsOnline);
  const profileQuery = useGetDeliveryProfileQuery(undefined, { refetchOnFocus: true });
  const isOnline = profileQuery.data !== undefined ? Boolean(profileQuery.data.isOnline) : reduxIsOnline;
  const rejectedOffers = useAppSelector(selectRejectedOffers);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [handledOfferIds, setHandledOfferIds] = useState<string[]>([]);

  const [toast, setToast] = useState<{
    message: string;
    variant: 'info' | 'success' | 'error' | 'warning';
  } | null>(null);

  const offersQuery = useGetDeliveryOffersQuery(undefined, {
    pollingInterval: 5000,
    refetchOnFocus: true,
  });
  const [acceptAssignment] = useAcceptAssignmentMutation();
  const [rejectAssignment] = useRejectAssignmentMutation();

  const handleError = useApiErrorHandler({
    onToast: (error) => setToast({ message: error.message, variant: 'error' }),
    onModalBlocking: (error) =>
      setToast({ message: error.message, variant: 'error' }),
    onInlineField: (error) =>
      setToast({ message: error.message, variant: 'error' }),
    onFullScreen: (error) =>
      setToast({ message: error.message, variant: 'error' }),
    onGeneric: (error) => setToast({ message: error.message, variant: 'error' }),
  });

  const offers = offersQuery.data ?? [];
  const visibleOffers = offers.filter(
    (o: any) => !rejectedOffers.includes(o.assignmentId) && !handledOfferIds.includes(o.assignmentId)
  );
  const firstOfferId = visibleOffers[0]?.assignmentId;
  const loading = offersQuery.isLoading && !offersQuery.data;

  useEffect(() => {
    trackAnalyticsEvent('delivery_offers_viewed');
  }, []);

  useEffect(() => {
    if (firstOfferId && isOnline) {
      const firstOffer = visibleOffers[0];
      void startOrderOfferAlert(firstOffer.assignmentId, {
        restaurantName: firstOffer.restaurantName,
        orderNumber: firstOffer.orderNumber,
      });
    } else {
      stopOrderOfferAlert();
    }

    return () => {
      stopOrderOfferAlert();
    };
  }, [firstOfferId, isOnline]);

  const onAccept = async (assignmentId: string, orderId: string) => {
    setHandledOfferIds((prev) => [...prev, assignmentId]);
    stopOrderOfferAlert();
    if (!isConnected) {
      setToast({
        message: 'Connect to the internet to accept an offer.',
        variant: 'warning',
      });
      return;
    }
    setAcceptingId(assignmentId);
    try {
      const result = await acceptAssignment(assignmentId).unwrap();
      trackAnalyticsEvent('offer_accepted', { assignmentId });
      dispatch(
        setActiveAssignment({
          assignmentId: result.assignmentId || assignmentId,
          orderId: result.orderId || orderId,
        }),
      );
      navigation.navigate('AssignmentDetails', {
        assignmentId: result.assignmentId || assignmentId,
        orderId: result.orderId || orderId,
      });
    } catch (error) {
      handleError(toUnwrappedApiError(error));
      void offersQuery.refetch();
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F2F7' }}>
      {/* iOS-style dark green gradient header arch */}
      <LinearGradient
        colors={['#0F3E22', '#14532D', '#1B6A3A']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top + 220,
          borderBottomLeftRadius: 40,
          borderBottomRightRadius: 40,
        }}
      />

      <FlatList
        style={{ flex: 1 }}
        data={loading ? [] : visibleOffers}
        keyExtractor={(item) => item.assignmentId}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 20, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={offersQuery.isFetching && !loading}
            onRefresh={() => void offersQuery.refetch()}
            tintColor="#FFF"
            colors={['#FCD34D']}
          />
        }
        ListHeaderComponent={
          <View style={{ marginBottom: 24 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <View>
                <Text style={{ fontSize: 34, fontWeight: '900', color: '#FCD34D', letterSpacing: 0.5 }}>
                  Live Orders
                </Text>
                <Text style={{ fontSize: 15, color: '#A7F3D0', fontWeight: '600', marginTop: 2 }}>
                  Nearby shifts available for you
                </Text>
              </View>
              <View style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(252,211,77,0.15)',
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: 'rgba(252,211,77,0.3)',
              }}>
                <Feather name="map" size={20} color="#FCD34D" />
              </View>
            </View>

            {/* Status pills */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{
                backgroundColor: isOnline ? 'rgba(16,185,129,0.2)' : 'rgba(160,174,192,0.2)',
                borderRadius: 20,
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: isOnline ? 'rgba(16,185,129,0.4)' : 'rgba(160,174,192,0.4)',
              }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: isOnline ? '#10B981' : '#A0AEC0' }}>
                  {isOnline ? '● ONLINE' : '○ OFFLINE'}
                </Text>
              </View>
              {visibleOffers.length > 0 && (
                <View style={{
                  backgroundColor: 'rgba(252,211,77,0.2)',
                  borderRadius: 20,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderWidth: 1,
                  borderColor: 'rgba(252,211,77,0.4)',
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#FCD34D' }}>
                    {visibleOffers.length} available
                  </Text>
                </View>
              )}
            </View>

            {!isOnline && (
              <View style={{
                backgroundColor: 'rgba(251,191,36,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(251,191,36,0.3)',
                borderRadius: 14,
                padding: 14,
                marginTop: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}>
                <Feather name="alert-circle" size={16} color="#FCD34D" />
                <Text style={{ color: '#FCD34D', fontSize: 13, fontWeight: '600', flex: 1 }}>
                  You appear offline. Offers may be empty until you go online.
                </Text>
              </View>
            )}
            {!isConnected && (
              <View style={{
                backgroundColor: '#FEF2F2',
                borderWidth: 1,
                borderColor: '#F87171',
                borderRadius: 14,
                padding: 14,
                marginTop: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}>
                <Feather name="wifi-off" size={16} color="#E23744" />
                <Text style={{ color: '#B91C1C', fontSize: 13, fontWeight: '700', flex: 1 }}>
                  Offline — showing cached offers. Accept is blocked.
                </Text>
              </View>
            )}

            {loading ? <View style={{ marginTop: 24 }}><OfferListSkeleton /></View> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={{
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 60,
              paddingHorizontal: 24,
              backgroundColor: '#FFFFFF',
              borderRadius: 24,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.06,
              shadowRadius: 16,
              elevation: 4,
            }}>
              <View style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: '#F0FDF4',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
                borderWidth: 2,
                borderColor: '#DCFCE7',
              }}>
                <Feather name="map" size={36} color="#14532D" />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#1A202C', marginBottom: 8, textAlign: 'center' }}>
                {isConnected ? 'No shifts right now' : 'No cached shifts'}
              </Text>
              <Text style={{ fontSize: 14, color: '#718096', textAlign: 'center', lineHeight: 22 }}>
                {isConnected
                  ? 'Stay online to receive new delivery push notifications as they become available.'
                  : 'Reconnect to refresh your feed.'}
              </Text>
            </View>
          )
        }
        renderItem={({ item: offer }) => {
          if (rejectedOffers.includes(offer.assignmentId)) return null;
          return (
            <OfferCard
              offer={offer}
              accepting={acceptingId === offer.assignmentId}
              acceptDisabled={!isConnected || acceptingId !== null}
              onReject={() => {
                setHandledOfferIds((prev) => [...prev, offer.assignmentId]);
                stopOrderOfferAlert();
                dispatch(addRejectedOffer(offer.assignmentId));
                void rejectAssignment(offer.assignmentId);
              }}
              onAccept={() => {
                void onAccept(offer.assignmentId, offer.orderId);
              }}
            />
          );
        }}
      />
      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />
      <BottomNav />
    </View>
  );
}
