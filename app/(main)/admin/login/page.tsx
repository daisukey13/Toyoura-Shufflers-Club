// app/(main)/admin/login/page.tsx
import { redirect } from "next/navigation";

export default function AdminLoginRedirect() {
  // 管理画面のトップに合わせてパスを調整（/admin か /admin/dashboard など）
  redirect("/login?redirect=/admin/dashboard");
}
