import React, { useState, useMemo } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, PiggyBank, Wallet, Clock, 
  MapPin, ShoppingCart, Sparkles, Plus, Edit2, Check, ArrowRight, ArrowLeftRight,
  Gift 
} from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  updatedAt: number;
}

interface FinanceViewProps {
  notes: NoteItem[];
  fileContents: Record<string, string>;
  onSelectNote: (path: string) => void;
  onCreateNote?: (name: string, folder: string | null) => Promise<void>;
  onSaveNote?: (path: string, content: string) => Promise<void>;
}

interface Transaction {
  id: string;
  noteName: string;
  notePath: string;
  date: string;
  description: string;
  amount: number;
  type: 'gelir' | 'gider' | 'yatirim' | 'tasarruf';
  location: string;
  kaynak: string;
}

interface PriceRecord {
  product: string;
  price: number;
  location: string;
  date: string;
  noteName: string;
  notePath: string;
}

interface Resource {
  name: string;
  path: string;
  initialBalance: number;
  initialLimit: number;
  type: 'nakit' | 'kredi-karti' | 'hesap' | 'hediye-karti' | 'diger';
  paymentType: 'otomatik' | 'manuel';
  income: number;
  expense: number;
  investment: number;
  savings: number;
  currentBalance: number;
}

interface Asset {
  name: string;
  path: string;
  value: number;
  type: 'gayrimenkul' | 'hisse' | 'altin-doviz' | 'arac' | 'diger';
}

interface RecurringItem {
  id: string;
  description: string;
  amount: number;
  type: 'gelir' | 'gider';
  period: string;
  day: number;
  noteName: string;
  notePath: string;
}

