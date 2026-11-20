// Alışveriş ↔ Bütçe Planı bağı: ekstre harcama dağılımındaki "Market" tutarından haftalık market hedefi çıkarır.
// Hedef = (aylık market harcaması − öneri kuralıyla belirlenen kısma hedefi) / 4,345 hafta. Bilgi amaçlıdır, bütçe toplamlarına girmez.
import { parseBudgetNote, analizByCat, monthPath, monthOf, shiftMonth, round2 } from './budget';
import { cutTarget, CUT_PCT } from './budgetAI';

export interface WeeklyMarket { month: string; aylik: number; kisma: number; haftalik: number }
const WEEKS_PER_MONTH = 4.345;

export const weeklyMarketBudget = (files: Record<string, string>, now: Date = new Date()): WeeklyMarket | null => {
  // Bu ay ve önceki 3 ay içinde, Market kategorisi olan en yeni ekstre analizi
  for (let i = 0; i < 4; i++) {
    const m = shiftMonth(monthOf(now), -i);
    const b = parseBudgetNote(files[monthPath(m)], m);
    const cat = b ? analizByCat(b).find(c => c.kategori === 'Market') : undefined;
    if (cat && cat.tutar > 0) {
      const kisma = cutTarget(cat.tutar, CUT_PCT['Market'] ?? 0.12);
      return { month: m, aylik: round2(cat.tutar), kisma, haftalik: Math.max(0, Math.round((cat.tutar - kisma) / WEEKS_PER_MONTH / 10) * 10) };
    }
  }
  return null;
};
