import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Platform, Dimensions, RefreshControl, Vibration, Alert, Linking, Switch, Modal } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { Image } from 'react-native';
import { Text } from '@/components/Text';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trackAnalyticsEvent } from '@/utils/analytics';
import { useConnectivity } from '@/hooks/useConnectivity';
import { useGetDeliveryOffersQuery, useGetDeliveryProfileQuery, useSetAvailabilityMutation, useVerifyFaceForOnlineMutation, useUploadDeliveryProfileImageMutation, useGetDeliveryReviewsQuery, captureFrameFromWebVideo, useAcceptAssignmentMutation, useRejectAssignmentMutation } from '@/api/endpoints/deliveryApi';
import { useGetWalletLedgerQuery } from '@/api/endpoints/walletApi';
import { useGetOrderQuery } from '@/api/endpoints/ordersApi';
import { useGetIncentivesProgressQuery, type IncentiveOfferProgress } from '@/api/endpoints/incentivesApi';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectActiveAssignment, selectIsOnline, setIsOnline, selectRejectedOffers, setActiveAssignment, addRejectedOffer } from '../availabilitySlice';
import { DeliveryHomeSkeleton } from '@/features/home/components/DeliveryHomeSkeleton';
import { useAssignmentOrderSubscription } from '@/features/home/hooks/useAssignmentOrderSubscription';
import { formatMoney, isTerminalOrderStatus } from '../types';
import type { MainStackParamList } from '@/navigation/types';
import { ensureLocalPushRegistration } from '../../notifications/pushRegistration';
import { selectUserId } from '../../auth/authSlice';
import { OfferCard } from '@/features/home/components/OfferCard';
import { startOrderOfferAlert, stopOrderOfferAlert } from '@/utils/orderOfferAlert';
import { playCashLimitVoiceAlert } from '@/utils/cashLimitVoiceAlert';
import { ENV } from '@/constants/env';
import { toUnwrappedApiError } from '../../auth/apiError';
import { Toast } from '@/components/Toast';
import { BottomNav } from '@/navigation/BottomNav';
import { useLocationTracker, requestAllLocationPermissions } from '@/features/location';
import { ensureBackgroundLocationForOnline } from '@/features/home/locationPermission';
import { getStoredActiveShift, type ActiveShiftData } from '@/features/home/shiftStorage';

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const { width } = Dimensions.get('window');

type Props = NativeStackScreenProps<MainStackParamList, 'DeliveryHome'>;

const THEME_PRIMARY = '#F59E0B';
const THEME_DARK = '#14532D';
const THEME_BG = '#F5F7FA';
const THEME_TEXT_MUTED = '#718096';
const THEME_CARD = '#FFFFFF';

