import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Suspense } from "react";
import { Toaster } from "react-hot-toast";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "NavigatorX",
  description: "osm routing engine",
  icons: {
    icon: "/favicon.png",
  },
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
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body className="antialiased" suppressHydrationWarning>
        <Suspense fallback={<div>Loading...</div>}>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 800,
              success: {
                duration: 800,
              },
              error: {
                duration: 800,
              },
            }}
          />
        </Suspense>
      </body>
    </html>
  );
}
