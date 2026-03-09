"use client";

import * as React from "react";
import { Moon, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // useEffect only runs on the client, so now we can safely show the UI
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={cn("inline-flex items-center bg-muted rounded-full p-1 h-[40px] w-[112px]", className)} />;
  }

  const activeTheme = theme === "system" ? resolvedTheme ?? "light" : theme;
  const options: Array<{ key: "light" | "dark" | "v3"; icon: React.ReactNode; label: string }> = [
    { key: "light", icon: <Sun className="h-4 w-4" />, label: "Light" },
    { key: "dark", icon: <Moon className="h-4 w-4" />, label: "Dark" },
    { key: "v3", icon: <Sparkles className="h-4 w-4" />, label: "V3" },
  ];

  return (
    <div className={cn("inline-flex items-center bg-muted rounded-full p-1", className)}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => setTheme(option.key)}
          className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center transition-all duration-200",
            activeTheme === option.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
          title={option.label}
          aria-label={`Switch to ${option.label} theme`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}
