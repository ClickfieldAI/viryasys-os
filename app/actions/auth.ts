"use server";
import { login, logout } from "@/lib/auth";
import { act, req, s, type ActionResult } from "@/lib/action-utils";

export async function loginAction(fd: FormData): Promise<ActionResult> {
  try {
    const r = await login(req(fd, "email", "email"));
    return r.ok ? { ok: true, redirect: "/" } : { ok: false, error: r.error };
  } catch (e: any) { return { ok: false, error: e.message }; }
}
export async function logoutAction(): Promise<ActionResult> {
  await logout();
  return { ok: true, redirect: "/login" };
}
void act; void s;
