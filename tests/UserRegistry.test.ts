// UserRegistry.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T; // Adjusted to avoid number union for read-only responses
}

interface ErrorResponse {
  ok: boolean;
  value: number; // For error codes
}

interface UserProfile {
  role: number;
  profile: string;
  location: Uint8Array;
  reputation: number;
  registrationTime: number;
  lastActive: number;
  status: number;
  verificationLevel: number;
}

interface UserActivity {
  activityType: number;
  timestamp: number;
  referenceId: number;
}

interface AuthHints {
  hint1: Uint8Array;
  hint2: Uint8Array;
}

interface Collaborator {
  permissionLevel: number;
  addedAt: number;
}

interface ContractState {
  users: Map<string, UserProfile>;
  userActivities: Map<string, UserActivity>; // Key: `${user}_${index}`
  userAuthHints: Map<string, AuthHints>;
  userCollaborators: Map<string, Collaborator>; // Key: `${user}_${collaborator}`
  blockHeight: number;
}

class UserRegistryMock {
  private state: ContractState = {
    users: new Map(),
    userActivities: new Map(),
    userAuthHints: new Map(),
    userCollaborators: new Map(),
    blockHeight: 0,
  };

  private ERR_ALREADY_REGISTERED = 100;
  private ERR_NOT_OWNER = 101;
  private ERR_INVALID_ROLE = 102;
  private ERR_INVALID_INPUT = 103;
  private ERR_NOT_REGISTERED = 104;
  private ERR_REPUTATION_OVERFLOW = 105;
  private ERR_INVALID_STATUS = 106;
  private ERR_MAX_ACTIVITIES_REACHED = 107;
  private MAX_PROFILE_LENGTH = 256;
  private MAX_ACTIVITIES = 50;
  private ROLE_PROVIDER = 1;
  private ROLE_CONSUMER = 2;
  private ROLE_ARBITRATOR = 3;
  private STATUS_ACTIVE = 1;
  private STATUS_SUSPENDED = 2;
  private STATUS_BANNED = 3;

  private isValidRole(role: number): boolean {
    return role === this.ROLE_PROVIDER || role === this.ROLE_CONSUMER || role === this.ROLE_ARBITRATOR;
  }

  private isValidStatus(status: number): boolean {
    return status === this.STATUS_ACTIVE || status === this.STATUS_SUSPENDED || status === this.STATUS_BANNED;
  }

  private getUserActivityCount(user: string): number {
    let count = 0;
    for (let i = 0; i < this.MAX_ACTIVITIES; i++) {
      if (this.state.userActivities.has(`${user}_${i}`)) {
        count++;
      }
    }
    return count;
  }

  registerUser(user: string, role: number, profile: string, location: Uint8Array): ErrorResponse {
    if (!this.isValidRole(role)) return { ok: false, value: this.ERR_INVALID_ROLE };
    if (profile.length > this.MAX_PROFILE_LENGTH) return { ok: false, value: this.ERR_INVALID_INPUT };
    if (this.state.users.has(user)) return { ok: false, value: this.ERR_ALREADY_REGISTERED };

    this.state.users.set(user, {
      role,
      profile,
      location,
      reputation: 5000,
      registrationTime: this.state.blockHeight,
      lastActive: this.state.blockHeight,
      status: this.STATUS_ACTIVE,
      verificationLevel: 0,
    });
    return { ok: true, value: 0 };
  }

  updateProfile(user: string, newProfile: string, newLocation: Uint8Array): ErrorResponse {
    const userProfile = this.state.users.get(user);
    if (!userProfile) return { ok: false, value: this.ERR_NOT_REGISTERED };
    if (newProfile.length > this.MAX_PROFILE_LENGTH) return { ok: false, value: this.ERR_INVALID_INPUT };

    this.state.users.set(user, { ...userProfile, profile: newProfile, location: newLocation, lastActive: this.state.blockHeight });
    return { ok: true, value: 0 };
  }

  setAuthHints(user: string, hint1: Uint8Array, hint2: Uint8Array): ErrorResponse {
    if (!this.state.users.has(user)) return { ok: false, value: this.ERR_NOT_REGISTERED };
    this.state.userAuthHints.set(user, { hint1, hint2 });
    return { ok: true, value: 0 };
  }

  addCollaborator(user: string, collaborator: string, permissionLevel: number): ErrorResponse {
    if (!this.state.users.has(user)) return { ok: false, value: this.ERR_NOT_REGISTERED };
    if (permissionLevel > 3) return { ok: false, value: this.ERR_INVALID_INPUT };
    if (this.state.userCollaborators.has(`${user}_${collaborator}`)) return { ok: false, value: this.ERR_ALREADY_REGISTERED };

    this.state.userCollaborators.set(`${user}_${collaborator}`, { permissionLevel, addedAt: this.state.blockHeight });
    return { ok: true, value: 0 };
  }

