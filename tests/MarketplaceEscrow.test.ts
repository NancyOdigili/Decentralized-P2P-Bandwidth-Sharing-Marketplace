// MarketplaceEscrow.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T;
}

interface ErrorResponse {
  ok: boolean;
  value: number;
}

interface Escrow {
  seller: string;
  buyer: string;
  amount: number;
  fee: number;
  startTime: number;
  duration: number;
  state: number;
  listingId: number;
  confirmations: string[];
  refundAmount: number;
}

interface EscrowMetadata {
  description: string;
  terms: string;
}

interface ContractState {
  escrows: Map<number, Escrow>;
  escrowMetadata: Map<number, EscrowMetadata>;
  escrowPayments: Map<number, { paid: boolean; timestamp: number }>;
  blockHeight: number;
  lastEscrowId: number;
  stxBalances: Map<string, number>;
  reputationUpdates: Map<string, number>;
}

class MarketplaceEscrowMock {
  private state: ContractState = {
    escrows: new Map(),
    escrowMetadata: new Map(),
    escrowPayments: new Map(),
    blockHeight: 0,
    lastEscrowId: 0,
    stxBalances: new Map([["contract", 0]]),
    reputationUpdates: new Map(),
  };

  private ERR_INSUFFICIENT_FUNDS = 201;
  private ERR_INVALID_AMOUNT = 202;
  private ERR_NOT_SELLER = 204;
  private ERR_NOT_BUYER = 205;
  private ERR_ESCROW_NOT_FOUND = 206;
  private ERR_INVALID_STATE = 207;
  private ERR_TIMEOUT_NOT_REACHED = 208;
  private ERR_ALREADY_CONFIRMED = 209;
  private ERR_NOT_OWNER = 101;
  private ERR_INVALID_INPUT = 103;
  private STATE_PENDING = 1;
  private STATE_ACTIVE = 2;
  private STATE_COMPLETED = 3;
  private STATE_DISPUTED = 4;
  private STATE_REFUNDED = 5;
  private PLATFORM_FEE_PCT = 5; // 0.5%
  private MAX_ESCROW_DURATION = 144;

  private calculateFee(amount: number): number {
    return Math.floor((amount * this.PLATFORM_FEE_PCT) / 1000);
  }

  private transferStx(from: string, amount: number, to: string): ErrorResponse {
    const fromBal = this.state.stxBalances.get(from) ?? 0;
    if (fromBal < amount) return { ok: false, value: this.ERR_INSUFFICIENT_FUNDS };
    this.state.stxBalances.set(from, fromBal - amount);
    const toBal = this.state.stxBalances.get(to) ?? 0;
    this.state.stxBalances.set(to, toBal + amount);
    return { ok: true, value: 0 };
  }

  private updateReputation(user: string, delta: number): void {
    const current = this.state.reputationUpdates.get(user) ?? 0;
    this.state.reputationUpdates.set(user, current + delta);
  }

  createEscrow(caller: string, listingId: number, amount: number, duration: number, description: string, terms: string, seller: string): ClarityResponse<number> {
    if (amount <= 0) return { ok: false, value: this.ERR_INVALID_AMOUNT };
    if (duration > this.MAX_ESCROW_DURATION) return { ok: false, value: this.ERR_INVALID_INPUT };
    const fee = this.calculateFee(amount);
    const total = amount + fee;

    const transfer = this.transferStx(caller, total, "contract");
    if (!transfer.ok) return { ok: false, value: transfer.value };

    const escrowId = this.state.lastEscrowId + 1;
    this.state.escrows.set(escrowId, {
      seller,
      buyer: caller,
      amount,
      fee,
      startTime: this.state.blockHeight,
      duration,
      state: this.STATE_PENDING,
      listingId,
      confirmations: [],
      refundAmount: 0,
    });
    this.state.escrowMetadata.set(escrowId, { description, terms });
    this.state.lastEscrowId = escrowId;
    return { ok: true, value: escrowId };
  }

