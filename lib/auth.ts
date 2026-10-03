import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { getDb } from "./db";
import { can, type Access, type ModuleKey, type RoleKey } from "./config";
import type { Actor } from "./services/core";

const COOKIE = "vos_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "vos-dev-secret-change-in-prod");

export interface SessionUser { id: number; name: string; email: string; role: RoleKey; customer_id: number | null }

const attempts = new Map<string, { n: number; t: number }>();

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = email.toLowerCase().trim();
  const a = attempts.get(key);
  if (a && a.n >= 6 && Date.now() - a.t < 60_000) return { ok: false, error: "Too many attempts. Wait a minute and try again." };
  const u = getDb().prepare("SELECT * FROM users WHERE lower(email) = ? AND active = 1").get(key) as any;
  const valid = u && (await bcrypt.compare(password, u.password_hash));
  if (!valid) {
    attempts.set(key, { n: (a && Date.now() - a.t < 60_000 ? a.n : 0) + 1, t: Date.now() });
    return { ok: false, error: "Incorrect email or password." };
  }
  attempts.delete(key);
  const token = await new SignJWT({ uid: u.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("14d").sign(secret);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return { ok: true };
}
export async function logout() { (await cookies()).delete(COOKIE); }

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const u = getDb().prepare("SELECT id, name, email, role, customer_id FROM users WHERE id = ? AND active = 1").get(payload.uid as number) as SessionUser | undefined;
    return u ?? null;
  } catch { return null; }
}

/** For pages: redirect anonymous users to /login and users without module access home (or to the portal). */
export async function guard(module: ModuleKey, need: Access = "r"): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (u.role === "customer") redirect("/portal");
  if (!can(u.role, module, need)) redirect("/forbidden");
  return u;
}

/** For server actions: throws instead of redirecting. Authorisation is always re-checked server-side. */
export async function authorize(module: ModuleKey, need: Access = "w"): Promise<{ user: SessionUser; actor: Actor }> {
  const u = await getUser();
  if (!u) throw new Error("Your session has expired. Please sign in again.");
  if (!can(u.role, module, need)) throw new Error("You don't have permission to do that.");
  return { user: u, actor: { id: u.id, name: u.name, role: u.role } };
}
