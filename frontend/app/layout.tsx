import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CreditWeave | Confidential Underwriting",
  description: "Privacy-first RWA underwriting dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
