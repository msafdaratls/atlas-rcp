import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas RCP",
  description: "Atlas Regulatory Compliance Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
