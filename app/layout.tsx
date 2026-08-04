import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#080b18",
  colorScheme: "dark light",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const ogImage = `${protocol}://${host}/og.png`;

  return {
    title: "문장잇기 — AI와 함께 만드는 릴레이 이야기",
    description:
      "한 기기에서 쓰거나 교사가 방을 열어 학생과 AI 작가가 함께 이어 쓰는 한국어 릴레이 이야기 활동입니다.",
    applicationName: "문장잇기",
    openGraph: {
      type: "website",
      locale: "ko_KR",
      title: "문장잇기 — 사람과 AI가 차례로 이어 쓰는 이야기",
      description: "교사는 방을 열고, 학생은 로그인 없이 참여해 한 문단씩 이야기를 완성합니다.",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: "문장잇기 릴레이 이야기 게임",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "문장잇기 — 사람과 AI가 함께 쓰는 릴레이 이야기",
      description: "학생은 로그인 없이 참여하고, AI 작가와 함께 한 편의 이야기를 완성합니다.",
      images: [ogImage],
    },
  };
}

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

  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
