export type RequestStatus =
  | "DRAFT"
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_REASSIGNMENT"
  | "IN_REVIEW"
  | "IN_CORRECTION"
  | "APPROVED"
  | "CLOSED"
  | "CANCELLED";

const allowedTransitions: Record<RequestStatus, readonly RequestStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_REASSIGNMENT", "CANCELLED"],
  IN_PROGRESS: ["IN_REVIEW", "WAITING_REASSIGNMENT", "CANCELLED"],
  WAITING_REASSIGNMENT: ["IN_PROGRESS", "CANCELLED"],
  IN_REVIEW: ["IN_CORRECTION", "APPROVED", "CANCELLED"],
  IN_CORRECTION: ["IN_REVIEW", "WAITING_REASSIGNMENT", "CANCELLED"],
  APPROVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertRequestTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransitionRequest(from, to)) {
    throw new Error(`Invalid request transition: ${from} -> ${to}`);
  }
}
