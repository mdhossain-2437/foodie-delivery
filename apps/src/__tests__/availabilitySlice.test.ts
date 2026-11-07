import reducer, {
  clearAvailability,
  setActiveAssignment,
  setIsOnline,
} from '@/features/home/availabilitySlice';
import { clearCredentials } from '@/features/auth/authSlice';
import { isTerminalOrderStatus } from '@/features/home/types';

describe('availabilitySlice (P2-DEL-02)', () => {
  it('tracks online flag and active assignment', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, setIsOnline(true));
    expect(state.isOnline).toBe(true);
    state = reducer(
      state,
      setActiveAssignment({
        assignmentId: 'a1',
        orderId: 'o1',
      }),
    );
    expect(state.activeAssignment?.orderId).toBe('o1');
  });

  it('clears on logout', () => {
    let state = reducer(undefined, setIsOnline(true));
    state = reducer(
      state,
      setActiveAssignment({ assignmentId: 'a1', orderId: 'o1' }),
    );
    state = reducer(state, clearCredentials());
    expect(state.isOnline).toBe(false);
    expect(state.activeAssignment).toBeNull();
    state = reducer(undefined, setIsOnline(true));
    state = reducer(state, clearAvailability());
    expect(state.isOnline).toBe(false);
  });

  it('accurately identifies active delivery vs terminal delivery states', () => {
    // Non-terminal: Active delivery in progress (delivery partner cannot go offline)
    expect(isTerminalOrderStatus('ACCEPTED')).toBe(false);
    expect(isTerminalOrderStatus('REACHED_RESTAURANT')).toBe(false);
    expect(isTerminalOrderStatus('PICKED_UP')).toBe(false);
    expect(isTerminalOrderStatus('OUT_FOR_DELIVERY')).toBe(false);
    expect(isTerminalOrderStatus(undefined)).toBe(false);

    // Terminal: Order is delivered or finished (delivery partner can go offline)
    expect(isTerminalOrderStatus('DELIVERED')).toBe(true);
    expect(isTerminalOrderStatus('CANCELLED')).toBe(true);
    expect(isTerminalOrderStatus('REJECTED')).toBe(true);
  });
});
