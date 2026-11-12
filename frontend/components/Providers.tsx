"use client";

import React from "react";
import { SensorProvider } from "@/lib/sensors";
import { ThemeProvider } from "@/lib/theme";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SensorProvider>{children}</SensorProvider>
    </ThemeProvider>
  );
}
