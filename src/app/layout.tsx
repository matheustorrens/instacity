import type { Metadata } from "next";
import Script from "next/script";
import GlobalRadio from "@/components/GlobalRadio";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001"
  ),
  title: "InstaCity - Seu Instagram como uma Cidade 3D",
  description:
    "Explore perfis do Instagram como prédios em uma cidade 3D pixel art. Voe pela cidade e descubra criadores.",
  keywords: [
    "instagram",
    "3d city",
    "perfil instagram",
    "seguidores",
    "pixel art",
    "influenciadores",
    "visualização instagram",
  ],
  openGraph: {
    title: "InstaCity - Seu Instagram como uma Cidade 3D",
    description:
      "Explore perfis do Instagram como prédios em uma cidade 3D pixel art. Voe pela cidade e descubra criadores.",
    siteName: "InstaCity",
    type: "website",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "InstaCity",
  description:
    "Seu perfil do Instagram como um prédio 3D pixel art em uma cidade interativa",
  url: BASE_URL,
  applicationCategory: "SocialNetworkingApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "BRL",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Silkscreen&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg font-pixel text-warm" suppressHydrationWarning>
        {children}
        <GlobalRadio />
        {process.env.NEXT_PUBLIC_HIMETRICA_API_KEY && (
          <>
            <Script
              src="https://cdn.himetrica.com/tracker.js"
              data-api-key={process.env.NEXT_PUBLIC_HIMETRICA_API_KEY}
              strategy="afterInteractive"
            />
            <Script
              src="https://cdn.himetrica.com/vitals.js"
              data-api-key={process.env.NEXT_PUBLIC_HIMETRICA_API_KEY}
              strategy="afterInteractive"
            />
            <Script
              src="https://cdn.himetrica.com/errors.js"
              data-api-key={process.env.NEXT_PUBLIC_HIMETRICA_API_KEY}
              strategy="afterInteractive"
            />
          </>
        )}
      </body>
    </html>
  );
}
