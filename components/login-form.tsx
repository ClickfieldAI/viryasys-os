"use client";
import { useState } from "react";
import { ActionForm } from "./client";
import { loginAction } from "@/app/actions/auth";

const DEMO = [
  ["MD / Owner", "kishore@viryasystech.com"], ["Sales", "arun@viryasystech.com"], ["Project Manager", "senthil@viryasystech.com"], ["Designer", "meena@viryasystech.com"],
  ["Procurement", "ramesh@viryasystech.com"], ["Finance", "lakshmi@viryasystech.com"], ["Site Engineer", "prakash@viryasystech.com"], ["Warehouse", "mohan@viryasystech.com"], ["Admin", "admin@viryasystech.com"], ["Customer", "customer@demo.in"],
];

export function LoginForm({ showDemo }: { showDemo: boolean }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  return (
    <div>
      <ActionForm action={loginAction} className="space-y-4" resetOnSuccess={false}>
        <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@viryasystech.com" /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <button type="submit" className="btn btn-primary w-full" style={{ height: 40 }}>Sign in</button>
      </ActionForm>
      {showDemo && (
        <div className="mt-7 rounded-lg border border-dashed border-[var(--line-strong)] p-3">
          <div className="eyebrow mb-2">Demo accounts · password viryasys123</div>
          <div className="flex flex-wrap gap-1.5">
            {DEMO.map(([l, e]) => <button key={e} type="button" className="btn btn-sm" onClick={() => { setEmail(e); setPw("viryasys123"); }}>{l}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
