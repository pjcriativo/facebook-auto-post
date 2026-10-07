import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "Facebook Auto Post — Automação e Publicação Inteligente para Facebook Pages",
    template: "%s | Facebook Auto Post",
  },
  description:
    "Crie, agende e publique posts automaticamente em suas páginas do Facebook com inteligência artificial, imagens e integração oficial com a Graph API.",
  applicationName: "Facebook Auto Post",
  keywords: [
    "Facebook Auto Post",
    "automação facebook",
    "facebook auto publish",
    "social media automation",
    "meta graph api",
    "facebook pages bot",
    "agendador de posts facebook",
  ],
  authors: [{ name: "Facebook Auto Post" }],
  creator: "Facebook Auto Post",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Facebook Auto Post",
    title: "Facebook Auto Post — Automação e Publicação Inteligente",
    description:
      "Crie, agende e publique posts automaticamente em suas páginas do Facebook com inteligência artificial.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Facebook Auto Post",
    description:
      "Crie, agende e publique posts automaticamente em suas páginas do Facebook com inteligência artificial.",
  },
};

// Runs before paint to apply the saved theme without a light->dark flash.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("fap-theme") || localStorage.getItem("pab-theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
