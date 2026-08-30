export function ms(value: number | null): string {
  if (value === null) return '—';
  return value < 1000 ? `${value} мс` : `${(value / 1000).toFixed(1)} с`;
}

const PLURAL = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
};

export function days(n: number): string {
  return `${n} ${PLURAL(n, 'день', 'дня', 'дней')}`;
}

export function cards(n: number): string {
  return `${n} ${PLURAL(n, 'карточка', 'карточки', 'карточек')}`;
}

/** «сегодня» / «завтра» / «через 5 дней» — the horizon, not a date. */
export function interval(daysAhead: number | null): string {
  if (daysAhead === null) return '—';
  if (daysAhead <= 0) return 'сегодня';
  if (daysAhead === 1) return 'завтра';
  if (daysAhead < 30) return `через ${days(daysAhead)}`;
  const months = Math.round(daysAhead / 30);
  return `через ${months} ${PLURAL(months, 'месяц', 'месяца', 'месяцев')}`;
}

export function when(date: Date | null, now: Date): string {
  if (date === null) return '—';
  const daysAhead = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  return interval(daysAhead);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
