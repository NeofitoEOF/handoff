export type CalculationDefinition =
  | {
      op: "ADD" | "SUBTRACT" | "MULTIPLY";
      fields: string[];
    }
  | {
      op: "PERCENT";
      valueField: string;
      percentField: string;
    }
  | {
      op: "COLUMN_SUM";
      field: string;
    };

export type CalculatedFieldDefinition = {
  key: string;
  calculation?: CalculationDefinition | undefined;
};

function numeric(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function applyItemCalculations(
  data: Record<string, unknown>,
  fields: CalculatedFieldDefinition[],
): Record<string, unknown> {
  const next = { ...data };

  for (const field of fields) {
    const calculation = field.calculation;
    if (!calculation || calculation.op === "COLUMN_SUM") continue;

    if (calculation.op === "ADD") {
      next[field.key] = calculation.fields.reduce(
        (sum, key) => sum + numeric(next[key]),
        0,
      );
      continue;
    }

    if (calculation.op === "SUBTRACT") {
      const [first, ...rest] = calculation.fields;
      next[field.key] = rest.reduce(
        (result, key) => result - numeric(next[key]),
        numeric(first ? next[first] : 0),
      );
      continue;
    }

    if (calculation.op === "MULTIPLY") {
      next[field.key] = calculation.fields.reduce(
        (result, key) => result * numeric(next[key]),
        1,
      );
      continue;
    }

    if (calculation.op === "PERCENT") {
      next[field.key] =
        numeric(next[calculation.valueField]) *
        (numeric(next[calculation.percentField]) / 100);
    }
  }

  return next;
}

export function calculateColumnTotals(
  items: Array<Record<string, unknown>>,
  fields: CalculatedFieldDefinition[],
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const field of fields) {
    const calculation = field.calculation;
    if (calculation?.op !== "COLUMN_SUM") continue;

    totals[field.key] = items.reduce(
      (sum, item) => sum + numeric(item[calculation.field]),
      0,
    );
  }

  return totals;
}
