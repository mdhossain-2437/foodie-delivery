import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ScrollView, View, StyleSheet, Pressable, BackHandler, Modal, Image, ActivityIndicator } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { BottomNav } from '@/navigation/BottomNav';
import { Text } from '@/components/Text';
import { Toast } from '@/components/Toast';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useTheme } from '@/hooks/useTheme';
import { useGetOrderQuery } from '@/api/endpoints/ordersApi';
import {
    useGetNavigationDetailsQuery,
    useInitiateCodOnlinePaymentMutation,
    useVerifyCodOnlinePaymentMutation,
} from '@/api/endpoints/deliveryApi';
import { useAssignmentOrderSubscription } from '../../home/hooks/useAssignmentOrderSubscription';
import { isUuid, formatMoney, formatDistanceKm } from '../../home/types';
import { MapSkeleton } from '@/features/navigation/components/MapSkeleton';
import { TrackingMap } from '@/features/navigation/components/TrackingMap';
import { useLocationPingLoop } from '@/features/navigation/hooks/useLocationPingLoop';
import { openOsMapsHandoff } from '../osMaps';
import type { MainStackParamList } from '@/navigation/types';
import { calculateDistanceKm } from '@/features/navigation/types';
import { useAppSelector } from '@/store/hooks';
import { selectUserId } from '../../auth/authSlice';

type Props = NativeStackScreenProps<MainStackParamList, 'CustomerDelivery'>;

const COD_STORAGE_KEY_PREFIX = 'cod_collected_';

function buildCashfreeGatewayHtml(paymentSessionId: string): string {
    return `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
  <title>Cashfree Checkout</title>
  <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
  <style>
    body,html{margin:0;padding:0;height:100vh;width:100vw;background:#fff;display:flex;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
    .spinner{width:40px;height:40px;border:4px solid #e2e8f0;border-top:4px solid #14532D;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;}
    @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
  </style>
  </head><body>
  <div id="loader" style="text-align:center;color:#1e293b"><div class="spinner"></div><p style="font-weight:700;font-size:16px">Loading Cashfree Checkout...</p></div>
  <script>
    window.onload=function(){
      try{
        const cashfree = Cashfree({ mode: "sandbox" });
        cashfree.checkout({
          paymentSessionId: "${paymentSessionId}"
        }).then(function(result){
          if(result.error){
            window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:result.error.message}));
          }
          if(result.paymentDetails){
            window.ReactNativeWebView.postMessage(JSON.stringify({type:'success',message:result.paymentDetails.paymentMessage}));
          }
        });
      }catch(err){
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:err.message||'Checkout error'}));
      }
    };
  </script></body></html>`;
}

