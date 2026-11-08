/**
 * P2-DEL-01 KYC shapes — UI-API KYC + API Contracts §3 Delivery Partner Documents.
 */

export const DOC_TYPES = ['LICENSE', 'VEHICLE_RC', 'IDENTITY'] as const;
export type DeliveryDocType = (typeof DOC_TYPES)[number];

export type DocumentVerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | string;

export type DeliveryDocumentUploadResult = {
  documentId: string;
  docType: DeliveryDocType | string;
  verificationStatus: DocumentVerificationStatus;
  fileKey: string;
  uploadedAt: string;
};

export type ProfileImageUploadResult = {
  fileKey: string;
  uploadedAt?: string;
};

export type UploadedDocumentMeta = {
  documentId: string;
  docType: DeliveryDocType;
  verificationStatus: DocumentVerificationStatus;
  fileKey: string;
  uploadedAt: string;
};

export function isDeliveryDocType(value: string): value is DeliveryDocType {
  return (DOC_TYPES as readonly string[]).indexOf(value) !== -1;
}

export type LocationZone = {
  id: string;
  zoneName: string;
  cityName: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  polygonCoordinates?: string;
  activeDrivers?: number;
  surgeMultiplier?: number;
  status?: string;
  restaurantEnabled?: boolean;
  deliveryPartnerEnabled?: boolean;
  customerOrderingEnabled?: boolean;
};

export type DeliveryZoneVerificationResult = {
  verified: boolean;
  zoneId?: string | null;
  zoneName?: string | null;
  cityName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  message: string;
};

export type DeliveryProfile = {
  deliveryPartnerId: string;
  phone: string;
  phoneNumber?: string;
  name: string;
  fullName?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED' | string;
  kycRejectionReason?: string;
  isOnline: boolean;
  profileImageUrl?: string;
  documents?: DeliveryDocumentUploadResult[];
  cashInHand?: number;
  maxCashInHandLimit?: number;
  isCashLimitExceeded?: boolean;
  latitude?: number;
  longitude?: number;
  zoneId?: string;
  zoneName?: string;
  zoneVerified?: boolean;
  locationApprovalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NONE' | string;
};
