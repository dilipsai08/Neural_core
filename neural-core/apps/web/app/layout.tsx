import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neural Core",
  description: "Concentration-driven target shooting experience",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
