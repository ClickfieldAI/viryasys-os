"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "./ui";

/* ───────────── toasts ───────────── */
type ToastKind = "success" | "error" | "info";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white px-3.5 py-2.5 text-[13px] shadow-lg"
            style={{ borderColor: t.kind === "error" ? "#e7c3c0" : t.kind === "success" ? "var(--green-100)" : "var(--line)", borderLeft: `3px solid ${t.kind === "error" ? "var(--red)" : t.kind === "success" ? "var(--green-500)" : "var(--blue)"}` }}>
            <Icon name={t.kind === "error" ? "alert" : "check"} size={15} className={t.kind === "error" ? "mt-0.5 text-[var(--red)]" : "mt-0.5 text-[var(--green-600)]"} />
            <span className="flex-1">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────────── modal / drawer ───────────── */
export function Modal({ open, onClose, title, children, width = 520, side = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number; side?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`modal-bg fixed inset-0 z-[90] flex bg-[rgba(10,20,28,.5)] ${side ? "justify-end" : "items-start justify-center overflow-y-auto p-4 pt-[8vh]"}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`modal flex flex-col bg-white shadow-2xl ${side ? "h-full" : "rounded-xl"}`} style={{ width: `min(${width}px, 100%)` }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-extrabold">{title}</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className={`px-5 py-4 ${side ? "flex-1 overflow-y-auto" : ""}`}>{children}</div>
      </div>
    </div>
  );
}

/** Button that opens a modal whose body is server-rendered content passed as children. */
export function ModalButton({ label, title, children, className = "btn btn-primary", width, side, icon }: { label: string; title: string; children: ReactNode; className?: string; width?: number; side?: boolean; icon?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{icon && <Icon name={icon} size={14} />}{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} width={width} side={side}>
        <CloseCtx.Provider value={() => setOpen(false)}>{children}</CloseCtx.Provider>
      </Modal>
    </>
  );
}
const CloseCtx = createContext<() => void>(() => {});

/* ───────────── server-action plumbing ───────────── */
export interface ActionResult { ok: boolean; message?: string; error?: string; redirect?: string }

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger, pending, onConfirm, onCancel }: { open: boolean; title: string; body?: string; confirmLabel?: string; danger?: boolean; pending?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} width={420}>
      {body && <p className="mb-4 text-[13px] text-muted">{body}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={pending}>{pending ? "Working…" : confirmLabel}</button>
      </div>
    </Modal>
  );
}

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const close = useContext(CloseCtx);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      let r: ActionResult;
      try { r = await fn(); } catch (e: any) { r = { ok: false, error: e?.message ?? "Something went wrong" }; }
      if (r.ok) {
        if (r.message) toast(r.message, "success");
        close();
        after?.(r);
        if (r.redirect) router.push(r.redirect); else router.refresh();
      } else toast(r.error ?? "Something went wrong", "error");
    });
  return { run, pending };
}

/** <form> wired to a server action with pending state, toast feedback, optional confirm. */
export function ActionForm({ action, children, className, resetOnSuccess = true, confirm, submitLabel, submitClass = "btn btn-primary", danger }: {
  action: (fd: FormData) => Promise<ActionResult>; children: ReactNode; className?: string; resetOnSuccess?: boolean;
  confirm?: string; submitLabel?: string; submitClass?: string; danger?: boolean;
}) {
  const { run, pending } = useRun();
  const ref = useRef<HTMLFormElement>(null);
  const [asking, setAsking] = useState(false);
  const submitter = useRef<HTMLElement | null>(null);
  const submit = () => { setAsking(false); run(() => action(new FormData(ref.current!, (submitter.current as HTMLButtonElement | null) ?? undefined)), (r) => r.ok && resetOnSuccess && ref.current?.reset()); };
  return (
    <>
      <form ref={ref} className={className} onSubmit={(e) => { e.preventDefault(); submitter.current = (e.nativeEvent as SubmitEvent).submitter; if (!e.currentTarget.reportValidity()) return; confirm ? setAsking(true) : submit(); }}>
        <fieldset disabled={pending} className="contents">
          {children}
          {submitLabel && <button type="submit" className={submitClass}>{pending ? "Saving…" : submitLabel}</button>}
        </fieldset>
      </form>
      <ConfirmDialog open={asking} title={confirm ?? ""} confirmLabel={submitLabel} danger={danger} pending={pending} onConfirm={submit} onCancel={() => setAsking(false)} />
    </>
  );
}

/** Button bound to a server action (bind args on the server). Optional confirmation dialog. */
export function ActionButton({ action, children, className = "btn btn-sm", confirm, confirmLabel, danger, title }: { action: () => Promise<ActionResult>; children: ReactNode; className?: string; confirm?: string; confirmLabel?: string; danger?: boolean; title?: string }) {
  const { run, pending } = useRun();
  const [asking, setAsking] = useState(false);
  const go = () => { setAsking(false); run(action); };
  return (
    <>
      <button type="button" className={className} title={title} disabled={pending} onClick={() => (confirm ? setAsking(true) : go())}>{pending ? "…" : children}</button>
      <ConfirmDialog open={asking} title={confirm ?? ""} confirmLabel={confirmLabel} danger={danger} pending={pending} onConfirm={go} onCancel={() => setAsking(false)} />
    </>
  );
}

/** Checkbox that fires a server action on change (task / checklist toggles). */
export function ToggleCheck({ checked, action, label }: { checked: boolean; action: () => Promise<ActionResult>; label: string }) {
  const { run, pending } = useRun();
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 text-[13px] ${pending ? "opacity-50" : ""}`}>
      <input type="checkbox" checked={checked} disabled={pending} onChange={() => run(action)} className="h-4 w-4 accent-[var(--green-600)]" />
      <span className={checked ? "text-muted line-through" : ""}>{label}</span>
    </label>
  );
}

