import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#f3f0e7",
  colorScheme: "light",
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
    title: "문장잇기 — 우리끼리 만드는 릴레이 이야기",
    description:
      "이름과 분위기를 고르고 한 문단씩 이어 쓰는 한국어 릴레이 이야기 게임입니다.",
    applicationName: "문장잇기",
    openGraph: {
      type: "website",
      locale: "ko_KR",
      title: "문장잇기 — 한 사람이 쓰고, 다음 사람이 상상해요",
      description: "첫 문장과 이야기 장치를 뽑아 우리만의 이야기를 완성해 보세요.",
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
      title: "문장잇기 — 우리끼리 만드는 릴레이 이야기",
      description: "한 문단씩 넘기면 예상 못 한 이야기가 완성됩니다.",
      images: [ogImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
