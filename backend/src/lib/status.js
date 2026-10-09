import { HttpError } from "./errors.js";

export const orderTransitions = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["completed", "returned"],
  completed: [],
  cancelled: [],
  returned: []
};

export const appointmentTransitions = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export const deliveryTransitions = {
  ready: ["assigned"],
  assigned: ["picked_up"],
  picked_up: ["in_transit"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  failed: []
};

export const returnTransitions = {
  requested: ["approved", "rejected"],
  approved: ["received"],
  rejected: [],
  received: ["refunded", "exchanged"],
  refunded: [],
  exchanged: []
};

export function assertTransition(flow, from, to) {
  if (!flow[from]?.includes(to)) {
    throw new HttpError(409, "INVALID_STATUS_TRANSITION", `Cannot change status from ${from} to ${to}`);
  }
}
