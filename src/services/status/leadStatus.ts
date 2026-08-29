export const LEAD_STATUS = {
  IMPORTED: 1,
  REVIEW: 2,
  NO_CONTACT: 3,
  QUEUED: 4,
  SENT: 5,
  INVALID: 6,
  DUPLICATE: 7,
} as const;

export type LeadStatusId = typeof LEAD_STATUS[keyof typeof LEAD_STATUS];

export const FINAL_LEAD_STATUS_IDS = [
  LEAD_STATUS.NO_CONTACT,
  LEAD_STATUS.SENT,
  LEAD_STATUS.INVALID,
  LEAD_STATUS.DUPLICATE,
] as const;

export function isFinalLeadStatusId(value: unknown): value is typeof FINAL_LEAD_STATUS_IDS[number] {
  return FINAL_LEAD_STATUS_IDS.includes(Number(value) as typeof FINAL_LEAD_STATUS_IDS[number]);
}
