import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { TeacherDashboard } from "./TeacherDashboard";

export const dynamic = "force-dynamic";

export default async function TeacherPage() {
  const user = await requireChatGPTUser("/teacher");

  return (
    <TeacherDashboard
      user={{ displayName: user.displayName, email: user.email }}
      signOutPath={chatGPTSignOutPath("/")}
    />
  );
}
