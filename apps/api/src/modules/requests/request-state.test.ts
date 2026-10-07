import { describe, expect, it } from "vitest";
import { canTransitionRequest } from "./request-state.js";

describe("request state machine", () => {
  it("allows the normal happy path", () => {
    expect(canTransitionRequest("DRAFT", "OPEN")).toBe(true);
    expect(canTransitionRequest("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canTransitionRequest("IN_PROGRESS", "IN_REVIEW")).toBe(true);
    expect(canTransitionRequest("IN_REVIEW", "APPROVED")).toBe(true);
    expect(canTransitionRequest("APPROVED", "CLOSED")).toBe(true);
  });

  it("supports correction without reopening approved requests", () => {
    expect(canTransitionRequest("IN_REVIEW", "IN_CORRECTION")).toBe(true);
    expect(canTransitionRequest("IN_CORRECTION", "IN_REVIEW")).toBe(true);
    expect(canTransitionRequest("CLOSED", "IN_CORRECTION")).toBe(false);
    expect(canTransitionRequest("APPROVED", "IN_CORRECTION")).toBe(false);
  });

  it("never reopens terminal states", () => {
    expect(canTransitionRequest("CLOSED", "OPEN")).toBe(false);
    expect(canTransitionRequest("CANCELLED", "OPEN")).toBe(false);
  });
});
