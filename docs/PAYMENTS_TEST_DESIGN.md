# Payment Core Domain Test Design

**Status:** Implementation Ready
**Purpose:** Comprehensive test fixtures and unit test design for core/payments domain logic
**Scope:** Unit tests only - no I/O, no external dependencies, deterministic

---

## Test Philosophy (from tests/AGENTS.md)

**Unit Test Standards:**

- No I/O, no time, no RNG
- Test pure functions and business rules only
- Use deterministic inputs and expected outputs
- Use \_fakes for controllable test doubles

**From tests/unit/core/AGENTS.md:**

- Focus on testing business invariants and domain rules
- Keep tests isolated from infrastructure concerns
- May import: core only
- Must not import: ports, adapters, features, app

---

## Test Fixtures Design

### Location: `tests/_fakes/payments/`

Following the pattern from `tests/_fakes/ai/message-builders.ts`, create payment domain builders:

**File: `tests/_fakes/payments/payment-builders.ts`**

```typescript
/**
 * Builder functions for creating test PaymentAttempt data
 * Provides deterministic test data with sensible defaults
 * Supports partial overrides for specific test scenarios
 */

import type {
  PaymentAttempt,
  PaymentAttemptStatus,
} from "@/core/payments/model";

export interface PaymentAttemptOptions {
  id?: string;
  billingAccountId?: string;
  fromAddress?: string;
  chainId?: number;
  token?: string;
  toAddress?: string;
  amountRaw?: bigint;
  amountUsdCents?: number;
  status?: PaymentAttemptStatus;
  txHash?: string | null;
  errorCode?: string | null;
  expiresAt?: Date | null;
  submittedAt?: Date | null;
  lastVerifyAttemptAt?: Date | null;
  verifyAttemptCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Creates a PaymentAttempt with deterministic defaults
 * All fields can be overridden via options
 */
export function createPaymentAttempt(
  options: PaymentAttemptOptions = {}
): PaymentAttempt;

/**
 * Creates a PaymentAttempt in CREATED_INTENT state
 * Includes expiresAt, no txHash
 */
export function createIntentAttempt(
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;

/**
 * Creates a PaymentAttempt in PENDING_UNVERIFIED state
 * Includes txHash, submittedAt, no expiresAt
 */
export function createPendingAttempt(
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;

/**
 * Creates a PaymentAttempt in CREDITED state (terminal)
 */
export function createCreditedAttempt(
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;

/**
 * Creates a PaymentAttempt in REJECTED state (terminal)
 * Includes errorCode
 */
export function createRejectedAttempt(
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;

/**
 * Creates a PaymentAttempt in FAILED state (terminal)
 * Includes errorCode
 */
export function createFailedAttempt(
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;

/**
 * Creates an expired intent attempt
 * expiresAt is in the past relative to provided time
 */
export function createExpiredIntent(
  now: Date,
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;

/**
 * Creates a timed-out pending attempt
 * submittedAt is >24h ago relative to provided time
 */
export function createTimedOutPending(
  now: Date,
  options?: Partial<PaymentAttemptOptions>
): PaymentAttempt;
```

**File: `tests/_fakes/payments/fakes.ts`** (barrel export)

```typescript
/**
 * Barrel export for payment test fakes
 */
export * from "./payment-builders";
```

**Update: `tests/_fakes/index.ts`**

Add:

```typescript
export * from "./payments/fakes";
```

---

## Unit Test Design

### Location: `tests/unit/core/payments/`

Following patterns from `tests/unit/core/chat/rules.test.ts` and `tests/unit/core/billing/pricing.test.ts`

---

### File: `tests/unit/core/payments/rules.test.ts`

**Test Coverage Matrix:**

#### 1. `isValidTransition()` - State Machine Validation

**Test Cases:**

| From State         | To State           | Expected | Scenario              |
| ------------------ | ------------------ | -------- | --------------------- |
| CREATED_INTENT     | CREATED_INTENT     | false    | Self-transition       |
| CREATED_INTENT     | PENDING_UNVERIFIED | true     | Submit txHash         |
| CREATED_INTENT     | FAILED             | true     | Intent expiration     |
| CREATED_INTENT     | CREDITED           | false    | Skip verification     |
| CREATED_INTENT     | REJECTED           | false    | Invalid               |
| PENDING_UNVERIFIED | PENDING_UNVERIFIED | false    | Self-transition       |
| PENDING_UNVERIFIED | CREDITED           | true     | Verification success  |
| PENDING_UNVERIFIED | REJECTED           | true     | Verification failure  |
| PENDING_UNVERIFIED | FAILED             | true     | TX reverted / timeout |
| PENDING_UNVERIFIED | CREATED_INTENT     | false    | Backward transition   |
| CREDITED           | \*                 | false    | Terminal state        |
| REJECTED           | \*                 | false    | Terminal state        |
| FAILED             | \*                 | false    | Terminal state        |

**Organize as:**

- Describe "Valid transitions from CREATED_INTENT"
- Describe "Valid transitions from PENDING_UNVERIFIED"
- Describe "Terminal states prevent all transitions"
- Describe "Self-transitions are always invalid"

