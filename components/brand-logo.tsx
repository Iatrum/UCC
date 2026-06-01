import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  showWordmark?: boolean;
  wordmarkClassName?: string;
};

const MARK_SRC = "/brand/iatrum-mark.png";

export function BrandLogo({
  className,
  showWordmark = true,
  wordmarkClassName,
}: BrandLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 overflow-hidden",
        showWordmark ? "h-8" : "h-8 w-8",
        className
      )}
    >
      <Image
        src={MARK_SRC}
        alt={showWordmark ? "" : "Iatrum"}
        width={405}
        height={414}
        priority
        className="h-full w-auto select-none object-contain"
      />
      {showWordmark && (
        <span
          className={cn(
            "text-[1.75rem] font-light leading-none tracking-[0.01em] text-[#06345f]",
            wordmarkClassName
          )}
        >
          Iatrum
        </span>
      )}
    </span>
  );
}
