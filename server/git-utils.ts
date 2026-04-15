export function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return String(seconds) + " seconds ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return String(minutes) + " minute" + (minutes === 1 ? "" : "s") + " ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return String(hours) + " hour" + (hours === 1 ? "" : "s") + " ago";
  const days = Math.floor(hours / 24);
  if (days < 7) return String(days) + " day" + (days === 1 ? "" : "s") + " ago";
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return String(weeks) + " week" + (weeks === 1 ? "" : "s") + " ago";
  const months = Math.floor(days / 30);
  if (months < 12) return String(months) + " month" + (months === 1 ? "" : "s") + " ago";
  const years = Math.floor(days / 365);
  return String(years) + " year" + (years === 1 ? "" : "s") + " ago";
}
