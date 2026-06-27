import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "member";

export type Account = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

export type PublicAccount = Account;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
  return body as T;
}

export async function hasAnyAccounts() {
  const response = await fetch("/api/setup/status", { cache: "no-store" });
  return readJson<{ hasAccounts: boolean }>(response).then((body) => body.hasAccounts);
}

export async function getAccounts() {
  return readJson<{ accounts: PublicAccount[] }>(
    await fetch("/api/members", { cache: "no-store" }),
  ).then((body) => body.accounts);
}

export async function getCurrentAccount() {
  const response = await fetch("/api/me", { cache: "no-store" });
  if (response.status === 401) return null;
  return readJson<{ account: Account }>(response).then((body) => body.account);
}

export async function createFirstAdmin(input: { name: string; email: string; password: string }) {
  const account = await readJson<{ account: Account }>(await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })).then((body) => body.account);

  await login(input.email, input.password);
  return account;
}

export async function createAccount(input: { name: string; email: string; password: string; role: Role }) {
  return readJson<{ account: Account }>(await fetch("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })).then((body) => body.account);
}

export async function deleteAccount(id: string) {
  await readJson<{ ok: true }>(
    await fetch(`/api/members/${id}`, { method: "DELETE" }),
  );
}

export async function login(email: string, password: string) {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error("Email or password is incorrect.");

  const account = await getCurrentAccount();
  if (!account) {
    await supabase.auth.signOut();
    throw new Error("This account does not have an Authentico profile.");
  }
  return account;
}

export async function changePassword(newPassword: string) {
  const { error } = await createClient().auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message || "Unable to update your password.");
}

export async function logout() {
  const { error } = await createClient().auth.signOut();
  if (error) throw new Error("Unable to sign out.");
}
