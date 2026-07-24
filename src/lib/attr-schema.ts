export type AttrField = {
  key: string;
  type: string;
  enum?: string[];
  titleEn: string;
  titleAr: string;
  helpEn: string;
  helpAr: string;
  required?: boolean;
};

/** Parses a `ServiceItem.productAttrSchema` JSON-schema-like blob into renderable fields. */
export function parseAttrSchema(schema: unknown): AttrField[] {
  if (!schema || typeof schema !== "object") return [];
  const root = schema as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  if (!root.properties) return [];
  return Object.entries(root.properties).map(([key, def]) => ({
    key,
    type: String(def.type ?? "string"),
    enum: Array.isArray(def.enum) ? def.enum.map(String) : undefined,
    titleEn: String(def.titleEn ?? key),
    titleAr: String(def.titleAr ?? key),
    helpEn: String(def.helpEn ?? ""),
    helpAr: String(def.helpAr ?? ""),
    required: root.required?.includes(key),
  }));
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

  for (const field of fields) {
    const raw = attrs[field.key];
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