---

#### 2. `isTerminalState()` - Terminal State Detection

**Test Cases:**

- CREDITED → true
- REJECTED → true
- FAILED → true
- CREATED_INTENT → false
- PENDING_UNVERIFIED → false

---

#### 3. `toClientVisibleStatus()` - Status Mapping

**Test Cases:**

| Internal Status    | Client-Visible Status | Notes                               |
| ------------------ | --------------------- | ----------------------------------- |
| CREATED_INTENT     | PENDING_VERIFICATION  | Intent created, awaiting submission |
| PENDING_UNVERIFIED | PENDING_VERIFICATION  | Submitted, awaiting verification    |
| CREDITED           | CONFIRMED             | Success                             |
| REJECTED           | FAILED                | Verification failed                 |
| FAILED             | FAILED                | TX reverted or expired              |

**Organize as:**

- Describe "Maps CREATED_INTENT and PENDING_UNVERIFIED to PENDING_VERIFICATION"
- Describe "Maps CREDITED to CONFIRMED"
- Describe "Maps REJECTED and FAILED to FAILED"

---

#### 4. `isValidPaymentAmount()` - Amount Bounds Validation

**Test Cases:**

| Input     | Expected | Scenario                       |
| --------- | -------- | ------------------------------ |
| 100       | true     | Minimum valid ($1.00)          |
| 1_000_000 | true     | Maximum valid ($10,000.00)     |
| 99        | false    | Below minimum                  |
| 1_000_001 | false    | Above maximum                  |
| 500       | true     | Mid-range                      |
| 100.5     | false    | Non-integer (fractional cents) |
| -100      | false    | Negative                       |
| 0         | false    | Zero                           |
| NaN       | false    | Not a number                   |
| Infinity  | false    | Infinity                       |

**Organize as:**

- Describe "Accepts valid amounts within bounds"
- Describe "Rejects amounts below minimum"
- Describe "Rejects amounts above maximum"
- Describe "Rejects non-integer amounts"
- Describe "Rejects invalid numeric values"

---

#### 5. `isIntentExpired()` - Intent Expiration Logic

**Test Cases using FakeClock:**

| Scenario             | expiresAt | now     | status             | Expected | Notes                          |
| -------------------- | --------- | ------- | ------------------ | -------- | ------------------------------ |
| Not expired          | T+30min   | T+10min | CREATED_INTENT     | false    | Within TTL                     |
| Exactly expired      | T+30min   | T+30min | CREATED_INTENT     | true     | Boundary                       |
| Just before expiry   | T+30min   | T+29:59 | CREATED_INTENT     | false    | Boundary                       |
| Just after expiry    | T+30min   | T+30:01 | CREATED_INTENT     | true     | Boundary                       |
| Way past expiry      | T+30min   | T+2h    | CREATED_INTENT     | false    | Already should be FAILED       |
| Wrong state PENDING  | T+30min   | T+10min | PENDING_UNVERIFIED | false    | Only applies to CREATED_INTENT |
| Wrong state CREDITED | T+30min   | T+10min | CREDITED           | false    | Terminal state                 |
| No expiresAt         | null      | T+10min | CREATED_INTENT     | false    | Edge case                      |

**Organize as:**

- Describe "Detects expired intents"
- Describe "Handles boundary conditions (exact TTL, just before/after)"
- Describe "Only applies to CREATED_INTENT state"
- Describe "Returns false for null expiresAt"

---

#### 6. `isVerificationTimedOut()` - Pending Timeout Logic

**Test Cases using FakeClock:**

| Scenario             | submittedAt | now        | status             | Expected | Notes                              |
| -------------------- | ----------- | ---------- | ------------------ | -------- | ---------------------------------- |
| Within timeout       | T           | T+1h       | PENDING_UNVERIFIED | false    | < 24h                              |
| Exactly timed out    | T           | T+24h      | PENDING_UNVERIFIED | true     | Boundary                           |
| Just before timeout  | T           | T+23:59:59 | PENDING_UNVERIFIED | false    | Boundary                           |
| Just after timeout   | T           | T+24:00:01 | PENDING_UNVERIFIED | true     | Boundary                           |
| Way past timeout     | T           | T+48h      | PENDING_UNVERIFIED | true     | Should be FAILED                   |
| Wrong state CREATED  | T           | T+1h       | CREATED_INTENT     | false    | Only applies to PENDING_UNVERIFIED |
| Wrong state CREDITED | T           | T+25h      | CREDITED           | false    | Terminal state                     |
| No submittedAt       | null        | T+1h       | PENDING_UNVERIFIED | false    | Edge case                          |

**Organize as:**

- Describe "Detects timed out verifications"
- Describe "Handles boundary conditions (exact 24h, just before/after)"
- Describe "Only applies to PENDING_UNVERIFIED state"
- Describe "Returns false for null submittedAt"

---

#### 7. Constants Export

**Test Cases:**

- MIN_PAYMENT_CENTS === 100
- MAX_PAYMENT_CENTS === 1_000_000
- PAYMENT*INTENT_TTL_MS === 30 * 60 \_ 1000
- PENDING*UNVERIFIED_TTL_MS === 24 * 60 \_ 60 \* 1000

