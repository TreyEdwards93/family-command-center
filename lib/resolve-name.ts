export function resolveNameFromEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized === "tcedwards93@gmail.com") return "Trey";
  if (normalized === "channingedwards25@gmail.com") return "Channing";
  return "there";
}