export default function FinanceView({ notes, fileContents, onSelectNote, onCreateNote, onSaveNote }: FinanceViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'compare' | 'ledger' | 'resources' | 'assets'>('summary');
  const [budgetLimit, setBudgetLimit] = useState<number>(() => {
    return parseFloat(localStorage.getItem('finance_monthly_budget') || '15000');
  });
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [tempBudget, setTempBudget] = useState(budgetLimit.toString());
  const [ledgerFilter, setLedgerFilter] = useState<'all' | 'gelir' | 'gider' | 'yatirim' | 'tasarruf'>('all');
  const [ledgerSourceFilter, setLedgerSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [newResourceName, setNewResourceName] = useState('');
  const [newResourceType, setNewResourceType] = useState<'nakit' | 'kredi-karti' | 'hesap' | 'hediye-karti' | 'diger'>('nakit');

  // Credit Card Payment Management states
  const [payingCard, setPayingCard] = useState<Resource | null>(null);
  const [paymentSource, setPaymentSource] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [newResourceInitial, setNewResourceInitial] = useState('');
  const [newResourceLimit, setNewResourceLimit] = useState('');

  const [newAssetName, setNewAssetName] = useState('');
  const [newAssetType, setNewAssetType] = useState<'gayrimenkul' | 'hisse' | 'altin-doviz' | 'arac' | 'diger'>('gayrimenkul');

  // Helper: Simple string hashing
  const getHash = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  };

  // 1. Data Extractor
  const financeData = useMemo(() => {
    const stopWords = new Set([
      'bir', 've', 'veya', 'ile', 'da', 'de', 'icin', 'için', 'olan', 'bu', 'su', 'şu', 'o', 'ne', 'kadar', 'gibi', 'mi', 'mu', 'mü', 'mi', 'sonra', 'once', 'önce', 'daha', 'cok', 'çok', 'en', 'her', 'hiç', 'hic', 'ama', 'fakat', 'ancak', 'lakin', 'yani', 'ise'
    ]);

    const resourcesMap: Record<string, {
      name: string;
      path: string;
      initialBalance: number;
      initialLimit: number;
      type: 'nakit' | 'kredi-karti' | 'hesap' | 'hediye-karti' | 'diger';
      paymentType: 'otomatik' | 'manuel';
    }> = {};

    const assetsList: Asset[] = [];
    const allRecurringItems: RecurringItem[] = [];

    // 1. Scan for Resource and Asset Definitions
    notes.forEach(note => {
      if (note.type !== 'note') return;
      const content = fileContents[note.path] || '';
      if (!content.trim()) return;

      // Check Resource definition
      const hasResourceTag = content.includes('#finans-kaynak') || content.includes('#kaynak');
      if (hasResourceTag) {
        let initialBalance = 0;
        let initialLimit = 0;
        let type: 'nakit' | 'kredi-karti' | 'hesap' | 'hediye-karti' | 'diger' = 'diger';
        let paymentType: 'otomatik' | 'manuel' = 'otomatik';

        const bakiyeMatch = content.match(/\[bakiye:\s*([\d.,-]+)\s*(?:TL|tl)?\]/i);
        if (bakiyeMatch) {
          initialBalance = parseFloat(bakiyeMatch[1].replace(/,/, '.'));
        }

        const limitMatch = content.match(/\[limit:\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        if (limitMatch) {
          initialLimit = parseFloat(limitMatch[1].replace(/,/, '.'));
          type = 'kredi-karti';
        }

        if (content.toLowerCase().includes('nakit') || note.name.toLowerCase().includes('nakit')) {
          type = 'nakit';
        } else if (content.toLowerCase().includes('kredi') || note.name.toLowerCase().includes('kredi') || limitMatch) {
          type = 'kredi-karti';
        } else if (content.toLowerCase().includes('bank') || content.toLowerCase().includes('hesap')) {
          type = 'hesap';
        } else if (content.toLowerCase().includes('hediye') || note.name.toLowerCase().includes('hediye') || content.toLowerCase().includes('çek') || content.toLowerCase().includes('cek')) {
          type = 'hediye-karti';
        }

        // Parse payment type
        if (content.toLowerCase().includes('[odeme: manuel]') || content.toLowerCase().includes('#odeme-manuel')) {
          paymentType = 'manuel';
        } else if (content.toLowerCase().includes('[odeme: otomatik]') || content.toLowerCase().includes('#odeme-otomatik')) {
          paymentType = 'otomatik';
        }

        resourcesMap[note.name.toLowerCase().trim()] = {
          name: note.name,
          path: note.path,
          initialBalance,
          initialLimit,
          type,
          paymentType
        };
      }

      // Check Asset definition
      const hasAssetTag = content.includes('#finans-varlik') || content.includes('#varlik');
      if (hasAssetTag) {
        let value = 0;
        let type: 'gayrimenkul' | 'hisse' | 'altin-doviz' | 'arac' | 'diger' = 'diger';

        const degerMatch = content.match(/\[(?:deger|varlik-degeri):\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        if (degerMatch) {
          value = parseFloat(degerMatch[1].replace(/,/, '.'));
        }

        const lowerContent = content.toLowerCase();
        const lowerName = note.name.toLowerCase();

        if (lowerContent.includes('ev') || lowerContent.includes('daire') || lowerContent.includes('arsa') || lowerContent.includes('villa') || lowerContent.includes('konut') || lowerName.includes('ev') || lowerName.includes('daire')) {
          type = 'gayrimenkul';
        } else if (lowerContent.includes('hisse') || lowerContent.includes('borsa') || lowerContent.includes('portföy') || lowerContent.includes('fon') || lowerName.includes('hisse') || lowerName.includes('portfoy')) {
          type = 'hisse';
        } else if (lowerContent.includes('altın') || lowerContent.includes('altin') || lowerContent.includes('döviz') || lowerContent.includes('doviz') || lowerContent.includes('usd') || lowerContent.includes('eur') || lowerName.includes('altin') || lowerName.includes('doviz')) {
          type = 'altin-doviz';
        } else if (lowerContent.includes('araba') || lowerContent.includes('araç') || lowerContent.includes('arac') || lowerContent.includes('otomobil') || lowerName.includes('araba') || lowerName.includes('arac')) {
          type = 'arac';
        }

        assetsList.push({
          name: note.name,
          path: note.path,
          value,
          type
        });
      }
    });

    const allTransactions: Transaction[] = [];
    const allPriceRecords: PriceRecord[] = [];

    notes.forEach(note => {
      if (note.type !== 'note') return;
      const content = fileContents[note.path] || '';
      if (!content.trim()) return;

      const lines = content.split('\n');
      lines.forEach((lineText, lineIdx) => {
        const trimmed = lineText.trim();
        if (!trimmed) return;

        // Recurring Items parsing
        const duzenliGelirMatch = trimmed.match(/\[duzenli-gelir:\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        const duzenliGiderMatch = trimmed.match(/\[duzenli-gider:\s*([\d.,]+)\s*(?:TL|tl)?\]/i);

        if (duzenliGelirMatch || duzenliGiderMatch) {
          const isGelir = !!duzenliGelirMatch;
          const match = duzenliGelirMatch || duzenliGiderMatch;
          const amount = parseFloat(match![1].replace(/,/, '.'));

          const periyotMatch = trimmed.match(/\[periyot:\s*([^\]]+)\]/i);
          const periyot = periyotMatch ? periyotMatch[1].trim() : 'aylik';

          const gunMatch = trimmed.match(/\[gun:\s*(\d+)\]/i);
          const gun = gunMatch ? parseInt(gunMatch[1], 10) : 1;

          const aciklamaMatch = trimmed.match(/\[aciklama:\s*([^\]]+)\]/i);
          let itemDesc = aciklamaMatch ? aciklamaMatch[1].trim() : '';

          if (!itemDesc) {
            itemDesc = trimmed
              .replace(/^[-*+]\s+/, '')
              .replace(/^\[[xX\s]\]\s*/, '')
              .replace(/\[duzenli-(?:gelir|gider):\s*[^\]]+\]/g, '')
              .replace(/\[periyot:\s*[^\]]+\]/g, '')
              .replace(/\[gun:\s*[^\]]+\]/g, '')
              .trim();
          }

          allRecurringItems.push({
            id: `${note.path}-rec-${lineIdx}`,
            description: itemDesc || (isGelir ? 'Düzenli Gelir' : 'Düzenli Gider'),
            amount,
            type: isGelir ? 'gelir' : 'gider',
            period: periyot,
            day: gun,
            noteName: note.name,
            notePath: note.path
          });
        }

        // Standard tags parsing
        const harcamaMatch = trimmed.match(/\[(?:harcama|gider):\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        const gelirMatch = trimmed.match(/\[gelir:\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        const yatirimMatch = trimmed.match(/\[(?:yatırım|yatirim):\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        const tasarrufMatch = trimmed.match(/\[tasarruf:\s*([\d.,]+)\s*(?:TL|tl)?\]/i);
        const fiyatMatch = trimmed.match(/\[fiyat:\s*([\d.,]+)\s*(?:TL|tl)?\]/i);

        // Location / Market parsing
        const locMatch = trimmed.match(/@([a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+)/);
        const location = locMatch ? locMatch[1] : '';

        // Source / Card parsing
        const kaynakMatch = trimmed.match(/\[(?:kaynak|kart|hesap):\s*([^\]]+)\]/i);
        const kaynak = kaynakMatch ? kaynakMatch[1].trim() : '';

        let description = trimmed
          .replace(/^[-*+]\s+/, '') // remove bullet
          .replace(/^\[[xX\s]\]\s*/, '') // remove checkbox
          .replace(/\[(?:harcama|gider|gelir|yatırım|yatirim|tasarruf|fiyat):\s*[^\]]+\]/g, '')
          .replace(/\[(?:kaynak|kart|hesap):\s*[^\]]+\]/g, '')
          .replace(/@[a-zA-Z0-9çıüşöğİÇIŞĞÜÖ_-]+/g, '')
          .trim();

        let type: 'gelir' | 'gider' | 'yatirim' | 'tasarruf' | '' = '';
        let amount = 0;

        if (harcamaMatch) {
          type = 'gider';
          amount = parseFloat(harcamaMatch[1].replace(/,/, '.'));
        } else if (gelirMatch) {
          type = 'gelir';
          amount = parseFloat(gelirMatch[1].replace(/,/, '.'));
        } else if (yatirimMatch) {
          type = 'yatirim';
          amount = parseFloat(yatirimMatch[1].replace(/,/, '.'));
        } else if (tasarrufMatch) {
          type = 'tasarruf';
          amount = parseFloat(tasarrufMatch[1].replace(/,/, '.'));
        } else if (fiyatMatch) {
          type = 'gider';
          amount = parseFloat(fiyatMatch[1].replace(/,/, '.'));
        } else {
          // Fallback 1: starts with +, - or *
          const moneyMatch = trimmed.match(/^([-+*])\s*([\d.,]+)\s*(?:TL|tl)?\s*(.*)$/i);
          if (moneyMatch) {
            const symbol = moneyMatch[1];
            amount = parseFloat(moneyMatch[2].replace(/,/, '.'));
            description = moneyMatch[3].trim();
            if (symbol === '+') type = 'gelir';
            else if (symbol === '-') type = 'gider';
            else if (symbol === '*') type = 'yatirim';
          } else {
            // Fallback 2: natural text
            const amountInText = trimmed.match(/([\d.,]+)\s*(?:TL|tl)\b/i);
            if (amountInText) {
              amount = parseFloat(amountInText[1].replace(/,/, '.'));
              if (trimmed.toLowerCase().includes('maaş') || trimmed.toLowerCase().includes('gelir') || trimmed.toLowerCase().includes('yattı')) {
                type = 'gelir';
              } else if (trimmed.toLowerCase().includes('yatırım') || trimmed.toLowerCase().includes('hisse') || trimmed.toLowerCase().includes('altın')) {
                type = 'yatirim';
              } else if (trimmed.toLowerCase().includes('tasarruf') || trimmed.toLowerCase().includes('birikim')) {
                type = 'tasarruf';
              } else {
                type = 'gider';
              }
            }
          }
        }

        if (type && amount > 0) {
          const dateMatch = trimmed.match(/\[(\d{4}-\d{2}-\d{2})\]/);
          const baseDate = dateMatch ? dateMatch[1] : new Date(note.updatedAt).toISOString().split('T')[0];

          let totalTaksit = 1;
          const taksitMatch = trimmed.match(/\[taksit:\s*(\d+)\]/i);
          if (taksitMatch && type === 'gider') {
            totalTaksit = parseInt(taksitMatch[1], 10);
          }

          if (totalTaksit > 1) {
            const monthlyAmount = parseFloat((amount / totalTaksit).toFixed(2));
            for (let i = 0; i < totalTaksit; i++) {
              const addMonths = (dateStr: string, months: number): string => {
                const parts = dateStr.split('-');
                if (parts.length !== 3) return dateStr;
                let y = parseInt(parts[0], 10);
                let m = parseInt(parts[1], 10) - 1; // 0-indexed
                let d = parseInt(parts[2], 10);
                
                m += months;
                y += Math.floor(m / 12);
                m = m % 12;
                if (m < 0) {
                  m += 12;
                  y -= 1;
                }
                const mStr = String(m + 1).padStart(2, '0');
                const dStr = String(d).padStart(2, '0');
                return `${y}-${mStr}-${dStr}`;
              };
              
              const instDate = addMonths(baseDate, i);
              allTransactions.push({
                id: `${note.path}-${lineIdx}-taksit-${i}`,
                noteName: note.name,
                notePath: note.path,
                date: instDate,
                description: `${description || 'Açıklamasız Girdi'} (Taksit ${i+1}/${totalTaksit})`,
                amount: monthlyAmount,
                type,
                location: location || 'Genel',
                kaynak: kaynak || 'Genel'
              });
            }
          } else {
            allTransactions.push({
              id: `${note.path}-${lineIdx}`,
              noteName: note.name,
              notePath: note.path,
              date: baseDate,
              description: description || 'Açıklamasız Girdi',
              amount,
              type,
              location: location || 'Genel',
              kaynak: kaynak || 'Genel'
            });
          }
        }

        // Fiş details parsing for product comparison
        if (amount > 0 && type === 'gider') {
          const prodListMatch = description.match(/\(([^)]+)\)/);
          if (prodListMatch) {
            const prods = prodListMatch[1].split(',').map(p => p.trim());
            prods.forEach(prod => {
              const cleanProd = prod.replace(/\[[\d.,\s]+TL\]/gi, '').trim();
              if (cleanProd && cleanProd.length > 1 && !stopWords.has(cleanProd.toLowerCase())) {
                allPriceRecords.push({
                  product: cleanProd,
                  price: amount / prods.length,
                  location: location || 'Belirtilmedi',
                  date: new Date(note.updatedAt).toISOString().split('T')[0],
                  noteName: note.name,
                  notePath: note.path
                });
              }
            });
          } else if (description) {
            const cleanProd = description.replace(/^[xX\s]*\]\s*/, '').trim();
            if (cleanProd && cleanProd.length > 1 && !stopWords.has(cleanProd.toLowerCase())) {
              allPriceRecords.push({
                product: cleanProd,
                price: amount,
                location: location || 'Belirtilmedi',
                date: new Date(note.updatedAt).toISOString().split('T')[0],
                noteName: note.name,
                notePath: note.path
              });
            }
          }
        }
      });
    });

    // 3. Build Resource Cards list with calculated balances
    const resourcesList: Resource[] = Object.values(resourcesMap).map(res => {
      let income = 0;
      let expense = 0;
      let investment = 0;
      let savings = 0;

      allTransactions.forEach(t => {
        if (t.kaynak.toLowerCase().trim() === res.name.toLowerCase().trim()) {
          if (t.type === 'gelir') income += t.amount;
          else if (t.type === 'gider') expense += t.amount;
          else if (t.type === 'yatirim') investment += t.amount;
          else if (t.type === 'tasarruf') savings += t.amount;
        }
      });

      let currentBalance = 0;
      if (res.type === 'kredi-karti') {
        currentBalance = res.initialLimit - expense + income;
      } else {
        currentBalance = res.initialBalance + income - expense - investment - savings;
      }

      return {
        ...res,
        income,
        expense,
        investment,
        savings,
        currentBalance
      };
    });

    // Find transactions with no matched resource
    let unspecifiedIncome = 0;
    let unspecifiedExpense = 0;
    let unspecifiedInvestment = 0;
    let unspecifiedSavings = 0;

    allTransactions.forEach(t => {
      const k = t.kaynak.toLowerCase().trim();
      const hasResource = Object.keys(resourcesMap).some(resKey => resKey === k);
      if (!hasResource) {
        if (t.type === 'gelir') unspecifiedIncome += t.amount;
        else if (t.type === 'gider') unspecifiedExpense += t.amount;
        else if (t.type === 'yatirim') unspecifiedInvestment += t.amount;
        else if (t.type === 'tasarruf') unspecifiedSavings += t.amount;
      }
    });

    if (unspecifiedIncome > 0 || unspecifiedExpense > 0 || unspecifiedInvestment > 0 || unspecifiedSavings > 0) {
      resourcesList.push({
        name: 'Genel / Diğer',
        path: '',
        initialBalance: 0,
        initialLimit: 0,
        type: 'diger',
        paymentType: 'otomatik',
        income: unspecifiedIncome,
        expense: unspecifiedExpense,
        investment: unspecifiedInvestment,
        savings: unspecifiedSavings,
        currentBalance: unspecifiedIncome - unspecifiedExpense - unspecifiedInvestment - unspecifiedSavings
      });
    }

    return { 
      transactions: allTransactions, 
      priceRecords: allPriceRecords,
      resources: resourcesList,
      assets: assetsList,
      recurringItems: allRecurringItems
    };
  }, [notes, fileContents]);

  // 2. Calculations
  const stats = useMemo(() => {
    let totalGelir = 0;
    let totalGider = 0;
    let totalYatirim = 0;
    let totalTasarruf = 0;

    const currentMonthStr = new Date().toISOString().slice(0, 7); // e.g. "2026-07"

    financeData.transactions.forEach(t => {
      if (t.date.startsWith(currentMonthStr)) {
        if (t.type === 'gelir') totalGelir += t.amount;
        else if (t.type === 'gider') totalGider += t.amount;
        else if (t.type === 'yatirim') totalYatirim += t.amount;
        else if (t.type === 'tasarruf') totalTasarruf += t.amount;
      }
    });

    return { totalGelir, totalGider, totalYatirim, totalTasarruf };
  }, [financeData.transactions]);

  // Grouped prices for product comparison
  const groupedPrices = useMemo(() => {
    const map: Record<string, PriceRecord[]> = {};
    financeData.priceRecords.forEach(rec => {
      const key = rec.product.toLowerCase().trim();
      if (!map[key]) map[key] = [];
      const existing = map[key].find(r => r.location.toLowerCase() === rec.location.toLowerCase());
      if (!existing) {
        map[key].push(rec);
      } else if (new Date(rec.date) > new Date(existing.date)) {
        existing.price = rec.price;
        existing.date = rec.date;
      }
    });
    return map;
  }, [financeData.priceRecords]);

  const handleSaveBudget = () => {
    const val = parseFloat(tempBudget);
    if (!isNaN(val) && val >= 0) {
      setBudgetLimit(val);
      localStorage.setItem('finance_monthly_budget', val.toString());
    }
    setIsEditingBudget(false);
  };

  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResourceName.trim() || !onCreateNote) return;

    const folder = 'Finans';
    try {
      await onCreateNote(newResourceName.trim(), folder);
    } catch (e) {
      console.error(e);
    }

    setNewResourceName('');
    setNewResourceInitial('');
    setNewResourceLimit('');
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssetName.trim() || !onCreateNote) return;

    const folder = 'Finans';
    try {
      await onCreateNote(newAssetName.trim(), folder);
    } catch (e) {
      console.error(e);
    }

    setNewAssetName('');
  };

  const filteredTransactions = useMemo(() => {
    return financeData.transactions.filter(t => {
      const matchesType = ledgerFilter === 'all' || t.type === ledgerFilter;
      const matchesSource = ledgerSourceFilter === 'all' || t.kaynak.toLowerCase().trim() === ledgerSourceFilter.toLowerCase().trim();
      const matchesSearch = t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            t.noteName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            t.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            t.kaynak.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesSource && matchesSearch;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [financeData.transactions, ledgerFilter, ledgerSourceFilter, searchQuery]);

  // Asset related computations
  const assetMetrics = useMemo(() => {
    const totalResourceBalances = financeData.resources
      .filter(r => r.name !== 'Genel / Diğer')
      .reduce((sum, r) => sum + r.currentBalance, 0);

    const totalAssetValues = financeData.assets.reduce((sum, a) => sum + a.value, 0);
    const netWorth = totalResourceBalances + totalAssetValues;

    let recurringIncome = 0;
    let recurringExpense = 0;

    financeData.recurringItems.forEach(item => {
      if (item.type === 'gelir') recurringIncome += item.amount;
      else if (item.type === 'gider') recurringExpense += item.amount;
    });

    return {
      netWorth,
      totalResourceBalances,
      totalAssetValues,
      recurringIncome,
      recurringExpense,
      netRecurringFlow: recurringIncome - recurringExpense
    };
  }, [financeData.resources, financeData.assets, financeData.recurringItems]);

  const handleTogglePaymentType = async (res: Resource) => {
    if (!onSaveNote || !res.path) return;
    const content = fileContents[res.path] || '';
    let newContent = content;
    
    const newType = res.paymentType === 'otomatik' ? 'manuel' : 'otomatik';
    
    if (content.toLowerCase().includes('[odeme:')) {
      newContent = content.replace(/\[odeme:\s*(otomatik|manuel)\]/gi, `[odeme: ${newType}]`);
    } else if (content.toLowerCase().includes('#odeme-')) {
      newContent = content.replace(/#odeme-(otomatik|manuel)/gi, `#odeme-${newType}`);
    } else {
      newContent = content.trim() + `\n\n[odeme: ${newType}]`;
    }
    
    await onSaveNote(res.path, newContent);
  };

  const handlePayCardDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCard || !paymentSource || !onSaveNote) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return;
    
    const sourceRes = financeData.resources.find(r => r.name === paymentSource);
    if (!sourceRes) return;
    
    const date = new Date().toISOString().split('T')[0];
    
    // 1. Update Card Note
    if (payingCard.path) {
      const cardContent = fileContents[payingCard.path] || '';
      const newCardContent = cardContent.trim() + `\n- Kredi Kartı Borç Ödemesi [gelir: ${amount}] [kaynak: ${payingCard.name}] [${date}] @${sourceRes.name}`;
      await onSaveNote(payingCard.path, newCardContent);
    }
    
    // 2. Update Source Account Note
    if (sourceRes.path) {
      const sourceContent = fileContents[sourceRes.path] || '';
      const newSourceContent = sourceContent.trim() + `\n- Kredi Kartı Ödemesi (${payingCard.name}) [gider: ${amount}] [kaynak: ${sourceRes.name}] [${date}] @Kredi`;
      await onSaveNote(sourceRes.path, newSourceContent);
    }
    
    setPayingCard(null);
    setPaymentSource('');
    setPaymentAmount('');
  };

  const budgetPercent = budgetLimit > 0 ? Math.min(100, Math.round((stats.totalGider / budgetLimit) * 100)) : 0;
  const budgetColor = budgetPercent > 85 ? '#ef4444' : budgetPercent > 65 ? '#f59e0b' : '#10b981';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Header */}
      <div style={{ 
        padding: '16px 24px', 
        background: 'var(--bg-secondary)', 
        borderBottom: '1px solid var(--border-color)', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '12px',
        alignItems: 'stretch'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Wallet className="accent-text" size={20} />
          <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Kişisel Finans & Bütçe Takipçisi</h2>
        </div>

        {/* Sub-tab navigation */}
        <div 
          className="no-scrollbar"
          style={{ 
            display: 'flex', 
            background: 'var(--bg-tertiary)', 
            borderRadius: '6px', 
            padding: '2px', 
            border: '1px solid var(--border-color)',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
            gap: '2px'
          }}
        >
          <button
            onClick={() => setActiveSubTab('summary')}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              background: activeSubTab === 'summary' ? 'var(--accent-color)' : 'transparent',
              color: activeSubTab === 'summary' ? '#fff' : 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            Özet Rapor
          </button>
          <button
            onClick={() => setActiveSubTab('compare')}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              background: activeSubTab === 'compare' ? 'var(--accent-color)' : 'transparent',
              color: activeSubTab === 'compare' ? '#fff' : 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            Fiyat Karşılaştırma
          </button>
          <button
            onClick={() => setActiveSubTab('resources')}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              background: activeSubTab === 'resources' ? 'var(--accent-color)' : 'transparent',
              color: activeSubTab === 'resources' ? '#fff' : 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            Kaynaklar (Hesaplar)
          </button>
          <button
            onClick={() => setActiveSubTab('assets')}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              background: activeSubTab === 'assets' ? 'var(--accent-color)' : 'transparent',
              color: activeSubTab === 'assets' ? '#fff' : 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            Varlıklar & Gelirler
          </button>
          <button
            onClick={() => setActiveSubTab('ledger')}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              background: activeSubTab === 'ledger' ? 'var(--accent-color)' : 'transparent',
              color: activeSubTab === 'ledger' ? '#fff' : 'var(--text-secondary)',
              flexShrink: 0
            }}
          >
            Hesap Geçmişi
          </button>
        </div>
      </div>

      {/* Main Body container */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {activeSubTab === 'summary' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                  <TrendingUp size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Aylık Gelir</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.totalGelir.toLocaleString('tr-TR')} TL</div>
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                  <TrendingDown size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Aylık Harcama</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.totalGider.toLocaleString('tr-TR')} TL</div>
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
                  <DollarSign size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Yatırımlar</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.totalYatirim.toLocaleString('tr-TR')} TL</div>
                </div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ padding: '8px', borderRadius: '6px', background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                  <PiggyBank size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tasarruf/Birikim</div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{stats.totalTasarruf.toLocaleString('tr-TR')} TL</div>
                </div>
              </div>
            </div>

            {/* Budget Bar widget */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 4px 0' }}>Aylık Bütçe Limiti</h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Harcanan bütçe limit oranını anlık gösterir.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isEditingBudget ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input 
                        type="number" 
                        value={tempBudget}
                        onChange={(e) => setTempBudget(e.target.value)}
                        style={{ width: '80px', padding: '4px 8px', fontSize: '12px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#fff' }}
                      />
                      <button onClick={handleSaveBudget} style={{ background: '#10b981', border: 'none', borderRadius: '4px', color: '#fff', padding: '4px', cursor: 'pointer' }}><Check size={14} /></button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{budgetLimit.toLocaleString('tr-TR')} TL</span>
                      <button onClick={() => { setTempBudget(budgetLimit.toString()); setIsEditingBudget(true); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><Edit2 size={12} /></button>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ width: `${budgetPercent}%`, height: '100%', background: budgetColor, transition: 'width 0.4s ease', borderRadius: '999px' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>% {budgetPercent} harcandı</span>
                <span>Kalan: {(budgetLimit - stats.totalGider).toLocaleString('tr-TR')} TL</span>
              </div>
            </div>

            {/* Note category distribution */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 16px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                Notlara Göre Harcama Dağılımı
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(() => {
                  const grouped: Record<string, { path: string; total: number }> = {};
                  financeData.transactions.forEach(t => {
                    if (t.type !== 'gider') return;
                    if (!grouped[t.noteName]) {
                      grouped[t.noteName] = { path: t.notePath, total: 0 };
                    }
                    grouped[t.noteName].total += t.amount;
                  });

                  const sorted = Object.entries(grouped)
                    .sort((a, b) => b[1].total - a[1].total);

                  if (sorted.length === 0) {
                    return <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>Hiç harcama kaydı bulunamadı.</div>;
                  }

                  const maxTotal = sorted[0][1].total;

                  return sorted.map(([name, data]) => {
                    const percent = Math.round((data.total / maxTotal) * 100);
                    return (
                      <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                          <span 
                            onClick={() => onSelectNote(data.path)} 
                            style={{ color: 'var(--accent-color)', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            {name}
                          </span>
                          <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{data.total.toLocaleString('tr-TR')} TL</span>
                        </div>
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent-color)' }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {activeSubTab === 'compare' && (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
            <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)', margin: '0 0 4px 0' }}>Market & Ürün Fiyat Karşılaştırması</h3>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Notlardan toplanan ürün bazlı fiyat geçmişi listelenir. En ucuz fiyat yeşil ile vurgulanır.</p>
            </div>

            {Object.keys(groupedPrices).length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>
                Fiyat karşılaştırma tablosu için notlarınıza fiyat ve konum etiketleri ekleyin. <br/>
                Örnek: <code style={{ color: 'var(--accent-color)' }}>- Süt [fiyat: 38 TL] @Bim</code>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {Object.entries(groupedPrices).map(([prodName, records]) => {
                  const sortedRecs = [...records].sort((a, b) => a.price - b.price);
                  const minPrice = sortedRecs[0].price;

                  return (
                    <div key={prodName} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px', padding: '12px 16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', textTransform: 'capitalize', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ShoppingCart size={13} className="accent-text" />
                        <span>{prodName}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                        {sortedRecs.map((rec, rIdx) => {
                          const isCheapest = rec.price === minPrice;
                          return (
                            <div 
                              key={rIdx} 
                              style={{ 
                                background: isCheapest ? 'rgba(16, 185, 129, 0.04)' : 'rgba(255,255,255,0.01)', 
                                border: isCheapest ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(255,255,255,0.03)', 
                                borderRadius: '4px', 
                                padding: '8px 12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}
                            >
                              <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <MapPin size={10} />
                                  <span>{rec.location}</span>
                                </div>
                                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{rec.date}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', color: isCheapest ? '#10b981' : '#fff' }}>
                                  {rec.price.toFixed(1)} TL
                                </div>
                                {isCheapest && <span style={{ fontSize: '9px', color: '#10b981', fontWeight: '600' }}>En Ucuz 🟢</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeSubTab === 'resources' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Create Resource Card */}
            {onCreateNote && (
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
                <h4 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 12px 0', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Yeni Ödeme Kaynağı (Hesap/Kart) Ekle</h4>
                <form onSubmit={handleCreateResource} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Kaynak Adı</label>
                    <input 
                      type="text" 
                      placeholder="Örn: Bonus Kartı, Nakit" 
                      value={newResourceName}
                      onChange={(e) => setNewResourceName(e.target.value)}
                      required
                      style={{ padding: '6px 12px', fontSize: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', width: '180px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tür</label>
                    <select
                      value={newResourceType}
                      onChange={(e) => setNewResourceType(e.target.value as any)}
                      style={{ padding: '6px 12px', fontSize: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', width: '120px' }}
                    >
                      <option value="nakit">💵 Nakit</option>
                      <option value="kredi-karti">💳 Kredi Kartı</option>
                      <option value="hesap">🏦 Banka Hesabı</option>
                      <option value="hediye-karti">🎁 Hediye Kartı</option>
                      <option value="diger">🏷️ Diğer / Hediye</option>
                    </select>
                  </div>
                  <button 
                    type="submit" 
                    style={{ 
                      padding: '7px 16px', 
                      background: 'var(--accent-color)', 
                      border: 'none', 
                      borderRadius: '4px', 
                      color: '#fff', 
                      fontSize: '12px', 
                      fontWeight: '600', 
                      cursor: 'pointer' 
                    }}
                  >
                    Kaynak Notu Oluştur
                  </button>
                </form>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
                  * Not oluşturulduktan sonra içine otomatik olarak yönlendirilirsiniz. Notun içine <code style={{ color: 'var(--accent-color)' }}>[bakiye: 5000]</code> veya kredi kartları için <code style={{ color: 'var(--accent-color)' }}>[limit: 15000]</code> yazarak başlangıç tutarlarını ayarlayabilirsiniz.
                </p>
              </div>
            )}

            {/* Borç Ödeme Formu */}
            {payingCard && (
              <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(16, 185, 129, 0.1)', paddingBottom: '8px', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: '600', color: '#fff', margin: 0 }}>
                    💳 {payingCard.name} Borç Ödeme
                  </h4>
                  <button 
                    onClick={() => setPayingCard(null)} 
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}
                  >
                    Kapat
                  </button>
                </div>
                <form onSubmit={handlePayCardDebt} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ödeme Yapılacak Kaynak</label>
                    <select
                      value={paymentSource}
                      onChange={(e) => setPaymentSource(e.target.value)}
                      required
                      style={{ padding: '6px 12px', fontSize: '12px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#fff', width: '180px' }}
                    >
                      <option value="">Kaynak Seçin</option>
                      {financeData.resources
                        .filter(r => r.name !== payingCard.name && r.name !== 'Genel / Diğer' && r.type !== 'kredi-karti')
                        .map(r => (
                          <option key={r.name} value={r.name}>{r.name} ({r.currentBalance.toLocaleString('tr-TR')} TL)</option>
                        ))}
                    </select>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tutar (TL)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      required
                      style={{ padding: '6px 12px', fontSize: '12px', background: '#1c1c24', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', color: '#fff', width: '120px' }}
                    />
                  </div>
                  
                  <button 
                    type="submit" 
                    style={{ 
                      padding: '7px 16px', 
                      background: '#10b981', 
                      border: 'none', 
                      borderRadius: '4px', 
                      color: '#fff', 
                      fontSize: '12px', 
                      fontWeight: '600', 
                      cursor: 'pointer' 
                    }}
                  >
                    Ödemeyi Notlara Kaydet
                  </button>
                </form>
              </div>
            )}

            {/* Resources Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {financeData.resources.map((res) => {
                const isCreditCard = res.type === 'kredi-karti';
                const typeIcon = res.type === 'nakit' ? '💵' : res.type === 'kredi-karti' ? '💳' : res.type === 'hesap' ? '🏦' : res.type === 'hediye-karti' ? '🎁' : '🏷️';
                const typeLabel = res.type === 'nakit' ? 'Nakit Hesap' : res.type === 'kredi-karti' ? 'Kredi Kartı' : res.type === 'hesap' ? 'Banka Hesabı' : res.type === 'hediye-karti' ? 'Hediye Kartı' : 'Diğer / Hediye';
                
                let usagePercent = 0;
                if (isCreditCard && res.initialLimit > 0) {
                  usagePercent = Math.min(100, Math.round((res.expense / res.initialLimit) * 100));
                }

                return (
                  <div 
                    key={res.name}
                    style={{ 
                      background: 'var(--bg-secondary)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '8px', 
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '16px' }}>{typeIcon}</span>
                          <h4 style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>{res.name}</h4>
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {typeLabel}
                        </div>
                      </div>
                      {res.path && (
                        <button 
                          onClick={() => onSelectNote(res.path)}
                          style={{ 
                            background: 'var(--bg-tertiary)', 
                            border: '1px solid var(--border-color)', 
                            borderRadius: '4px', 
                            color: 'var(--text-muted)', 
                            padding: '4px 8px', 
                            fontSize: '10px', 
                            cursor: 'pointer' 
                          }}
                        >
                          Nota Git
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{isCreditCard ? 'Kullanılabilir Limit' : 'Güncel Bakiye'}</span>
                      <span style={{ fontSize: '18px', fontWeight: 'bold', color: res.currentBalance >= 0 ? '#10b981' : '#ef4444' }}>
                        {res.currentBalance.toLocaleString('tr-TR')} TL
                      </span>
                    </div>

                    {isCreditCard && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', background: 'var(--bg-tertiary)', padding: '6px 10px', borderRadius: '4px', marginTop: '4px' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Borç: </span>
                          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{(res.expense - res.income).toLocaleString('tr-TR')} TL</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button 
                            onClick={() => handleTogglePaymentType(res)}
                            style={{ 
                              fontSize: '10px', 
                              cursor: 'pointer', 
                              color: 'var(--accent-color)', 
                              textDecoration: 'underline',
                              background: 'transparent',
                              border: 'none',
                              padding: 0
                            }}
                            title="Ödeme tipini değiştir"
                          >
                            {res.paymentType === 'otomatik' ? '🤖 Oto' : '👤 Man'}
                          </button>
                          
                          {res.paymentType === 'manuel' && (res.expense - res.income) > 0 && (
                            <button
                              onClick={() => {
                                setPayingCard(res);
                                setPaymentAmount((res.expense - res.income).toString());
                                const defaultSrc = financeData.resources.find(r => r.type === 'hesap' || r.type === 'nakit');
                                setPaymentSource(defaultSrc ? defaultSrc.name : '');
                              }}
                              style={{
                                background: '#10b981',
                                border: 'none',
                                color: '#fff',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontWeight: '600',
                                cursor: 'pointer'
                              }}
                            >
                              Öde
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {isCreditCard && res.initialLimit > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.04)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div style={{ width: `${usagePercent}%`, height: '100%', background: usagePercent > 80 ? '#ef4444' : usagePercent > 50 ? '#f59e0b' : 'var(--accent-color)' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)' }}>
                          <span>Limit: {res.initialLimit.toLocaleString('tr-TR')} TL</span>
                          <span>Dolu: %{usagePercent}</span>
                        </div>
                      </div>
                    )}

                    <div style={{ gridTemplateColumns: '1fr 1fr', display: 'grid', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '10px', fontSize: '11px' }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>Girişler</div>
                        <div style={{ color: '#10b981', fontWeight: '500', marginTop: '2px' }}>+{res.income.toLocaleString('tr-TR')} TL</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>Çıkışlar</div>
                        <div style={{ color: '#ef4444', fontWeight: '500', marginTop: '2px' }}>-{res.expense.toLocaleString('tr-TR')} TL</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeSubTab === 'assets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Top Cards for Net Worth and Cash Flow */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Toplam Net Varlık (Net Worth)</div>
                <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                  {assetMetrics.netWorth.toLocaleString('tr-TR')} TL
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>💰 Likit Varlıklar (Hesaplar): {assetMetrics.totalResourceBalances.toLocaleString('tr-TR')} TL</span>
                  <span>🏠 Fiziksel Varlıklar: {assetMetrics.totalAssetValues.toLocaleString('tr-TR')} TL</span>
                </div>
              </div>

              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Aylık Düzenli Pasif Akış</div>
                <div style={{ fontSize: '22px', fontWeight: 'bold', color: assetMetrics.netRecurringFlow >= 0 ? '#10b981' : '#ef4444' }}>
                  {assetMetrics.netRecurringFlow >= 0 ? '+' : ''}{assetMetrics.netRecurringFlow.toLocaleString('tr-TR')} TL / Ay
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>📈 Toplam Düzenli Gelir: +{assetMetrics.recurringIncome.toLocaleString('tr-TR')} TL</span>
                  <span>📉 Abonelikler & Ödemeler: -{assetMetrics.recurringExpense.toLocaleString('tr-TR')} TL</span>
                </div>
              </div>
            </div>

            {/* Split Grid */}
            <div className="finance-split-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'flex-start' }}>
              
              {/* Assets Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>Varlıklarım (Assets)</h3>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{financeData.assets.length} Varlık</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {financeData.assets.map(asset => {
                    const typeEmoji = asset.type === 'gayrimenkul' ? '🏠' : asset.type === 'hisse' ? '📈' : asset.type === 'altin-doviz' ? '🪙' : asset.type === 'arac' ? '🚗' : '🎁';
                    const typeLabel = asset.type === 'gayrimenkul' ? 'Gayrimenkul' : asset.type === 'hisse' ? 'Hisse/Yatırım' : asset.type === 'altin-doviz' ? 'Altın/Döviz' : asset.type === 'arac' ? 'Araç/Taşıt' : 'Diğer';

                    return (
                      <div 
                        key={asset.name} 
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center', 
                          padding: '12px 16px', 
                          background: 'var(--bg-tertiary)', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '6px' 
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '20px' }}>{typeEmoji}</span>
                          <div>
                            <h4 style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>{asset.name}</h4>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{typeLabel}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                            {asset.value.toLocaleString('tr-TR')} TL
                          </span>
                          <button 
                            onClick={() => onSelectNote(asset.path)}
                            style={{ 
                              background: 'var(--bg-secondary)', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '4px', 
                              color: 'var(--text-muted)', 
                              padding: '4px 8px', 
                              fontSize: '10px', 
                              cursor: 'pointer' 
                            }}
                          >
                            Git
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {financeData.assets.length === 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '24px 0', textAlign: 'center' }}>
                      Kayıtlı varlık bulunamadı. Başlamak için yeni bir varlık ekleyin!
                    </div>
                  )}
                </div>

                {onCreateNote && (
                  <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '16px', marginTop: '8px' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-primary)', margin: '0 0 12px 0' }}>Yeni Varlık Notu Ekle</h4>
                    <form onSubmit={handleCreateAsset} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <input 
                        type="text" 
                        placeholder="Örn: Kiralık Dairem, Portföyüm" 
                        value={newAssetName}
                        onChange={(e) => setNewAssetName(e.target.value)}
                        required
                        style={{ flex: 1, minWidth: '150px', padding: '6px 12px', fontSize: '12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
                      />
                      <button 
                        type="submit" 
                        style={{ padding: '7px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}
                      >
                        Varlık Notu Oluştur
                      </button>
                    </form>
                    <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
                      * Not oluşturulduktan sonra içine yönlendirilirsiniz. İçeriğe <code style={{ color: 'var(--accent-color)' }}>#varlik</code> ve <code style={{ color: 'var(--accent-color)' }}>[deger: 4500000]</code> yazarak bakiye girin.
                    </p>
                  </div>
                )}
              </div>

              {/* Recurring schedule Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff', margin: 0 }}>Düzenli Gelir & Ödemeler</h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(() => {
                    const todayDate = new Date();
                    const currentDay = todayDate.getDate();

                    const sortedRecurring = [...financeData.recurringItems].sort((a, b) => {
                      // Sort by upcoming day in month
                      const diffA = a.day >= currentDay ? a.day - currentDay : a.day + 30 - currentDay;
                      const diffB = b.day >= currentDay ? b.day - currentDay : b.day + 30 - currentDay;
                      return diffA - diffB;
                    });

                    if (sortedRecurring.length === 0) {
                      return (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '32px 0', textAlign: 'center' }}>
                          Düzenli işlem bulunamadı. <br/>
                          Bir nota <code style={{ color: 'var(--accent-color)' }}>[duzenli-gider: 120] [gun: 15]</code> yazarak başlayın.
                        </div>
                      );
                    }

                    return sortedRecurring.map(item => {
                      const isGelir = item.type === 'gelir';
                      const badgeBg = isGelir ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)';
                      const badgeBorder = isGelir ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
                      const badgeText = isGelir ? '#10b981' : '#ef4444';

                      // Calculate remaining days
                      let daysRemaining = item.day - currentDay;
                      let statusText = '';
                      if (daysRemaining === 0) {
                        statusText = 'Bugün! 🔔';
                      } else if (daysRemaining === 1) {
                        statusText = 'Yarın';
                      } else if (daysRemaining > 1) {
                        statusText = `${daysRemaining} gün sonra`;
                      } else {
                        // Next month
                        statusText = 'Geçti / Gelecek Ay';
                      }

                      return (
                        <div 
                          key={item.id}
                          style={{ 
                            background: badgeBg, 
                            border: `1px solid ${badgeBorder}`, 
                            borderRadius: '6px', 
                            padding: '12px 16px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#fff' }}>{item.description}</span>
                              <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                                Her ayın {item.day}'i
                              </span>
                            </div>
                            <div style={{ fontSize: '10px', color: badgeText, fontWeight: '500', marginTop: '4px' }}>
                              {statusText}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: badgeText }}>
                              {isGelir ? '+' : '-'}{item.amount.toLocaleString('tr-TR')} TL
                            </div>
                            <span 
                              onClick={() => onSelectNote(item.notePath)}
                              style={{ fontSize: '9px', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer' }}
                            >
                              {item.noteName}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSubTab === 'ledger' && (
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Search & Filter bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '4px', padding: '2px', border: '1px solid var(--border-color)' }}>
                  {(['all', 'gelir', 'gider', 'yatirim', 'tasarruf'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setLedgerFilter(t)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '3px',
                        border: 'none',
                        fontSize: '11px',
                        cursor: 'pointer',
                        background: ledgerFilter === t ? 'var(--bg-hover)' : 'transparent',
                        color: ledgerFilter === t ? 'var(--text-primary)' : 'var(--text-muted)',
                        textTransform: 'capitalize'
                      }}
                    >
                      {t === 'all' ? 'Tümü' : t === 'gider' ? 'Harcama' : t === 'yatirim' ? 'Yatırım' : t}
                    </button>
                  ))}
                </div>

                <select
                  value={ledgerSourceFilter}
                  onChange={(e) => setLedgerSourceFilter(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    fontSize: '11.5px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                >
                  <option value="all">Tüm Kaynaklar</option>
                  {financeData.resources.map(res => (
                    <option key={res.name} value={res.name}>{res.name}</option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                placeholder="Açıklama, not veya yer ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  width: '200px'
                }}
              />
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredTransactions.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '32px 0' }}>Hiç işlem kaydı bulunamadı.</div>
              ) : (
                filteredTransactions.map(t => {
                  const typeColor = t.type === 'gelir' ? '#10b981' : t.type === 'gider' ? '#ef4444' : t.type === 'yatirim' ? '#f59e0b' : '#a855f7';
                  const typeLabel = t.type === 'gelir' ? '📥 Gelir' : t.type === 'gider' ? '💸 Harcama' : t.type === 'yatirim' ? '📈 Yatırım' : '🏦 Tasarruf';

                  return (
                    <div 
                      key={t.id} 
                      className="finance-transaction-row"
                    >
                      <div className="finance-transaction-info">
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', width: '70px' }}>{t.date}</div>
                        <div>
                          <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{t.description}</div>
                          <div className="finance-transaction-meta">
                            <span>Not: <strong onClick={() => onSelectNote(t.notePath)} style={{ textDecoration: 'underline', color: 'var(--accent-color)', cursor: 'pointer' }}>{t.noteName}</strong></span>
                            {t.location && t.location !== 'Genel' && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><MapPin size={9} /> {t.location}</span>
                            )}
                            {t.kaynak && t.kaynak !== 'Genel' && (
                              <span style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: '4px', fontSize: '9.5px', color: 'var(--text-secondary)' }}>
                                💳 {t.kaynak}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="finance-transaction-amount">
                        <div style={{ fontWeight: 'bold', color: typeColor }}>
                          {t.type === 'gelir' ? '+' : '-'}{t.amount.toLocaleString('tr-TR')} TL
                        </div>
                        <div style={{ fontSize: '9px', color: typeColor, fontWeight: '500' }}>{typeLabel}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
