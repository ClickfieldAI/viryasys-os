import { revalidatePath } from "next/cache";

export interface ActionResult { ok: boolean; message?: string; error?: string; redirect?: string }

/** Uniform server-action wrapper: errors become user-facing results, never stack traces. */
export async function act(fn: () => Promise<Partial<ActionResult> | void> | Partial<ActionResult> | void, message?: string): Promise<ActionResult> {
  try {
    const r = (await fn()) || {};
    revalidatePath("/", "layout");
    return { ok: true, message: r.message ?? message, redirect: r.redirect };
  } catch (e: any) {
    if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
    return { ok: false, error: e?.message ?? "Something went wrong" };
  }
}

export const s = (fd: FormData, k: string): string => String(fd.get(k) ?? "").trim();
export const n = (fd: FormData, k: string): number | null => {
  const v = s(fd, k).replace(/,/g, "");
  if (v === "") return null;
  const x = Number(v);
  if (Number.isNaN(x)) throw new Error(`“${k.replace(/_/g, " ")}” must be a number`);
  return x;
};
export const req = (fd: FormData, k: string, name = k.replace(/_/g, " ")): string => {
  const v = s(fd, k);
  if (!v) throw new Error(`${name[0].toUpperCase()}${name.slice(1)} is required`);
  return v;
};
export const dateTimeSql = (v: string) => (v ? v.replace("T", " ") + (v.length === 16 ? ":00" : "") : "");
