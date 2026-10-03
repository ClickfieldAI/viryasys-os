import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/client";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ViryaSys OS", template: "%s · ViryaSys OS" },
  description: "The operating system of ViryaSys Technologies — lead to handover on one record.",
  icons: { icon: "/brand/mark.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
