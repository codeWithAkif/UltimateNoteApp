import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Building2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Şehirdeki her bir binanın (notun) sahip olacağı özellikleri belirten veri arayüzü.
interface BuildingData {
  name: string;
  path: string;
  folder: string;
  wordCount: number;
  totalTasks: number;
  completedTasks: number;
  col: number; // Grid sütunu
  row: number; // Grid satırı
  height: number; // Bina yüksekliği (px)
  hue: number; // Klasöre göre renk tonu (HSL)
}

interface CityBuilderViewProps {
  notes: any[];
  fileContents: Record<string, string>;
  onSelectNote: (path: string) => void;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Klasör isimlerine göre HSL renk tonu (hue) eşleştirmesi yapan yardımcı fonksiyon.
// Bu sayede aynı klasördeki notların binaları şehirde aynı renk mahalleleri oluşturur.
const getHueForFolder = (folder: string): number => {
  if (!folder) return 210; // Varsayılan mavi/gri tonu
  let hash = 0;
  for (let i = 0; i < folder.length; i++) {
    hash = folder.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Notları çakışmasız ve merkezden dışa doğru bir sarmal (spiral) şeklinde yerleştirmek için
// grid koordinatlarını hesaplayan deterministik sarmal algoritması.
const getSpiralGridCoords = (index: number, centerX: number, centerY: number) => {
  if (index === 0) return { col: centerX, row: centerY };
  let x = 0;
  let y = 0;
  let dx = 0;
  let dy = -1;
  let step = 0;
  let limit = 1;
  let count = 0;
  
  for (let i = 0; i < index; i++) {
    x += dx;
    y += dy;
    count++;
    
    if (count === limit) {
      count = 0;
      const temp = dx;
      dx = -dy;
      dy = temp;
      
      if (step % 2 === 1) {
        limit++;
      }
      step++;
    }
  }
  return { col: centerX + x, row: centerY + y };
};

export default function CityBuilderView({ notes, fileContents, onSelectNote }: CityBuilderViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Kamera kaydırma (Pan), yakınlaştırma (Zoom) ve etkileşim durumları
  const [zoom, setZoom] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [hoveredBuilding, setHoveredBuilding] = useState<BuildingData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  // Grid boyutu (Not sayısına göre sarmalın genişleyebileceği kadar büyük dinamik grid)
  const gridSize = useMemo(() => {
    return Math.max(8, Math.ceil(Math.sqrt(notes.length)) + 4);
  }, [notes.length]);

  const centerX = Math.floor(gridSize / 2);
  const centerY = Math.floor(gridSize / 2);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Not listesini tarayıp kelime ve görev sayılarını çıkararak izometrik bina yapılarını hazırlayan memo.
  const buildings = useMemo(() => {
    const mdNotes = notes.filter(n => n.type === 'note' || n.type === 'excalidraw');
    
    // Binaları deterministik olarak sırala (böylece her yüklemede grid konumu sabit kalır)
    const sortedNotes = [...mdNotes].sort((a, b) => a.path.localeCompare(b.path));

    return sortedNotes.map((note, index) => {
      const content = fileContents[note.path] || '';
      
      // Kelime sayısı hesaplama
      const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

      // Görev sayılarını hesaplama (- [ ] ve - [x])
      const totalTasks = (content.match(/-\s*\[[ xX]\]/g) || []).length;
      const completedTasks = (content.match(/-\s*\[[xX]\]/g) || []).length;

      // Klasör bilgisi
      const parts = note.path.split('/');
      const folderName = parts.length > 1 ? parts[0] : '';

      // Deterministik grid pozisyonu (merkezden dışa spiral)
      const { col, row } = getSpiralGridCoords(index, centerX, centerY);

      // Kelime sayısına göre kat ve bina yüksekliği belirleme
      let floors = 1;
      if (wordCount > 1500) floors = 6;
      else if (wordCount > 750) floors = 4;
      else if (wordCount > 300) floors = 3;
      else if (wordCount > 100) floors = 2;
      
      const height = floors * 22; // Her kat 22px yüksekliğinde
      const hue = getHueForFolder(folderName);

      return {
        name: note.name.replace(/\.md$/, ''),
        path: note.path,
        folder: folderName || 'Kök Dizin',
        wordCount,
        totalTasks,
        completedTasks,
        col,
        row,
        height,
        hue
      };
    });
  }, [notes, fileContents, centerX, centerY]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // İzometrik 3D şehir çizim motoru. Pan, Zoom ve Hover güncellemelerinde gerçek zamanlı olarak çalışır.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const tileWidth = 64;
    const tileHeight = 32;

    // Painter's Algorithm: Derinlik karmaşasını önlemek için binaları arkadan öne doğru sıralayarak çizeriz
    const sortedBuildings = [...buildings].sort((a, b) => (a.col + a.row) - (b.col + b.row));

    // Bulut animasyon verileri
    const clouds = [
      { x: 100, y: 150, speed: 0.15, size: 40 },
      { x: 400, y: 80, speed: 0.08, size: 60 },
      { x: 800, y: 220, speed: 0.22, size: 50 }
    ];

    const drawCity = () => {
      // Ekrana tam sığdırma ve çözünürlük temizliği
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Gökyüzü gradyan arka planı (Koyu Gece Modu)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      skyGrad.addColorStop(0, '#090a0f');
      skyGrad.addColorStop(1, '#181926');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Pan ve Zoom dönüşümlerini uygula
      ctx.translate(canvas.width / 2 + panOffset.x, canvas.height / 3 + panOffset.y);
      ctx.scale(zoom, zoom);

      // 1. ZEMİN GRIDİ VE YOLLARIN ÇİZİLMESİ
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      for (let c = 0; c <= gridSize; c++) {
        // Sol-alt grid çizgileri
        ctx.beginPath();
        const start1 = isometrictToScreen(c, 0, tileWidth, tileHeight);
        const end1 = isometrictToScreen(c, gridSize, tileWidth, tileHeight);
        ctx.moveTo(start1.x, start1.y);
        ctx.lineTo(end1.x, end1.y);
        ctx.stroke();

        // Sağ-alt grid çizgileri
        ctx.beginPath();
        const start2 = isometrictToScreen(0, c, tileWidth, tileHeight);
        const end2 = isometrictToScreen(gridSize, c, tileWidth, tileHeight);
        ctx.moveTo(start2.x, start2.y);
        ctx.lineTo(end2.x, end2.y);
        ctx.stroke();
      }

      // 2. BİNALARIN (NOTLARIN) RENDER EDİLMESİ
      sortedBuildings.forEach(b => {
        const screen = isometrictToScreen(b.col, b.row, tileWidth, tileHeight);
        const isHovered = hoveredBuilding ? hoveredBuilding.path === b.path : false;

        drawIsometricBuilding(ctx, screen.x, screen.y, b, isHovered);
      });

      ctx.restore();

      // 3. GÖKYÜZÜNDEKİ BULUTLARIN ÇİZİLMESİ VE İLERLETİLMESİ
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      clouds.forEach(cloud => {
        cloud.x += cloud.speed;
        if (cloud.x > canvas.width + 100) cloud.x = -100;
        
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, cloud.size, 0, Math.PI * 2);
        ctx.arc(cloud.x + 30, cloud.y - 10, cloud.size * 0.8, 0, Math.PI * 2);
        ctx.arc(cloud.x - 25, cloud.y + 5, cloud.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      animationId = requestAnimationFrame(drawCity);
    };

    drawCity();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [buildings, zoom, panOffset, hoveredBuilding, gridSize]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Canvas boyutlarını pencere boyutuna göre eşitleyen yardımcı efekt.
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
        canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Grid koordinatını (col, row) ekran piksel koordinatına dönüştüren yardımcı projeksiyon.
  const isometrictToScreen = (col: number, row: number, tileWidth: number, tileHeight: number) => {
    return {
      x: (col - row) * (tileWidth / 2),
      y: (col + row) * (tileHeight / 2)
    };
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // 3 boyutlu izometrik binayı (Sol yüz, Sağ yüz, Çatı ve pencereler) çizen çekirdek fonksiyon.
  const drawIsometricBuilding = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    b: BuildingData,
    isHovered: boolean
  ) => {
    const w = 48; // Bina genişliği (tile genişliğinden dar)
    const h = b.height; // Bina yüksekliği
    const sideW = w / 2;
    const sideH = 12; // İzometrik yatay eğim derinliği

    // Hover durumunda parıltılı dış çerçeve (Glow) çizimi
    if (isHovered) {
      ctx.save();
      ctx.shadowBlur = 15;
      ctx.shadowColor = `hsl(${b.hue}, 100%, 65%)`;
      ctx.strokeStyle = `hsl(${b.hue}, 100%, 65%)`;
      ctx.lineWidth = 3;
      
      // Binanın sınır dış çizgisini çiziyoruz
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x - sideW, y - sideH - h);
      ctx.lineTo(x - sideW, y - sideH);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sideW, y - sideH);
      ctx.lineTo(x + sideW, y - sideH - h);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 1. SOL DUVAR (Gölge Yüzü - Daha Koyu)
    ctx.fillStyle = `hsl(${b.hue}, 70%, 18%)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - sideW, y - sideH);
    ctx.lineTo(x - sideW, y - sideH - h);
    ctx.lineTo(x, y - h);
    ctx.closePath();
    ctx.fill();

    // 2. SAĞ DUVAR (Işık Yüzü - Orta Parlaklık)
    ctx.fillStyle = `hsl(${b.hue}, 70%, 28%)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sideW, y - sideH);
    ctx.lineTo(x + sideW, y - sideH - h);
    ctx.lineTo(x, y - h);
    ctx.closePath();
    ctx.fill();

    // 3. ÇATI (Işığın Geldiği Tepe Yüzü - En Parlak)
    ctx.fillStyle = `hsl(${b.hue}, 65%, 45%)`;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x - sideW, y - sideH - h);
    ctx.lineTo(x, y - sideH * 2 - h);
    ctx.lineTo(x + sideW, y - sideH - h);
    ctx.closePath();
    ctx.fill();

    // 4. PENCERELERİN VE IŞIKLARIN ÇİZİLMESİ
    // Kat sayısına göre kat hizalarında pencereler açıp, görev tamamlanma oranına göre aydınlatıyoruz.
    const floorCount = Math.round(h / 22);
    const totalWindowsPerSide = floorCount * 2;
    
    // Toplam ışık yanacak pencere oranı (görev tamamlanma oranına bağlı)
    let lightRatio = 0.5; // Görevi yoksa sıcak daire hissi için %50'si yansın
    if (b.totalTasks > 0) {
      lightRatio = b.completedTasks / b.totalTasks;
    }
    
    let windowIndex = 0;

    for (let f = 0; f < floorCount; f++) {
      const floorY = y - 4 - (f * 22);

      // Sol Duvar Pencereleri (2 adet)
      for (let wIdx = 0; wIdx < 2; wIdx++) {
        const winX = x - 7 - (wIdx * 10);
        const winY = floorY - (winX - x) * 0.3; // İzometrik eğimle uyumlandırılmış Y koordinatı
        
        const isLit = (windowIndex / totalWindowsPerSide) <= lightRatio;
        ctx.fillStyle = isLit ? '#fef08a' : '#0f172a'; // Sarı neon veya sönük siyah/koyu gri
        
        ctx.beginPath();
        ctx.moveTo(winX, winY);
        ctx.lineTo(winX - 4, winY - 2);
        ctx.lineTo(winX - 4, winY - 10);
        ctx.lineTo(winX, winY - 8);
        ctx.closePath();
        ctx.fill();

        // Işık yanan pencerelere ufak sarı bir ışıma (glow) ekleme
        if (isLit) {
          ctx.save();
          ctx.shadowBlur = 4;
          ctx.shadowColor = '#fef08a';
          ctx.fillStyle = 'rgba(254, 240, 138, 0.4)';
          ctx.fill();
          ctx.restore();
        }
        windowIndex++;
      }

      // Sağ Duvar Pencereleri (2 adet)
      for (let wIdx = 0; wIdx < 2; wIdx++) {
        const winX = x + 7 + (wIdx * 10);
        const winY = floorY + (winX - x) * 0.3; // İzometrik eğimle uyumlandırılmış Y koordinatı
        
        const isLit = (windowIndex / totalWindowsPerSide) <= lightRatio;
        ctx.fillStyle = isLit ? '#fef08a' : '#0f172a';
        
        ctx.beginPath();
        ctx.moveTo(winX, winY);
        ctx.lineTo(winX + 4, winY + 2);
        ctx.lineTo(winX + 4, winY - 6);
        ctx.lineTo(winX, winY - 8);
        ctx.closePath();
        ctx.fill();

        if (isLit) {
          ctx.save();
          ctx.shadowBlur = 4;
          ctx.shadowColor = '#fef08a';
          ctx.fillStyle = 'rgba(254, 240, 138, 0.4)';
          ctx.fill();
          ctx.restore();
        }
        windowIndex++;
      }
    }

    // Gökdelenlerin tepesine yanıp sönen kırmızı uyarı lambası (z-index beacon) çizimi
    if (floorCount >= 4) {
      const beaconY = y - h - sideH * 2 - 2;
      const isRed = Math.floor(Date.now() / 500) % 2 === 0;
      ctx.fillStyle = isRed ? '#ef4444' : 'rgba(239, 68, 68, 0.2)';
      ctx.beginPath();
      ctx.arc(x, beaconY, 2, 0, Math.PI * 2);
      ctx.fill();
      if (isRed) {
        ctx.save();
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#ef4444';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
        ctx.arc(x, beaconY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  };

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Fare hareket ettirildiğinde kamera dönüşüm matrisini tersine çevirerek hangi binanın
  // üzerinde (hover) olduğunu algılayan etkileşim fonksiyonu.
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Sürükleyerek kamera kaydırma (Pan) aktifse
    if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPanOffset({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy
      });
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Viewport dönüşümlerine göre fare koordinatlarını eşitle
    const transformedX = (mouseX - (canvas.width / 2 + panOffset.x)) / zoom;
    const transformedY = (mouseY - (canvas.height / 3 + panOffset.y)) / zoom;

    let found: BuildingData | null = null;
    const tileWidth = 64;
    const tileHeight = 32;

    // Painter's Algorithm'in tersine göre önden arkaya doğru tarıyoruz ki en öndeki binaya odaklanalım
    const sortedBuildings = [...buildings].sort((a, b) => (b.col + b.row) - (a.col + a.row));

    for (let b of sortedBuildings) {
      const screen = isometrictToScreen(b.col, b.row, tileWidth, tileHeight);
      
      // Basit tıklama/hizalama sınır kutusu (Bounding box) kontrolü
      const w = 48;
      const h = b.height;
      const sideW = w / 2;

      // Mouse binanın 3D kutusu sınırlarında mı?
      if (
        transformedX >= screen.x - sideW &&
        transformedX <= screen.x + sideW &&
        transformedY >= screen.y - h - 12 &&
        transformedY <= screen.y
      ) {
        found = b;
        break;
      }
    }

    setHoveredBuilding(found);
    if (found) {
      setTooltipPos({ x: e.clientX + 14, y: e.clientY + 14 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...panOffset };
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    isDraggingRef.current = false;
    
    // Sürükleme yapılmadan tıklanmışsa notu aç
    const dx = Math.abs(e.clientX - dragStartRef.current.x);
    const dy = Math.abs(e.clientY - dragStartRef.current.y);
    if (dx < 5 && dy < 5 && hoveredBuilding) {
      onSelectNote(hoveredBuilding.path);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scale = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(prev => Math.max(0.4, Math.min(2.5, prev * scale)));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#090a0f' }}>
      
      {/* 3D Simülasyon Ekranı Canvas */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        style={{ display: 'block', width: '100%', height: '100%', cursor: isDraggingRef.current ? 'grabbing' : 'grab' }}
      />

      {/* Şehir Başlığı ve İstatistik Paneli (Glassmorphic) */}
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '16px',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        pointerEvents: 'none',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={18} style={{ color: 'var(--accent-color, #6366f1)' }} />
          <span style={{ fontWeight: 'bold', fontSize: '15px', letterSpacing: '0.5px' }}>Not Şehri (Note-City)</span>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
          Toplam Bina: <strong style={{ color: '#fff' }}>{buildings.length}</strong>
        </span>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', maxWidth: '200px', lineHeight: 1.4 }}>
          * Not kelime sayınız bina katlarını, tamamlanan görev oranınız ise yanan pencereleri belirler.
        </span>
      </div>

      {/* Sağ Kamera Kontrol Paneli */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        right: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '6px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.4)'
      }}>
        <button
          onClick={() => setZoom(prev => Math.min(2.5, prev * 1.2))}
          style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Yakınlaş"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => setZoom(prev => Math.max(0.4, prev * 0.8))}
          style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Uzaklaş"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={() => { setZoom(1.0); setPanOffset({ x: 0, y: 0 }); }}
          style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Kamerayı Sıfırla"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Hover Edilen Bina Detay Tooltip Kartı */}
      {hoveredBuilding && (
        <div style={{
          position: 'fixed',
          left: `${tooltipPos.x}px`,
          top: `${tooltipPos.y}px`,
          background: 'rgba(15, 23, 42, 0.9)',
          backdropFilter: 'blur(10px)',
          border: `1px solid hsl(${hoveredBuilding.hue}, 70%, 50%)`,
          borderRadius: '8px',
          padding: '10px 14px',
          color: '#fff',
          fontSize: '12px',
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          zIndex: 100000,
          boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
          maxWidth: '240px'
        }}>
          <strong style={{ fontSize: '13px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px', marginBottom: '2px', color: `hsl(${hoveredBuilding.hue}, 100%, 75%)` }}>
            {hoveredBuilding.name}
          </strong>
          <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.6)' }}>
            Klasör: <strong style={{ color: '#fff' }}>{hoveredBuilding.folder}</strong>
          </span>
          <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.6)' }}>
            Hacim: <strong style={{ color: '#fff' }}>{hoveredBuilding.wordCount} kelime</strong>
          </span>
          <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.6)' }}>
            Görevler: <strong style={{ color: '#fff' }}>
              {hoveredBuilding.totalTasks > 0 
                ? `${hoveredBuilding.completedTasks}/${hoveredBuilding.totalTasks} (%${Math.round((hoveredBuilding.completedTasks/hoveredBuilding.totalTasks)*100)})`
                : 'Görev yok'}
            </strong>
          </span>
          <span style={{ fontSize: '9px', color: 'var(--accent-color, #818cf8)', marginTop: '2px', fontStyle: 'italic' }}>
            * Açmak için tıklayın
          </span>
        </div>
      )}

    </div>
  );
}