  confirmDelivery(caller: string, escrowId: number): ErrorResponse {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    if (![escrow.buyer, escrow.seller].includes(caller)) return { ok: false, value: this.ERR_NOT_OWNER };
    if (escrow.state !== this.STATE_ACTIVE) return { ok: false, value: this.ERR_INVALID_STATE };
    if (escrow.confirmations.includes(caller)) return { ok: false, value: this.ERR_ALREADY_CONFIRMED };

    const newConfirmations = [...escrow.confirmations, caller];
    if (newConfirmations.length === 2) {
      this.state.escrows.set(escrowId, { ...escrow, state: this.STATE_COMPLETED, confirmations: newConfirmations });
      this.transferStx("contract", escrow.amount, escrow.seller);
      this.transferStx("contract", escrow.fee, "platform");
      this.updateReputation(escrow.seller, 100);
      this.updateReputation(escrow.buyer, 50);
      return { ok: true, value: 0 };
    } else {
      this.state.escrows.set(escrowId, { ...escrow, confirmations: newConfirmations });
      return { ok: true, value: 1 };
    }
  }

  activateEscrow(caller: string, escrowId: number): ErrorResponse {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    if (caller !== escrow.seller) return { ok: false, value: this.ERR_NOT_SELLER };
    if (escrow.state !== this.STATE_PENDING) return { ok: false, value: this.ERR_INVALID_STATE };

    this.state.escrows.set(escrowId, { ...escrow, state: this.STATE_ACTIVE });
    return { ok: true, value: 0 };
  }

  requestRefund(caller: string, escrowId: number, refundAmount: number): ErrorResponse {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    if (caller !== escrow.buyer) return { ok: false, value: this.ERR_NOT_BUYER };
    if (![this.STATE_ACTIVE, this.STATE_PENDING].includes(escrow.state)) return { ok: false, value: this.ERR_INVALID_STATE };
    if (refundAmount > escrow.amount) return { ok: false, value: this.ERR_INVALID_AMOUNT };

    this.state.escrows.set(escrowId, { ...escrow, state: this.STATE_DISPUTED, refundAmount });
    return { ok: true, value: 0 };
  }

  approveRefund(caller: string, escrowId: number): ErrorResponse {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    if (caller !== escrow.seller) return { ok: false, value: this.ERR_NOT_SELLER };
    if (escrow.state !== this.STATE_DISPUTED) return { ok: false, value: this.ERR_INVALID_STATE };

    const totalAmount = escrow.amount + escrow.fee; // Total escrowed amount (1000 + 5)
    const buyerRefund = escrow.refundAmount; // Amount requested by buyer (e.g., 500)
    const sellerAmount = totalAmount - buyerRefund; // Seller gets remainder (e.g., 505)
    this.transferStx("contract", buyerRefund, escrow.buyer);
    if (sellerAmount > 0) {
      this.transferStx("contract", sellerAmount, escrow.seller);
    }
    this.state.escrows.set(escrowId, { ...escrow, state: this.STATE_REFUNDED });
    this.updateReputation(escrow.seller, -50);
    return { ok: true, value: 0 };
  }

  timeoutRelease(escrowId: number): ErrorResponse {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    if (this.state.blockHeight - escrow.startTime <= escrow.duration) return { ok: false, value: this.ERR_TIMEOUT_NOT_REACHED };
    if (escrow.state !== this.STATE_ACTIVE) return { ok: false, value: this.ERR_INVALID_STATE };

    this.transferStx("contract", escrow.amount, escrow.seller);
    this.transferStx("contract", escrow.fee, "platform");
    this.state.escrows.set(escrowId, { ...escrow, state: this.STATE_COMPLETED });
    this.updateReputation(escrow.seller, 20);
    return { ok: true, value: 0 };
  }

  getEscrow(escrowId: number): ClarityResponse<Escrow | null> {
    return { ok: true, value: this.state.escrows.get(escrowId) ?? null };
  }