export function DeliveryHomeScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { isConnected } = useConnectivity();
  const reduxIsOnline = useAppSelector(selectIsOnline);
  const active = useAppSelector(selectActiveAssignment);
  const userId = useAppSelector(selectUserId);
  const rejectedOffers = useAppSelector(selectRejectedOffers);
  const dispatch = useAppDispatch();

  // Automatic status-based location tracker (Req 3, 5, 7)
  const locationTracker = useLocationTracker();

  const [setAvailability, availabilityState] = useSetAvailabilityMutation();
  const [verifyFace] = useVerifyFaceForOnlineMutation();
  const [uploadImage] = useUploadDeliveryProfileImageMutation();

  const isTogglingRef = useRef(false);
  const profileQuery = useGetDeliveryProfileQuery(undefined, { pollingInterval: 5000, refetchOnFocus: true });
  // Backend database is the single source of truth, with immediate optimistic state during active toggle
  const isOnline = isTogglingRef.current
    ? reduxIsOnline
    : (profileQuery.data?.isOnline !== undefined ? profileQuery.data.isOnline : reduxIsOnline);

  const cashInHand = Number(profileQuery.data?.cashInHand ?? 0);
  const maxCashInHandLimit = Number(profileQuery.data?.maxCashInHandLimit ?? 2000);
  const isCashLimitReached = Boolean(
    profileQuery.data?.isCashLimitExceeded ||
    (profileQuery.data?.maxCashInHandLimit != null && cashInHand >= maxCashInHandLimit)
  );

  const kycStatus = profileQuery.data?.kycStatus ?? 'PENDING';
  const isKycApproved = kycStatus === 'VERIFIED';
  const pendingOrRejected = !isKycApproved;

  const [handledOfferIds, setHandledOfferIds] = useState<string[]>([]);

  // Trigger AI male voice warning when cash collected exceeds threshold
  useEffect(() => {
    if (isCashLimitReached) {
      void playCashLimitVoiceAlert();
    }
  }, [isCashLimitReached]);

  // Rehydrate and synchronize online availability with backend database
  // If partner is marked online in AsyncStorage (meaning user never clicked offline) but backend database reports offline
  // (e.g. backend was restarted, redeployed, or idle), automatically restore their online availability on the backend!
  useEffect(() => {
    let isMounted = true;
    const syncOnlineState = async () => {
      if (isTogglingRef.current) return;
      try {
        const stored = await AsyncStorage.getItem('@foodie_delivery_is_online');
        const shouldBeOnline = stored === 'true';

        if (profileQuery.data?.isOnline !== undefined) {
          const backendOnline = Boolean(profileQuery.data.isOnline);

          if (shouldBeOnline && !backendOnline && isKycApproved && !isCashLimitReached) {
            console.info('[DeliveryHome] Auto-restoring partner online status in backend database...');
            await setAvailability({ isOnline: true }).unwrap();
            if (isMounted) {
              dispatch(setIsOnline(true));
              void profileQuery.refetch();
              void locationTracker.sampleAndPing();
            }
          } else if (!shouldBeOnline && backendOnline) {
            // User explicitly chose offline locally, sync backend to offline
            console.info('[DeliveryHome] Partner is offline locally, updating backend to offline...');
            await setAvailability({ isOnline: false }).unwrap();
            if (isMounted) {
              dispatch(setIsOnline(false));
              void profileQuery.refetch();
            }
          } else if (backendOnline !== reduxIsOnline && isMounted) {
            dispatch(setIsOnline(backendOnline));
            void AsyncStorage.setItem('@foodie_delivery_is_online', String(backendOnline));
          }
        } else if (stored != null && isMounted) {
          const storedBool = stored === 'true';
          if (storedBool !== reduxIsOnline) {
            dispatch(setIsOnline(storedBool));
          }
        }
      } catch (err) {
        console.warn('[DeliveryHome] Error synchronizing online availability:', err);
      }
    };

    void syncOnlineState();
    return () => {
      isMounted = false;
    };
  }, [profileQuery.data?.isOnline, reduxIsOnline, isKycApproved, isCashLimitReached, dispatch]);

  // Camera / selfie state
  const [isCameraVisible, setIsCameraVisible] = useState(false);
  const cameraRef = useRef<any>(null);
  const [permission, requestPermission] = useCameraPermissions();
  // Pending action after selfie succeeds: 'go_online' or 'recheck'
  const pendingActionRef = useRef<'go_online' | 'recheck' | null>(null);
  // Track when partner last verified (for 3-hour re-check)
  const lastVerifiedAtRef = useRef<number | null>(null);

  const [acceptAssignment] = useAcceptAssignmentMutation();
  const [rejectAssignment] = useRejectAssignmentMutation();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, variant: 'info' | 'success' | 'error' | 'warning' } | null>(null);

  // Delivery Partner Shifts state (managed via My Shift tab)
  const [activeShift, setActiveShift] = useState<ActiveShiftData | null>(null);
  const prevIsOnlineRef = useRef<boolean>(isOnline);

  const loadActiveShift = useCallback(async () => {
    try {
      const stored = await getStoredActiveShift();
      setActiveShift(stored);
    } catch {
      // Continue silently
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadActiveShift();
    }, [loadActiveShift])
  );

  // Requirement: Handle autoGoOnline request from Shift Booked modal
  useEffect(() => {
    if (route?.params?.autoGoOnline && !isOnline && activeShift) {
      navigation.setParams({ autoGoOnline: undefined });
      void toggleAvailability();
    }
  }, [route?.params?.autoGoOnline, isOnline, activeShift, navigation]);

  // Requirement: If account is suspended by admin, return to verification page immediately
  useEffect(() => {
    if (profileQuery.data?.kycStatus === 'SUSPENDED') {
      navigation.reset({
        index: 0,
        routes: [{ name: 'PendingVerification' as any }],
      });
    }
  }, [profileQuery.data?.kycStatus, navigation]);


  const onAccept = async (assignmentId: string, orderId: string) => {
    setHandledOfferIds((prev) => [...prev, assignmentId]);
    stopOrderOfferAlert();
    if (isCashLimitReached) {
      setToast({
        message: 'Your cash collected is high. Please deposit the amount to receive new orders.',
        variant: 'error',
      });
      Alert.alert(
        'Cash Limit Reached',
        'Your cash collected is high. Please deposit the amount to receive new orders.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Deposit Cash', onPress: () => navigation.navigate('CashDeposit' as any) },
        ]
      );
      return;
    }
    if (!isConnected) {
      setToast({ message: 'Connect to the internet to accept an offer.', variant: 'warning' });
      return;
    }
    if (active?.orderId) {
      setToast({ message: 'Please complete your assigned order first before accepting a new one.', variant: 'error' });
      return;
    }
    stopOrderOfferAlert();
    setAcceptingId(assignmentId);
    try {
      const result = await acceptAssignment(assignmentId).unwrap();
      trackAnalyticsEvent('delivery_offer_accepted', { assignmentId });
      dispatch(setActiveAssignment({
        assignmentId: result.assignmentId || assignmentId,
        orderId: result.orderId || orderId,
      }));
      navigation.navigate('AssignmentDetails', {
        assignmentId: result.assignmentId || assignmentId,
        orderId: result.orderId || orderId,
      });
    } catch (error: any) {
      setToast({ message: 'Failed to accept offer: ' + (error?.data?.message || 'Unknown error'), variant: 'error' });
    } finally {
      setAcceptingId(null);
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const ledgerQuery = useGetWalletLedgerQuery(
    { createdAtFrom: todayStart.toISOString() },
    { pollingInterval: 5000, refetchOnFocus: true }
  );

  const ledgerEntries = ledgerQuery.data || [];
  const deliveriesToday = ledgerEntries.filter(e => e.referenceType === 'DELIVERY_ASSIGNMENT').length;
  // Calculate dynamic daily earnings for today from actual completed delivery orders and genuine earned incentives
  const validTodayCredits = ledgerEntries.filter(e => {
    if (e.entryType !== 'CREDIT') return false;
    if (e.referenceType === 'DELIVERY_ASSIGNMENT') return true;
    if (e.referenceType === 'INCENTIVE') {
      // Exclude legacy mock seed entry of 2000
      if (Number(e.amount) === 2000) return false;
      return true;
    }
    return false;
  });
  const incentiveToday = validTodayCredits
    .filter(e => e.referenceType === 'INCENTIVE')
    .reduce((acc, curr) => acc + Number(curr.amount), 0);
  const totalEarningsToday = validTodayCredits
    .reduce((acc, curr) => acc + Number(curr.amount), 0);

  const incentivesProgressQuery = useGetIncentivesProgressQuery(undefined, { pollingInterval: 5000, refetchOnFocus: true });
  const activeOffers: IncentiveOfferProgress[] = useMemo(() => {
    return incentivesProgressQuery.data?.offers?.filter((o: IncentiveOfferProgress) => o.active) || [];
  }, [incentivesProgressQuery.data?.offers]);

  const maxExtraEarning = useMemo(() => {
    if (!activeOffers.length) return 0;
    const unearned = activeOffers.filter((o: IncentiveOfferProgress) => !o.isEarned);
    const candidateOffers = unearned.length > 0 ? unearned : activeOffers;
    return candidateOffers.reduce((sum: number, o: IncentiveOfferProgress) => sum + Number(o.rewardAmount || 0), 0);
  }, [activeOffers]);

  const milestoneSummaryText = useMemo(() => {
    if (!activeOffers.length) return 'Active bonus offers available';
    const milestoneOffers = activeOffers.filter((o: IncentiveOfferProgress) => o.target > 1);
    if (milestoneOffers.length > 0) {
      const targets = milestoneOffers.map((o: IncentiveOfferProgress) => `${o.target} trips`);
      if (targets.length === 1) {
        const single = milestoneOffers[0];
        if (single.remaining != null && single.remaining > 0 && single.currentProgress > 0) {
          return `${single.remaining} more trips to reach ${single.target} trips milestone`;
        }
        return `${targets[0]} milestone`;
      }
      return `${targets.join(' and ')} milestones`;
    }
    const titles = activeOffers.map((o: IncentiveOfferProgress) => o.title);
    if (titles.length === 1) {
      return `${titles[0]} active`;
    }
    return `${titles[0]} & ${titles[1]}`;
  }, [activeOffers]);

  const offersQuery = useGetDeliveryOffersQuery(undefined, { pollingInterval: 5000, refetchOnFocus: true });
  const orderQuery = useGetOrderQuery(active?.orderId ?? '', { skip: !active?.orderId, pollingInterval: active?.orderId ? 5000 : 0 });

  const isOrderTerminal = isTerminalOrderStatus(orderQuery.data?.status);
  const hasActiveDelivery = Boolean(active?.orderId && !isOrderTerminal);

  useEffect(() => {
    if (active?.orderId && isTerminalOrderStatus(orderQuery.data?.status)) {
      dispatch(setActiveAssignment(null));
    }
  }, [active?.orderId, orderQuery.data?.status, dispatch]);

  // Delivery Partner Ratings & Reviews state and query
  const [isReviewsModalVisible, setIsReviewsModalVisible] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'ALL' | '5' | '4' | '3_BELOW' | 'WITH_COMMENTS'>('ALL');
  const reviewsQuery = useGetDeliveryReviewsQuery(undefined, { pollingInterval: 5000, refetchOnFocus: true });

  const reviewsData = reviewsQuery.data ?? {
    averageRating: 0.0,
    totalReviews: 0,
    positivePercentage: 0,
    ratingBreakdown: { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 } as Record<string, number>,
    compliments: [
      { label: 'Super Fast Delivery', count: 0, icon: 'zap' },
      { label: 'Polite & Friendly', count: 0, icon: 'smile' },
      { label: 'Handled With Care', count: 0, icon: 'package' },
      { label: 'Followed Instructions', count: 0, icon: 'check-circle' },
    ],
    reviews: [],
  };

  const filteredReviews = (reviewsData.reviews || []).filter((item) => {
    if (reviewFilter === '5') return item.rating === 5;
    if (reviewFilter === '4') return item.rating === 4;
    if (reviewFilter === '3_BELOW') return item.rating <= 3;
    if (reviewFilter === 'WITH_COMMENTS') return Boolean(item.comment && item.comment.trim().length > 0);
    return true;
  });

  useAssignmentOrderSubscription(active?.orderId, orderQuery.data?.status);

  useEffect(() => {
    trackAnalyticsEvent('delivery_home_viewed');
    trackAnalyticsEvent('delivery_home_loaded');

    async function requestCorePermissions() {
      try {
        await requestAllLocationPermissions();
        if (userId) {
          await ensureLocalPushRegistration(userId);
        }
      } catch (e) {
        console.warn('Permission issue', e);
      }
    }
    void requestCorePermissions();
  }, [userId]);

  const rawOffers = Array.isArray(offersQuery.data) ? offersQuery.data : (offersQuery.data as any)?.content || [];
  const visibleOffers = rawOffers.filter(
    (o: any) => !rejectedOffers.includes(o.assignmentId) && !handledOfferIds.includes(o.assignmentId)
  );
  const firstOfferId = visibleOffers[0]?.assignmentId;

  const lastAlertOfferIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (firstOfferId && isOnline && !active?.orderId) {
      if (lastAlertOfferIdRef.current !== firstOfferId) {
        lastAlertOfferIdRef.current = firstOfferId;
        const firstOffer = visibleOffers[0];
        void startOrderOfferAlert(firstOffer.assignmentId, {
          restaurantName: firstOffer.restaurantName,
          orderNumber: firstOffer.orderNumber,
        });
      }
    } else {
      if (lastAlertOfferIdRef.current !== null) {
        lastAlertOfferIdRef.current = null;
        stopOrderOfferAlert();
      }
    }
  }, [firstOfferId, isOnline, active?.orderId]);

  useEffect(() => {
    return () => {
      stopOrderOfferAlert();
    };
  }, []);

  const loading = (offersQuery.isLoading && !offersQuery.data) || (Boolean(active?.orderId) && orderQuery.isLoading && !orderQuery.data) || (profileQuery.isLoading && !profileQuery.data);

  // Handle photo capture and go-online transition
  const handleCapturePhoto = useCallback(async () => {
    try {
      let captureUri = '';
      let captureBlob: Blob | undefined;

      if (Platform.OS === 'web' || typeof document !== 'undefined') {
        const webCapture = captureFrameFromWebVideo();
        if (webCapture) {
          captureUri = webCapture.dataUri;
          captureBlob = webCapture.blob;
          console.info('[FaceVerify] Web capture success:', {
            width: webCapture.width,
            height: webCapture.height,
            blobSize: webCapture.blob.size,
            dataUriPrefix: webCapture.dataUri.substring(0, 30),
            previewUrl: webCapture.previewUrl,
          });
        }
      }

      if (!captureUri && cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
        if (photo?.uri) {
          captureUri = photo.uri;
          captureBlob = (photo as any).file;
        }
      }

      setIsCameraVisible(false);

      if (!captureUri) {
        setToast({ message: 'Photo capture failed. Please ensure camera is active and try again.', variant: 'error' });
        return;
      }

      console.info('[FaceVerify] Sending verification request with safe metadata:', {
        hasCaptureBlob: Boolean(captureBlob),
        blobSize: captureBlob?.size,
        blobType: captureBlob?.type,
        formDataField: 'file',
        fileName: 'go-online-verification.jpg',
      });

      // Strict biometric verification against approved KYC profile photo
      const isVerified = await verifyFace({
        uri: captureUri,
        mimeType: 'image/jpeg',
        fileName: 'go-online-verification.jpg',
        webFile: captureBlob,
      }).unwrap();

      if (!isVerified) {
        setToast({
          message: 'Face verification failed. The scanned face does not match your KYC profile photo.',
          variant: 'error',
        });
        return;
      }

      // Only after successful face verification match, call availability API
      isTogglingRef.current = true;
      dispatch(setIsOnline(true));
      await AsyncStorage.setItem('@foodie_delivery_is_online', 'true');
      try {
        const result = await setAvailability({ isOnline: true }).unwrap();
        await profileQuery.refetch();
        trackAnalyticsEvent('delivery_availability_changed', { isOnline: true });
        trackAnalyticsEvent('go_online_photo_verified');
        setToast({ message: 'Face verified! You are now online.', variant: 'success' });
      } catch (mutationErr: any) {
        dispatch(setIsOnline(false));
        await AsyncStorage.setItem('@foodie_delivery_is_online', 'false');
        throw mutationErr;
      } finally {
        isTogglingRef.current = false;
      }
    } catch (error: any) {
      setIsCameraVisible(false);

      const errMsg =
        error?.data?.error?.message ||
        error?.data?.message ||
        error?.error ||
        error?.message ||
        'Face verification failed. Please try again.';
      setToast({ message: errMsg, variant: 'error' });
    }
  }, [verifyFace, setAvailability, dispatch]);

  const toggleAvailability = async () => {
    if (!isConnected || availabilityState.isLoading || isTogglingRef.current) {
      if (!isConnected) {
        setToast({ message: 'Connect to the internet to change availability.', variant: 'warning' });
      }
      return;
    }
    if (pendingOrRejected) {
      setToast({ message: 'Your KYC verification is not complete. You cannot go online yet.', variant: 'warning' });
      return;
    }

    if (!isOnline) {
      // 0. Shift Booking Gate: The delivery person first has to book the shift before coming online
      if (!activeShift) {
        setToast({
          message: 'Please book a shift first. Shift booking is required to go online.',
          variant: 'warning',
        });
        Alert.alert(
          'Shift Booking Required',
          'You must first book an available shift before you can come online. Please select a shift from My Shift.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Book Shift',
              onPress: () => navigation.navigate('MyShift' as any),
            },
          ]
        );
        return;
      }

      // 1. Verify Location services and permissions gate (Req 1, 4, 6)
      const locationGate = await ensureBackgroundLocationForOnline();
      if (!locationGate.ok) {
        setToast({ message: locationGate.message, variant: 'warning' });
        if (locationGate.code === 'GPS_DISABLED' || locationGate.code === 'PERMISSION_DENIED') {
          Alert.alert(
            locationGate.code === 'GPS_DISABLED' ? 'GPS Location Required' : 'Location Permission Required',
            locationGate.message,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => void Linking.openSettings() },
            ]
          );
        }
        return;
      }

      // 2. Request camera permission
      let hasPermission = permission?.granted;
      if (!hasPermission) {
        try {
          const permResult = await requestPermission();
          hasPermission = permResult?.granted;
          if (!hasPermission) {
            setToast({ message: 'Camera permission is required to go online.', variant: 'warning' });
            if (permResult && !permResult.canAskAgain) {
              Alert.alert(
                'Camera Permission Required',
                'Camera permission is required to go online. Please enable camera access in your device settings.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => void Linking.openSettings() },
                ]
              );
            }
            return;
          }
        } catch (_err) {
          setToast({ message: 'Camera permission is required to go online.', variant: 'warning' });
          return;
        }
      }

      // 3. Permission granted -> Open camera for mandatory photo capture (do NOT go online yet)
      setIsCameraVisible(true);
      return;
    }

    // Going offline
    if (hasActiveDelivery) {
      const orderNum =
        orderQuery.data?.orderNumber ||
        (active?.orderId ? active.orderId.substring(0, 8).toUpperCase() : '');
      const orderMsg = orderNum ? `order #${orderNum}` : 'your active order';
      setToast({
        message: `You have an active delivery in progress (${orderMsg}). You cannot go offline until it is delivered.`,
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
                  navigation.navigate('AssignmentDetails', {
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

    // Instant single-tap offline toggle
    isTogglingRef.current = true;
    stopOrderOfferAlert();
    dispatch(setIsOnline(false));
    void AsyncStorage.setItem('@foodie_delivery_is_online', 'false');

    try {
      await setAvailability({ isOnline: false }).unwrap();
      await profileQuery.refetch();
      trackAnalyticsEvent('delivery_availability_changed', { isOnline: false });
      setToast({ message: 'You are now offline.', variant: 'info' });
    } catch (e: any) {
      // Revert if backend error
      dispatch(setIsOnline(true));
      void AsyncStorage.setItem('@foodie_delivery_is_online', 'true');
      const errMsg = e?.data?.error?.message || e?.data?.message || 'Failed to update availability. Please try again.';
      setToast({ message: errMsg, variant: 'error' });
    } finally {
      isTogglingRef.current = false;
    }
  };

  const handlePickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setToast({ message: 'Uploading photo...', variant: 'info' });
        await uploadImage({
          uri: asset.uri,
          mimeType: asset.mimeType || 'image/jpeg',
          fileName: asset.fileName || 'profile.jpg',
          webFile: (asset as any).file,
        }).unwrap();
        setToast({ message: 'Profile photo updated!', variant: 'success' });
        profileQuery.refetch();
      }
    } catch (e: any) {
      setToast({ message: 'Failed to upload photo.', variant: 'error' });
    }
  };

  let finalImgUri = profileQuery.data?.profileImageUrl ?? null;
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

  if (loading) return <View style={{ flex: 1, backgroundColor: THEME_BG }}><DeliveryHomeSkeleton /></View>;

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]}
        bounces={true}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={async () => {
              setIsRefreshing(true);
              await Promise.all([profileQuery.refetch(), offersQuery.refetch()]);
              setIsRefreshing(false);
            }}
            tintColor="#FFF"
            colors={['#FCD34D']}
          />
        }
      >
        {/* iOS-style dark green gradient arch - placed inside ScrollView for full page unified scroll */}
        <LinearGradient
          colors={['#0F3E22', '#14532D', '#1B6A3A']}
          style={[styles.topArch, { height: 280 + insets.top }]}
        />

        {/* Header Section */}
        <View style={styles.header}>
          <View>
            <View style={styles.greetingRow}>
              <Feather name={isOnline ? "sun" : "moon"} size={16} color="#A0AEC0" />
              <Text style={styles.greeting}>
                {new Date().getHours() < 12 ? 'Good Morning,' : new Date().getHours() < 17 ? 'Good Afternoon,' : 'Good Evening,'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <Text style={styles.name}>{profileQuery.data?.name ? profileQuery.data.name.split(' ')[0] : 'Partner'}</Text>
              <View
                style={{
                  backgroundColor: isKycApproved ? '#D1FAE5' : kycStatus === 'REJECTED' ? '#FEE2E2' : '#FEF3C7',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: isKycApproved ? '#065F46' : kycStatus === 'REJECTED' ? '#991B1B' : '#92400E',
                  }}
                >
                  {isKycApproved ? '✓ VERIFIED' : `⏳ KYC ${kycStatus}`}
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable
              style={styles.bellButton}
              onPress={() => navigation.navigate('DeliveryNotifications' as any)}
            >
              <Feather name="bell" size={22} color="#FFF" />
              <View style={styles.bellDot} />
            </Pressable>
            <Pressable
              style={styles.bellButton}
              onPress={() => navigation.navigate('DeliveryProfile' as any)}
            >
              <Feather name="user" size={22} color="#FFF" />
            </Pressable>
          </View>
        </View>

        {/* Central Premium Status Card */}
        <View style={[styles.statusCard, isOnline && styles.statusCardOnline]}>
          <View style={styles.statusHeaderRow}>
            <View style={[styles.statusIndicator, { backgroundColor: isOnline ? '#10B981' : '#A0AEC0' }]} />
            <Text style={styles.statusText}>{isOnline ? 'ONLINE & READY' : 'CURRENTLY OFFLINE'}</Text>
          </View>

          <Text style={styles.earningsLabel}>Daily Earnings</Text>
          <View style={styles.earningsRow}>
            <Text style={styles.earningsSymbol}>₹</Text>
            <Text style={styles.earningsAmount}>{totalEarningsToday.toFixed(2)}</Text>
          </View>

          {activeOffers.length > 0 && maxExtraEarning > 0 && (
            <Pressable
              style={styles.incentiveMiniCard}
              onPress={() => navigation.navigate('Incentives' as any)}
            >
              <View style={styles.incentiveMiniLeft}>
                <Text style={styles.incentiveMiniTitle}>Earn upto ₹{maxExtraEarning} extra</Text>
                <View style={styles.milestoneRow}>
                  <Ionicons name="bicycle" size={14} color="#F59E0B" />
                  <Text style={styles.milestoneMiniText}> {milestoneSummaryText}</Text>
                </View>
              </View>
              <View style={styles.incentiveMiniRight}>
                <Text style={styles.viewDetailsText}>View details</Text>
                <Feather name="chevron-right" size={16} color="#DD6B20" />
              </View>
            </Pressable>
          )}

          {/* Simple Online / Offline Toggle Switch */}
          <View style={[styles.toggleSwitchContainer, isOnline ? styles.toggleSwitchContainerOnline : styles.toggleSwitchContainerOffline]}>
            <View style={styles.toggleSwitchLeft}>
              <View style={[styles.statusDot, { backgroundColor: isOnline ? '#10B981' : '#94A3B8' }]} />
              <View style={{ flex: 1 }}>
                <View style={styles.onlineTitleRow}>
                  <Text style={styles.toggleSwitchTitle}>
                    {isOnline ? 'Online' : 'Offline'}
                  </Text>
                  {!isOnline && (
                    <View style={[
                      styles.shiftRequirementBadge,
                      activeShift ? styles.shiftRequirementBadgeReady : styles.shiftRequirementBadgeRequired
                    ]}>
                      <Text style={[
                        styles.shiftRequirementBadgeText,
                        activeShift ? styles.shiftRequirementBadgeTextReady : styles.shiftRequirementBadgeTextRequired
                      ]}>
                        {activeShift ? 'Shift Booked' : 'Shift Required'}
                      </Text>
                    </View>
                  )}
                </View>

                <Pressable
                  onPress={() => navigation.navigate('MyShift' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="My Shift details"
                >
                  <Text style={styles.toggleSwitchSubtitle}>
                    {hasActiveDelivery
                      ? 'Active delivery in progress • Complete delivery to go offline'
                      : activeShift
                        ? `${activeShift.shiftName} (${activeShift.startTime} - ${activeShift.endTime}) • Active`
                        : (isOnline ? 'Receiving order offers' : 'Book a shift first to come online • Tap to view shifts')}
                  </Text>
                </Pressable>
              </View>
            </View>

            <Switch
              trackColor={{ false: '#CBD5E1', true: '#A7F3D0' }}
              thumbColor={isOnline ? '#10B981' : '#64748B'}
              ios_backgroundColor="#CBD5E1"
              onValueChange={toggleAvailability}
              value={isOnline}
              disabled={pendingOrRejected || availabilityState.isLoading || !isConnected}
            />
          </View>

          {hasActiveDelivery && (
            <Pressable
              style={styles.activeDeliveryWarningBox}
              onPress={() =>
                active?.orderId &&
                navigation.navigate('AssignmentDetails', {
                  assignmentId: active.assignmentId,
                  orderId: active.orderId,
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Active delivery in progress warning"
            >
              <Feather name="shield" size={15} color="#B45309" style={{ marginRight: 8 }} />
              <Text style={styles.activeDeliveryWarningText}>
                Active delivery in progress • Cannot go offline until delivered
              </Text>
              <Feather name="chevron-right" size={16} color="#B45309" />
            </Pressable>
          )}

          {pendingOrRejected && (
            <Pressable
              style={styles.kycWarningBox}
              onPress={() => navigation.navigate('PendingVerification' as any)}
            >
              <Feather name="alert-circle" size={16} color="#E23744" />
              <Text style={styles.kycWarning}>
                Verification {kycStatus}
              </Text>
            </Pressable>
          )}

          {isCashLimitReached && (
            <Pressable
              style={styles.cashLimitWarningCard}
              onPress={() => navigation.navigate('CashDeposit' as any)}
              accessibilityRole="button"
              accessibilityLabel="Deposit cash collected"
            >
              <View style={styles.cashLimitWarningTop}>
                <View style={styles.cashLimitWarningIconWrap}>
                  <Feather name="alert-triangle" size={18} color="#DC2626" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.cashLimitWarningTitle}>Cash Collection Limit Reached!</Text>
                  <Text style={styles.cashLimitWarningBody}>
                    Your cash collected is high. Please deposit the amount to receive new orders.
                  </Text>
                </View>
              </View>
              <View style={styles.cashLimitProgressBox}>
                <View style={styles.cashLimitProgressLabels}>
                  <Text style={styles.cashLimitProgressLabelLeft}>Cash in Hand</Text>
                  <Text style={styles.cashLimitProgressLabelRight}>
                    ₹{cashInHand.toFixed(0)} / ₹{maxCashInHandLimit.toFixed(0)}
                  </Text>
                </View>
                <View style={styles.cashLimitProgressBarBg}>
                  <View
                    style={[
                      styles.cashLimitProgressBarFill,
                      {
                        width: `${Math.min(100, Math.max(5, (cashInHand / Math.max(1, maxCashInHandLimit)) * 100))}%`,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.cashLimitActionRow}>
                <View style={styles.cashLimitActionBtn}>
                  <Feather name="upload" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.cashLimitActionBtnText}>Deposit Cash Now</Text>
                  <Feather name="chevron-right" size={14} color="#FFFFFF" style={{ marginLeft: 4 }} />
                </View>
              </View>
            </Pressable>
          )}
        </View>

        {/* Active Assignment Section */}
        {active?.orderId && (
          <Pressable
            style={styles.activeAssignmentCard}
            onPress={() => navigation.navigate('AssignmentDetails', { assignmentId: active.assignmentId, orderId: active.orderId })}
          >
            <View style={styles.activeTopRow}>
              <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>ON ROUTE</Text></View>
              <Text style={styles.activeStatus}>{orderQuery.data?.status ?? 'Tracking Order'}</Text>
            </View>

            <View style={styles.routeContainer}>
              <View style={styles.iconSpaced}>
                <Ionicons name="location" size={24} color={THEME_PRIMARY} />
              </View>
              <View style={styles.routeTextContainer}>
                <Text style={styles.pickupLabel}>Pickup Address</Text>
                <Text style={styles.pickupText}>{(orderQuery.data as any)?.restaurantName ?? 'Restaurant'}</Text>
              </View>
            </View>

            <View style={styles.activeBottomRow}>
              <View>
                <Text style={styles.earnHintLabel}>Estimated Payout</Text>
                <Text style={styles.earnAmount}>{formatMoney(orderQuery.data?.deliveryFee ?? 0)}</Text>
              </View>
              <View style={styles.navAction}>
                <Text style={styles.navText}>Tap for Details</Text>
                <Feather name="chevron-right" size={20} color={THEME_PRIMARY} />
              </View>
            </View>
          </Pressable>
        )}

        {/* Incoming Offers - Full Details */}
        {visibleOffers.length > 0 && !active?.orderId && isOnline && (
          <View style={{ marginBottom: 32 }}>
            <Text style={styles.menuTitle}>New Delivery Offers</Text>
            {visibleOffers.map((offer: any) => (
              <OfferCard
                key={offer.assignmentId}
                offer={offer}
                accepting={acceptingId === offer.assignmentId}
                acceptDisabled={!isConnected || acceptingId !== null}
                onReject={() => {
                  setHandledOfferIds((prev) => [...prev, offer.assignmentId]);
                  stopOrderOfferAlert();
                  dispatch(addRejectedOffer(offer.assignmentId));
                  void rejectAssignment(offer.assignmentId);
                }}
                onAccept={() => void onAccept(offer.assignmentId, offer.orderId)}
              />
            ))}
          </View>
        )}

        {/* Action Modules Grid */}
        <Text style={styles.menuTitle}>Dashboard Options</Text>
        <View style={styles.menuGrid}>
          <Pressable style={styles.menuFeatureCard} onPress={() => navigation.navigate('DeliveryOffers' as any)}>
            <View style={[styles.menuIconCircle, { backgroundColor: 'rgba(252, 211, 77, 0.12)' }]}>
              <Feather name="map" size={28} color="#FCD34D" />
            </View>
            <Text style={styles.menuItemTitle}>Orders</Text>
            <Text style={styles.menuItemSubtitle}>Nearby Shifts</Text>
          </Pressable>

          <Pressable style={styles.menuFeatureCard} onPress={() => navigation.navigate('Wallet' as any)}>
            <View style={[styles.menuIconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
              <Feather name="credit-card" size={28} color="#10B981" />
            </View>
            <Text style={styles.menuItemTitle}>Payouts</Text>
            <Text style={styles.menuItemSubtitle}>Balance</Text>
          </Pressable>

          <Pressable style={styles.menuFeatureCard} onPress={() => navigation.navigate('CashDeposit' as any)}>
            <View style={[styles.menuIconCircle, { backgroundColor: 'rgba(251,191,36,0.12)' }]}>
              <Feather name="package" size={28} color="#D97706" />
            </View>
            <Text style={styles.menuItemTitle}>COD Cash</Text>
            <Text style={styles.menuItemSubtitle}>Deposit</Text>
          </Pressable>
        </View>

        {/* Delivery Partner Ratings and Reviews Card */}
        <Pressable
          style={styles.ratingsCard}
          onPress={() => setIsReviewsModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Delivery Partner ratings and reviews"
        >
          <View style={styles.ratingsCardLeft}>
            <View style={styles.ratingsStarIconCircle}>
              <Ionicons name="star" size={22} color="#F59E0B" />
            </View>
            <View style={styles.ratingsTextColumn}>
              <Text style={styles.ratingsCardTitle}>Delivery Partner Ratings and Reviews</Text>
              <View style={styles.ratingsSubtitleRow}>
                {reviewsData.totalReviews > 0 ? (
                  <>
                    <View style={styles.ratingsScoreBadge}>
                      <Ionicons name="star" size={11} color="#FFF" />
                      <Text style={styles.ratingsScoreBadgeText}>
                        {reviewsData.averageRating.toFixed(1)}
                      </Text>
                    </View>
                    <Text style={styles.ratingsCardSubtitle}>
                      {reviewsData.totalReviews} {reviewsData.totalReviews === 1 ? 'rating' : 'ratings'} • {reviewsData.positivePercentage}% Positive
                    </Text>
                  </>
                ) : (
                  <Text style={styles.ratingsCardSubtitle}>
                    No ratings yet • Complete orders to get rated
                  </Text>
                )}
              </View>
            </View>
          </View>
          <View style={styles.ratingsCardRight}>
            <View style={styles.ratingsViewBtn}>
              <Text style={styles.ratingsViewBtnText}>View</Text>
              <Feather name="chevron-right" size={16} color="#B45309" />
            </View>
          </View>
        </Pressable>

      </ScrollView>
      <Toast
        visible={Boolean(toast)}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        accessibilityLabel={toast?.message ?? 'Toast'}
        onDismiss={() => setToast(null)}
      />


      {/* Customer Ratings and Reviews Modal */}
      <Modal
        visible={isReviewsModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsReviewsModalVisible(false)}
      >
        <View style={[styles.reviewsModalContainer, { paddingTop: insets.top || 16 }]}>
          {/* Top Nav Bar */}
          <View style={styles.reviewsModalHeader}>
            <Pressable
              style={styles.reviewsModalBackBtn}
              onPress={() => setIsReviewsModalVisible(false)}
            >
              <Feather name="arrow-left" size={24} color="#1E293B" />
            </Pressable>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.reviewsModalHeaderTitle}>Ratings & Reviews</Text>
              <Text style={styles.reviewsModalHeaderSubtitle}>Customer feedback & compliments</Text>
            </View>
            <Pressable
              style={styles.reviewsModalRefreshBtn}
              onPress={() => void reviewsQuery.refetch()}
            >
              <Feather name="refresh-cw" size={18} color="#475569" />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.reviewsModalContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Main Score & Distribution Card */}
            <View style={styles.reviewsScoreCard}>
              <View style={styles.scoreOverviewLeft}>
                <Text style={styles.bigScoreText}>
                  {reviewsData.totalReviews > 0 ? reviewsData.averageRating.toFixed(1) : '0.0'}
                </Text>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Ionicons
                      key={s}
                      name="star"
                      size={18}
                      color={s <= Math.round(reviewsData.averageRating) && reviewsData.totalReviews > 0 ? '#F59E0B' : '#CBD5E1'}
                    />
                  ))}
                </View>
                <Text style={styles.totalReviewsText}>
                  {reviewsData.totalReviews} Customer {reviewsData.totalReviews === 1 ? 'Review' : 'Reviews'}
                </Text>
                <View style={[styles.satisfactionBadge, reviewsData.totalReviews === 0 && { backgroundColor: '#F1F5F9' }]}>
                  <Feather
                    name={reviewsData.totalReviews > 0 ? 'check-circle' : 'info'}
                    size={12}
                    color={reviewsData.totalReviews > 0 ? '#10B981' : '#64748B'}
                  />
                  <Text style={[styles.satisfactionBadgeText, reviewsData.totalReviews === 0 && { color: '#64748B' }]}>
                    {reviewsData.totalReviews > 0 ? `${reviewsData.positivePercentage}% Positive Rating` : 'No ratings yet'}
                  </Text>
                </View>
              </View>

              <View style={styles.scoreDivider} />

              <View style={styles.scoreDistributionRight}>
                {[5, 4, 3, 2, 1].map((starNum) => {
                  const count = reviewsData.ratingBreakdown?.[String(starNum)] ?? 0;
                  const total = reviewsData.totalReviews;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <View key={starNum} style={styles.distRow}>
                      <Text style={styles.distStarLabel}>{starNum} ★</Text>
                      <View style={styles.distBarTrack}>
                        <View style={[styles.distBarFill, { width: `${pct}%` }]} />
                      </View>
                      <Text style={styles.distCountLabel}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Customer Compliments */}
            <View style={styles.complimentsContainer}>
              <Text style={styles.sectionHeading}>Customer Compliments</Text>
              <View style={styles.complimentsGrid}>
                {(reviewsData.compliments || []).map((comp, idx) => (
                  <View key={idx} style={styles.complimentChip}>
                    <View style={styles.complimentIconCircle}>
                      <Ionicons
                        name={
                          comp.icon === 'zap' || comp.icon === 'flash' ? 'flash' :
                            comp.icon === 'smile' || comp.icon === 'happy' ? 'happy' :
                              comp.icon === 'package' || comp.icon === 'cube' ? 'cube' : 'checkmark-circle'
                        }
                        size={16}
                        color="#D97706"
                      />
                    </View>
                    <View>
                      <Text style={styles.complimentLabel}>{comp.label}</Text>
                      <Text style={styles.complimentCount}>{comp.count} {comp.count === 1 ? 'customer' : 'customers'}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* Filter Tabs */}
            <View style={styles.filterSection}>
              <Text style={styles.sectionHeading}>Customer Reviews</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterTabsRow}
              >
                <Pressable
                  style={[styles.filterChip, reviewFilter === 'ALL' && styles.filterChipActive]}
                  onPress={() => setReviewFilter('ALL')}
                >
                  <Text style={[styles.filterChipText, reviewFilter === 'ALL' && styles.filterChipTextActive]}>
                    All ({reviewsData.reviews?.length || 0})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.filterChip, reviewFilter === '5' && styles.filterChipActive]}
                  onPress={() => setReviewFilter('5')}
                >
                  <Ionicons name="star" size={13} color={reviewFilter === '5' ? '#FFF' : '#F59E0B'} />
                  <Text style={[styles.filterChipText, reviewFilter === '5' && styles.filterChipTextActive]}>
                    5 Star
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.filterChip, reviewFilter === '4' && styles.filterChipActive]}
                  onPress={() => setReviewFilter('4')}
                >
                  <Ionicons name="star" size={13} color={reviewFilter === '4' ? '#FFF' : '#F59E0B'} />
                  <Text style={[styles.filterChipText, reviewFilter === '4' && styles.filterChipTextActive]}>
                    4 Star
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.filterChip, reviewFilter === '3_BELOW' && styles.filterChipActive]}
                  onPress={() => setReviewFilter('3_BELOW')}
                >
                  <Text style={[styles.filterChipText, reviewFilter === '3_BELOW' && styles.filterChipTextActive]}>
                    ≤ 3 Star
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.filterChip, reviewFilter === 'WITH_COMMENTS' && styles.filterChipActive]}
                  onPress={() => setReviewFilter('WITH_COMMENTS')}
                >
                  <Text style={[styles.filterChipText, reviewFilter === 'WITH_COMMENTS' && styles.filterChipTextActive]}>
                    With Comments
                  </Text>
                </Pressable>
              </ScrollView>
            </View>

            {/* Customer Review Cards */}
            <View style={styles.reviewsList}>
              {filteredReviews.length === 0 ? (
                <View style={styles.emptyReviewsCard}>
                  <Ionicons name="chatbox-ellipses-outline" size={44} color="#94A3B8" />
                  <Text style={styles.emptyReviewsTitle}>
                    {reviewsData.totalReviews === 0 ? 'No customer reviews yet' : 'No reviews match this filter'}
                  </Text>
                  <Text style={styles.emptyReviewsSubtitle}>
                    {reviewsData.totalReviews === 0
                      ? 'Customer ratings, compliments and feedback will appear here in real-time as you deliver orders.'
                      : 'Try selecting a different rating filter above.'}
                  </Text>
                </View>
              ) : (
                filteredReviews.map((item) => (
                  <View key={item.id} style={styles.customerReviewCard}>
                    {/* Review Header */}
                    <View style={styles.revHeader}>
                      <View style={styles.revAvatar}>
                        <Text style={styles.revAvatarText}>
                          {item.customerName ? item.customerName.charAt(0).toUpperCase() : 'C'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.revCustomerName}>{item.customerName || 'Customer'}</Text>
                        <Text style={styles.revTimeAgo}>
                          {item.timeAgo}{item.orderNumber ? ` • Order ${item.orderNumber}` : ''}
                        </Text>
                      </View>
                      <View style={styles.revRatingBadge}>
                        <Ionicons name="star" size={12} color="#FFF" />
                        <Text style={styles.revRatingBadgeText}>{item.rating}.0</Text>
                      </View>
                    </View>

                    {/* Compliment Tags */}
                    {item.tags && item.tags.length > 0 && (
                      <View style={styles.revTagsRow}>
                        {item.tags.map((tag, tIdx) => (
                          <View key={tIdx} style={styles.revTagChip}>
                            <Feather name="thumbs-up" size={11} color="#D97706" />
                            <Text style={styles.revTagText}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Customer Comment */}
                    {item.comment ? (
                      <View style={styles.revCommentBox}>
                        <Text style={styles.revCommentText}>&ldquo;{item.comment}&rdquo;</Text>
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>



      {isCameraVisible && (
        <View style={styles.cameraModal}>
          <Text style={styles.cameraTitle}>Identity Verification</Text>
          <Text style={styles.cameraSubtitle}>Position your face in the circle to go online</Text>
          <View style={styles.cameraMask}>
            <CameraView
              style={styles.cameraPreview}
              facing="front"
              ref={cameraRef}
            />
          </View>
          <View style={styles.cameraActions}>
            <Pressable style={styles.cameraCancelBtn} onPress={() => setIsCameraVisible(false)}>
              <Feather name="x" size={24} color="#E23744" />
            </Pressable>
            <Pressable style={styles.cameraCaptureBtn} onPress={handleCapturePhoto}>
              <View style={styles.cameraCaptureInner} />
            </Pressable>
          </View>
        </View>
      )}
      <BottomNav />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME_BG,
  },
  topArch: {
    position: 'absolute',
    top: 0,
    left: -20,
    right: -20,
    backgroundColor: THEME_DARK,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  greeting: {
    fontSize: 15,
    color: '#A0AEC0',
    marginLeft: 6,
    fontWeight: '500',
  },
  name: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 0.5,
  },
  profileButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1,
    borderColor: THEME_DARK,
  },
  statusCard: {
    backgroundColor: THEME_CARD,
    borderRadius: 28,
    padding: 24,
    shadowColor: '#14532D',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusCardOnline: {
    borderWidth: 2,
    borderColor: '#10B981',
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    alignSelf: 'flex-start',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#4A5568',
  },
  earningsLabel: {
    fontSize: 15,
    color: THEME_TEXT_MUTED,
    fontWeight: '600',
    marginBottom: 4,
  },
  earningsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    marginBottom: 12,
  },
  earningsSymbol: {
    fontSize: 24,
    fontWeight: '700',
    color: '#718096',
    marginRight: 4,
    marginBottom: 6,
  },
  earningsAmount: {
    fontSize: 38,
    lineHeight: 44,
    includeFontPadding: false,
    fontWeight: '900',
    color: '#1A202C',
  },
  incentiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  incentiveStat: {
    flex: 1,
    alignItems: 'center',
  },
  incentiveStatValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 4,
  },
  incentiveStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#718096',
    textTransform: 'uppercase',
  },
  incentiveDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#E2E8F0',
    marginHorizontal: 16,
  },
  toggleButton: {
    backgroundColor: THEME_PRIMARY,
    borderRadius: 20,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME_PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  offlineActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
  },
  arrowCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleSwitchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  toggleSwitchContainerOnline: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  toggleSwitchContainerOffline: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  toggleSwitchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  toggleSwitchTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E293B',
  },
  toggleSwitchSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  onlineTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  shiftRequirementBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  shiftRequirementBadgeReady: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  shiftRequirementBadgeRequired: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  shiftRequirementBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  shiftRequirementBadgeTextReady: {
    color: '#065F46',
  },
  shiftRequirementBadgeTextRequired: {
    color: '#92400E',
  },
  myShiftPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 16,
    gap: 4,
  },
  myShiftPillButtonActive: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  myShiftPillButtonInactive: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  myShiftPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369A1',
  },
  myShiftPillTextActive: {
    color: '#065F46',
  },
  activeShiftDotBadge: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  selectShiftTag: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  selectShiftTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  toggleButtonDisabled: {
    backgroundColor: '#CBD5E0',
    shadowOpacity: 0,
  },
  toggleButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  pulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
    marginRight: 10,
  },
  activeDeliveryWarningBox: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  activeDeliveryWarningText: {
    flex: 1,
    color: '#92400E',
    fontSize: 13,
    fontWeight: '600',
  },
  kycWarningBox: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    paddingVertical: 10,
    borderRadius: 12,
  },
  kycWarning: {
    color: '#E23744',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  cashLimitWarningCard: {
    marginTop: 14,
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#FECACA',
  },
  cashLimitWarningTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cashLimitWarningIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  cashLimitWarningTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991B1B',
    marginBottom: 3,
  },
  cashLimitWarningBody: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 17,
    fontWeight: '500',
  },
  cashLimitProgressBox: {
    marginTop: 10,
    backgroundColor: 'rgba(254, 226, 226, 0.5)',
    borderRadius: 8,
    padding: 8,
  },
  cashLimitProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cashLimitProgressLabelLeft: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7F1D1D',
  },
  cashLimitProgressLabelRight: {
    fontSize: 11,
    fontWeight: '800',
    color: '#991B1B',
  },
  cashLimitProgressBarBg: {
    height: 6,
    backgroundColor: '#FECACA',
    borderRadius: 3,
    overflow: 'hidden',
  },
  cashLimitProgressBarFill: {
    height: '100%',
    backgroundColor: '#DC2626',
    borderRadius: 3,
  },
  cashLimitActionRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  cashLimitActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DC2626',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  cashLimitActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  incomingOfferCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    marginBottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  incomingOfferIcon: {
    backgroundColor: '#F59E0B',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  incomingOfferBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#1E293B',
  },
  incomingOfferTextContainer: {
    flex: 1,
  },
  incomingOfferTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  incomingOfferSub: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  activeAssignmentCard: {
    backgroundColor: '#14532D',
    borderRadius: 28,
    padding: 24,
    marginBottom: 32,
    shadowColor: '#1A202C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#3730A3',
  },
  activeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  liveBadge: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  liveBadgeText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1,
  },
  activeStatus: {
    fontSize: 15,
    fontWeight: '700',
    color: '#CBD5E0',
  },
  routeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2D2E32',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  iconSpaced: {
    marginRight: 16,
  },
  routeTextContainer: {
    flex: 1,
  },
  pickupLabel: {
    fontSize: 13,
    color: '#A0AEC0',
    marginBottom: 4,
    fontWeight: '500',
  },
  pickupText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  activeBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  earnHintLabel: {
    fontSize: 12,
    color: '#A0AEC0',
    marginBottom: 4,
    fontWeight: '500',
  },
  earnAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F59E0B',
  },
  navAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  navText: {
    color: THEME_PRIMARY,
    fontWeight: '700',
    marginRight: 6,
    fontSize: 14,
  },
  menuTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  menuGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  menuFeatureCard: {
    width: '31%',
    backgroundColor: THEME_CARD,
    borderRadius: 20,
    paddingVertical: 20,
    alignItems: 'center',
    shadowColor: '#95A5A6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  menuIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  menuItemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1A202C',
    marginBottom: 4,
  },
  menuItemSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A0AEC0',
  },
  incentiveMiniCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FEF3C7',
    marginBottom: 24,
  },
  incentiveMiniLeft: {
    flex: 1,
    marginRight: 12,
  },
  incentiveMiniTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#92400E',
    marginBottom: 4,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  milestoneMiniText: {
    fontSize: 12,
    color: '#B45309',
    fontWeight: '600',
    marginLeft: 4,
  },
  incentiveMiniRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewDetailsText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DD6B20',
    marginRight: 4,
  },
  cameraModal: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1A202C',
    zIndex: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraTitle: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  cameraSubtitle: {
    color: '#A0AEC0',
    fontSize: 13,
    marginBottom: 40,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  cameraMask: {
    width: 280,
    height: 280,
    borderRadius: 140,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#10B981',
    marginBottom: 60,
  },
  cameraPreview: {
    flex: 1,
  },
  cameraActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
    position: 'absolute',
    bottom: 50,
  },
  cameraCaptureBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'transparent',
    borderWidth: 4,
    borderColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraCaptureInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFF',
  },
  cameraCancelBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomNavContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 12, // account for home indicator
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  bottomNavItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  bottomNavText: {
    fontSize: 12,
    marginTop: 4,
    color: '#718096',
    fontWeight: '600',
  },
  ratingsCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  ratingsCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  ratingsStarIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  ratingsTextColumn: {
    flex: 1,
  },
  ratingsCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
  },
  ratingsSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
    gap: 6,
  },
  ratingsScoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D97706',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  ratingsScoreBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  ratingsCardSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#78350F',
  },
  ratingsCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingsViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 2,
  },
  ratingsViewBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  reviewsModalContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  reviewsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  reviewsModalBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewsModalHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  reviewsModalHeaderSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  reviewsModalRefreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewsModalContent: {
    padding: 20,
    paddingBottom: 40,
  },
  reviewsScoreCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 20,
  },
  scoreOverviewLeft: {
    alignItems: 'center',
    flex: 1.1,
  },
  bigScoreText: {
    fontSize: 44,
    fontWeight: '900',
    color: '#0F172A',
    lineHeight: 48,
  },
  starRow: {
    flexDirection: 'row',
    gap: 3,
    marginVertical: 4,
  },
  totalReviewsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  satisfactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  satisfactionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
  },
  scoreDivider: {
    width: 1,
    height: '80%',
    backgroundColor: '#E2E8F0',
    marginHorizontal: 16,
  },
  scoreDistributionRight: {
    flex: 1.4,
    gap: 6,
  },
  distRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  distStarLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    width: 26,
  },
  distBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
  },
  distBarFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#F59E0B',
  },
  distCountLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    width: 24,
    textAlign: 'right',
  },
  complimentsContainer: {
    marginBottom: 20,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
  },
  complimentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  complimentChip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FEF3C7',
    flexBasis: '48%',
    flexGrow: 1,
    gap: 10,
  },
  complimentIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  complimentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  complimentCount: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D97706',
    marginTop: 1,
  },
  filterSection: {
    marginBottom: 14,
  },
  filterTabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  filterChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  reviewsList: {
    gap: 12,
  },
  customerReviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  revHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  revAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  revAvatarText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#B45309',
  },
  revCustomerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  revTimeAgo: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  revRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 3,
  },
  revRatingBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  revTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  revTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  revTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
  revCommentBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  revCommentText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 19,
    fontStyle: 'italic',
  },
  emptyReviewsCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyReviewsTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E293B',
    marginTop: 10,
  },
  emptyReviewsSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    textAlign: 'center',
  },
});
