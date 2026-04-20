import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Suspense } from "react";
import { Toaster } from "react-hot-toast";
import Script from "next/script";

export const metadata: Metadata = {
  title: "NavigatorX",
  description: "osm routing engine",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Script
          src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"
          strategy="afterInteractive"
        />
        <Suspense fallback={<div>Loading...</div>}>
          {children}
          <Toaster position="top-center" />
        </Suspense>
      </body>
    </html>
  );
}
