import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const u = await getUser();
  if (u) redirect(u.role === "customer" ? "/portal" : "/");
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[var(--navy-900)] p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)", backgroundSize: "36px 36px" }}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
          <path className="flow-line" d="M-20 560 C 120 560, 160 420, 300 420 S 470 300, 640 300" stroke="#32C36C" strokeWidth="1.5" opacity=".55" />
          <path className="flow-line" d="M-20 620 C 140 620, 200 500, 320 500 S 500 380, 640 380" stroke="#32C36C" strokeWidth="1" opacity=".3" />
          <path className="flow-line" d="M-20 500 C 100 500, 140 340, 280 340 S 460 220, 640 220" stroke="#FFE65A" strokeWidth="1" opacity=".22" />
          {[[300, 420], [320, 500], [280, 340]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="3.5" fill="#32C36C" />)}
        </svg>
        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark.png" alt="" width={38} height={33} />
          <div><div className="text-lg font-extrabold tracking-tight">ViryaSys <span className="text-[var(--green-500)]">OS</span></div><div className="text-[11px] tracking-[.16em] text-[#7d92a3] uppercase">Accelerating Green</div></div>
        </div>
        <div className="relative max-w-md">
          <p className="eyebrow !text-[var(--green-500)]">Solar EPC operating system</p>
          <h1 className="mt-3 text-[34px] font-extrabold leading-[1.15] tracking-tight">One record from first enquiry to handover.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[#9db0be]">Leads, site surveys, designs, proposals, procurement, installation and payments — connected, automated and always current.</p>
        </div>
        <div className="relative text-xs text-[#6d8091]">ViryaSys Technologies · Tamil Nadu</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-[380px]">
          <h2 className="text-2xl font-extrabold tracking-tight">Sign in</h2>
          <p className="mb-6 mt-1 text-[13px] text-muted">Use your ViryaSys work account.</p>
          <LoginForm showDemo />
        </div>
      </div>
    </div>
  );
}
