import Link from "next/link";
import { Icon } from "@/components/ui";
export default function Forbidden() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--orange-50)] text-[var(--orange)]"><Icon name="lock" /></div>
        <h1 className="text-lg font-extrabold">You don’t have access to this area</h1>
        <p className="mt-1 text-[13px] text-muted">Your role doesn’t include this module. Ask an admin if you need it.</p>
        <Link href="/" className="btn btn-primary mt-4">Back to dashboard</Link>
      </div>
    </div>
  );
}
