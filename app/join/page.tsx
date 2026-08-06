import type { Metadata } from "next";
import { StudentJoin } from "./StudentJoin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "학생 참여",
  description: "방 코드를 입력하고 로그인 없이 문장잇기 릴레이 소설 활동에 참여하세요.",
  alternates: {
    canonical: "/join",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function JoinPage() {
  return <StudentJoin />;
}
