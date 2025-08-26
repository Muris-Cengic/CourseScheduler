import * as React from "react";

type Variant = "default" | "secondary" | "destructive";
const variants: Record<Variant, string> = {
  default: "bg-gray-900 text-white",
  secondary: "bg-gray-100 text-gray-900",
  destructive: "bg-red-100 text-red-700",
};

export function Badge({
  className = "",
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