  getEscrowMetadata(escrowId: number): ClarityResponse<EscrowMetadata | null> {
    return { ok: true, value: this.state.escrowMetadata.get(escrowId) ?? null };
  }

  getEscrowState(escrowId: number): ClarityResponse<number> {
    const escrow = this.state.escrows.get(escrowId);
    if (!escrow) return { ok: false, value: this.ERR_ESCROW_NOT_FOUND };
    return { ok: true, value: escrow.state };
  }

  calculatePlatformFee(amount: number): ClarityResponse<number> {
    return { ok: true, value: this.calculateFee(amount) };
  }

  setStxBalance(account: string, balance: number) {
    this.state.stxBalances.set(account, balance);
  }

  getStxBalance(account: string): number {
    return this.state.stxBalances.get(account) ?? 0;
  }

  incrementBlockHeight() {
    this.state.blockHeight++;
  }

  getReputationUpdate(user: string): number {
    return this.state.reputationUpdates.get(user) ?? 0;
  }
}

// Test setup
const accounts = {
  buyer: "wallet_1",
  seller: "wallet_2",
};

describe("MarketplaceEscrow Contract", () => {
  let contract: MarketplaceEscrowMock;

  beforeEach(() => {
    contract = new MarketplaceEscrowMock();
    contract.setStxBalance(accounts.buyer, 10000);
    contract.setStxBalance(accounts.seller, 0);
  });

  it("should create escrow with fee", () => {
    const create = contract.createEscrow(accounts.buyer, 1, 1000, 100, "Desc", "Terms", accounts.seller);
    expect(create.ok).toBe(true);
    expect(create.value).toBe(1);
    const escrow = contract.getEscrow(1);
    expect(escrow.ok).toBe(true);
    expect(escrow.value).not.toBeNull();
    if (escrow.value) {
      expect(escrow.value.amount).toBe(1000);
      expect(escrow.value.fee).toBe(5);
      expect(escrow.value.seller).toBe(accounts.seller);
    }
    expect(contract.getStxBalance("contract")).toBe(1005);
  });

  it("should activate escrow by seller", () => {
    contract.createEscrow(accounts.buyer, 1, 1000, 100, "Desc", "Terms", accounts.seller);
    const activate = contract.activateEscrow(accounts.seller, 1);
    expect(activate).toEqual({ ok: true, value: 0 });
    const state = contract.getEscrowState(1);
    expect(state).toEqual({ ok: true, value: 2 });
  });

  it("should confirm delivery with multi-sig", () => {
    contract.createEscrow(accounts.buyer, 1, 1000, 100, "Desc", "Terms", accounts.seller);
    contract.activateEscrow(accounts.seller, 1);
    const confirm1 = contract.confirmDelivery(accounts.buyer, 1);
    expect(confirm1).toEqual({ ok: true, value: 1 });
    const confirm2 = contract.confirmDelivery(accounts.seller, 1);
    expect(confirm2).toEqual({ ok: true, value: 0 });
    const state = contract.getEscrowState(1);
    expect(state).toEqual({ ok: true, value: 3 });
    expect(contract.getStxBalance(accounts.seller)).toBe(1000);
    expect(contract.getReputationUpdate(accounts.seller)).toBe(100);
    expect(contract.getReputationUpdate(accounts.buyer)).toBe(50);
  });

  it("should timeout release to seller", () => {
    contract.createEscrow(accounts.buyer, 1, 1000, 10, "Desc", "Terms", accounts.seller);
    contract.activateEscrow(accounts.seller, 1);
    for (let i = 0; i < 11; i++) contract.incrementBlockHeight();
    const timeout = contract.timeoutRelease(1);
    expect(timeout).toEqual({ ok: true, value: 0 });
    expect(contract.getStxBalance(accounts.seller)).toBe(1000);
    expect(contract.getReputationUpdate(accounts.seller)).toBe(20);
  });
});