export function CustomerDeliveryScreen({ navigation, route }: Props) {
    const { tokens } = useTheme();
    const { isConnected } = useConnectivity();
    const { orderId, assignmentId } = route.params;
    const validOrder = Boolean(orderId && isUuid(orderId));
    const userId = useAppSelector(selectUserId);

    const orderQuery = useGetOrderQuery(orderId, {
        skip: !validOrder,
        pollingInterval: 30_000,
        refetchOnFocus: true,
    });

    const validAssignment = Boolean(assignmentId && typeof assignmentId === 'string' && assignmentId.length > 10);
    const navQuery = useGetNavigationDetailsQuery(assignmentId as string, {
        skip: !validAssignment,
    });

    useAssignmentOrderSubscription(
        validOrder ? orderId : undefined,
        orderQuery.data?.status,
    );

    const [initiateCodPayment, { isLoading: isInitiating }] = useInitiateCodOnlinePaymentMutation();
    const [verifyCodPayment, { isLoading: isMutationVerifying }] = useVerifyCodOnlinePaymentMutation();
    const [isVerifyingState, setIsVerifyingState] = useState(false);
    const isVerifying = isMutationVerifying || isVerifyingState;

    const order = orderQuery.data;
    const status = order?.status;
    const pingEnabled = status === 'OUT_FOR_DELIVERY' || status === 'PICKED_UP';

    const { lastPing, permissionDenied } = useLocationPingLoop({
        enabled: pingEnabled && validOrder,
    });

    const [toast, setToast] = useState<{
        message: string;
        variant: 'info' | 'success' | 'error' | 'warning';
    } | null>(null);

    // Flow states
    const [reachedCustomer, setReachedCustomer] = useState(Boolean((route.params as any)?.reachedCustomer));
    const [paymentCollected, setPaymentCollected] = useState(false);
    const [collectionMethod, setCollectionMethod] = useState<'ONLINE' | 'CASH' | null>(null);

    // Modal states
    const [showCollectModal, setShowCollectModal] = useState(false);
    const [showQrModal, setShowQrModal] = useState(false);
    const [showGatewayModal, setShowGatewayModal] = useState(false);
    const [qrData, setQrData] = useState<{
        amount: number;
        upiQrPayload: string;
        paymentSessionId: string;
        cfOrderId: string;
        qrBase64?: string;
    } | null>(null);

    const isCod = (order as any)?.paymentMethod === 'COD' ||
        (order as any)?.paymentMethod === 'CASH_ON_DELIVERY' ||
        (order as any)?.paymentMethod === 'CASH' ||
        Boolean((order as any)?.isCod);

    // Load persisted reachedCustomer and paymentCollected state so leaving & returning resumes right where left off
    useFocusEffect(
        useCallback(() => {
            if (!assignmentId) return;
            let active = true;
            const loadPersistedAssignmentState = async () => {
                try {
                    const reached = await AsyncStorage.getItem(`reached_customer_${assignmentId}`);
                    if (active && (reached === 'true' || (route.params as any)?.reachedCustomer)) {
                        setReachedCustomer(true);
                    }
                    const collected = await AsyncStorage.getItem(`payment_collected_${assignmentId}`);
                    if (active) {
                        if (collected === 'ONLINE') {
                            setPaymentCollected(true);
                            setCollectionMethod('ONLINE');
                        } else if (collected === 'CASH') {
                            setPaymentCollected(true);
                            setCollectionMethod('CASH');
                        }
                    }
                } catch {}
            };
            void loadPersistedAssignmentState();
            return () => { active = false; };
        }, [assignmentId, route.params])
    );

    useEffect(() => {
        if (order?.paymentStatus === 'CAPTURED' || order?.paymentStatus === 'PAID') {
            setPaymentCollected(true);
            setCollectionMethod('ONLINE');
            if (assignmentId) {
                void AsyncStorage.setItem(`payment_collected_${assignmentId}`, 'ONLINE');
            }
        }
    }, [order?.paymentStatus, assignmentId]);

    useEffect(() => {
        trackAnalyticsEvent('customer_delivery_viewed', { orderId });

        // Disable back button at all times in customer dropoff leg
        navigation.setOptions({
            headerLeft: () => null,
            headerBackVisible: false,
            gestureEnabled: false,
        });
        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
        return () => backHandler.remove();
    }, [orderId, navigation]);

    const customerName = navQuery.data?.customerName ?? order?.customerName ?? 'Customer';
    const deliveryAddress = navQuery.data?.deliveryAddress ?? order?.deliveryAddress ?? 'Customer delivery address pending...';
    const customerPhone = navQuery.data?.customerPhone ?? order?.customerPhone ?? '+919876543210';

    const [customerCoords, setCustomerCoords] = useState<{ latitude: number; longitude: number } | null>(null);

    useEffect(() => {
        let active = true;
        const resolveCustomerCoordinates = async () => {
            const rawLat = navQuery.data?.deliveryLat ?? (order as any)?.deliveryLat;
            const rawLng = navQuery.data?.deliveryLng ?? (order as any)?.deliveryLng;
            const addrText = navQuery.data?.deliveryAddress || order?.deliveryAddress;

            if (addrText && addrText.length > 5 && !addrText.toLowerCase().includes('shantiniketan')) {
                try {
                    const results = await Location.geocodeAsync(addrText);
                    if (results && results.length > 0 && active) {
                        setCustomerCoords({ latitude: results[0].latitude, longitude: results[0].longitude });
                        return;
                    }
                } catch { }
            }

            if (rawLat && rawLng && !isNaN(Number(rawLat)) && !isNaN(Number(rawLng)) && Number(rawLat) !== 0) {
                if (active) {
                    setCustomerCoords({ latitude: Number(rawLat), longitude: Number(rawLng) });
                    return;
                }
            }
        };
        void resolveCustomerCoordinates();
        return () => { active = false; };
    }, [navQuery.data?.deliveryLat, navQuery.data?.deliveryLng, navQuery.data?.deliveryAddress, order?.deliveryAddress]);

    const defaultDistance = order?.estimatedDistance ?? 2.4;
    const targetCustLat = customerCoords?.latitude ?? navQuery.data?.deliveryLat ?? 12.9716;
    const targetCustLng = customerCoords?.longitude ?? navQuery.data?.deliveryLng ?? 77.5946;
    const distance = (lastPing)
        ? calculateDistanceKm(lastPing.latitude, lastPing.longitude, targetCustLat, targetCustLng)
        : defaultDistance;

    const handleCall = (phone: string) => {
        Linking.openURL(`tel:${phone}`).catch(() =>
            setToast({ message: 'Unable to place a call.', variant: 'error' })
        );
    };

    const onOpenOsMaps = async () => {
        trackAnalyticsEvent('open_os_maps_tapped', { leg: 'drop', orderId });

        const opened = await openOsMapsHandoff({
            originLat: lastPing?.latitude,
            originLng: lastPing?.longitude,
            destLat: targetCustLat,
            destLng: targetCustLng,
            query: orderQuery.data?.orderNumber ? `Order ${orderQuery.data.orderNumber}` : undefined,
        });
        if (!opened) {
            setToast({ message: 'Could not open OS maps on this device.', variant: 'warning' });
        }
    };

    const handleReachedCustomerLocation = async () => {
        setReachedCustomer(true);
        if (assignmentId) {
            try {
                await AsyncStorage.setItem(`reached_customer_${assignmentId}`, 'true');
            } catch {}
        }
    };

    // PHYSICAL CASH COLLECTION
    const handleCollectPhysicalCash = async () => {
        setShowCollectModal(false);
        const amount = Number(order?.totalAmount ?? 0);
        if (userId && amount > 0) {
            const key = `${COD_STORAGE_KEY_PREFIX}${userId}`;
            try {
                const raw = await AsyncStorage.getItem(key);
                const current = parseFloat(raw || '0');
                const total = current + amount;
                await AsyncStorage.setItem(key, total.toString());
            } catch (err) {
                console.warn('Failed to update local COD balance:', err);
            }
        }
        if (assignmentId) {
            try {
                await AsyncStorage.setItem(`payment_collected_${assignmentId}`, 'CASH');
            } catch {}
        }
        setPaymentCollected(true);
        setCollectionMethod('CASH');
        setToast({
            message: `✅ Physical cash of ${formatMoney(order?.totalAmount)} collected. Added to COD balance.`,
            variant: 'success',
        });
    };

    // ONLINE PAYMENT: GENERATE CASHFREE UPI QR
    const handleInitiateOnlinePayment = async () => {
        if (!assignmentId) {
            setToast({ message: 'Assignment ID missing.', variant: 'error' });
            return;
        }
        try {
            const res = await initiateCodPayment({ assignmentId }).unwrap();
            setQrData({
                amount: res.amount,
                upiQrPayload: res.upiQrPayload,
                paymentSessionId: res.paymentSessionId,
                cfOrderId: res.cfOrderId,
                qrBase64: (res as any).qrBase64,
            });
            setShowCollectModal(false);
            setShowQrModal(true);
        } catch (err: any) {
            setToast({
                message: err?.data?.message || err?.message || 'Failed to generate QR code.',
                variant: 'error',
            });
        }
    };

    // ONLINE PAYMENT: VERIFY PAYMENT STATUS (NOT JUST GATEWAY OPENED, MUST BE PAID)
    const handleVerifyOnlinePayment = async (silent: boolean = false, simulate: boolean = false) => {
        if (!assignmentId) return false;
        if (!silent) setIsVerifyingState(true);
        try {
            const res = await verifyCodPayment({ assignmentId, simulate }).unwrap();
            if (res.verified || res.paymentStatus === 'PAID' || res.paymentStatus === 'SUCCESS' || res.paymentStatus === 'CAPTURED') {
                setShowQrModal(false);
                setShowGatewayModal(false);
                setPaymentCollected(true);
                setCollectionMethod('ONLINE');
                if (assignmentId) {
                    try {
                        await AsyncStorage.setItem(`payment_collected_${assignmentId}`, 'ONLINE');
                    } catch {}
                }
                // DO NOT ADD TO DELIVERY PARTNER COD BALANCE! Money reached admin online.
                setToast({
                    message: `✅ Online payment of ${formatMoney(res.amount ?? order?.totalAmount)} verified! Received directly by admin.`,
                    variant: 'success',
                });
                return true;
            } else {
                if (!silent) {
                    setToast({
                        message: res.message || 'Payment not completed yet. Ask customer to approve payment.',
                        variant: 'warning',
                    });
                }
                return false;
            }
        } catch (err: any) {
            if (!silent) {
                setToast({
                    message: err?.data?.message || err?.message || 'Could not verify payment yet.',
                    variant: 'warning',
                });
            }
            return false;
        } finally {
            if (!silent) setIsVerifyingState(false);
        }
    };

    // Real-time verification polling while QR modal is active
    useEffect(() => {
        if (!showQrModal && !showGatewayModal) return;
        const timer = setInterval(() => {
            void handleVerifyOnlinePayment(true);
        }, 3500);
        return () => clearInterval(timer);
    }, [showQrModal, showGatewayModal, assignmentId]);

    const qrImageUrl = qrData?.qrBase64
        ? (qrData.qrBase64.startsWith('data:') ? qrData.qrBase64 : `data:image/png;base64,${qrData.qrBase64}`)
        : (qrData?.upiQrPayload
            ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=${encodeURIComponent(qrData.upiQrPayload)}`
            : null);

    if (!validOrder) {
        return (
            <View style={styles.errorContainer}>
                <Feather name="alert-triangle" size={48} color="#A0AEC0" />
                <Text style={styles.errorTitle}>Invalid Navigation parameters</Text>
            </View>
        );
    }

    const loading = orderQuery.isLoading && !orderQuery.data;

    return (
        <View style={styles.container}>
            <View style={[styles.topArch, { height: 260 }]} />

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.headerBox}>
                    <Text style={styles.pageTitle}>Customer Delivery</Text>
                    <Text style={styles.pageSubtitle}>
                        Order #{orderQuery.data?.orderNumber ?? orderId} · {status ?? 'loading'}
                    </Text>

                    {!isConnected ? (
                        <View style={styles.warningContainer}>
                            <Feather name="wifi-off" size={16} color="#B91C1C" />
                            <Text style={styles.warningText}>Offline — location pings buffered</Text>
                        </View>
                    ) : null}
                    {permissionDenied ? (
                        <View style={styles.warningContainer}>
                            <Feather name="map-pin" size={16} color="#B91C1C" />
                            <Text style={styles.warningText}>Location permission denied! Cannot track.</Text>
                        </View>
                    ) : null}
                </View>

                <View style={styles.mapCard}>
                    {loading ? (
                        <View style={styles.mapFrame}>
                            <MapSkeleton />
                        </View>
                    ) : (
                        <View style={styles.mapFrame}>
                            <TrackingMap
                                lastPing={lastPing}
                                orderStatus={status}
                                leg="drop"
                                restaurantLocation={{
                                    latitude: navQuery.data?.restaurantLat ?? 12.9780,
                                    longitude: navQuery.data?.restaurantLng ?? 77.6000
                                }}
                                customerLocation={{
                                    latitude: targetCustLat,
                                    longitude: targetCustLng,
                                }}
                            />
                        </View>
                    )}

                    <View style={styles.actionSection}>
                        <Pressable style={[styles.actionButton, styles.primaryNavButton]} onPress={() => void onOpenOsMaps()}>
                            <Feather name="external-link" size={20} color="#FFFFFF" style={styles.actionIconLeft} />
                            <Text style={styles.actionButtonText}>Open OS Maps</Text>
                        </Pressable>
                    </View>
                </View>

                <View style={styles.infoCard}>
                    <View style={styles.infoRow}>
                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                            <Ionicons name="person" size={20} color="#10B981" />
                        </View>
                        <View style={styles.infoTextContainer}>
                            <Text style={styles.infoLabel}>Deliver To</Text>
                            <Text style={styles.infoTitle} numberOfLines={1}>{customerName}</Text>
                            <Text style={styles.infoAddress} numberOfLines={2}>{deliveryAddress}</Text>
                            <View style={styles.distanceBadge}>
                                <Ionicons name="navigate-outline" size={12} color="#14532D" />
                                <Text style={styles.distanceText}>{formatDistanceKm(distance)} away</Text>
                            </View>
                        </View>
                        <Pressable style={styles.callButton} onPress={() => handleCall(customerPhone)}>
                            <Feather name="phone" size={20} color="#10B981" />
                        </Pressable>
                    </View>
                </View>

                {/* Workflow Actions */}
                <View style={styles.actionCard}>
                    {!reachedCustomer ? (
                        <Pressable
                            style={[styles.actionButton, styles.secondaryButton]}
                            onPress={() => void handleReachedCustomerLocation()}
                        >
                            <Feather name="map-pin" size={20} color="#14532D" style={styles.actionIconLeft} />
                            <Text style={styles.secondaryButtonText}>Reached Customer Location</Text>
                        </Pressable>
                    ) : (
                        <View style={{ gap: 12 }}>
                            {isCod && !paymentCollected ? (
                                <>
                                    {/* COD Payment Pending Banner */}
                                    <View style={styles.pendingPaymentBanner}>
                                        <Ionicons name="alert-circle-outline" size={22} color="#D97706" />
                                        <View style={{ flex: 1, marginLeft: 10 }}>
                                            <Text style={styles.pendingPaymentTitle}>Cash on Delivery Order</Text>
                                            <Text style={styles.pendingPaymentSub}>
                                                Collect {formatMoney(order?.totalAmount)} before completing delivery
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Collect Cash Option (No dollar icon/symbol) */}
                                    <Pressable
                                        style={[styles.actionButton, styles.collectCashButton]}
                                        onPress={() => setShowCollectModal(true)}
                                    >
                                        <Ionicons name="cash-outline" size={22} color="#FFFFFF" style={styles.actionIconLeft} />
                                        <Text style={styles.collectCashButtonText}>
                                            Collect Cash ({formatMoney(order?.totalAmount)})
                                        </Text>
                                    </Pressable>
                                </>
                            ) : (
                                <>
                                    {/* Payment Collected or Prepaid Banner */}
                                    <View style={styles.paymentSuccessBanner}>
                                        <Ionicons name="checkmark-circle" size={22} color="#15803D" />
                                        <View style={{ flex: 1, marginLeft: 10 }}>
                                            <Text style={styles.paymentSuccessTitle}>
                                                {!isCod
                                                    ? 'Prepaid Order'
                                                    : collectionMethod === 'ONLINE'
                                                        ? 'Online Payment Verified ✓'
                                                        : 'Physical Cash Collected ✓'}
                                            </Text>
                                            <Text style={styles.paymentSuccessSub}>
                                                {!isCod
                                                    ? 'Customer already paid online'
                                                    : collectionMethod === 'ONLINE'
                                                        ? `${formatMoney(qrData?.amount ?? order?.totalAmount)} received directly by admin (No COD)`
                                                        : `${formatMoney(order?.totalAmount)} added to your COD balance`}
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Delivered (Enter OTP) Option */}
                                    <Pressable
                                        style={[styles.actionButton, styles.tertiaryButton]}
                                        onPress={() => navigation.navigate('DeliveryOtp', { assignmentId, orderId })}
                                    >
                                        <Feather name="check-circle" size={20} color="#F59E0B" style={styles.actionIconLeft} />
                                        <Text style={styles.tertiaryButtonText}>Delivered (Enter OTP)</Text>
                                    </Pressable>
                                </>
                            )}
                        </View>
                    )}
                </View>

            </ScrollView>

            {/* COLLECT PAYMENT SELECTION MODAL */}
            <Modal
                visible={showCollectModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowCollectModal(false)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalSheet}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.modalTitle}>Collect Payment</Text>
                        <Text style={styles.modalSub}>
                            Amount to collect: <Text style={styles.modalAmountHighlight}>{formatMoney(order?.totalAmount ?? 0)}</Text>
                        </Text>

                        {/* Option 1: Online Payment (Generate QR) */}
                        <Pressable
                            style={[styles.paymentOptionCard, styles.onlineOptionCard]}
                            onPress={handleInitiateOnlinePayment}
                            disabled={isInitiating}
                        >
                            <View style={[styles.optionIconCircle, { backgroundColor: '#ECFDF5' }]}>
                                {isInitiating ? (
                                    <ActivityIndicator size="small" color="#059669" />
                                ) : (
                                    <Ionicons name="qr-code-outline" size={26} color="#059669" />
                                )}
                            </View>
                            <View style={{ flex: 1, marginLeft: 14 }}>
                                <Text style={styles.optionCardTitle}>Online Payment (Generate QR)</Text>
                                <Text style={styles.optionCardSub}>
                                    Generate Cashfree UPI QR for customer to scan & pay directly
                                </Text>
                            </View>
                            <Feather name="chevron-right" size={20} color="#059669" />
                        </Pressable>

                        {/* Option 2: Physical Cash */}
                        <Pressable
                            style={[styles.paymentOptionCard, styles.cashOptionCard]}
                            onPress={handleCollectPhysicalCash}
                        >
                            <View style={[styles.optionIconCircle, { backgroundColor: '#FEF3C7' }]}>
                                <Ionicons name="cash-outline" size={26} color="#D97706" />
                            </View>
                            <View style={{ flex: 1, marginLeft: 14 }}>
                                <Text style={styles.optionCardTitle}>Physical Cash</Text>
                                <Text style={styles.optionCardSub}>
                                    Collect cash physically (added to your COD balance)
                                </Text>
                            </View>
                            <Feather name="chevron-right" size={20} color="#D97706" />
                        </Pressable>

                        <Pressable
                            onPress={() => setShowCollectModal(false)}
                            style={styles.modalCancelButton}
                        >
                            <Text style={styles.modalCancelText}>Cancel</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>

            {/* CASHFREE UPI QR MODAL */}
            <Modal
                visible={showQrModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowQrModal(false)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={styles.qrModalCard}>
                        <Pressable
                            onPress={() => setShowQrModal(false)}
                            style={styles.qrCloseButton}
                        >
                            <Feather name="x" size={20} color="#64748B" />
                        </Pressable>

                        <Text style={styles.qrModalTitle}>Scan UPI QR to Pay</Text>
                        <Text style={styles.qrModalAmount}>
                            {formatMoney(qrData?.amount ?? order?.totalAmount ?? 0)}
                        </Text>
                        <Text style={styles.qrModalSub}>
                            Ask customer to scan using any UPI application
                        </Text>

                        {/* QR Code Container */}
                        <View style={styles.qrCodeContainer}>
                            {qrImageUrl ? (
                                <Image
                                    source={{ uri: qrImageUrl }}
                                    style={styles.qrImage}
                                    resizeMode="contain"
                                />
                            ) : (
                                <View style={styles.qrLoadingBox}>
                                    <ActivityIndicator size="large" color="#14532D" />
                                    <Text style={styles.qrLoadingText}>Generating QR code...</Text>
                                </View>
                            )}
                        </View>

                        {/* Supported Apps Pills */}
                        <View style={styles.upiBadgesRow}>
                            <View style={styles.upiBadge}>
                                <Text style={styles.upiBadgeText}>GPay</Text>
                            </View>
                            <View style={styles.upiBadge}>
                                <Text style={styles.upiBadgeText}>PhonePe</Text>
                            </View>
                            <View style={styles.upiBadge}>
                                <Text style={styles.upiBadgeText}>Paytm</Text>
                            </View>
                            <View style={styles.upiBadge}>
                                <Text style={styles.upiBadgeText}>BHIM</Text>
                            </View>
                        </View>

                        {/* Real-time status indicator */}
                        <View style={styles.realtimeVerifyIndicator}>
                            <ActivityIndicator size="small" color="#059669" />
                            <Text style={styles.realtimeVerifyText}>
                                Listening for payment confirmation...
                            </Text>
                        </View>

                        {/* Manual Verification Button */}
                        <Pressable
                            style={[styles.actionButton, styles.verifyButton, isVerifying && { opacity: 0.7 }]}
                            onPress={() => void handleVerifyOnlinePayment(false)}
                            disabled={isVerifying}
                        >
                            {isVerifying ? (
                                <ActivityIndicator size="small" color="#FFFFFF" style={styles.actionIconLeft} />
                            ) : (
                                <Feather name="check" size={20} color="#FFFFFF" style={styles.actionIconLeft} />
                            )}
                            <Text style={styles.verifyButtonText}>
                                {isVerifying ? 'Verifying Payment...' : 'Check / Verify Payment'}
                            </Text>
                        </Pressable>

                        {/* Test Sandbox Simulation Button */}
                        <Pressable
                            style={[styles.actionButton, { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', marginTop: 10 }]}
                            onPress={() => void handleVerifyOnlinePayment(false, true)}
                            disabled={isVerifying}
                        >
                            <Feather name="zap" size={18} color="#475569" style={styles.actionIconLeft} />
                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#334155' }}>
                                Simulate Payment Success (Test)
                            </Text>
                        </Pressable>

                        {/* Cashfree Checkout Webview Alternative */}
                        {qrData?.paymentSessionId ? (
                            <Pressable
                                style={[styles.actionButton, { backgroundColor: '#14532D', marginTop: 10 }]}
                                onPress={() => {
                                    setShowQrModal(false);
                                    setShowGatewayModal(true);
                                }}
                            >
                                <Feather name="credit-card" size={18} color="#FFFFFF" style={styles.actionIconLeft} />
                                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>
                                    Open Cashfree Payment Gateway
                                </Text>
                            </Pressable>
                        ) : null}

                        {/* Helper banner about sandbox & PhonePe technical issue */}
                        <View style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginTop: 12, borderWidth: 1, borderColor: '#E2E8F0' }}>
                            <Text style={{ fontSize: 11, color: '#64748B', lineHeight: 16 }}>
                                💡 <Text style={{ fontWeight: '700' }}>Note:</Text> Live UPI apps (PhonePe/GPay) reject test sandbox VPAs on live banking servers. Tap <Text style={{ fontWeight: '700', color: '#14532D' }}>&quot;Open Cashfree Payment Gateway&quot;</Text> above or <Text style={{ fontWeight: '700', color: '#334155' }}>&quot;Simulate Payment Success&quot;</Text> to complete &amp; test payment.
                            </Text>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* CASHFREE WEBVIEW CHECKOUT MODAL */}
            <Modal
                visible={showGatewayModal}
                animationType="slide"
                transparent={false}
                onRequestClose={() => setShowGatewayModal(false)}
            >
                <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
                    <View style={styles.gatewayHeader}>
                        <Text style={styles.gatewayHeaderTitle}>Cashfree Secure Payment</Text>
                        <Pressable
                            onPress={() => setShowGatewayModal(false)}
                            style={styles.gatewayCloseButton}
                        >
                            <Feather name="x" size={22} color="#1E293B" />
                        </Pressable>
                    </View>

                    {qrData?.paymentSessionId ? (
                        <WebView
                            source={{
                                html: buildCashfreeGatewayHtml(qrData.paymentSessionId),
                                baseUrl: 'https://sandbox.cashfree.com',
                            }}
                            style={{ flex: 1 }}
                            javaScriptEnabled
                            domStorageEnabled
                            originWhitelist={['*']}
                            mixedContentMode="always"
                            thirdPartyCookiesEnabled
                            onShouldStartLoadWithRequest={(request) => {
                                const url = request.url;
                                if (
                                    url.startsWith('upi://') ||
                                    url.startsWith('phonepe://') ||
                                    url.startsWith('gpay://') ||
                                    url.startsWith('paytm://') ||
                                    url.startsWith('tez://') ||
                                    url.startsWith('intent://')
                                ) {
                                    Linking.openURL(url).catch(() => { });
                                    return false;
                                }
                                return true;
                            }}
                            onMessage={async (event) => {
                                try {
                                    const msg = JSON.parse(event.nativeEvent.data);
                                    if (msg.type === 'success') {
                                        await handleVerifyOnlinePayment(false);
                                    } else if (msg.type === 'error') {
                                        setToast({ message: msg.message || 'Payment failed.', variant: 'error' });
                                    }
                                } catch { }
                            }}
                        />
                    ) : null}
                </View>
            </Modal>

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

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F5F7FA' },
    topArch: { position: 'absolute', top: 0, width: '100%', backgroundColor: '#14532D' },
    scrollContent: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 60 },
    headerBox: { marginBottom: 24 },
    pageTitle: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
    pageSubtitle: { fontSize: 15, color: '#A0AEC0', fontWeight: '500' },
    warningContainer: { backgroundColor: '#FEF2F2', flexDirection: 'row', alignItems: 'center', borderRadius: 8, padding: 12, marginTop: 16 },
    warningText: { color: '#B91C1C', fontSize: 13, fontWeight: '700', marginLeft: 8 },
    mapCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 16, shadowColor: '#14532D', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4, marginBottom: 16 },
    mapFrame: { width: '100%', height: 300, borderRadius: 16, overflow: 'hidden', backgroundColor: '#F1F5F9', marginBottom: 16 },
    actionSection: { gap: 12 },
    actionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, height: 56, paddingHorizontal: 20 },
    primaryNavButton: { backgroundColor: '#1A202C' },
    actionButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
    actionIconLeft: { marginRight: 8 },
    infoCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, marginBottom: 16, shadowColor: '#1A202C', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.05, shadowRadius: 16, elevation: 4, borderWidth: 1, borderColor: '#E2E8F0' },
    infoRow: { flexDirection: 'row', alignItems: 'center' },
    iconCircle: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
    infoTextContainer: { flex: 1, paddingHorizontal: 16 },
    infoLabel: { fontSize: 12, color: '#A0AEC0', fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
    infoTitle: { fontSize: 17, fontWeight: '800', color: '#1A202C', marginBottom: 2 },
    infoAddress: { fontSize: 13, color: '#718096', marginBottom: 6 },
    distanceBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    distanceText: { fontSize: 11, fontWeight: '700', color: '#14532D', marginLeft: 4 },
    callButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0FDF4', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#DCFCE7' },
    actionCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, shadowColor: '#1A202C', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.05, shadowRadius: 16, elevation: 4, borderWidth: 1, borderColor: '#E2E8F0' },
    tertiaryButton: { backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FEF3C7' },
    tertiaryButtonText: { color: '#F59E0B', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
    secondaryButton: { backgroundColor: '#F1F5F9' },
    secondaryButtonText: { color: '#14532D', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },
    errorContainer: { flex: 1, backgroundColor: '#F5F7FA', justifyContent: 'center', alignItems: 'center', padding: 40 },
    errorTitle: { marginTop: 16, fontSize: 18, fontWeight: '600', color: '#4A5568', textAlign: 'center' },

    // COD Banner & Collect Cash Button
    pendingPaymentBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFBEB',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#FDE68A',
    },
    pendingPaymentTitle: { fontSize: 14, fontWeight: '800', color: '#92400E' },
    pendingPaymentSub: { fontSize: 12, color: '#B45309', marginTop: 2, fontWeight: '500' },
    collectCashButton: { backgroundColor: '#059669' },
    collectCashButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },

    // Payment Success / Prepaid Banner
    paymentSuccessBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0FDF4',
        borderRadius: 14,
        padding: 14,
        borderWidth: 1,
        borderColor: '#BBF7D0',
    },
    paymentSuccessTitle: { fontSize: 14, fontWeight: '800', color: '#166534' },
    paymentSuccessSub: { fontSize: 12, color: '#15803D', marginTop: 2, fontWeight: '500' },

    // Collect Modal Styles
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36 },
    modalHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 18 },
    modalTitle: { fontSize: 22, fontWeight: '900', color: '#1E293B', marginBottom: 4 },
    modalSub: { fontSize: 14, color: '#64748B', marginBottom: 20 },
    modalAmountHighlight: { fontWeight: '900', color: '#059669' },
    paymentOptionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1.5,
    },
    onlineOptionCard: { backgroundColor: '#F0FDF4', borderColor: '#A7F3D0' },
    cashOptionCard: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
    optionIconCircle: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
    optionCardTitle: { fontSize: 16, fontWeight: '800', color: '#1E293B' },
    optionCardSub: { fontSize: 12, color: '#64748B', marginTop: 3 },
    modalCancelButton: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
    modalCancelText: { fontSize: 15, fontWeight: '700', color: '#94A3B8' },

    // QR Modal Styles
    qrModalCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 28,
        margin: 20,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 8,
    },
    qrCloseButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },
    qrModalTitle: { fontSize: 20, fontWeight: '900', color: '#1E293B', marginTop: 8 },
    qrModalAmount: { fontSize: 32, fontWeight: '900', color: '#059669', marginVertical: 6 },
    qrModalSub: { fontSize: 13, color: '#64748B', textAlign: 'center', marginBottom: 16 },
    qrCodeContainer: {
        width: 260,
        height: 260,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        overflow: 'hidden',
        marginBottom: 16,
    },
    qrImage: { width: 240, height: 240 },
    qrLoadingBox: { justifyContent: 'center', alignItems: 'center' },
    qrLoadingText: { fontSize: 13, color: '#64748B', marginTop: 10, fontWeight: '600' },
    upiBadgesRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    upiBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    upiBadgeText: { fontSize: 11, fontWeight: '700', color: '#475569' },
    realtimeVerifyIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#ECFDF5',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        marginBottom: 18,
    },
    realtimeVerifyText: { fontSize: 12, fontWeight: '600', color: '#059669' },
    verifyButton: { backgroundColor: '#14532D', width: '100%', marginBottom: 10 },
    verifyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    gatewayLinkButton: { paddingVertical: 8 },
    gatewayLinkText: { fontSize: 12, color: '#059669', fontWeight: '700', textDecorationLine: 'underline' },

    // Gateway Webview Header
    gatewayHeader: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
        backgroundColor: '#F8FAFC',
    },
    gatewayHeaderTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B' },
    gatewayCloseButton: { padding: 8 },
});
