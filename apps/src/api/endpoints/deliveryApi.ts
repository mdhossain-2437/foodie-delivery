import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { baseApi } from '../baseApi';
import type { DeliveryDocType, DeliveryDocumentUploadResult, DeliveryProfile, LocationZone, DeliveryZoneVerificationResult } from '@/features/kyc/types';
import type { AvailabilityState, DeliveryAssignment, DeliveryOffer } from '@/features/home/types';
import { normalizeOffers } from '@/features/home/types';
import type { LocationPingPayload } from '@/features/navigation/types';
import { setIsOnline } from '@/features/home/availabilitySlice';

export type DeliveryNavigationDetails = {
  assignmentId: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  restaurantName: string;
  restaurantPhone: string;
  restaurantAddress: string;
  restaurantLat: number | null;
  restaurantLng: number | null;
};

export type DeliveryShift = {
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  durationHours: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DeliveryShiftBooking = {
  bookingId: string;
  deliveryPartnerId: string;
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  durationHours: string;
  status: string;
  bookedAt: string;
  createdAt?: string;
  updatedAt?: string;
};

export function dataUriToBlob(dataUri: string): Blob {
  const parts = dataUri.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const byteString = atob(parts[1] || '');
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

export function captureFrameFromWebVideo(videoEl?: HTMLVideoElement | null): {
  dataUri: string;
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
} | null {
  if (typeof document === 'undefined') return null;

  const video = videoEl || (document.querySelector('video') as HTMLVideoElement | null);
  if (!video) {
    console.warn('[CameraCapture] No HTMLVideoElement found in DOM.');
    return null;
  }

  const vWidth = video.videoWidth || video.clientWidth || 0;
  const vHeight = video.videoHeight || video.clientHeight || 0;

  console.info('[CameraCapture] HTMLVideoElement state:', {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    clientWidth: video.clientWidth,
    clientHeight: video.clientHeight,
    readyState: video.readyState,
  });

  if (vWidth === 0 || vHeight === 0) {
    console.warn('[CameraCapture] Video stream has 0 dimensions.');
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = vWidth;
  canvas.height = vHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[CameraCapture] Canvas 2d context unavailable.');
    return null;
  }

  // Draw current uncompressed video frame
  ctx.drawImage(video, 0, 0, vWidth, vHeight);

  // Export high quality JPEG (quality 0.92)
  const dataUri = canvas.toDataURL('image/jpeg', 0.92);
  const blob = dataUriToBlob(dataUri);
  const previewUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';

  console.info('[CameraCapture] Safe captured frame metadata:', {
    'video.readyState': video.readyState,
    'video.videoWidth': video.videoWidth,
    'video.videoHeight': video.videoHeight,
    'canvas.width': canvas.width,
    'canvas.height': canvas.height,
    'Blob.size': blob.size,
    'Blob.type': blob.type,
    'FormData field name': 'file',
    'filename': 'go-online-verification.jpg',
    previewUrl,
  });

  return {
    dataUri,
    blob,
    width: canvas.width,
    height: canvas.height,
    previewUrl,
  };
}

export async function createUploadFormData(
  fields: Record<string, string | undefined>,
  fileField: { name: string; uri: string; mimeType: string; fileName: string; webFile?: any }
): Promise<FormData> {
  const formData = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined) formData.append(k, v);
  });

  if (Platform.OS === 'web') {
    let fileObj = fileField.webFile;
    if (fileObj instanceof Blob || (typeof File !== 'undefined' && fileObj instanceof File)) {
      if (fileObj.size > 0) {
        if ((!fileObj.type || fileObj.type === 'application/octet-stream') && fileField.mimeType) {
          try {
            fileObj = new File([fileObj], fileField.fileName || 'file', { type: fileField.mimeType });
          } catch {
            // fallback if File constructor fails
          }
        }
        formData.append(fileField.name, fileObj, fileField.fileName || 'file.jpg');
        return formData;
      }
    }
    if (fileField.uri) {
      if (fileField.uri.startsWith('data:')) {
        try {
          const blob = dataUriToBlob(fileField.uri);
          if (blob.size > 0) {
            let typedBlob = blob;
            if ((!blob.type || blob.type === 'application/octet-stream') && fileField.mimeType) {
              typedBlob = blob.slice(0, blob.size, fileField.mimeType);
            }
            formData.append(fileField.name, typedBlob, fileField.fileName || 'file.jpg');
            return formData;
          }
        } catch (err) {
          console.warn('[Upload] Failed to convert data URI to blob', err);
        }
      }
      try {
        const res = await fetch(fileField.uri);
        const blob = await res.blob();
        if (blob.size > 0) {
          let typedBlob = blob;
          if ((!blob.type || blob.type === 'application/octet-stream') && fileField.mimeType) {
            typedBlob = blob.slice(0, blob.size, fileField.mimeType);
          }
          formData.append(fileField.name, typedBlob, fileField.fileName || 'file.jpg');
          return formData;
        }
      } catch (err) {
        console.warn('[Upload] Failed to convert URI to blob', err);
      }
    }
    // Fallback on web to avoid passing plain object to FormData
    try {
      const blob = new Blob([], { type: fileField.mimeType || 'image/jpeg' });
      formData.append(fileField.name, blob, fileField.fileName || 'file.jpg');
      return formData;
    } catch {
      // ignore
    }
  }

  formData.append(fileField.name, {
    uri: fileField.uri,
    type: fileField.mimeType || 'image/jpeg',
    name: fileField.fileName || 'file.jpg',
  } as unknown as Blob);
  return formData;
}

