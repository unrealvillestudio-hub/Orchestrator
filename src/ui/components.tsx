import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Spinner = ({ size = 16, className }: { size?: number; className?: string }) => (
  <span
    className={cn("inline-block rounded-full border-2 border-current/20 border-t-current animate-spin", className)}
    style={{ width: size, height: size, minWidth: size }}
  />
);

export const GlowDot = ({ color = "#FFAB00", pulse = true }: { color?: string; pulse?: boolean }) => (
  <span
    className={cn("inline-block rounded-full", pulse && "animate-pulse")}
    style={{ width: 7, height: 7, backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
  />
);
