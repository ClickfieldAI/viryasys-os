"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon } from "./ui";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || (path.startsWith(href + "/") && !(href === "/procurement" && path.startsWith("/procurement/") && (path.startsWith("/procurement/vendors") || path.startsWith("/procurement/inventory") || path.startsWith("/procurement/deliveries"))) && !(href === "/design" && (path.startsWith("/design/calculator") || path.startsWith("/design/layouts"))));
  return <Link href={href} className="nav-item" aria-current={active ? "page" : undefined}>{children}</Link>;
}

/** Sidebar frame: fixed on desktop, slide-over drawer on mobile. */
export function SidebarFrame({ children, top }: { children: ReactNode; top: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const [last, setLast] = useState(path);
  if (last !== path) { setLast(path); if (open) setOpen(false); }
  return (
    <>
      <button className="btn btn-ghost btn-sm fixed left-2 top-[13px] z-40 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="list" size={18} /></button>
      {open && <div className="modal-bg fixed inset-0 z-40 bg-[rgba(10,20,28,.5)] lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`sidebar fixed inset-y-0 left-0 z-50 flex w-[236px] flex-col transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`} aria-label="Primary">
        {top}
        <nav className="flex-1 overflow-y-auto pb-6">{children}</nav>
      </aside>
    </>
  );
}