  removeCollaborator(user: string, collaborator: string): ErrorResponse {
    if (!this.state.users.has(user)) return { ok: false, value: this.ERR_NOT_REGISTERED };
    if (!this.state.userCollaborators.has(`${user}_${collaborator}`)) return { ok: false, value: this.ERR_NOT_REGISTERED };

    this.state.userCollaborators.delete(`${user}_${collaborator}`);
    return { ok: true, value: 0 };
  }

  updateReputation(user: string, target: string, delta: number): ClarityResponse<number> {
    const entry = this.state.users.get(target);
    if (!entry) return { ok: false, value: this.ERR_NOT_REGISTERED };

    let newRep = entry.reputation + delta;
    if (newRep > 10000 || newRep < 0) return { ok: false, value: this.ERR_REPUTATION_OVERFLOW };

    this.state.users.set(target, { ...entry, reputation: newRep });
    return { ok: true, value: newRep };
  }

  updateStatus(arbitrator: string, target: string, newStatus: number): ErrorResponse {
    const callerEntry = this.state.users.get(arbitrator);
    if (!callerEntry) return { ok: false, value: this.ERR_NOT_REGISTERED };
    const targetProfile = this.state.users.get(target);
    if (!targetProfile) return { ok: false, value: this.ERR_NOT_REGISTERED };
    if (callerEntry.role !== this.ROLE_ARBITRATOR) return { ok: false, value: this.ERR_NOT_OWNER };
    if (!this.isValidStatus(newStatus)) return { ok: false, value: this.ERR_INVALID_STATUS };

    this.state.users.set(target, { ...targetProfile, status: newStatus, lastActive: this.state.blockHeight });
    return { ok: true, value: 0 };
  }

  logActivity(user: string, activityType: number, referenceId: number): ErrorResponse {
    const userProfile = this.state.users.get(user);
    if (!userProfile) return { ok: false, value: this.ERR_NOT_REGISTERED };
    const count = this.getUserActivityCount(user);
    if (count >= this.MAX_ACTIVITIES) return { ok: false, value: this.ERR_MAX_ACTIVITIES_REACHED };

    this.state.userActivities.set(`${user}_${count}`, { activityType, timestamp: this.state.blockHeight, referenceId });
    this.state.users.set(user, { ...userProfile, lastActive: this.state.blockHeight });
    return { ok: true, value: 0 };
  }

  upgradeVerification(user: string, newLevel: number): ErrorResponse {
    const userProfile = this.state.users.get(user);
    if (!userProfile) return { ok: false, value: this.ERR_NOT_REGISTERED };
    if (newLevel <= userProfile.verificationLevel || newLevel > 2) return { ok: false, value: this.ERR_INVALID_INPUT };

    this.state.users.set(user, { ...userProfile, verificationLevel: newLevel });
    return { ok: true, value: 0 };
  }

  getUser(user: string): ClarityResponse<UserProfile | null> {
    return { ok: true, value: this.state.users.get(user) ?? null };
  }

  getUserAuthHints(user: string): ClarityResponse<AuthHints | null> {
    return { ok: true, value: this.state.userAuthHints.get(user) ?? null };
  }

  getCollaborator(user: string, collaborator: string): ClarityResponse<Collaborator | null> {
    return { ok: true, value: this.state.userCollaborators.get(`${user}_${collaborator}`) ?? null };
  }

  getActivity(user: string, index: number): ClarityResponse<UserActivity | null> {
    return { ok: true, value: this.state.userActivities.get(`${user}_${index}`) ?? null };
  }

  isRegistered(user: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.users.has(user) };
  }

  hasRole(user: string, role: number): ClarityResponse<boolean> {
    const entry = this.state.users.get(user);
    return { ok: true, value: entry ? entry.role === role : false };
  }

  getReputation(user: string): ClarityResponse<number> {
    const entry = this.state.users.get(user);
    if (!entry) return { ok: false, value: this.ERR_NOT_REGISTERED };
    return { ok: true, value: entry.reputation };
  }

  getStatus(user: string): ClarityResponse<number> {
    const entry = this.state.users.get(user);
    if (!entry) return { ok: false, value: this.ERR_NOT_REGISTERED };
    return { ok: true, value: entry.status };
  }

  // Simulate block height increase for testing
  incrementBlockHeight() {
    this.state.blockHeight++;
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  provider: "wallet_1",
  consumer: "wallet_2",
  arbitrator: "wallet_3",
};

