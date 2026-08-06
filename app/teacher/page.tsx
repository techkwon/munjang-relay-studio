import type { Metadata } from "next";
import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { TeacherDashboard } from "./TeacherDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "교사 대시보드",
  description: "문장잇기 릴레이 소설 활동 방을 만들고 진행 상황과 학생 글쓰기 분석을 관리합니다.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function TeacherPage() {
  const user = await requireChatGPTUser("/teacher");

  return (
    <TeacherDashboard
      user={{ displayName: user.displayName, email: user.email }}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
