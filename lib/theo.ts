export const THEO_BIRTHDAY = new Date("2026-05-13T00:00:00");

export function getTheoAgeLabel(): string {
  const now = new Date();
  const totalDays = Math.floor(
    (now.getTime() - THEO_BIRTHDAY.getTime()) / 86_400_000,
  );
  if (totalDays < 0) return "";
  if (totalDays < 14) return `${totalDays} day${totalDays !== 1 ? "s" : ""} old`;
  const weeks = Math.floor(totalDays / 7);
  if (weeks < 12) return `${weeks} week${weeks !== 1 ? "s" : ""} old`;
  const months = Math.floor(totalDays / 30.44);
  return `${months} month${months !== 1 ? "s" : ""} old`;
}
