import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  BookOpen, Check, X, Search, Layers, RefreshCw, Plus, Calendar, FileText, ArrowRight, Star
} from 'lucide-react';

interface CardItem {
  filePath: string;
  lineIdx: number;
  originalLine: string;
  question: string;
  answer: string;
  box: number; // 1-5
  dueDate: string; // YYYY-MM-DD
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Hafıza sarayındaki odaların, koordinatlarının, görsel loci (mekan) nesnelerinin ve parçacık efektlerinin tanımları.
export interface LocusDef {
  id: string;
  name: string;
  emoji: string;
  x: number; // oda içi koordinat x
  y: number; // oda içi koordinat y
  description: string;
}

export interface RoomDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
  x: number; // harita koordinat x
  y: number; // harita koordinat y
  w: number; // harita koordinat genişlik
  h: number; // harita koordinat yükseklik
  loci: LocusDef[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
}

export const PALACE_ROOMS: RoomDef[] = [
  {
    id: 'library',
    name: 'Gök Kütüphane',
    emoji: '📚',
    color: '#3b82f6',
    x: 30, y: 30, w: 250, h: 150,
    loci: [
      { id: 'lib_desk', name: 'Çalışma Masası', emoji: '💻', x: 150, y: 120, description: 'Genel odaklı ezberler' },
      { id: 'lib_shelf', name: 'Dev Kitaplık', emoji: '📚', x: 450, y: 120, description: 'Akademik ve teorik bilgiler' },
      { id: 'lib_globe', name: 'Yeryüzü Küresi', emoji: '🌐', x: 150, y: 280, description: 'Tarih, coğrafya ve genel kültür' },
      { id: 'lib_fireplace', name: 'Şömine Köşesi', emoji: '🔥', x: 450, y: 280, description: 'Sanat, edebiyat ve sosyal bilimler' }
    ]
  },
  {
    id: 'garden',
    name: 'Zen Bahçesi',
    emoji: '🌿',
    color: '#10b981',
    x: 320, y: 30, w: 250, h: 150,
    loci: [
      { id: 'zen_pond', name: 'Koi Havuzu', emoji: '💧', x: 150, y: 120, description: 'Zihin rahatlatıcı tekrar kartları' },
      { id: 'zen_tree', name: 'Sakura Ağacı', emoji: '🌸', x: 450, y: 120, description: 'Dil kelimeleri ve konuşma kalıpları' },
      { id: 'zen_bench', name: 'Bambu Çay Masası', emoji: '🍵', x: 150, y: 280, description: 'Fikirler ve yaratıcı notlar' },
      { id: 'zen_lantern', name: 'Taş Fener', emoji: '🏮', x: 450, y: 280, description: 'Felsefi kavramlar ve derin teoriler' }
    ]
  },
  {
    id: 'vault',
    name: 'Gizemli Zindan',
    emoji: '💎',
    color: '#8b5cf6',
    x: 30, y: 220, w: 250, h: 150,
    loci: [
      { id: 'vault_chest', name: 'Kilitli Sandık', emoji: '📦', x: 150, y: 120, description: 'En zor, sık unutulan kritik bilgiler' },
      { id: 'vault_table', name: 'Simya Tezgahı', emoji: '🧪', x: 450, y: 120, description: 'Matematik ve fen formülleri' },
      { id: 'vault_altar', name: 'Sunak Taşı', emoji: '🪨', x: 150, y: 280, description: 'Yazılım syntax ve algoritmik yapılar' },
      { id: 'vault_cage', name: 'Demir Kafes', emoji: '⛓️', x: 450, y: 280, description: 'Defalarca yanlış yapılan sarmal hatalar' }
    ]
  },
  {
    id: 'hall',
    name: 'Giriş Salonu',
    emoji: '🏛️',
    color: '#f59e0b',
    x: 320, y: 220, w: 250, h: 150,
    loci: [
      { id: 'hall_fountain', name: 'Giriş Çeşmesi', emoji: '⛲', x: 150, y: 120, description: 'Basit ve temel tanım kartları' },
      { id: 'hall_armor', name: 'Şövalye Zırhı', emoji: '🛡️', x: 450, y: 120, description: 'Mantıksal ve stratejik teoriler' },
      { id: 'hall_gallery', name: 'Resim Galerisi', emoji: '🖼️', x: 150, y: 280, description: 'Görsel veya diyagram içeren bilgiler' },
      { id: 'hall_rug', name: 'Büyük Halı', emoji: '🛋️', x: 450, y: 280, description: 'Genel tekrar ve hızlı kartlar' }
    ]
  }
];

export const getDeterministicLocus = (question: string) => {
  let hash = 0;
  for (let i = 0; i < question.length; i++) {
    hash = question.charCodeAt(i) + ((hash << 5) - hash);
  }
  const allLociIds = [
    'lib_desk', 'lib_shelf', 'lib_globe', 'lib_fireplace',
    'zen_pond', 'zen_tree', 'zen_bench', 'zen_lantern',
    'hall_fountain', 'hall_armor', 'hall_gallery', 'hall_rug',
    'vault_chest', 'vault_table', 'vault_altar', 'vault_cage'
  ];
  return allLociIds[Math.abs(hash) % 16];
};

interface FlashcardViewProps {
  notes: any[];
  fileContents: Record<string, string>;
  onSelectNote: (path: string) => void;
  onSaveNote: (path: string, content: string) => Promise<void>;
  // BUG DÜZELTMESİ: native window.confirm() yerine App.tsx'teki paylaşılan uygulama-içi
  // onay modalını kullanır (confirm() gerçek bir pencere blur/focus olayı tetiklemediği
  // için odağa dayalı temizleme mekanizmaları silme onayı sırasında hiç çalışmıyordu).
  onRequestConfirm?: (message: string, onConfirm: () => void) => void;
}

export default function FlashcardView({
  notes,
  fileContents,
  onSelectNote,
  onSaveNote,
  onRequestConfirm
}: FlashcardViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'review' | 'browse' | 'create' | 'palace'>('review');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Akıl Sarayı (Memory Palace) modülü için oda seçimi, lokasyon odaklanması ve animasyonlu durumsal state'ler.
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);
  const [hoveredLocus, setHoveredLocus] = useState<LocusDef | null>(null);
  const [selectedLocus, setSelectedLocus] = useState<LocusDef | null>(null);
  const [locusReviewQueue, setLocusReviewQueue] = useState<CardItem[]>([]);
  const [locusReviewIndex, setLocusReviewIndex] = useState(0);
  const [locusReviewFlipped, setLocusReviewFlipped] = useState(false);
  const [isPalaceHelpOpen, setIsPalaceHelpOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Yerel hafızadaki elle atanan loci koordinat haritasını okur/yazar
  const [manualLoci, setManualLoci] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('focus_srs_palace_loci') || '{}');
    } catch {
      return {};
    }
  });

  const saveManualLocus = (cardKey: string, locusId: string) => {
    const next = { ...manualLoci, [cardKey]: locusId };
    setManualLoci(next);
    localStorage.setItem('focus_srs_palace_loci', JSON.stringify(next));
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Hafıza sarayındaki loci (lokasyon) kart sorgulamalarını gerçekleştiren filtreler.
  const getCardLocus = (card: CardItem) => {
    const key = `${card.filePath}:${card.lineIdx}`;
    return manualLoci[key] || getDeterministicLocus(card.question);
  };

  const getCardsForLocus = (locusId: string) => {
    return allCards.filter(card => getCardLocus(card) === locusId);
  };

  const getDueCardsForLocus = (locusId: string, todayStr: string) => {
    return getCardsForLocus(locusId).filter(card => card.dueDate <= todayStr);
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Akıl Sarayı etkileşim olayları ve lokasyona göre kart çalışma oturumlarını başlayan işleyiciler.
  const handleSelectLocus = (locus: LocusDef) => {
    const todayStr = getTodayStr();
    const due = getDueCardsForLocus(locus.id, todayStr);
    
    if (due.length > 0) {
      setLocusReviewQueue(due);
      setLocusReviewIndex(0);
      setLocusReviewFlipped(false);
      setSelectedLocus(locus);
    } else {
      const allLocusCards = getCardsForLocus(locus.id);
      if (allLocusCards.length > 0) {
        const message = `Bu konumdaki tüm kartlar güncel (tekrara hazır değil). Yine de hepsini (${allLocusCards.length} adet) tekrar etmek ister misiniz?`;
        const startReview = () => {
          setLocusReviewQueue(allLocusCards);
          setLocusReviewIndex(0);
          setLocusReviewFlipped(false);
          setSelectedLocus(locus);
        };
        if (onRequestConfirm) {
          onRequestConfirm(message, startReview);
        } else if (confirm(message)) {
          startReview();
        }
      } else {
        alert("Bu lokasyon boş! Not kartları listesinden buraya kart yerleştirebilirsiniz.");
      }
    }
  };

  const handleLocusRating = async (isCorrect: boolean) => {
    if (locusReviewQueue.length === 0 || !selectedLocus) return;

    const currentCard = locusReviewQueue[locusReviewIndex];
    setLocusReviewFlipped(false);
    
    setTimeout(async () => {
      await updateCardInFile(currentCard, isCorrect);
      
      const newQueue = [...locusReviewQueue];
      newQueue.splice(locusReviewIndex, 1);
      
      if (newQueue.length > 0) {
        setLocusReviewQueue(newQueue);
        if (locusReviewIndex >= newQueue.length) {
          setLocusReviewIndex(0);
        }
      } else {
        setLocusReviewQueue([]);
        setSelectedLocus(null);
        alert(`Tebrikler! "${selectedLocus.name}" konumundaki tüm kartlar başarıyla çalışıldı. 🌟`);
      }
    }, 200);
  };

  // Create tab state
  const [selectedNoteForCreate, setSelectedNoteForCreate] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState({ text: '', type: '' });

  // Review state
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<CardItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [initialQueueSize, setInitialQueueSize] = useState(0);

  // Helper: Get today's date string in YYYY-MM-DD local format
  const getTodayStr = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  // 1. Parse all cards from markdown notes
  const allCards = useMemo(() => {
    const cards: CardItem[] = [];
    const cardRegex = /\[card:\s*([^\]]+?)\s*\|\|\s*([^\]]+?)\s*\](?:\s*\[srs:\s*box(\d+),\s*(\d{4}-\d{2}-\d{2})\s*\])?/g;

    Object.entries(fileContents).forEach(([filePath, content]) => {
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Reset regex index for safety
        cardRegex.lastIndex = 0;
        const match = cardRegex.exec(line);
        if (match) {
          const question = match[1].trim();
          const answer = match[2].trim();
          const box = match[3] ? parseInt(match[3]) : 1;
          const dueDate = match[4] || getTodayStr();
          
          cards.push({
            filePath,
            lineIdx: idx,
            originalLine: line,
            question,
            answer,
            box,
            dueDate
          });
        }
      });
    });

    return cards;
  }, [fileContents]);

  // Initialize review queue
  useEffect(() => {
    if (activeSubTab === 'review') {
      const todayStr = getTodayStr();
      const due = allCards.filter(card => card.dueDate <= todayStr);
      setReviewQueue(due);
      setCurrentQueueIndex(0);
      setCompletedCount(0);
      setInitialQueueSize(due.length);
      setIsFlipped(false);
    }
  }, [allCards, activeSubTab]);

  // Spacing helper for Leitner system
  const getIntervalDays = (box: number) => {
    switch (box) {
      case 1: return 1;
      case 2: return 2;
      case 3: return 4;
      case 4: return 7;
      case 5: return 14;
      default: return 1;
    }
  };

  // Update card in markdown note
  const updateCardInFile = async (card: CardItem, isCorrect: boolean) => {
    const fileContent = fileContents[card.filePath];
    if (!fileContent) return;

    const lines = fileContent.split('\n');
    let lineToUpdate = lines[card.lineIdx];
    
    // Safety check: if line doesn't match, search for it
    if (!lineToUpdate.includes(card.question) || !lineToUpdate.includes(card.answer)) {
      const foundIdx = lines.findIndex(l => l.includes(card.question) && l.includes(card.answer));
      if (foundIdx !== -1) {
        card.lineIdx = foundIdx;
        lineToUpdate = lines[foundIdx];
      } else {
        console.error("Card line not found in file content!");
        return;
      }
    }

    const nextBox = isCorrect ? Math.min(card.box + 1, 5) : 1;
    const intervalDays = getIntervalDays(nextBox);
    
    const now = new Date();
    now.setDate(now.getDate() + intervalDays);
    const nextDueDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Construct the new card line
    const baseCardText = `[card: ${card.question} || ${card.answer}]`;
    const newSRSMeta = ` [srs: box${nextBox}, ${nextDueDateStr}]`;
    
    // Replace the card block on that line
    const cardRegex = /\[card:\s*([^\]]+?)\s*\|\|\s*([^\]]+?)\s*\](?:\s*\[srs:\s*box(\d+),\s*(\d{4}-\d{2}-\d{2})\s*\])?/;
    lines[card.lineIdx] = lineToUpdate.replace(cardRegex, `${baseCardText}${newSRSMeta}`);

    const newContent = lines.join('\n');
    await onSaveNote(card.filePath, newContent);
  };

  // Handle Review Actions
  const handleRating = async (isCorrect: boolean) => {
    if (reviewQueue.length === 0) return;

    const currentCard = reviewQueue[currentQueueIndex];
    setIsFlipped(false);
    
    // Wait a brief moment for flip-back animation before changing card
    setTimeout(async () => {
      await updateCardInFile(currentCard, isCorrect);
      
      if (isCorrect) {
        // Remove from current queue
        const newQueue = [...reviewQueue];
        newQueue.splice(currentQueueIndex, 1);
        setReviewQueue(newQueue);
        setCompletedCount(prev => prev + 1);
        // If we removed item, currentQueueIndex stays same (points to next item)
        if (currentQueueIndex >= newQueue.length && newQueue.length > 0) {
          setCurrentQueueIndex(0);
        }
      } else {
        // Move to the end of the queue for review in current session
        const newQueue = [...reviewQueue];
        const failedItem = newQueue.splice(currentQueueIndex, 1)[0];
        
        // Update local object stats so it shows box1
        failedItem.box = 1;
        newQueue.push(failedItem);
        
        setReviewQueue(newQueue);
        // Move to next card or back to start
        if (currentQueueIndex >= newQueue.length - 1) {
          setCurrentQueueIndex(0);
        }
      }
    }, 200);
  };

  // Add new card
  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNoteForCreate || !newQuestion.trim() || !newAnswer.trim()) {
      setCreateMessage({ text: 'Lütfen tüm alanları doldurun.', type: 'error' });
      return;
    }

    setIsCreating(true);
    setCreateMessage({ text: '', type: '' });

    try {
      const currentContent = fileContents[selectedNoteForCreate] || '';
      const cardStr = `\n[card: ${newQuestion.trim()} || ${newAnswer.trim()}] [srs: box1, ${getTodayStr()}]`;
      const updatedContent = currentContent ? `${currentContent.trimEnd()}${cardStr}\n` : cardStr.trim();
      
      await onSaveNote(selectedNoteForCreate, updatedContent);
      setCreateMessage({ text: 'Kart başarıyla oluşturuldu!', type: 'success' });
      setNewQuestion('');
      setNewAnswer('');
    } catch (err) {
      console.error(err);
      setCreateMessage({ text: 'Kart oluşturulurken hata meydana geldi.', type: 'error' });
    } finally {
      setIsCreating(false);
    }
  };

  // Filtered Cards for browsing
  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return allCards;
    const q = searchQuery.toLowerCase();
    return allCards.filter(card => 
      card.question.toLowerCase().includes(q) || 
      card.answer.toLowerCase().includes(q) ||
      card.filePath.toLowerCase().includes(q)
    );
  }, [allCards, searchQuery]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Hafıza Sarayı canvas etkileşimleri (tıklama, üzerine gelme) için fare koordinat dinleyicileri.
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (activeRoom === null) {
      // Kuş bakışı saray haritasında oda tıklama tespiti
      const room = PALACE_ROOMS.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      if (room) {
        setActiveRoom(room.id);
      }
    } else {
      // Zoom-in oda görünümündeyken "Geri Dön" butonu tıklama tespiti
      if (x >= 10 && x <= 120 && y >= 10 && y <= 40) {
        setActiveRoom(null);
        setHoveredLocus(null);
        return;
      }
      
      // Odadaki loci nesnelerinin (nesnelerin parlayan halkaları) tıklama tespiti
      const room = PALACE_ROOMS.find(r => r.id === activeRoom);
      if (room) {
        const hitLocus = room.loci.find(l => {
          const dist = Math.sqrt((x - l.x) ** 2 + (y - l.y) ** 2);
          return dist <= 25;
        });
        if (hitLocus) {
          handleSelectLocus(hitLocus);
        }
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (activeRoom === null) {
      // Kuş bakışı oda hover tespiti
      const room = PALACE_ROOMS.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      setHoveredRoom(room ? room.id : null);
      setHoveredLocus(null);
    } else {
      // Oda içi loci nesneleri hover tespiti (tooltip göstermek için)
      const room = PALACE_ROOMS.find(r => r.id === activeRoom);
      if (room) {
        const locus = room.loci.find(l => {
          const dist = Math.sqrt((x - l.x) ** 2 + (y - l.y) ** 2);
          return dist <= 25;
        });
        setHoveredLocus(locus || null);
      }
      setHoveredRoom(null);
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Hafıza sarayındaki odaları, loci nesnelerini ve ortam parçacıklarını animasyonlu olarak çizdiren render döngüsü.
  useEffect(() => {
    if (activeSubTab !== 'palace') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationId: number;
    const particles: Particle[] = [];
    const maxParticles = 40;
    
    const render = () => {
      ctx.clearRect(0, 0, 600, 400);
      const todayStr = getTodayStr();

      // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
      // Bu sahne Canvas API ile elle çiziliyor; CSS değişkenlerine bağlı değil,
      // dolayısıyla uygulama tema değiştirse bile sabit koyu renklerde kalıyordu.
      // Yapısal renkleri (zemin, ızgara, sınırlar, soluk metin) açık/koyu temaya
      // göre seçilen bir palet üzerinden çiziyoruz; canlı vurgu/durum renklerine
      // (oda renkleri, kırmızı/yeşil, parçacıklar) dokunmuyoruz — onlar zaten
      // her iki temada da okunaklı.
      const isLight = document.documentElement.classList.contains('light-theme');
      const palette = isLight
        ? { mapBg: '#eef1f6', roomBg: 'rgba(255, 255, 255, 0.75)', roomBgHover: 'rgba(226, 232, 240, 0.9)', gridLine: 'rgba(15, 23, 42, 0.05)', roomBorder: 'rgba(15, 23, 42, 0.1)', titleText: '#0f172a', mutedText: 'rgba(15, 23, 42, 0.35)', mutedText2: 'rgba(15, 23, 42, 0.55)' }
        : { mapBg: '#0b0f19', roomBg: 'rgba(15, 23, 42, 0.7)', roomBgHover: 'rgba(30, 41, 59, 0.85)', gridLine: 'rgba(255, 255, 255, 0.02)', roomBorder: 'rgba(255, 255, 255, 0.08)', titleText: '#fff', mutedText: 'rgba(255,255,255,0.35)', mutedText2: 'rgba(255,255,255,0.6)' };

      if (activeRoom === null) {
        // --- 1. SARAY HARİTASI (KUŞ BAKIŞI) ---
        ctx.fillStyle = palette.mapBg;
        ctx.fillRect(0, 0, 600, 400);

        // Zemin ızgara çizgileri
        ctx.strokeStyle = palette.gridLine;
        ctx.lineWidth = 1;
        for (let i = 0; i < 600; i += 30) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 400); ctx.stroke();
        }
        for (let j = 0; j < 400; j += 30) {
          ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(600, j); ctx.stroke();
        }
        
        // Sınır koridor çizgileri
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(300, 0); ctx.lineTo(300, 400); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(600, 200); ctx.stroke();
        
        // Merkez saray arması
        ctx.fillStyle = 'rgba(99, 102, 241, 0.05)';
        ctx.beginPath(); ctx.arc(300, 200, 30, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.beginPath(); ctx.arc(300, 200, 20, 0, Math.PI * 2); ctx.stroke();
        
        // Odaların çizimi
        PALACE_ROOMS.forEach(room => {
          const isHovered = hoveredRoom === room.id;
          
          let roomTotal = 0;
          let roomDue = 0;
          room.loci.forEach(l => {
            const cards = getCardsForLocus(l.id);
            roomTotal += cards.length;
            roomDue += cards.filter(c => c.dueDate <= todayStr).length;
          });
          
          // Oda kutusu
          ctx.fillStyle = isHovered ? palette.roomBgHover : palette.roomBg;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(room.x, room.y, room.w, room.h, 12);
          } else {
            ctx.rect(room.x, room.y, room.w, room.h);
          }
          ctx.fill();

          ctx.strokeStyle = isHovered ? room.color : palette.roomBorder;
          ctx.lineWidth = isHovered ? 2 : 1;
          ctx.stroke();

          // Başlık
          ctx.font = 'bold 13px sans-serif';
          ctx.fillStyle = palette.titleText;
          ctx.textAlign = 'left';
          ctx.fillText(`${room.emoji} ${room.name}`, room.x + 16, room.y + 30);

          // Bilgiler
          ctx.font = '11px sans-serif';
          if (roomTotal === 0) {
            ctx.fillStyle = palette.mutedText;
            ctx.fillText('Lokasyon Boş', room.x + 16, room.y + 62);
          } else {
            ctx.fillStyle = palette.mutedText2;
            ctx.fillText(`Toplam: ${roomTotal} Kart`, room.x + 16, room.y + 58);
            
            if (roomDue > 0) {
              ctx.fillStyle = '#f87171';
              ctx.fillText(`⚠️ ${roomDue} Tekrar Bekliyor`, room.x + 16, room.y + 80);
              
              // Tekrar bekleyen kartlar varsa odaya neon ışıma ver
              ctx.strokeStyle = `${room.color}22`;
              ctx.lineWidth = 4 + Math.sin(Date.now() / 150) * 2;
              ctx.beginPath();
              if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(room.x - 2, room.y - 2, room.w + 4, room.h + 4, 14);
              } else {
                ctx.rect(room.x - 2, room.y - 2, room.w + 4, room.h + 4);
              }
              ctx.stroke();
            } else {
              ctx.fillStyle = '#34d399';
              ctx.fillText('💚 Zihin Taze (Temiz)', room.x + 16, room.y + 80);
            }
          }
          
          if (isHovered) {
            ctx.fillStyle = room.color;
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText('GİRMEK İÇİN TIKLAYIN ➔', room.x + 16, room.y + room.h - 16);
          }
        });
      } else {
        // --- 2. ODA GÖRÜNÜMÜ (ZOOMED) ---
        const room = PALACE_ROOMS.find(r => r.id === activeRoom)!;
        
        ctx.fillStyle = isLight ? '#f4f6fa' : '#060a13';
        ctx.fillRect(0, 0, 600, 400);

        // "Geri Dön" butonu çizimi
        ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.04)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(10, 10, 100, 30, 6);
        } else {
          ctx.rect(10, 10, 100, 30);
        }
        ctx.fill();
        ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255, 255, 255, 0.15)';
        ctx.stroke();

        ctx.font = '11.5px sans-serif';
        ctx.fillStyle = isLight ? '#334155' : '#cbd5e1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⬅ Saraya Dön', 60, 25);

        // Oda Başlığı
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = palette.titleText;
        ctx.textAlign = 'left';
        ctx.fillText(`${room.emoji} ${room.name}`, 130, 25);

        // Oda sınır duvarları
        ctx.strokeStyle = `${room.color}33`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(30, 50, 540, 320, 16);
        } else {
          ctx.rect(30, 50, 540, 320);
        }
        ctx.stroke();

        // Oda içi karo ızgarası
        ctx.strokeStyle = palette.gridLine;
        ctx.lineWidth = 1;
        for (let i = 50; i < 550; i += 25) {
          ctx.beginPath(); ctx.moveTo(i, 60); ctx.lineTo(i, 360); ctx.stroke();
        }
        for (let j = 60; j < 360; j += 25) {
          ctx.beginPath(); ctx.moveTo(40, j); ctx.lineTo(560, j); ctx.stroke();
        }
        
        // Oda tipine göre uçuşan parçacıkların oluşturulması (sakura yaprağı, şömine kıvılcımı vb.)
        if (particles.length < maxParticles && Math.random() < 0.18) {
          let pColor = '#fbbf24';
          let vx = (Math.random() - 0.5) * 0.4;
          let vy = -0.3 - Math.random() * 0.4;
          let life = 100 + Math.random() * 100;
          
          if (room.id === 'garden') {
            pColor = '#f472b6'; // Pembe sakura yaprakları
            vx = -0.5 - Math.random() * 0.6;
            vy = 0.5 + Math.random() * 0.6;
          } else if (room.id === 'vault') {
            pColor = '#a78bfa'; // Zindan mistik mor gazı
            vx = (Math.random() - 0.5) * 0.5;
            vy = -0.4 - Math.random() * 0.4;
          } else if (room.id === 'hall') {
            pColor = '#60a5fa'; // Giriş çeşmesi su baloncukları
            vx = (Math.random() - 0.5) * 0.3;
            vy = -0.7 - Math.random() * 0.7;
          }
          
          particles.push({
            x: room.id === 'garden' ? 450 + Math.random() * 100 : 80 + Math.random() * 440,
            y: room.id === 'garden' ? 60 : 350,
            vx, vy,
            size: 1.5 + Math.random() * 2,
            color: pColor,
            alpha: 0.3 + Math.random() * 0.5,
            life
          });
        }
        
        // Parçacıkları güncelle ve çiz
        particles.forEach((p, idx) => {
          p.x += p.vx;
          p.y += p.vy;
          p.life--;
          
          ctx.save();
          ctx.globalAlpha = p.alpha * (p.life / 200);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          if (room.id === 'garden') {
            ctx.translate(p.x, p.y);
            ctx.rotate(p.life * 0.02);
            ctx.ellipse(0, 0, p.size * 1.5, p.size * 0.7, 0, 0, Math.PI * 2);
          } else {
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.restore();
          
          if (p.life <= 0 || p.x < 40 || p.x > 560 || p.y < 60 || p.y > 360) {
            particles.splice(idx, 1);
          }
        });
        
        // Loci (Nesne Konumları) çizimi
        room.loci.forEach(locus => {
          const isLocusHovered = hoveredLocus?.id === locus.id;
          
          const locusCards = getCardsForLocus(locus.id);
          const locusDue = locusCards.filter(c => c.dueDate <= todayStr);
          
          let pulseColor = 'rgba(100, 116, 139, 0.4)';
          let ringColor = 'rgba(100, 116, 139, 0.2)';
          
          if (locusCards.length > 0) {
            if (locusDue.length > 0) {
              pulseColor = '#ef4444'; // Tekrar var (Kırmızı)
              ringColor = 'rgba(239, 68, 68, 0.4)';
            } else {
              pulseColor = '#10b981'; // Çalışılmış (Yeşil)
              ringColor = 'rgba(16, 185, 129, 0.4)';
            }
          }
          
          // Parıldama halkası çizimi
          if (locusCards.length > 0) {
            const radPulse = 18 + Math.sin(Date.now() / 150) * 4;
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(locus.x, locus.y, radPulse, 0, Math.PI * 2);
            ctx.stroke();
          }
          
          // Nesne dairesi arka planı
          ctx.fillStyle = isLocusHovered
            ? (isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255,255,255,0.08)')
            : (isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(0, 0, 0, 0.4)');
          ctx.beginPath();
          ctx.arc(locus.x, locus.y, 25, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = isLocusHovered ? palette.titleText : (isLight ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255,255,255,0.1)');
          ctx.lineWidth = isLocusHovered ? 2 : 1;
          ctx.beginPath();
          ctx.arc(locus.x, locus.y, 25, 0, Math.PI * 2);
          ctx.stroke();
          
          // Merkez durum noktası
          ctx.fillStyle = pulseColor;
          ctx.beginPath();
          ctx.arc(locus.x, locus.y, 6, 0, Math.PI * 2);
          ctx.fill();
          
          // Nesne Emojisi
          ctx.font = '16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(locus.emoji, locus.x, locus.y - 1);
          
          // Nesne İsmi
          ctx.font = '11px sans-serif';
          ctx.fillStyle = isLocusHovered ? palette.titleText : (isLight ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255,255,255,0.7)');
          ctx.fillText(locus.name, locus.x, locus.y + 40);
          
          // Görev bekleyen kart sayısı balonu
          if (locusCards.length > 0) {
            ctx.fillStyle = locusDue.length > 0 ? '#ef4444' : '#10b981';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(locus.x + 12, locus.y - 25, 20, 14, 4);
            } else {
              ctx.rect(locus.x + 12, locus.y - 25, 20, 14);
            }
            ctx.fill();
            
            ctx.font = '9px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.fillText(locusDue.length > 0 ? String(locusDue.length) : '✓', locus.x + 22, locus.y - 18);
          }
        });
      }
      
      animationId = requestAnimationFrame(render);
    };
    
    render();
    
    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [activeSubTab, activeRoom, hoveredRoom, hoveredLocus, allCards, manualLoci]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px', boxSizing: 'border-box', overflowY: 'auto', background: 'var(--bg-main)' }}>
      {/* Dynamic Style injection */}
      <style dangerouslySetInnerHTML={{__html: `
        .srs-subtab-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          padding: 8px 16px;
          font-size: 14px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .srs-subtab-btn.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
          font-weight: 500;
        }
        .srs-card-container {
          perspective: 1000px;
          width: 100%;
          max-width: 550px;
          height: 320px;
          margin: 0 auto;
        }
        .srs-card-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
          transform-style: preserve-3d;
          cursor: pointer;
        }
        .srs-card-container.flipped .srs-card-inner {
          transform: rotateY(180deg);
        }
        .srs-card-face {
          position: absolute;
          width: 100%;
          height: 100%;
          backface-visibility: hidden;
          border-radius: 16px;
          padding: 32px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .srs-card-front {
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8));
          backdrop-filter: blur(12px);
          color: var(--text-main);
        }
        .srs-card-back {
          background: linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(15, 23, 42, 0.9));
          border-color: rgba(99, 102, 241, 0.2);
          backdrop-filter: blur(12px);
          color: var(--text-main);
          transform: rotateY(180deg);
        }
        .srs-box-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 99px;
          font-weight: 500;
        }
        .srs-box-1 { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); }
        .srs-box-2 { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2); }
        .srs-box-3 { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); }
        .srs-box-4 { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }
        .srs-box-5 { background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.2); }
      `}} />

      {/* Main Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)' }}>
            <Layers style={{ color: 'var(--accent)' }} /> Ezber Kartları (Spaced Repetition)
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Leitner 5-Kutu aralıklı tekrar sistemi ile bilgilerinizi kalıcı hafızaya aktarın.
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.02)', padding: '4px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button 
            className={`srs-subtab-btn ${activeSubTab === 'review' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('review')}
          >
            <RefreshCw size={14} /> Çalışma ({reviewQueue.length} Kart)
          </button>
          <button 
            className={`srs-subtab-btn ${activeSubTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('browse')}
          >
            <BookOpen size={14} /> Deste ({allCards.length} Kart)
          </button>
          <button 
            className={`srs-subtab-btn ${activeSubTab === 'create' ? 'active' : ''}`}
            onClick={() => {
              setActiveSubTab('create');
              setCreateMessage({ text: '', type: '' });
              if (notes.length > 0 && !selectedNoteForCreate) {
                setSelectedNoteForCreate(notes[0].path);
              }
            }}
          >
            {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                Akıl Sarayı görünümü alt sekme geçiş butonu. */}
            <Plus size={14} /> Kart Ekle
          </button>
          <button 
            className={`srs-subtab-btn ${activeSubTab === 'palace' ? 'active' : ''}`}
            onClick={() => setActiveSubTab('palace')}
          >
            <span>🏛️</span> Akıl Sarayı
          </button>
        </div>
      </div>

      {/* SUBTAB 1: REVIEW (STUDY SESSION) */}
      {activeSubTab === 'review' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '400px' }}>
          {reviewQueue.length > 0 ? (
            <div style={{ width: '100%', maxWidth: '550px' }}>
              {/* Progress and indicators */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                <span>Tamamlanan: {completedCount} / {initialQueueSize}</span>
                <span className={`srs-box-badge srs-box-${reviewQueue[currentQueueIndex].box}`}>
                  Kutu {reviewQueue[currentQueueIndex].box} ({getIntervalDays(reviewQueue[currentQueueIndex].box)} gün)
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', marginBottom: '24px', overflow: 'hidden' }}>
                <div style={{ 
                  width: `${initialQueueSize > 0 ? (completedCount / initialQueueSize) * 100 : 0}%`, 
                  height: '100%', 
                  background: 'var(--accent)', 
                  transition: 'width 0.4s ease' 
                }} />
              </div>

              {/* Interactive Flippable Card */}
              <div 
                className={`srs-card-container ${isFlipped ? 'flipped' : ''}`}
                onClick={() => setIsFlipped(!isFlipped)}
              >
                <div className="srs-card-inner">
                  {/* Front Side: Question */}
                  <div className="srs-card-face srs-card-front">
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>Soru</span>
                    <div style={{ fontSize: '18px', fontWeight: 500, textAlign: 'center', lineHeight: 1.5, overflowY: 'auto', maxHeight: '180px', width: '100%' }}>
                      {reviewQueue[currentQueueIndex].question}
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '24px', opacity: 0.8 }}>Çevirmek için Tıkla</span>
                  </div>

                  {/* Back Side: Answer */}
                  <div className="srs-card-face srs-card-back">
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '16px' }}>Cevap</span>
                    <div style={{ fontSize: '18px', fontWeight: 500, textAlign: 'center', lineHeight: 1.5, overflowY: 'auto', maxHeight: '180px', width: '100%', color: '#818cf8' }}>
                      {reviewQueue[currentQueueIndex].answer}
                    </div>
                    <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '24px' }}>Gizlemek için Tıkla</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '16px', marginTop: '32px', justifyContent: 'center' }}>
                <button
                  onClick={() => handleRating(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 28px',
                    borderRadius: '99px',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: '#f87171',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                    e.currentTarget.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <X size={16} /> Bilemedim (Kutu 1)
                </button>
                <button
                  onClick={() => handleRating(true)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 28px',
                    borderRadius: '99px',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34d399',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
                    e.currentTarget.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <Check size={16} /> Bildim (Kutu+)
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px', background: 'rgba(255,255,255,0.01)', border: '1px dashed rgba(255,255,255,0.05)', borderRadius: '16px', maxWidth: '400px' }}>
              <Star size={48} style={{ color: '#fbbf24', marginBottom: '16px', filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.3))' }} />
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600, color: 'var(--text-main)' }}>Harika! Bugünlük Bitti</h3>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Bugün tekrar etmeniz gereken tüm ezber kartlarını başarıyla bitirdiniz. Yeni kartlar eklendikçe veya süreleri doldukça burada belirecektir.
              </p>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: BROWSE DECK */}
      {activeSubTab === 'browse' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
          {/* Search input */}
          <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Kartlarda veya dosya isimlerinde ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--text-main)',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Cards List */}
          {filteredCards.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '8px' }}>
              {filteredCards.map((card, idx) => (
                <div 
                  key={idx} 
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                  }}
                >
                  <div>
                    {/* Card Meta */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span className={`srs-box-badge srs-box-${card.box}`}>
                        Kutu {card.box}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={10} /> Tekrar: {card.dueDate}
                      </span>
                    </div>

                    {/* Question & Answer */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-main)' }}>
                        <strong>S:</strong> {card.question}
                      </div>
                      <div style={{ fontSize: '13px', color: '#818cf8', borderTop: '1px dashed rgba(255,255,255,0.04)', paddingTop: '6px', marginTop: '2px' }}>
                        <strong>C:</strong> {card.answer}
                      </div>
                    </div>
                  </div>

                  {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                      Kartı Akıl Sarayında istenen Locus (mekansal konum) nesnesine atamayı sağlayan seçici. */}
                  <div style={{ margin: '0 16px 12px 16px', display: 'flex', alignItems: 'center', gap: '6px', borderTop: '1px dashed rgba(255,255,255,0.03)', paddingTop: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>📍 Saray Konumu:</span>
                    <select
                      value={manualLoci[`${card.filePath}:${card.lineIdx}`] || getDeterministicLocus(card.question)}
                      onChange={(e) => saveManualLocus(`${card.filePath}:${card.lineIdx}`, e.target.value)}
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#fff',
                        fontSize: '11px',
                        borderRadius: '4px',
                        padding: '2px 4px',
                        outline: 'none',
                        cursor: 'pointer',
                        maxWidth: '160px'
                      }}
                    >
                      {PALACE_ROOMS.flatMap(room => 
                        room.loci.map(locus => (
                          <option key={locus.id} value={locus.id}>
                            {room.emoji} {locus.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {/* Note link footer */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '8px', fontSize: '11px' }}>
                    <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <FileText size={11} /> {card.filePath.split('/').pop()}
                    </span>
                    <button
                      onClick={() => onSelectNote(card.filePath)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        padding: 0,
                        fontSize: '11px',
                        fontWeight: 500
                      }}
                    >
                      Nota Git <ArrowRight size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
              Arama kriterlerine uygun kart bulunamadı.
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: CREATE CARD */}
      {activeSubTab === 'create' && (
        <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: '400px' }}>
          <form 
            onSubmit={handleCreateCard}
            style={{
              width: '100%',
              maxWidth: '500px',
              background: 'rgba(255,255,255,0.01)',
              border: '1px solid rgba(255,255,255,0.04)',
              borderRadius: '16px',
              padding: '24px',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              alignSelf: 'flex-start'
            }}
          >
            <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>Yeni Kart Oluştur</h3>

            {/* Note Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Eklenecek Not Dosyası</label>
              <select
                value={selectedNoteForCreate}
                onChange={(e) => setSelectedNoteForCreate(e.target.value)}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontSize: '13px'
                }}
              >
                {notes.map(note => (
                  <option key={note.path} value={note.path}>
                    {note.path}
                  </option>
                ))}
              </select>
            </div>

            {/* Question Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Soru (Ön Yüz)</label>
              <textarea
                placeholder="Ezberlemek istediğiniz soruyu veya terimi girin..."
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                rows={3}
                required
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontSize: '13px',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* Answer Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Cevap (Arka Yüz)</label>
              <textarea
                placeholder="Sorunun cevabını veya tanımını girin..."
                value={newAnswer}
                onChange={(e) => setNewAnswer(e.target.value)}
                rows={3}
                required
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  fontSize: '13px',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* Feedback Message */}
            {createMessage.text && (
              <div style={{
                padding: '10px',
                borderRadius: '8px',
                fontSize: '13px',
                background: createMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: createMessage.type === 'success' ? '#34d399' : '#f87171',
                border: createMessage.type === 'success' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
              }}>
                {createMessage.text}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isCreating}
              style={{
                padding: '12px',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--accent)',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.2s',
                opacity: isCreating ? 0.7 : 1
              }}
            >
              {isCreating ? 'Kart Oluşturuluyor...' : 'Kart Oluştur ve Nota Ekle'}
            </button>
          </form>
        </div>
      )}

      {/* SUBTAB 4: AKIL SARAYI (MEMORY PALACE) */}
      {activeSubTab === 'palace' && (
        <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: '410px', width: '100%', marginTop: '10px' }}>
          
          {/* Canvas Sol Kolon */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ 
              background: 'rgba(15, 23, 42, 0.4)', 
              borderRadius: '16px', 
              border: '1px solid rgba(255, 255, 255, 0.06)', 
              overflow: 'hidden',
              boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.25)'
            }}>
              <canvas
                ref={canvasRef}
                width={600}
                height={400}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMouseMove}
                style={{ display: 'block', cursor: 'pointer' }}
              />
            </div>
            
            {/* Alt Kontroller / Bilgi satırı */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', padding: '0 8px' }}>
              <span>💡 İpucu: Odalara girmek için tıklayın. Loci (nesneler) üzerindeki tekrar sayılarına tıklayarak ezber yapın.</span>
              {activeRoom && (
                <button 
                  onClick={() => { setActiveRoom(null); setHoveredLocus(null); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Saraya Dön ➔
                </button>
              )}
            </div>
          </div>
          
          {/* Bilgi Paneli / Sağ Kolon */}
          <div style={{ 
            flex: 1, 
            background: 'var(--bg-secondary)', 
            backdropFilter: 'blur(12px)',
            borderRadius: '16px', 
            border: '1px solid var(--border-color)', 
            padding: '20px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '12px',
            minHeight: '400px',
            position: 'relative'
          }}>
            {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                Kullanıcıya hafıza sarayı tekniğini anlatan interaktif rehber butonu. */}
            <button
              onClick={() => setIsPalaceHelpOpen(true)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                color: 'var(--accent)',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                zIndex: 10
              }}
            >
              ❓ Nasıl Çalışır?
            </button>

            {hoveredLocus ? (
              // 1. HOVERED LOCUS VIEW
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '24px' }}>{hoveredLocus.emoji}</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{hoveredLocus.name}</strong>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Mekansal Konum (Locus)</span>
                  </div>
                </div>
                
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0', lineHeight: 1.4 }}>
                  {hoveredLocus.description}
                </p>
                
                <div style={{ borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: '10px', marginTop: '4px' }}>
                  <strong style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Bu Konumdaki Kartlar ({getCardsForLocus(hoveredLocus.id).length}):
                  </strong>
                  
                  {getCardsForLocus(hoveredLocus.id).length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                      {getCardsForLocus(hoveredLocus.id).map((c, i) => {
                        const isDue = c.dueDate <= getTodayStr();
                        return (
                          <div key={i} style={{ 
                            padding: '8px', 
                            borderRadius: '6px', 
                            background: isDue ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-tertiary)', 
                            border: `1px solid ${isDue ? 'rgba(239,68,68,0.15)' : 'var(--border-color)'}`,
                            fontSize: '11.5px',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                              {c.question}
                            </span>
                            <span style={{ fontSize: '9px', color: isDue ? '#f87171' : 'var(--text-muted)' }}>
                              {isDue ? '⚠️ Bekliyor' : '✓ Zinde'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Burada henüz kart yok.</span>
                  )}
                </div>
              </div>
            ) : activeRoom ? (
              // 2. ACTIVE ROOM VIEW
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>
                  {PALACE_ROOMS.find(r => r.id === activeRoom)?.emoji} {PALACE_ROOMS.find(r => r.id === activeRoom)?.name} Odası
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>
                  Bu oda içindeki loci (eşya odakları) üzerinde gezinerek mekansal bağ kurabilirsiniz.
                </p>
                <div style={{ background: 'var(--bg-tertiary)', border: '1px dashed var(--border-color)', borderRadius: '8px', padding: '12px', fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '8px' }}>
                  💡 <strong>Nasıl Ezberlenir?</strong><br />
                  Seçtiğiniz lokasyondaki eşyanın (örneğin kitaplık veya koi havuzu) şeklini, sesini ve hissini gözünüzün önüne getirin ve kartın sorusunu o eşyayla bütünleştirin. Çalışırken odayı ve lokasyonları sırayla ziyaret edin.
                </div>
              </div>
            ) : (
              // 3. PALACE GENERAL STATS
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>🏛️ Akıl Sarayı Nedir?</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.45, margin: 0 }}>
                  Antik Roma'dan beri kullanılan **Mekansal Bellek (Loci)** tekniğidir. Bilgileri fiziksel lokasyonlarla ilişkilendirerek hafızanızın geri çağırma gücünü katlarsınız.
                </p>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                  <div style={{ padding: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Toplam Saray Kartı</span>
                    <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>{allCards.length}</strong>
                  </div>
                  <div style={{ padding: '10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>Tekrarı Gelen</span>
                    <strong style={{ fontSize: '18px', color: '#f87171' }}>
                      {allCards.filter(c => c.dueDate <= getTodayStr()).length}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. LOCUS STUDY MODAL OVERLAY */}
      {selectedLocus && locusReviewQueue.length > 0 && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '500px',
            padding: '24px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            {/* Close Button */}
            <button 
              onClick={() => { setSelectedLocus(null); setLocusReviewQueue([]); }}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              ✕
            </button>
            
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ fontSize: '24px' }}>{selectedLocus.emoji}</span>
              <div>
                <strong style={{ fontSize: '15px', color: '#fff' }}>{selectedLocus.name}</strong>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
                  Lokasyon Ezber Çalışması • {locusReviewIndex + 1} / {locusReviewQueue.length} Kart
                </span>
              </div>
            </div>
            
            {/* Card Body */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(255,255,255,0.04)',
              borderRadius: '12px',
              padding: '24px',
              minHeight: '160px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              textAlign: 'center',
              gap: '12px'
            }}>
              {!locusReviewFlipped ? (
                <>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>SORU (ÖN YÜZ)</span>
                  <div style={{ fontSize: '16px', fontWeight: '500', color: '#fff', lineHeight: 1.4 }}>
                    {locusReviewQueue[locusReviewIndex].question}
                  </div>
                  <button
                    onClick={() => setLocusReviewFlipped(true)}
                    style={{
                      marginTop: '16px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Cevabı Göster
                  </button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '11px', color: 'rgba(99,102,241,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CEVAP (ARKA YÜZ)</span>
                  <div style={{ fontSize: '15px', color: '#cbd5e1', lineHeight: 1.4 }}>
                    {locusReviewQueue[locusReviewIndex].answer}
                  </div>
                  
                  {/* Rating Buttons */}
                  <div style={{ display: 'flex', gap: '10px', marginTop: '20px', width: '100%' }}>
                    <button
                      onClick={() => handleLocusRating(false)}
                      style={{
                        flex: 1,
                        background: 'rgba(239,68,68,0.15)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        color: '#f87171',
                        padding: '10px',
                        borderRadius: '6px',
                        fontSize: '12.5px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ❌ Yanlış
                    </button>
                    <button
                      onClick={() => handleLocusRating(true)}
                      style={{
                        flex: 1,
                        background: 'rgba(16,185,129,0.15)',
                        border: '1px solid rgba(16,185,129,0.3)',
                        color: '#34d399',
                        padding: '10px',
                        borderRadius: '6px',
                        fontSize: '12.5px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      💚 Doğru
                    </button>
                  </div>
                </>
              )}
            </div>
            
          </div>
        </div>
      )}
      {/* 6. AKIL SARAYI YARDIM KILAVUZU MODALI */}
      {isPalaceHelpOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3100
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.98))',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '550px',
            padding: '24px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            {/* Kapat Butonu */}
            <button 
              onClick={() => setIsPalaceHelpOpen(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              ✕
            </button>
            
            {/* Başlık */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '10px' }}>
              <span style={{ fontSize: '24px' }}>🏛️</span>
              <div>
                <strong style={{ fontSize: '15px', color: '#fff' }}>Akıl Sarayı ve Hafıza Teknikleri Kılavuzu</strong>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>Mekansal Bellek (Loci) ve Zincirleme Teknikleri</span>
              </div>
            </div>
            
            {/* Gövde - Kaydırılabilir */}
            <div style={{ 
              fontSize: '12.5px', 
              color: 'var(--text-secondary)', 
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxHeight: '320px',
              overflowY: 'auto',
              paddingRight: '6px',
              textAlign: 'left'
            }}>
              <p style={{ margin: 0 }}>
                <strong>Akıl Sarayı (Method of Loci)</strong>, bilgileri zihninizde çok daha kolay geri çağırmak için antik çağlardan beri kullanılan en güçlü hafıza tekniğidir. Bilgiyi soyut bir liste olarak ezberlemek yerine, zihninizde fiziksel bir konuma (locus) yerleştirirsiniz.
              </p>
              
              <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ color: '#fff' }}>📍 1. Kartları Dağıtın (Önerilen)</strong>
                <span>
                  Tek bir nesneye (örneğin çalışma masasına) 20 kart birden yığarsanız zihniniz karışabilir. Sarayımızda 16 farklı nesne (Çalışma Masası, Sakura Ağacı, Koi Havuzu vb.) bulunmaktadır. Deste (Browse) ekranında kartların altındaki <strong>Saray Konumu</strong> seçeneğini kullanarak kartları odalara dağıtın.
                </span>
              </div>

              <div style={{ borderLeft: '3px solid #10b981', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ color: '#fff' }}>🛋️ 2. Mikro-Loci (Nesneleri Parçalara Bölün)</strong>
                <span>
                  Bir nesneye (örneğin Çalışma Masası'na) birden fazla kart koymanız gerekiyorsa, masayı zihninizde daha küçük parçalara bölün: masanın üstündeki <em>Lamba</em>, köşedeki <em>Kahve Kupası</em> veya masanın altındaki <em>Çekmece</em> gibi alt odaklar tanımlayın.
                </span>
              </div>

              <div style={{ borderLeft: '3px solid #f59e0b', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ color: '#fff' }}>🔗 3. Absürt Öyküleme (Zincirleme)</strong>
                <span>
                  Tekrar edeceğiniz 3-4 kartı zihninizde absürt, hareketli ve komik bir hikaye ile birbirine bağlayın. Zihin sıradan olayları unutur ancak absürt, mantıksız ve hareketli sahneleri asla unutmaz. Çalışma nesnesini hikayenizin başlangıç noktası yapın.
                </span>
              </div>

              <div style={{ borderLeft: '3px solid #8b5cf6', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ color: '#fff' }}>🧠 4. Nasıl Eşleştirme Yapılır?</strong>
                <span>
                  Soruyu okuduğunuzda, o an tıkladığınız eşyayı (örneğin Çalışma Masası'nı) hayal edin. Bilgiyi o eşyanın rengiyle, dokusuyla veya sesiyle bütünleştirin. Zamanla, o eşyayı her düşündüğünüzde bilginin kendiliğinden zihninize geldiğini fark edeceksiniz!
                </span>
              </div>
            </div>
            
            {/* Kapat Butonu Alt */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px', marginTop: '6px' }}>
              <button 
                onClick={() => setIsPalaceHelpOpen(false)}
                style={{
                  background: 'var(--accent)',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Anladım, Başlayalım
              </button>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
