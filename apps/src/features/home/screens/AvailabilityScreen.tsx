import React, { useEffect, useState } from 'react';
import { ScrollView, View, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useApiErrorHandler } from '@/hooks/useApiErrorHandler';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTheme } from '@/hooks/useTheme';
import { useGetDeliveryProfileQuery, useSetAvailabilityMutation } from '@/api/endpoints/deliveryApi';
import { toUnwrappedApiError } from '../../auth/apiError';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  selectActiveAssignment,
  selectIsOnline,
  setIsOnline,
  setActiveAssignment,
} from '../availabilitySlice';
import { useGetOrderQuery } from '@/api/endpoints/ordersApi';
import { isTerminalOrderStatus } from '../types';
import type { MainStackParamList } from '@/navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'Availability'>;

/**
 * P2-DEL-02 — POST /delivery/availability.
 * Offline toggle blocked. Background location hard gate on go-online only.
 * kycStatus not readable (GAP-API-08) — server KYC_NOT_VERIFIED is backstop.
 */
export function AvailabilityScreen(_props: Props) {
  const { tokens } = useTheme();
  const { isConnected } = useConnectivity();
  const dispatch = useAppDispatch();
  const reduxIsOnline = useAppSelector(selectIsOnline);
  const profileQuery = useGetDeliveryProfileQuery(undefined, { refetchOnFocus: true });
  const isOnline = profileQuery.data !== undefined ? Boolean(profileQuery.data.isOnline) : reduxIsOnline;
  const [setAvailability, mutation] = useSetAvailabilityMutation();
  const active = useAppSelector(selectActiveAssignment);
  const orderQuery = useGetOrderQuery(active?.orderId ?? '', { skip: !active?.orderId, pollingInterval: active?.orderId ? 5000 : 0 });
  const isOrderTerminal = isTerminalOrderStatus(orderQuery.data?.status);
  const hasActiveDelivery = Boolean(active?.orderId && !isOrderTerminal);

  useEffect(() => {
    if (active?.orderId && isTerminalOrderStatus(orderQuery.data?.status)) {
      dispatch(setActiveAssignment(null));
    }
  }, [active?.orderId, orderQuery.data?.status, dispatch]);
  const [toast, setToast] = useState<{
    message: string;
    variant: 'info' | 'success' | 'error' | 'warning';
  } | null>(null);

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

  useEffect(() => {
    trackAnalyticsEvent('delivery_availability_viewed');
  }, []);

  const applyAvailability = async (nextOnline: boolean) => {
    if (!isConnected) {
      setToast({
        message: 'Connect to the internet to change availability.',
        variant: 'warning',
      });
      return;
    }

    if (nextOnline) {
      trackAnalyticsEvent('go_online_tapped');
      // Enforce camera photo verification via DeliveryHome
      _props.navigation.navigate('DeliveryHome');
      return;
    }

    if (hasActiveDelivery) {
      const orderNum =
        orderQuery.data?.orderNumber ||
        (active?.orderId ? active.orderId.substring(0, 8).toUpperCase() : '');
      const orderMsg = orderNum ? `order #${orderNum}` : 'your active order';
      setToast({
        message: `You cannot go offline while you have an active order in progress (${orderMsg}). Please complete the delivery first.`,
        variant: 'warning',
      });
      Alert.alert(
        'Cannot Go Offline',
        `You cannot go offline while you have an active order to deliver. Please complete the delivery of ${orderMsg} before going offline.`,
        [
          { text: 'OK', style: 'cancel' },
          ...(active?.orderId
            ? [
                {
                  text: 'View Order',
                  onPress: () =>
                    _props.navigation.navigate('AssignmentDetails', {
                      assignmentId: active.assignmentId,
                      orderId: active.orderId,
                    }),
                },
              ]
            : []),
        ],
      );
      return;
    }

    trackAnalyticsEvent('go_offline_tapped');
    const previous = isOnline;
    dispatch(setIsOnline(false));
    try {
      const result = await setAvailability({ isOnline: false }).unwrap();
      dispatch(setIsOnline(Boolean(result.isOnline)));
      trackAnalyticsEvent('delivery_availability_changed', {
        isOnline: Boolean(result.isOnline),
      });
      setToast({
        message: 'You are offline.',
        variant: 'success',
      });
    } catch (error) {
      dispatch(setIsOnline(previous));
      handleError(toUnwrappedApiError(error));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: tokens.spacing.md,
          gap: tokens.spacing.md,
          paddingBottom: 48,
        }}
      >
        <Text variant="heading1" accessibilityRole="header">
          Availability
        </Text>
        <Text variant="body" color={tokens.color.textSecondary}>
          Status: {isOnline ? 'Online' : 'Offline'}. Background location is
          required to go online. Partner kycStatus is not readable yet
          (GAP-API-08) — the server returns KYC_NOT_VERIFIED if verification is
          incomplete.
        </Text>
        {!isConnected ? (
          <Text variant="caption" color={tokens.color.warning}>
            Offline — availability toggle is blocked.
          </Text>
        ) : null}
        {hasActiveDelivery ? (
          <Text variant="caption" color={tokens.color.warning}>
            Active delivery in progress — You cannot go offline until the order is delivered.
          </Text>
        ) : null}
        <Button
          label={isOnline ? 'Go offline' : 'Go online'}
          accessibilityLabel={isOnline ? 'Go offline' : 'Go online'}
          accessibilityRole="switch"
          accessibilityState={{
            checked: isOnline,
            disabled: !isConnected,
          }}
          accessibilityHint={
            isOnline
              ? 'Takes you offline and stops receiving offers'
              : 'Requires internet and background location permission'
          }
          loading={mutation.isLoading}
          disabled={!isConnected}
          onPress={() => {
            void applyAvailability(!isOnline);
          }}
        />
      </ScrollView>
      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}
