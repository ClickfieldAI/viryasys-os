"use client";
import { Icon } from "@/components/ui";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--red-50)] text-[var(--red)]"><Icon name="alert" /></div>
      <h2 className="text-lg font-extrabold">This page couldn’t load</h2>
      <p className="mt-1 text-[13px] text-muted">{error.message || "Something went wrong."} {error.digest && <span className="text-faint">Ref {error.digest}</span>}</p>
      <button className="btn btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
