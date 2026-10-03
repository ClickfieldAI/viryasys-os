"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, useToast } from "./client";
import { loginAction } from "@/app/actions/auth";

const DEMO = [
  ["MD / Owner", "kishore@viryasystech.com"], ["Sales", "arun@viryasystech.com"], ["Project Manager", "senthil@viryasystech.com"], ["Designer", "meena@viryasystech.com"],
  ["Procurement", "ramesh@viryasystech.com"], ["Finance", "lakshmi@viryasystech.com"], ["Site Engineer", "prakash@viryasystech.com"], ["Warehouse", "mohan@viryasystech.com"], ["Admin", "admin@viryasystech.com"], ["Customer", "customer@demo.in"],
];

export function LoginForm({ showDemo }: { showDemo: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const router = useRouter();
  const toast = useToast();

  const enterAs = async (addr: string) => {
    setBusy(addr);
    const fd = new FormData(); fd.set("email", addr);
    try { const r = await loginAction(fd); if (r.ok) { router.push(r.redirect ?? "/"); router.refresh(); } else toast(r.error ?? "Could not sign in", "error"); } finally { setBusy(""); }
  };

  return (
    <div>
      <ActionForm action={loginAction} className="space-y-4" resetOnSuccess={false}>
        <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@viryasystech.com" /></div>
        <button type="submit" className="btn btn-primary w-full" style={{ height: 40 }}>Sign in</button>
      </ActionForm>
      {showDemo && (
        <div className="mt-7 rounded-lg border border-dashed border-[var(--line-strong)] p-3">
          <div className="eyebrow mb-2">Jump straight in — demo accounts</div>
          <div className="flex flex-wrap gap-1.5">
            {DEMO.map(([l, e]) => <button key={e} type="button" disabled={!!busy} className="btn btn-sm" onClick={() => enterAs(e)}>{busy === e ? "…" : l}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