describe("UserRegistry Contract", () => {
  let contract: UserRegistryMock;

  beforeEach(() => {
    contract = new UserRegistryMock();
  });

  it("should register a new user as provider", () => {
    const result = contract.registerUser(accounts.provider, 1, "Provider bio", new Uint8Array(32));
    expect(result).toEqual({ ok: true, value: 0 });
    const user = contract.getUser(accounts.provider);
    expect(user.ok).toBe(true);
    expect(user.value).not.toBeNull();
    if (user.value) {
      expect(user.value.role).toBe(1);
      expect(user.value.reputation).toBe(5000);
    }
  });

  it("should prevent duplicate registration", () => {
    contract.registerUser(accounts.provider, 1, "Bio", new Uint8Array(32));
    const duplicate = contract.registerUser(accounts.provider, 1, "New bio", new Uint8Array(32));
    expect(duplicate).toEqual({ ok: false, value: 100 });
  });

  it("should update profile", () => {
    contract.registerUser(accounts.consumer, 2, "Old bio", new Uint8Array(32));
    const update = contract.updateProfile(accounts.consumer, "New bio", new Uint8Array(32).fill(1));
    expect(update).toEqual({ ok: true, value: 0 });
    const user = contract.getUser(accounts.consumer);
    expect(user.ok).toBe(true);
    expect(user.value).not.toBeNull();
    if (user.value) {
      expect(user.value.profile).toBe("New bio");
    }
  });

  it("should set auth hints", () => {
    contract.registerUser(accounts.consumer, 2, "Bio", new Uint8Array(32));
    const setHints = contract.setAuthHints(accounts.consumer, new Uint8Array(64), new Uint8Array(64).fill(1));
    expect(setHints).toEqual({ ok: true, value: 0 });
    const hints = contract.getUserAuthHints(accounts.consumer);
    expect(hints.ok).toBe(true);
    expect(hints.value).not.toBeNull();
    if (hints.value) {
      expect(hints.value.hint2[0]).toBe(1);
    }
  });

  it("should add and remove collaborator", () => {
    contract.registerUser(accounts.provider, 1, "Bio", new Uint8Array(32));
    const add = contract.addCollaborator(accounts.provider, accounts.consumer, 2);
    expect(add).toEqual({ ok: true, value: 0 });
    const collab = contract.getCollaborator(accounts.provider, accounts.consumer);
    expect(collab.ok).toBe(true);
    expect(collab.value).not.toBeNull();
    if (collab.value) {
      expect(collab.value.permissionLevel).toBe(2);
    }

    const remove = contract.removeCollaborator(accounts.provider, accounts.consumer);
    expect(remove).toEqual({ ok: true, value: 0 });
    const removedCollab = contract.getCollaborator(accounts.provider, accounts.consumer);
    expect(removedCollab.ok).toBe(true);
    expect(removedCollab.value).toBeNull();
  });

  it("should update reputation", () => {
    contract.registerUser(accounts.consumer, 2, "Bio", new Uint8Array(32));
    const update = contract.updateReputation(accounts.consumer, accounts.consumer, 1000);
    expect(update).toEqual({ ok: true, value: 6000 });
    const rep = contract.getReputation(accounts.consumer);
    expect(rep).toEqual({ ok: true, value: 6000 });
  });

  it("should prevent reputation overflow", () => {
    contract.registerUser(accounts.consumer, 2, "Bio", new Uint8Array(32));
    const overflow = contract.updateReputation(accounts.consumer, accounts.consumer, 6000);
    expect(overflow).toEqual({ ok: false, value: 105 });
  });

  it("should update status by arbitrator", () => {
    contract.registerUser(accounts.arbitrator, 3, "Arb bio", new Uint8Array(32));
    contract.registerUser(accounts.consumer, 2, "Bio", new Uint8Array(32));
    const update = contract.updateStatus(accounts.arbitrator, accounts.consumer, 2);
    expect(update).toEqual({ ok: true, value: 0 });
    const status = contract.getStatus(accounts.consumer);
    expect(status).toEqual({ ok: true, value: 2 });
  });

  it("should prevent non-arbitrator from updating status", () => {
    contract.registerUser(accounts.consumer, 2, "Bio", new Uint8Array(32));
    const update = contract.updateStatus(accounts.consumer, accounts.consumer, 2);
    expect(update).toEqual({ ok: false, value: 101 });
  });

  it("should log activities up to max", () => {
    contract.registerUser(accounts.provider, 1, "Bio", new Uint8Array(32));
    for (let i = 0; i < 50; i++) {
      contract.incrementBlockHeight();
      const log = contract.logActivity(accounts.provider, 1, i);
      expect(log).toEqual({ ok: true, value: 0 });
    }
    const over = contract.logActivity(accounts.provider, 1, 50);
    expect(over).toEqual({ ok: false, value: 107 });
  });

  it("should upgrade verification level", () => {
    contract.registerUser(accounts.consumer, 2, "Bio", new Uint8Array(32));
    const upgrade = contract.upgradeVerification(accounts.consumer, 1);
    expect(upgrade).toEqual({ ok: true, value: 0 });
    const user = contract.getUser(accounts.consumer);
    expect(user.ok).toBe(true);
    expect(user.value).not.toBeNull();
    if (user.value) {
      expect(user.value.verificationLevel).toBe(1);
    }
  });
});