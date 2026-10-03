import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { SIDEBAR, ROLES, can } from "@/lib/config";
import { unreadCount } from "@/lib/services/core";
import { NavLink, SidebarFrame } from "@/components/nav";
import { CommandSearch } from "@/components/client";
import { Icon } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { logoutAction } from "../actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role === "customer") redirect("/portal");
  const unread = unreadCount(user);
  const groups = SIDEBAR.map((g) => ({ ...g, items: g.items.filter((i) => can(user.role, i.module)) })).filter((g) => g.items.length);

  return (
    <div className="min-h-screen">
      <SidebarFrame
        top={
          <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.png" alt="" width={30} height={26} />
            <div className="leading-tight">
              <div className="text-[15px] font-extrabold tracking-tight text-white">ViryaSys <span className="text-[var(--green-500)]">OS</span></div>
              <div className="text-[10px] font-medium tracking-[.14em] text-[#6fb38c] uppercase">Accelerating Green</div>
            </div>
          </Link>
        }
      >
        {groups.map((g) => (
          <div key={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map((i) => (
              <NavLink key={i.href} href={i.href}><Icon name={i.icon} size={18} className="nav-ic" /><span className="flex-1">{i.label}</span></NavLink>
            ))}
          </div>
        ))}
      </SidebarFrame>

      <div className="lg:pl-[236px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:px-6">
          <div className="lg:hidden w-8" />
          <CommandSearch />
          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/notifications" className="btn btn-ghost btn-sm relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
              <Icon name="bell" size={17} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--red)] px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <details className="relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-[var(--sunk)]">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--green-600)] text-[13px] font-extrabold text-white">{user.name[0]}</span>
                <span className="hidden text-left leading-tight sm:block"><span className="block text-[13px] font-bold">{user.name}</span><span className="block text-[11px] text-faint">{ROLES[user.role].name}</span></span>
                <Icon name="chevron" size={14} className="text-faint" />
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-52 rounded-xl border border-line bg-white p-1.5 shadow-xl">
                <div className="px-3 py-2 text-xs text-muted"><b className="block text-[13px] text-ink">{user.name}</b>{user.email}</div>
                <Link href="/notifications" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold hover:bg-[var(--sunk)]"><Icon name="bell" size={15} /> Notifications</Link>
                <ActionButton action={logoutAction} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--red)] hover:bg-[var(--red-50)]"><Icon name="logout" size={15} /> Sign out</ActionButton>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto max-w-[1360px] px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
