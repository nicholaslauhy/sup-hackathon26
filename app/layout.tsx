import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Authentico",
  description: "Explainable receipt and invoice fraud triage",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
