import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://munjang-relay-studio.techkwon.chatgpt.site";
const SITE_TITLE = "문장잇기 — AI와 함께 만드는 릴레이 이야기";
const SITE_DESCRIPTION =
  "한 기기에서 쓰거나 교사가 방을 열어 학생과 AI 작가가 함께 이어 쓰는 한국어 릴레이 이야기 활동입니다.";

export const viewport: Viewport = {
  themeColor: "#080b18",
  colorScheme: "dark light",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | 문장잇기",
  },
  description: SITE_DESCRIPTION,
  applicationName: "문장잇기",
  keywords: ["문장잇기", "릴레이 소설", "AI 글쓰기", "협동 글쓰기", "학교 글쓰기 활동"],
  creator: "문장잇기",
  publisher: "문장잇기",
  category: "education",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "문장잇기",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "/",
    siteName: "문장잇기",
    title: "문장잇기 — 사람과 AI가 차례로 이어 쓰는 이야기",
    description: "교사는 방을 열고, 학생은 로그인 없이 참여해 한 문단씩 이야기를 완성합니다.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "문장잇기에서 한 사람의 문장을 다음 사람이 이어 쓰는 모습",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "문장잇기 — 사람과 AI가 함께 쓰는 릴레이 이야기",
    description: "학생은 로그인 없이 참여하고, AI 작가와 함께 한 편의 이야기를 완성합니다.",
    images: ["/og.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "문장잇기",
  alternateName: "문장잇기 릴레이 스튜디오",
  url: `${SITE_URL}/`,
  image: `${SITE_URL}/og.png`,
  description: SITE_DESCRIPTION,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web Browser",
  browserRequirements: "Requires JavaScript and HTML5 support.",
  inLanguage: "ko-KR",
  isAccessibleForFree: true,
  audience: {
    "@type": "EducationalAudience",
    educationalRole: ["teacher", "student"],
  },
  featureList: [
    "로그인 없는 학생 참여",
    "사람과 AI가 함께 쓰는 릴레이 소설",
    "교사용 활동 방 관리",
    "학생별 글쓰기 분석",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeInitializer = `(() => {
    try {
      const saved = localStorage.getItem("munjang-itgi:theme");
      const theme = saved === "light" || saved === "dark"
        ? saved
        : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.style.colorScheme = "dark";
    }
  })();`;
  const structuredDataJson = JSON.stringify(structuredData).replace(/</g, "\\u003c");

  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredDataJson }}
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