/**
 * Delivery RTK — P2-DEL-01…03.
 * No GET /delivery/me (GAP-API-08). No decline offer (GAP-API-10).
 */
export const deliveryApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDeliveryProfile: builder.query<DeliveryProfile, void>({
      query: () => '/api/v1/delivery/me',
      transformResponse: async (response: any) => {
        const raw = response?.data ? { ...response.data } : { ...response };
        if (!raw) return raw;

        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (raw.phone && UUID_REGEX.test(String(raw.phone).trim())) {
          if (!raw.userId) raw.userId = String(raw.phone).trim();
          raw.phone = undefined;
        }
        if (raw.phoneNumber && UUID_REGEX.test(String(raw.phoneNumber).trim())) {
          if (!raw.userId) raw.userId = String(raw.phoneNumber).trim();
          raw.phoneNumber = undefined;
        }

        if (!raw.phone && raw.phoneNumber) {
          raw.phone = raw.phoneNumber;
        }
        if (!raw.phoneNumber && raw.phone) {
          raw.phoneNumber = raw.phone;
        }

        const myPartnerId = String(raw.deliveryPartnerId || raw.partnerId || raw.id || '').trim();
        const myUserId = String(raw.userId || raw.userCredentialId || '').trim();

        // Clean up any stale global un-scoped phone keys
        try {
          void AsyncStorage.removeItem('@foodie_delivery_registered_phone');
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem('foodie_delivery_phone');
          }
        } catch {}

        // If profile already has a valid phone number, persist it and skip admin BFF fetch
        const existingPhone = String(raw.phoneNumber || raw.phone || '').trim();
        const isValidExisting = existingPhone && !UUID_REGEX.test(existingPhone) && existingPhone.replace(/\D/g, '').length >= 10;
        if (isValidExisting) {
          raw.phoneNumber = existingPhone;
          raw.phone = existingPhone;
          const credId = myUserId || (raw as any)?.userCredentialId;
          if (credId) {
            try {
              void AsyncStorage.setItem(`@foodie_delivery_registered_phone_${credId}`, existingPhone);
              if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(`foodie_delivery_phone_${credId}`, existingPhone);
              }
            } catch {}
          }
          return raw;
        }

        // Only query local admin BFF if explicitly running in a dev environment where port 3100 is accessible
        const shouldCheckAdminBff = typeof window !== 'undefined' && window.location?.port === '3100';
        if (!shouldCheckAdminBff) {
          return raw;
        }

        try {
          const bffOrigin =
            typeof window !== 'undefined' && window.location?.hostname
              ? `${window.location.protocol}//${window.location.hostname}:3100`
              : 'http://localhost:3100';

          let matchedPartner = null;

          // Attempt 1: Fetch directly by unique partner ID from database / BFF
          if (myPartnerId) {
            try {
              const singleController = typeof AbortController !== 'undefined' ? new AbortController() : null;
              const singleTimeout = singleController ? setTimeout(() => singleController.abort(), 3000) : null;
              const singleRes = await fetch(`${bffOrigin}/api/bff/admin/delivery-partners/${encodeURIComponent(myPartnerId)}`, {
                signal: singleController?.signal,
              });
              if (singleTimeout) clearTimeout(singleTimeout);
              if (singleRes && singleRes.ok) {
                const singleJson = await singleRes.json();
                if (singleJson?.data && String(singleJson.data.id || singleJson.data.partnerId).toLowerCase() === myPartnerId.toLowerCase()) {
                  matchedPartner = singleJson.data;
                }
              }
            } catch {}
          }

          // Attempt 2: If not resolved yet, fetch list and match strictly by unique userCredentialId or partner ID
          if (!matchedPartner) {
            const listController = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const listTimeout = listController ? setTimeout(() => listController.abort(), 3000) : null;
            const res = await fetch(`${bffOrigin}/api/bff/admin/delivery-partners?size=100`, {
              signal: listController?.signal,
            });
            if (listTimeout) clearTimeout(listTimeout);

            if (res && res.ok) {
              const bffJson = await res.json();
              const partnerList = bffJson?.data?.items || bffJson?.data || [];
              if (Array.isArray(partnerList)) {
                matchedPartner = partnerList.find((item) => {
                  const iId = String(item.id || item.partnerId || '').trim().toLowerCase();
                  const iCred = String(item.userCredentialId || item.userId || '').trim().toLowerCase();
                  return (
                    (myPartnerId && iId && iId === myPartnerId.toLowerCase()) ||
                    (myUserId && iCred && iCred === myUserId.toLowerCase())
                  );
                });
              }
            }
          }

          if (matchedPartner) {
            const partnerPhone = String(matchedPartner.phoneNumber || matchedPartner.phone || '').trim();
            const isValidPartnerPhone = partnerPhone && !UUID_REGEX.test(partnerPhone) && partnerPhone.replace(/\D/g, '').length >= 10;
            if (isValidPartnerPhone) {
              raw.phoneNumber = partnerPhone;
              raw.phone = partnerPhone;
              const credId = matchedPartner.userCredentialId || myUserId;
              if (credId) {
                try {
                  void AsyncStorage.setItem(`@foodie_delivery_registered_phone_${credId}`, partnerPhone);
                  if (typeof window !== 'undefined' && window.localStorage) {
                    window.localStorage.setItem(`foodie_delivery_phone_${credId}`, partnerPhone);
                  }
                } catch {}
              }
            }
            if (!raw.profileImageUrl && matchedPartner.profileImageUrl) {
              raw.profileImageUrl = matchedPartner.profileImageUrl;
            }
            if (matchedPartner.userCredentialId && !raw.userId) {
              raw.userId = matchedPartner.userCredentialId;
            }
            if (matchedPartner.kycStatus === 'SUSPENDED') {
              raw.kycStatus = 'SUSPENDED';
              raw.isOnline = false;
              raw.kycRejectionReason = matchedPartner?.kycRejectionReason || 'Account suspended by Admin. Verification review in progress.';
              if (Array.isArray(raw.documents)) {
                raw.documents = raw.documents.map((d: any) => ({
                  ...d,
                  verificationStatus: 'PENDING',
                }));
              }
            }
          }
        } catch {
          // If BFF check fails, continue with raw profile
        }

        return raw;
      },
      providesTags: [{ type: 'Delivery', id: 'PROFILE' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled, getState }) {
        try {
          const { data } = await queryFulfilled;
          const currentIsOnline = (getState() as any)?.availability?.isOnline;
          if (data && typeof data.isOnline === 'boolean') {
            if (!data.isOnline && currentIsOnline) {
              dispatch(setIsOnline(false));
            } else if (data.isOnline && !currentIsOnline) {
              dispatch(setIsOnline(true));
            }
          }
        } catch {
          // Ignored if query fails
        }
      },
    }),
    getDeliveryZones: builder.query<LocationZone[], void>({
      query: () => '/api/v1/delivery/zones',
      keepUnusedDataFor: 300,
    }),
    verifyDeliveryZone: builder.mutation<
      DeliveryZoneVerificationResult,
      { latitude: number; longitude: number; zoneId?: string; address?: string }
    >({
      query: (body) => ({
        url: '/api/v1/delivery/me/verify-zone',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      invalidatesTags: [{ type: 'Delivery', id: 'PROFILE' }],
    }),
    upsertDeliveryProfile: builder.mutation<
      DeliveryProfile,
      {
        fullName?: string;
        vehicleType?: string;
        vehicleNumber?: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        pincode?: string;
      }
    >({
      query: (body) => ({
        url: '/api/v1/delivery/me',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      invalidatesTags: [{ type: 'Delivery', id: 'PROFILE' }],
    }),
    uploadDeliveryDocument: builder.mutation<
      DeliveryDocumentUploadResult,
      {
        docType: DeliveryDocType;
        uri: string;
        mimeType: string;
        fileName: string;
        webFile?: any;
      }
    >({
      queryFn: async (args, _queryApi, _extraOptions, fetchWithBQ) => {
        try {
          const formData = await createUploadFormData(
            { docType: args.docType },
            {
              name: 'file',
              uri: args.uri,
              mimeType: args.mimeType,
              fileName: args.fileName,
              webFile: args.webFile,
            }
          );
          const result = await fetchWithBQ({
            url: `/api/v1/delivery/me/documents?docType=${encodeURIComponent(args.docType)}`,
            method: 'POST',
            body: formData,
          });
          if (result.error) return { error: result.error };
          return { data: result.data as DeliveryDocumentUploadResult };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } as any };
        }
      },
      invalidatesTags: [{ type: 'Delivery', id: 'DOCS' }, { type: 'Delivery', id: 'PROFILE' }],
    }),
    setAvailability: builder.mutation<AvailabilityState, { isOnline: boolean }>(
      {
        query: (body) => ({
          url: '/api/v1/delivery/availability',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        invalidatesTags: [
          'Delivery',
          { type: 'Delivery', id: 'AVAILABILITY' },
          { type: 'Delivery', id: 'PROFILE' },
        ],
        async onQueryStarted({ isOnline }, { dispatch, queryFulfilled }) {
          const patchResult = dispatch(
            deliveryApi.util.updateQueryData('getDeliveryProfile', undefined, (draft) => {
              if (draft) {
                draft.isOnline = isOnline;
              }
            })
          );
          try {
            const { data } = await queryFulfilled;
            const confirmedOnline = Boolean(data?.isOnline ?? isOnline);
            dispatch(setIsOnline(confirmedOnline));
            void AsyncStorage.setItem('@foodie_delivery_is_online', String(confirmedOnline));
          } catch {
            patchResult.undo();
          }
        },
      },
    ),
    getDeliveryOffers: builder.query<DeliveryOffer[], void>({
      query: () => '/api/v1/delivery/offers',
      transformResponse: (response: unknown) => normalizeOffers(response),
      providesTags: (result) =>
        result
          ? [
            ...result.map(({ assignmentId }) => ({
              type: 'Delivery' as const,
              id: `OFFER-${assignmentId}`,
            })),
            { type: 'Delivery', id: 'OFFERS' },
          ]
          : [{ type: 'Delivery', id: 'OFFERS' }],
      keepUnusedDataFor: 15,
    }),
    acceptAssignment: builder.mutation<DeliveryAssignment, string>({
      query: (assignmentId) => ({
        url: `/api/v1/delivery/assignments/${assignmentId}/accept`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {},
      }),
      invalidatesTags: (_result, _error, assignmentId) => [
        { type: 'Delivery', id: 'OFFERS' },
        { type: 'Delivery', id: `OFFER-${assignmentId}` },
        { type: 'Order', id: 'LIST' },
      ],
    }),
    rejectAssignment: builder.mutation<void, string>({
      query: (assignmentId) => ({
        url: `/api/v1/delivery/assignments/${assignmentId}/reject`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {},
      }),
      invalidatesTags: (_result, _error, assignmentId) => [
        { type: 'Delivery', id: 'OFFERS' },
        { type: 'Delivery', id: `OFFER-${assignmentId}` },
      ],
    }),
    locationPing: builder.mutation<null, LocationPingPayload>({
      query: (body) => ({
        url: '/api/v1/delivery/location-ping',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        responseHandler: async (response) => {
          const text = await response.text();
          if (!text) return null;
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return null;
          }
        },
      }),
    }),
    verifyPickupOtp: builder.mutation<
      DeliveryAssignment,
      { assignmentId: string; orderId: string; otp: string }
    >({
      query: ({ assignmentId, otp }) => ({
        url: `/api/v1/delivery/assignments/${assignmentId}/verify-pickup`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { otp },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Delivery', id: 'OFFERS' },
        { type: 'Order', id: 'LIST' },
        { type: 'Order', id: arg.orderId },
      ],
    }),
    verifyDeliveryOtp: builder.mutation<
      DeliveryAssignment,
      { assignmentId: string; orderId: string; otp: string; collectionMethod?: string }
    >({
      query: ({ assignmentId, otp, collectionMethod }) => ({
        url: `/api/v1/delivery/assignments/${assignmentId}/verify-delivery`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { otp, collectionMethod },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Delivery', id: 'OFFERS' },
        { type: 'Order', id: 'LIST' },
        { type: 'Order', id: arg.orderId },
        { type: 'Wallet', id: 'BALANCE' },
      ],
    }),
    uploadDeliveryProfileImage: builder.mutation<
      { profileImageKey: string; uploadedAt: string },
      { uri: string; mimeType: string; fileName: string; webFile?: any }
    >({
      queryFn: async (args, _queryApi, _extraOptions, fetchWithBQ) => {
        try {
          const formData = await createUploadFormData({}, {
            name: 'file',
            uri: args.uri,
            mimeType: args.mimeType,
            fileName: args.fileName,
            webFile: args.webFile,
          });
          const result = await fetchWithBQ({
            url: '/api/v1/delivery/me/profile-image',
            method: 'POST',
            body: formData,
          });
          if (result.error) return { error: result.error };
          return { data: result.data as { profileImageKey: string; uploadedAt: string } };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } as any };
        }
      },
      invalidatesTags: [{ type: 'Delivery', id: 'PROFILE' }],
    }),
    verifyFace: builder.mutation<
      boolean,
      { assignmentId: string; uri: string; mimeType: string; fileName: string; webFile?: any }
    >({
      queryFn: async (args, _queryApi, _extraOptions, fetchWithBQ) => {
        try {
          const formData = await createUploadFormData({}, {
            name: 'file',
            uri: args.uri,
            mimeType: args.mimeType,
            fileName: args.fileName,
            webFile: args.webFile,
          });
          const result = await fetchWithBQ({
            url: `/api/v1/delivery/assignments/${args.assignmentId}/verify-face`,
            method: 'POST',
            body: formData,
          });
          if (result.error) return { error: result.error };
          return { data: result.data as boolean };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } as any };
        }
      },
    }),
    verifyFaceForOnline: builder.mutation<
      boolean,
      { uri: string; mimeType: string; fileName: string; webFile?: any }
    >({
      queryFn: async (args, _queryApi, _extraOptions, fetchWithBQ) => {
        try {
          const formData = await createUploadFormData({}, {
            name: 'file',
            uri: args.uri,
            mimeType: args.mimeType,
            fileName: args.fileName,
            webFile: args.webFile,
          });
          const result = await fetchWithBQ({
            url: '/api/v1/delivery/me/verify-face',
            method: 'POST',
            body: formData,
          });
          if (result.error) return { error: result.error };
          return { data: result.data as boolean };
        } catch (e: any) {
          return { error: { status: 'CUSTOM_ERROR', error: e.message } as any };
        }
      },
    }),
    getDeliveryBankDetails: builder.query<
      { accountHolderName: string; accountNumber: string; ifscCode: string; bankName: string },
      void
    >({
      query: () => '/api/v1/delivery/me/bank-details',
      providesTags: [{ type: 'Delivery', id: 'BANK_DETAILS' }],
    }),
    updateDeliveryBankDetails: builder.mutation<
      { accountHolderName: string; accountNumber: string; ifscCode: string; bankName: string },
      { accountHolderName: string; accountNumber: string; ifscCode: string; bankName: string }
    >({
      query: (body) => ({
        url: '/api/v1/delivery/me/bank-details',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      invalidatesTags: [{ type: 'Delivery', id: 'BANK_DETAILS' }, { type: 'Delivery', id: 'PROFILE' }],
    }),
    getDeliveryReviews: builder.query<
      {
        averageRating: number;
        totalReviews: number;
        positivePercentage: number;
        ratingBreakdown: Record<string, number>;
        compliments: { label: string; count: number; icon: string }[];
        reviews: {
          id: string;
          customerName: string;
          rating: number;
          comment: string;
          orderNumber: string;
          timeAgo: string;
          tags: string[];
        }[];
      },
      void
    >({
      query: () => '/api/v1/delivery/me/reviews',
      providesTags: [{ type: 'Delivery', id: 'PROFILE' }],
    }),
    getNavigationDetails: builder.query<DeliveryNavigationDetails, string>({
      query: (assignmentId) => `/api/v1/delivery/assignments/${assignmentId}/navigation`,
      providesTags: (_result, _error, assignmentId) => [{ type: 'Order', id: `NAV-${assignmentId}` }],
    }),
    arrivedAtRestaurant: builder.mutation<void, string>({
      query: (assignmentId) => ({
        url: `/api/v1/delivery/assignments/${assignmentId}/arrived-restaurant`,
        method: 'POST',
      }),
      invalidatesTags: ['Delivery', 'Order'],
    }),
    submitCashDeposit: builder.mutation<
      { paymentSessionId?: string, referenceNumber: string },
      { amount: number; referenceNumber?: string }
    >({
      query: (body) => ({
        url: '/api/v1/delivery/cash-deposits',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      invalidatesTags: [{ type: 'Delivery', id: 'PROFILE' }],
    }),
    verifyCashDeposit: builder.mutation<
      void,
      string
    >({
      query: (depositId) => ({
        url: `/api/v1/delivery/cash-deposits/${depositId}/verify`,
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'Delivery', id: 'PROFILE' }],
    }),
    getAvailableShifts: builder.query<DeliveryShift[], void>({
      query: () => '/api/v1/delivery/shifts/available',
      transformResponse: (response: any) => {
        if (Array.isArray(response)) return response;
        if (response?.data && Array.isArray(response.data)) return response.data;
        return [];
      },
      providesTags: [{ type: 'Delivery', id: 'SHIFTS' }],
    }),
    getMyShiftBookings: builder.query<DeliveryShiftBooking[], void>({
      query: () => '/api/v1/delivery/shifts/my-bookings',
      transformResponse: (response: any) => {
        if (Array.isArray(response)) return response;
        if (response?.data && Array.isArray(response.data)) return response.data;
        return [];
      },
      providesTags: [{ type: 'Delivery', id: 'MY_SHIFTS' }],
    }),
    bookDeliveryShift: builder.mutation<DeliveryShiftBooking, string>({
      query: (shiftId) => ({
        url: `/api/v1/delivery/shifts/${shiftId}/book`,
        method: 'POST',
      }),
      invalidatesTags: [
        'Delivery',
        { type: 'Delivery', id: 'SHIFTS' },
        { type: 'Delivery', id: 'MY_SHIFTS' },
      ],
    }),
    initiateCodOnlinePayment: builder.mutation<
      {
        orderId: string;
        assignmentId: string;
        paymentSessionId: string;
        cfOrderId: string;
        amount: number;
        upiQrPayload: string;
      },
      { assignmentId: string }
    >({
      query: ({ assignmentId }) => ({
        url: `/api/v1/delivery/assignments/${assignmentId}/collect-online-payment`,
        method: 'POST',
      }),
      transformResponse: (response: any) => {
        return response?.data || response;
      },
    }),
    verifyCodOnlinePayment: builder.mutation<
      {
        orderId: string;
        assignmentId: string;
        cfOrderId: string;
        verified: boolean;
        paymentStatus: string;
        amount: number;
        message: string;
      },
      { assignmentId: string; cfOrderId?: string; simulate?: boolean }
    >({
      query: ({ assignmentId, cfOrderId, simulate }) => {
        const params = new URLSearchParams();
        if (cfOrderId) params.append('cfOrderId', cfOrderId);
        if (simulate) params.append('simulate', 'true');
        const qs = params.toString();
        return {
          url: `/api/v1/delivery/assignments/${assignmentId}/verify-online-payment${qs ? `?${qs}` : ''}`,
          method: 'POST',
        };
      },
      transformResponse: (response: any) => {
        return response?.data || response;
      },
    }),
  }),
});

export const {
  useGetDeliveryProfileQuery,
  useUpsertDeliveryProfileMutation,
  useUploadDeliveryDocumentMutation,
  useSetAvailabilityMutation,
  useGetDeliveryOffersQuery,
  useAcceptAssignmentMutation,
  useRejectAssignmentMutation,
  useLocationPingMutation,
  useVerifyPickupOtpMutation,
  useVerifyDeliveryOtpMutation,
  useUploadDeliveryProfileImageMutation,
  useVerifyFaceMutation,
  useVerifyFaceForOnlineMutation,
  useGetDeliveryBankDetailsQuery,
  useUpdateDeliveryBankDetailsMutation,
  useGetDeliveryReviewsQuery,
  useGetNavigationDetailsQuery,
  useArrivedAtRestaurantMutation,
  useSubmitCashDepositMutation,
  useVerifyCashDepositMutation,
  useGetDeliveryZonesQuery,
  useVerifyDeliveryZoneMutation,
  useGetAvailableShiftsQuery,
  useGetMyShiftBookingsQuery,
  useBookDeliveryShiftMutation,
  useInitiateCodOnlinePaymentMutation,
  useVerifyCodOnlinePaymentMutation,
} = deliveryApi;

