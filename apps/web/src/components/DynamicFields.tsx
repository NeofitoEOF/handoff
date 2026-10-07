import type { TemplateSchema } from "../types";

export function DynamicFields({
  schema,
  value,
  onChange,
  disabled = false,
}: {
  schema: TemplateSchema;
  value: Record<string, unknown>;
  onChange(next: Record<string, unknown>): void;
  disabled?: boolean;
}) {
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });

  return (
    <div className="field-grid">
      {schema.fields.map((field) => {
        const current = value[field.key] ?? "";

        if (field.type === "BOOLEAN") {
          return (
            <label className="field checkbox-field" key={field.key}>
              <input
                type="checkbox"
                checked={Boolean(current)}
                onChange={(event) => set(field.key, event.target.checked)}
                disabled={disabled}
              />
              <span>{field.label}{field.required ? " *" : ""}</span>
            </label>
          );
        }

        if (field.type === "SELECT") {
          return (
            <label className="field" key={field.key}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              <select
                value={String(current)}
                required={field.required}
                disabled={disabled}
                onChange={(event) => set(field.key, event.target.value)}
              >
                <option value="">Selecione</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          );
        }

        const inputType =
          field.type === "DATE"
            ? "date"
            : field.type === "NUMBER" || field.type === "MONEY"
              ? "number"
              : "text";

        return (
          <label className="field" key={field.key}>
            <span>{field.label}{field.required ? " *" : ""}</span>
            <input
              type={inputType}
              value={String(current)}
              required={field.required}
              min={field.min}
              max={field.max}
              disabled={disabled}
              onChange={(event) => {
                if (field.type === "NUMBER" || field.type === "MONEY") {
                  set(field.key, event.target.value === "" ? "" : Number(event.target.value));
                } else {
                  set(field.key, event.target.value);
                }
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
