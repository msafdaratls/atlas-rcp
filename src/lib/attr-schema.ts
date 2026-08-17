export type AttrField = {
  key: string;
  type: string;
  enum?: string[];
  titleEn: string;
  titleAr: string;
  helpEn: string;
  helpAr: string;
  required?: boolean;
  /** For type "array": the field schema for each entry in the list. */
  items?: AttrField[];
};

/** Parses a `ServiceItem.productAttrSchema` JSON-schema-like blob into renderable fields. */
export function parseAttrSchema(schema: unknown): AttrField[] {
  if (!schema || typeof schema !== "object") return [];
  const root = schema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  if (!root.properties) return [];
  // Postgres jsonb does not preserve object key order, so `properties` entries
  // can come back in a different order than they were authored in. An explicit
  // numeric `sortOrder` on a field definition survives that round-trip; entries
  // without one fall back to whatever order jsonb happened to return.
  return Object.entries(root.properties)
    .map(([key, def], index) => {
      const type = String(def.type ?? "string");
      return {
        sortOrder: typeof def.sortOrder === "number" ? def.sortOrder : index,
        field: {
          key,
          type,
          enum: Array.isArray(def.enum) ? def.enum.map(String) : undefined,
          titleEn: String(def.titleEn ?? key),
          titleAr: String(def.titleAr ?? key),
          helpEn: String(def.helpEn ?? ""),
          helpAr: String(def.helpAr ?? ""),
          required: root.required?.includes(key),
          items: type === "array" ? parseAttrSchema(def.items) : undefined,
        },
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => entry.field);
}

function validateFields(
  fields: AttrField[],
  attrs: Record<string, unknown>,
): "ATTR_REQUIRED" | "ATTR_INVALID" | null {
  for (const field of fields) {
    const raw = attrs[field.key];

    if (field.type === "array") {
      if (raw === undefined || raw === null) {
        if (field.required) return "ATTR_REQUIRED";
        continue;
      }
      if (!Array.isArray(raw)) return "ATTR_INVALID";
      if (field.required && raw.length === 0) return "ATTR_REQUIRED";
      for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return "ATTR_INVALID";
        }
        const entryError = validateFields(field.items ?? [], entry as Record<string, unknown>);
        if (entryError) return entryError;
      }
      continue;
    }

    const missing =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim() === "");

    if (field.required && missing) {
      return "ATTR_REQUIRED";
    }
    if (missing) continue;

    if (field.enum && !field.enum.includes(String(raw))) {
      return "ATTR_INVALID";
    }

    if (field.type === "number" || field.type === "integer") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return "ATTR_INVALID";
      if (field.type === "integer" && !Number.isInteger(n)) {
        return "ATTR_INVALID";
      }
    } else if (field.type === "boolean") {
      if (typeof raw !== "boolean" && raw !== "true" && raw !== "false") {
        return "ATTR_INVALID";
      }
    } else if (typeof raw !== "string" && typeof raw !== "number") {
      return "ATTR_INVALID";
    }
  }

  return null;
}

/**
 * Validates productAttrs against a service productAttrSchema.
 * Returns null when valid, or an error code when invalid.
 */
export function validateProductAttrs(
  schema: unknown,
  attrs: Record<string, unknown>,
): "ATTR_REQUIRED" | "ATTR_INVALID" | null {
  const fields = parseAttrSchema(schema);
  if (fields.length === 0) return null;
  return validateFields(fields, attrs);
}
