import { describe, expect, it } from "vitest";
import { calculateSettlementAmounts } from "../src/lib/settlement.js";

describe("calculateSettlementAmounts", () => {
  it("pays full distributable amount when positive", () => {
    const result = calculateSettlementAmounts(1000.5, 250.25);

    expect(result.distributableAmount).toBe(750.25);
    expect(result.paidAmount).toBe(750.25);
    expect(result.carryForwardAmount).toBe(0);
    expect(result.cumulativeSettledAmount).toBe(1000.5);
  });

  it("does not pay when distributable is zero", () => {
    const result = calculateSettlementAmounts(500, 500);

    expect(result.distributableAmount).toBe(0);
    expect(result.paidAmount).toBe(0);
    expect(result.carryForwardAmount).toBe(0);
    expect(result.cumulativeSettledAmount).toBe(500);
  });

  it("carries forward deficit when distributable is negative", () => {
    const result = calculateSettlementAmounts(300, 500.5);

    expect(result.distributableAmount).toBe(-200.5);
    expect(result.paidAmount).toBe(0);
    expect(result.carryForwardAmount).toBe(200.5);
    expect(result.cumulativeSettledAmount).toBe(500.5);
  });

  it("reserves part of positive distributable amount by carry ratio", () => {
    const result = calculateSettlementAmounts(1000, 500, 0.2);

    expect(result.distributableAmount).toBe(500);
    expect(result.paidAmount).toBe(400);
    expect(result.carryForwardAmount).toBe(100);
    expect(result.cumulativeSettledAmount).toBe(900);
  });

  it("clamps invalid carry ratio into safe range", () => {
    const result = calculateSettlementAmounts(1000, 500, 2);

    expect(result.distributableAmount).toBe(500);
    expect(result.paidAmount).toBe(0);
    expect(result.carryForwardAmount).toBe(500);
    expect(result.cumulativeSettledAmount).toBe(500);
  });
});
