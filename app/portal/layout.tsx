import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { ActionButton } from "@/components/client";
import { Icon } from "@/components/ui";
import { logoutAction } from "@/app/actions/auth";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const u = await getUser();
  if (!u) redirect("/login");
  if (u.role !== "customer") redirect("/");
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-[1000px] items-center justify-between px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="flex items-center gap-3"><img src="/brand/logo.png" alt="ViryaSys Technologies" height={30} style={{ height: 30 }} /><span className="hidden rounded-full bg-[var(--green-50)] px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-[var(--green-700)] uppercase sm:inline">Customer portal</span></div>
          <div className="flex items-center gap-2"><span className="text-[13px] font-semibold">{u.name}</span><ActionButton action={logoutAction} className="btn btn-ghost btn-sm" title="Sign out"><Icon name="logout" size={16} /></ActionButton></div>
        </div>
      </header>
      <main className="mx-auto max-w-[1000px] px-4 py-6">{children}</main>
    </div>
  );
}
