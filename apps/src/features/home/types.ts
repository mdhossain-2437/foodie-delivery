/**
 * P2-DEL-02 shapes — UI-API Home/Availability/Offers/AssignmentDetails +
 * DeliveryOfferResponseDto / AvailabilityResponseDto / DeliveryAssignmentResponseDto /
 * OrderResponseDto (§6.2 / §8.1–§8.3).
 */

export type AvailabilityState = {
  isOnline: boolean;
};

export type DeliveryOffer = {
  assignmentId: string;
  orderId: string;
  orderNumber?: string;
  restaurantName: string;
  pickupAddress: string;
  deliveryAddress?: string;
  expectedFoodReadyTime?: string;
  estimatedDistance: number;
  estimatedFee?: number;
};

export type DeliveryAssignment = {
  assignmentId: string;
  orderId: string;
  status: string;
  pickupOtpRequired: boolean;
  assignedAt?: string;
  pickupVerifiedAt?: string | null;
  deliveredVerifiedAt?: string | null;
};

export type OrderLineItem = {
  menuItemId?: string;
  variantId?: string | null;
  name?: string;
  quantity: number;
  unitPrice?: number | string;
  lineTotal?: number | string;
};

export type OrderStatusEvent = {
  eventId?: string;
  fromStatus?: string | null;
  toStatus?: string;
  actorType?: string;
  actorId?: string;
  reason?: string | null;
  createdAt?: string;
  occurredAt?: string;
};

export type OrderDetail = {
  orderId: string;
  orderNumber: string;
  status: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  restaurantId?: string;
  restaurantName?: string;
  restaurantPhone?: string;
  restaurantAddress?: string;
  addressId?: string;
  estimatedDistance?: number;
  subtotal: number | string;
  deliveryFee: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  totalAmount: number | string;
  placedAt?: string;
  preparationTime?: number;
  foodReadyAt?: string;
  assignmentScheduledAt?: string;
  items?: OrderLineItem[];
  orderStatusEvents?: OrderStatusEvent[];
  paymentMethod?: string;
  paymentStatus?: string;
  transactionId?: string;
};

/** Active assignment summary for Home — session-only. */
export type ActiveAssignmentRef = {
  assignmentId: string;
  orderId: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TERMINAL: ReadonlySet<string> = new Set([
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
]);

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isTerminalOrderStatus(status: string | undefined): boolean {
  if (!status) return false;
  return TERMINAL.has(status);
}

export function formatMoney(value: number | string | undefined): string {
  if (value === undefined || value === null) return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `₹${n.toFixed(2)}`;
}

export function formatDistanceKm(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} km`;
}

export function normalizeOffers(data: unknown): DeliveryOffer[] {
  if (Array.isArray(data)) return data as DeliveryOffer[];
  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as { content?: unknown }).content)
  ) {
    return (data as { content: DeliveryOffer[] }).content;
  }
  return [];
}