---

### File: `tests/unit/core/payments/util.test.ts`

**Test Coverage:**

#### 1. `usdCentsToRawUsdc()` - Conversion to Raw USDC

**Test Cases:**

| USD Cents | Raw USDC (bigint) | Notes          |
| --------- | ----------------- | -------------- |
| 100       | 1_000_000n        | $1.00 = 1 USDC |
| 1_000_000 | 10_000_000_000n   | $10,000 max    |
| 1         | 10_000n           | 1 cent         |
| 500       | 5_000_000n        | $5.00          |
| 0         | 0n                | Zero           |

**Formula verification:**

- amountRaw = amountUsdCents × 10,000
- 1 USDC = 1,000,000 raw units (6 decimals)
- 1 USD = 100 cents
- Therefore: 1 cent = 10,000 raw units

---

#### 2. `rawUsdcToUsdCents()` - Conversion from Raw USDC

**Test Cases:**

| Raw USDC (bigint) | USD Cents | Notes          |
| ----------------- | --------- | -------------- |
| 1_000_000n        | 100       | 1 USDC = $1.00 |
| 10_000_000_000n   | 1_000_000 | $10,000 max    |
| 10_000n           | 1         | 1 cent         |
| 5_000_000n        | 500       | $5.00          |
| 0n                | 0         | Zero           |

---

#### 3. Roundtrip Tests - Conversion Consistency

**Test Cases:**

For each test value:

- Forward: `cents → raw → cents`
- Backward: `raw → cents → raw`
- Both should return original value

**Test Values:**

- 100 cents ($1.00 minimum)
- 1_000_000 cents ($10,000 maximum)
- 1 cent (minimum granularity)
- 500 cents ($5.00 typical)
- 12345 cents ($123.45 arbitrary)

**Important:** Tests should verify no precision loss in roundtrips

---

## Deterministic Time Testing

Use `FakeClock` from `tests/_fakes/fake-clock.ts` for all time-dependent tests:

```typescript
import { FakeClock } from "@tests/_fakes";

describe("Time-dependent tests", () => {
  const clock = new FakeClock("2025-01-01T00:00:00.000Z");

  it("should check expiration", () => {
    const now = new Date(clock.now());
    const attempt = createIntentAttempt({
      expiresAt: new Date(clock.now()),
    });

    clock.advance(PAYMENT_INTENT_TTL_MS + 1);
    const later = new Date(clock.now());

    expect(isIntentExpired(attempt, later)).toBe(true);
  });
});
```

---

## Test File Organization

**Directory structure:**

```
tests/
├── _fakes/
│   ├── payments/
│   │   ├── payment-builders.ts    # PaymentAttempt builders
│   │   └── fakes.ts               # Barrel export
│   └── index.ts                    # Re-export payments fakes
└── unit/
    └── core/
        └── payments/
            ├── rules.test.ts       # State machine & validation tests
            └── util.test.ts        # Conversion utility tests
```

---

## Non-Blocking Nits (from feedback)

### 1. Constant Reuse in shared/web3/chain.ts

**Current:** `shared/web3/chain.ts` may redefine payment constants

**Action:** Ensure it imports from core:

```typescript
// In src/shared/web3/chain.ts
import { MIN_PAYMENT_CENTS, MAX_PAYMENT_CENTS } from "@/core/payments/rules";

// Use these instead of redefining
```

**Rationale:** Single source of truth for domain constants

---

### 2. Public API Export Consistency

**Current:** Payment types may be exported from both:

- `src/core/payments/public.ts`
- `src/core/public.ts`

**Action:** Consider exporting Payment\* types ONLY via:

```
src/core/payments/public.ts → src/core/public.ts
```

**Not both entry points independently**

**Rationale:** Avoid confusion about canonical import path

---

## Test Execution

**Run tests:**

```bash
pnpm test tests/unit/core/payments
```

**Expected output:**

- All state transitions covered
- All boundary conditions tested
- All conversion roundtrips verified
- No I/O, no external dependencies
- Deterministic, repeatable results

---

## Success Criteria

✅ **Coverage:**

- isValidTransition: all state pairs tested
- isTerminalState: all states tested
- toClientVisibleStatus: all states tested
- isValidPaymentAmount: boundaries + invalid inputs
- isIntentExpired: boundaries + edge cases
- isVerificationTimedOut: boundaries + edge cases
- Conversion utils: roundtrips verified

✅ **Principles:**

- No I/O (pure functions only)
- Deterministic time (FakeClock)
- No external dependencies
- Follows existing test patterns

✅ **Nits addressed:**

- Constants reused from core
- Public API export consistency checked

---

## Related Documentation

- [PAYMENTS_DESIGN.md](PAYMENTS_DESIGN.md) - MVP spec
- [TESTING.md](TESTING.md) - Test strategy
- [AGENTS.md](../AGENTS.md) - Workflow principles
- [tests/AGENTS.md](../tests/AGENTS.md) - Test layer boundaries
- [tests/unit/core/AGENTS.md](../tests/unit/core/AGENTS.md) - Core unit test standards
