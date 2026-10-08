import { applyItemCalculations, type CalculationDefinition } from "./calculations.js";

export type SectorFieldRole = "MANAGER" | "APPROVER" | "MEMBER";

export type AccessibleField = {
  key: string;
  visibleTo?: SectorFieldRole[] | undefined;
  readOnlyFor?: SectorFieldRole[] | undefined;
  calculation?: CalculationDefinition | undefined;
};

export type FieldViewer = {
  guest: boolean;
  privileged: boolean;
  roles: SectorFieldRole[];
};

export type ApprovalPolicy = {
  fieldKey: string;
  threshold: number;
};

const roles: SectorFieldRole[] = ["MANAGER", "APPROVER", "MEMBER"];

export function isSectorFieldRole(value: string): value is SectorFieldRole {
  return roles.includes(value as SectorFieldRole);
}

export function canSeeField(field: AccessibleField, viewer: FieldViewer): boolean {
  if (field.visibleTo === undefined) return true;
  if (viewer.privileged) return true;
  if (viewer.guest || field.visibleTo.length === 0) return false;
  return viewer.roles.some((role) => field.visibleTo?.includes(role));
}

export function canEditField(field: AccessibleField, viewer: FieldViewer): boolean {
  if (field.calculation && field.calculation.op !== "COLUMN_SUM") return false;
  if (!canSeeField(field, viewer)) return false;
  if (viewer.privileged && viewer.roles.length === 0 && !viewer.guest) return false;
  const locked = field.readOnlyFor ?? [];
  if (locked.length === 0) return true;
  if (viewer.guest) return !locked.includes("MEMBER");
  if (viewer.roles.length === 0) return false;
  return viewer.roles.some((role) => !locked.includes(role));
}

export function fieldsForEntry<T extends AccessibleField>(fields: T[], viewer: FieldViewer): T[] {
  return fields.filter((field) => canEditField(field, viewer));
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty && rightEmpty) return true;
  return String(left) === String(right);
}

export function prepareItemData(input: {
  existing: Record<string, unknown>;
  incoming: Record<string, unknown>;
  fields: AccessibleField[];
  viewer: FieldViewer;
}): { ok: true; data: Record<string, unknown> } | { ok: false; fields: string[] } {
  const locked: string[] = [];
  const next: Record<string, unknown> = { ...input.existing };

  for (const [key, value] of Object.entries(input.incoming)) {
    const field = input.fields.find((candidate) => candidate.key === key);
    if (!field) {
      if (!sameValue(input.existing[key], value)) locked.push(key);
      continue;
    }
    if (!canEditField(field, input.viewer)) {
      if (!sameValue(input.existing[key], value)) locked.push(key);
      continue;
    }
    next[key] = value;
  }

  if (locked.length > 0) return { ok: false, fields: locked };
  return {
    ok: true,
    data: applyItemCalculations(next, input.fields),
  };
}

export function redactData(
  data: Record<string, unknown>,
  fields: AccessibleField[],
  viewer: FieldViewer,
): Record<string, unknown> {
  const hidden = new Set(
    fields.filter((field) => !canSeeField(field, viewer)).map((field) => field.key),
  );
  if (hidden.size === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !hidden.has(key)));
}

export function presentFields<T extends AccessibleField>(fields: T[], viewer: FieldViewer): Array<T & { readOnly: boolean }> {
  return fields
    .filter((field) => canSeeField(field, viewer))
    .map((field) => ({ ...field, readOnly: !canEditField(field, viewer) }));
}

export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!trimmed) return null;

  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  const normalized = lastComma >= 0 && lastComma > lastDot
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : lastDot >= 0 && lastDot > lastComma && lastComma >= 0
      ? trimmed.replace(/,/g, "")
      : trimmed.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

export function requiredApprovals(
  policy: ApprovalPolicy | null | undefined,
  data: Record<string, unknown>,
): 1 | 2 {
  if (!policy) return 1;
  const amount = parseAmount(data[policy.fieldKey]);
  if (amount === null) return 2;
  return amount > policy.threshold ? 2 : 1;
}

export function readApprovalPolicy(schema: unknown): ApprovalPolicy | null {
  if (!schema || typeof schema !== "object" || !("approvalPolicy" in schema)) return null;
  const policy = (schema as { approvalPolicy?: unknown }).approvalPolicy;
  if (!policy || typeof policy !== "object") return null;
  const fieldKey = "fieldKey" in policy ? policy.fieldKey : undefined;
  const threshold = "threshold" in policy ? policy.threshold : undefined;
  if (typeof fieldKey !== "string" || !fieldKey.trim()) return null;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0) return null;
  return { fieldKey, threshold };
}

function parseRoleList(value: unknown): SectorFieldRole[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.filter((role): role is SectorFieldRole => typeof role === "string" && isSectorFieldRole(role));
}

export function readSchemaFields(schema: unknown): AccessibleField[] {
  if (!schema || typeof schema !== "object" || !("fields" in schema)) return [];
  const fields = (schema as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];

  return fields.flatMap((field) => {
    if (!field || typeof field !== "object" || !("key" in field) || typeof field.key !== "string") return [];
    const source = field as AccessibleField;
    return [{
      ...source,
      visibleTo: parseRoleList(source.visibleTo),
      readOnlyFor: parseRoleList(source.readOnlyFor),
    }];
  });
}
