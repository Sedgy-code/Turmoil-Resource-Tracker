import Image from "next/image";

export interface ClanBrandProps {
  variant?: "mark" | "full";
  className?: string;
  size?: number;
  alt?: string;
  decorative?: boolean;
  sizes?: string;
  preload?: boolean;
}

export function ClanBrand({
  variant = "mark",
  className = "",
  size = variant === "mark" ? 40 : 220,
  alt = "Turmoil clan crest",
  decorative = false,
  sizes = variant === "full" ? `(max-width: 640px) 80vw, ${size}px` : `${size}px`,
  preload = variant === "full",
}: ClanBrandProps) {
  return (
    <Image
      src={variant === "full" ? "/turmoil-crest.png" : "/clan-emblem.svg"}
      width={size}
      height={size}
      alt={decorative ? "" : alt}
      aria-hidden={decorative || undefined}
      className={`clan-brand clan-brand--${variant}${className ? ` ${className}` : ""}`}
      sizes={sizes}
      preload={preload}
      loading={variant === "mark" && !preload ? "eager" : undefined}
      unoptimized={variant === "mark"}
      style={{ objectFit: "contain", flexShrink: 0 }}
    />
  );
}
