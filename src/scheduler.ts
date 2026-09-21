export function isWithinBusinessHours(date: Date, timezone: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(date),
  );
  return hour >= 8 && hour < 18;
}