/** Auto-submitting filter form: GET params, debounced typing. */
export function SearchBox({ param = "q", placeholder = "Search…", defaultValue = "" }: { param?: string; placeholder?: string; defaultValue?: string }) {
  const router = useRouter();
  const [v, setV] = useState(defaultValue);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <div className="relative">
      <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input className="input pl-8" style={{ width: 220 }} placeholder={placeholder} value={v} aria-label={placeholder}
        onChange={(e) => {
          setV(e.target.value);
          clearTimeout(t.current);
          t.current = setTimeout(() => {
            const u = new URL(window.location.href);
            if (e.target.value) u.searchParams.set(param, e.target.value); else u.searchParams.delete(param);
            u.searchParams.delete("page");
            router.replace(u.pathname + u.search);
          }, 300);
        }} />
    </div>
  );
}

/* ───────────── SLA countdown ───────────── */
export function SlaTimer({ deadline, total, state, responseSeconds }: { deadline: number; total: number; state: "running" | "met" | "breached"; responseSeconds: number | null }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const refreshed = useRef(false);
  useEffect(() => {
    setNow(Date.now());
    if (state !== "running") return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [state]);
  const mmss = (s: number) => `${String(Math.floor(Math.abs(s) / 60)).padStart(2, "0")}:${String(Math.abs(s) % 60).padStart(2, "0")}`;
  const rem = now == null ? total : Math.round((deadline - now) / 1000);
  useEffect(() => {
    if (state === "running" && now != null && rem <= 0 && !refreshed.current) { refreshed.current = true; setTimeout(() => router.refresh(), 1200); }
  }, [rem, state, now, router]);

  if (state === "met") return <span className="badge b-green"><i />SLA met{responseSeconds != null && ` · ${mmss(responseSeconds)}`}</span>;
  if (state === "breached" || rem <= 0) return <span className="badge b-red"><i />SLA breached{responseSeconds != null ? ` · ${mmss(responseSeconds)}` : ""}</span>;
  return <span className={`badge num ${rem <= 30 ? "b-red" : "b-orange"}`}><i />{mmss(rem)} left</span>;
}

/* ───────────── ⌘K command search ───────────── */
interface Hit { type: string; code: string; title: string; sub?: string; href: string }
export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ hits: Hit[]; docCount: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    if (!open) { setQ(""); setRes(null); return; }
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (r.ok) { setRes(await r.json()); setSel(0); }
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const go = (h: Hit) => { setOpen(false); router.push(h.href); };
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-9 w-full max-w-[380px] items-center gap-2 rounded-lg border border-line bg-[var(--sunk)] px-3 text-left text-[13px] text-faint transition-colors hover:border-[var(--faint)]" aria-label="Search everything">
        <Icon name="search" size={14} /> <span className="flex-1">Search leads, projects, proposals…</span>
        <kbd className="rounded border border-line bg-white px-1.5 text-[10px] font-semibold text-muted">⌘K</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Search" width={620}>
        <div onKeyDown={(e) => {
          if (!res?.hits.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(res.hits.length - 1, s + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === "Enter") go(res.hits[sel]);
        }}>
          <input autoFocus className="input mb-3" placeholder="Try “ABC Industries”, VS-LEAD-000124, a phone number…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search query" />
          <div className="max-h-[52vh] overflow-y-auto">
            {loading && !res && <div className="space-y-2"><div className="skeleton h-9" /><div className="skeleton h-9" /></div>}
            {res && res.hits.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No matches for “{q}”.</p>}
            {res?.hits.map((h, i) => (
              <button key={h.href + h.code + i} onClick={() => go(h)} onMouseEnter={() => setSel(i)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${i === sel ? "bg-[var(--green-50)]" : ""}`}>
                <span className="badge b-navy w-[110px] justify-center">{h.type}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{h.title}</span><span className="block truncate text-xs text-muted">{h.code}{h.sub ? ` · ${h.sub}` : ""}</span></span>
                <Icon name="arrow" size={13} className="text-faint" />
              </button>
            ))}
            {res && res.docCount > 0 && <Link href={`/documents?q=${encodeURIComponent(q)}`} onClick={() => setOpen(false)} className="mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-[13px] hover:bg-[var(--green-50)]"><span className="badge b-navy w-[110px] justify-center">Documents</span><span>{res.docCount} matching document{res.docCount > 1 ? "s" : ""}</span></Link>}
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Periodically refreshes server data (live dashboards, AI inbox). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(i);
  }, [router, seconds]);
  return null;
}
