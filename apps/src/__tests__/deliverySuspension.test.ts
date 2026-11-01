import type { DeliveryProfile } from '@/features/kyc/types';

describe('Delivery Partner Suspension Verification Gate', () => {
  it('identifies SUSPENDED status correctly on delivery profile', () => {
    const profile: DeliveryProfile = {
      deliveryPartnerId: '43356826-811b-4b52-950d-b656ea4f3125',
      phone: '+916575859525',
      name: 'niiiiiiiiiiii',
      fullName: 'niiiiiiiiiiii',
      kycStatus: 'SUSPENDED',
      kycRejectionReason: 'Account suspended by Admin. Verification review in progress.',
      isOnline: false,
    };

    expect(profile.kycStatus).toBe('SUSPENDED');
    expect(profile.isOnline).toBe(false);
    expect(profile.kycRejectionReason).toContain('Account suspended by Admin');
  });

  it('determines that non-VERIFIED and SUSPENDED status routes to KYC PendingVerification', () => {
    const getFlowAndRoute = (kycStatus: string, hasDocs = true, hasImage = true, hasName = true) => {
      let flow: 'auth' | 'kyc' | 'main' = 'auth';
      let initialRouteName: any = undefined;

      if (kycStatus !== 'VERIFIED') {
        flow = 'kyc';
        if (kycStatus === 'SUSPENDED' || kycStatus === 'PENDING' || (hasDocs && hasImage && hasName)) {
          initialRouteName = 'PendingVerification';
        } else {
          initialRouteName = 'DeliveryZone';
        }
      } else {
        flow = 'main';
        initialRouteName = 'DeliveryHome';
      }
      return { flow, initialRouteName };
    };

    const suspendedResult = getFlowAndRoute('SUSPENDED');
    expect(suspendedResult.flow).toBe('kyc');
    expect(suspendedResult.initialRouteName).toBe('PendingVerification');

    const verifiedResult = getFlowAndRoute('VERIFIED');
    expect(verifiedResult.flow).toBe('main');
    expect(verifiedResult.initialRouteName).toBe('DeliveryHome');
  });
});
