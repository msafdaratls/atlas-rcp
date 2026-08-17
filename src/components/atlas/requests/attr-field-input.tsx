"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { AttrField } from "@/lib/attr-schema";

type Props = {
  field: AttrField;
  value: unknown;
  onChange: (value: unknown) => void;
  selectPlaceholder: string;
  yesLabel: string;
  noLabel: string;
  enumLabel: (option: string) => string;
};

/** Renders a single scalar (string/number/boolean/enum) productAttrSchema field as an input. */
export function AttrScalarInput({
  field,
  value,
  onChange,
  selectPlaceholder,
  yesLabel,
  noLabel,
  enumLabel,
}: Props) {
  if (field.type === "boolean") {
    return (
      <Select
        value={value === true ? "true" : value === false ? "false" : ""}
        onValueChange={(v) => onChange(v === "true")}
      >
        <SelectTrigger>
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{yesLabel}</SelectItem>
          <SelectItem value="false">{noLabel}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.enum) {
    return (
      <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
        <SelectTrigger>
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {field.enum.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {enumLabel(opt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type={field.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(e) =>
        onChange(field.type === "number" ? e.target.valueAsNumber : e.target.value)
      }
    />
  );
}
