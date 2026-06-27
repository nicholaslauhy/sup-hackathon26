import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Account } from "@/lib/auth";

type ProfileRow = { id: string; name: string; email: string; role: "admin" | "member"; created_at: string };

export function toAccount(profile: ProfileRow): Account {
  return { id: profile.id, name: profile.name, email: profile.email, role: profile.role, createdAt: profile.created_at };
}

export async function findProfile(id: string) {
  const { data, error } = await createAdminClient().from("profiles").select("id,name,email,role,created_at").eq("id", id).single();
  if (error || !data) return null;
  return toAccount(data as ProfileRow);
}
