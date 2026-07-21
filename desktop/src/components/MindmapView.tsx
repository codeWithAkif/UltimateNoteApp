import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Network, Plus, Trash2, ArrowDown, Maximize2, Minimize2, 
  Check, X, CheckSquare, Square, ZoomIn, ZoomOut, Compass, 
  Layout, Eye, Smile, FileText, Palette
} from 'lucide-react';

// ==========================================
// ARAYÜZ VE TİP TANIMLAMALARI (Interfaces)
// ==========================================

interface MindmapViewProps {
  content: string;
  onChangeContent: (newContent: string) => void;
  noteName: string;
  savedCoords: LayoutCoords;
  savedCustoms: CustomElement[];
  onSaveLayout: (coords: LayoutCoords, customs: CustomElement[]) => void;
  // BUG DÜZELTMESİ: native window.confirm() yerine App.tsx'teki paylaşılan uygulama-içi
  // onay modalını kullanır (confirm() gerçek bir pencere blur/focus olayı tetiklemediği
  // için odağa dayalı temizleme mekanizmaları silme onayı sırasında hiç çalışmıyordu).
  onRequestConfirm?: (message: string, onConfirm: () => void) => void;
}

interface MindmapNode {
  id: string; // Kararlı yol kimliği (pathId veya line index)
  text: string;
  type: 'root' | 'heading' | 'task' | 'listitem';
  level: number; // Hiyerarşik derinlik (0: root, 1, 2, 3...)
  lineIndex: number; // Orijinal markdown satır numarası (0-indexed)
  checked?: boolean; // Görevler için tamamlanma durumu
  indent: number; // Listeler için boşluk sayısı
  parentId: string | null;
  children: string[];
  x: number;
  y: number;
}

// Özel Yüzer Öğeler için Veri Yapısı (Text, Emoji, Sticky Note)
interface CustomElement {
  id: string;
  type: 'text' | 'emoji' | 'sticky';
  text: string;
  x: number;
  y: number;
  color?: string; // Sticky not arka plan rengi
}

interface LayoutCoords {
  [nodeId: string]: { x: number; y: number };
}

// Metadata JSON yapısı
interface MindmapMetadata {
  coords: LayoutCoords;
  customs: CustomElement[];
}

export default function MindmapView({ 
  content, 
  onChangeContent, 
  noteName,
  savedCoords,
  savedCustoms,
  onSaveLayout,
  onRequestConfirm
}: MindmapViewProps) {
  // ==========================================
  // STATE VE REFERANS TANIMLAMALARI (States & Refs)
  // ==========================================

  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [customs, setCustoms] = useState<CustomElement[]>([]); // Özel yüzer öğeler
  const [layoutMode, setLayoutMode] = useState<'radial' | 'tree' | 'free'>('radial');
  
  // Kamera Zoom ve Pan ayarları
  const [zoom, setZoom] = useState<number>(0.8);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 100, y: 150 });
  const isDraggingCanvasRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Düğüm sürükleme (Drag Node) durumları
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [draggedCustomId, setDraggedCustomId] = useState<string | null>(null); // Sürüklenen yüzer öğe
  const dragNodeStartMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragNodeStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Düzenleme (Inline Edit) durumları
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null); // Düzenlenen yüzer öğe
  const [editingText, setEditingText] = useState<string>('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Seçili Düğüm (Selected Node) ve Seçili Yüzer Öğe
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCustomId, setSelectedCustomId] = useState<string | null>(null);

  // Başlık Altı İçerik Önizleme (Section Previews)
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
  const [previewLines, setPreviewLines] = useState<string[]>([]);

  // Öğe Ekleme Menüsü (Dropdown) Açık mı?
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // ==========================================
  // TÜRKÇE YORUM (Kural 5):
  // Markdown dosyasındaki ham metni satır satır ayrıştırıp hiyerarşik zihin haritası düğümlerine (nodes) çeviren parser.
  // Dosyanın sonundaki "<!-- mindmap-layout: ... -->" verisini okuyup hem koordinatları hem de özel öğeleri (customs) yükler.
  // Geriye dönük uyumluluk için coords/customs içermeyen eski JSON formatlarını otomatik dönüştürür.
  // ==========================================
  useEffect(() => {
    setCustoms(savedCustoms);
  }, [savedCustoms]);

  useEffect(() => {
    const layoutRegex = /<!--\s*mindmap-layout:\s*({.*?})\s*-->/s;
    const layoutMatch = content.match(layoutRegex);
    
    let commentCoords: LayoutCoords = {};
    let commentCustoms: CustomElement[] = [];
    
    if (layoutMatch) {
      try {
        const parsedMeta = JSON.parse(layoutMatch[1]);
        if (parsedMeta.coords || parsedMeta.customs) {
          commentCoords = parsedMeta.coords || {};
          commentCustoms = parsedMeta.customs || [];
        } else {
          commentCoords = parsedMeta;
        }
      } catch (e) {
        console.error('Eski yerleşim verileri okunamadı:', e);
      }
    }

    const activeCoords = Object.keys(savedCoords).length > 0 ? savedCoords : commentCoords;
    const activeCustoms = savedCustoms.length > 0 ? savedCustoms : commentCustoms;

    setCustoms(activeCustoms);

    const mainBody = content.replace(layoutRegex, '');
    const lines = mainBody.split('\n');
    const parsedNodes: MindmapNode[] = [];

    // Root düğümünü oluştur
    const rootNodeId = 'root-node';
    const rootNode: MindmapNode = {
      id: rootNodeId,
      text: noteName.replace('.md', ''),
      type: 'root',
      level: 0,
      lineIndex: -1,
      indent: 0,
      parentId: null,
      children: [],
      x: activeCoords[rootNodeId]?.x ?? 0,
      y: activeCoords[rootNodeId]?.y ?? 0
    };
    parsedNodes.push(rootNode);

    // Hiyerarşi takibi için stack yapısı
    const headingStack: string[] = Array(7).fill(rootNodeId);
    const listStack: { indent: number; id: string }[] = [];

    // Satır satır dolaşarak başlıkları ve listeleri yakala
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed === '') return;

      let node: MindmapNode | null = null;
      let parentId = rootNodeId;

      // A. BAŞLIKLAR
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();
        const id = `heading-${index}`;

        // TÜRKÇE YORUM (Kural 5):
        // Eğer H1 başlığı dosya ismi (Root) ile aynıysa, mükerrerliği önlemek için düğüm olarak eklemiyoruz.
        // Alt başlıkların doğrudan Root düğüme bağlanması için headingStack[1] değerini Root atayıp geçiyoruz.
        if (level === 1 && text.toLowerCase() === rootNode.text.toLowerCase()) {
          headingStack[1] = rootNodeId;
          for (let i = 2; i <= 6; i++) {
            headingStack[i] = rootNodeId;
          }
          listStack.length = 0;
          return;
        }

        parentId = headingStack[level - 1] || rootNodeId;
        
        node = {
          id,
          text,
          type: 'heading',
          level,
          lineIndex: index,
          indent: 0,
          parentId,
          children: [],
          x: activeCoords[id]?.x ?? 0,
          y: activeCoords[id]?.y ?? 0
        };

        headingStack[level] = id;
        for (let i = level + 1; i <= 6; i++) {
          headingStack[i] = id;
        }
        listStack.length = 0;
      }
      // B. GÖREV LİSTELERİ
      else {
        const taskMatch = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/);
        if (taskMatch) {
          const indentSpaces = taskMatch[1].length;
          const checked = taskMatch[2].toLowerCase() === 'x';
          const text = taskMatch[3].trim();
          const id = `task-${index}`;

          while (listStack.length > 0 && listStack[listStack.length - 1].indent >= indentSpaces) {
            listStack.pop();
          }

          parentId = listStack.length > 0 
            ? listStack[listStack.length - 1].id 
            : (headingStack.find((h, idx) => idx > 0 && h !== rootNodeId) || rootNodeId);

          node = {
            id,
            text,
            type: 'task',
            level: (listStack.length + 1),
            lineIndex: index,
            checked,
            indent: indentSpaces,
            parentId,
            children: [],
            x: activeCoords[id]?.x ?? 0,
            y: activeCoords[id]?.y ?? 0
          };

          listStack.push({ indent: indentSpaces, id });
        }
        // C. LİSTE MADDELERİ
        else {
          const listMatch = line.match(/^(\s*)[-*+]\s+(?!\[[ xX]\])(.*)$/);
          if (listMatch) {
            const indentSpaces = listMatch[1].length;
            const text = listMatch[2].trim();
            const id = `list-${index}`;

            while (listStack.length > 0 && listStack[listStack.length - 1].indent >= indentSpaces) {
              listStack.pop();
            }

            parentId = listStack.length > 0 
              ? listStack[listStack.length - 1].id 
              : (headingStack.find((h, idx) => idx > 0 && h !== rootNodeId) || rootNodeId);

            node = {
              id,
              text,
              type: 'listitem',
              level: (listStack.length + 1),
              lineIndex: index,
              indent: indentSpaces,
              parentId,
              children: [],
              x: activeCoords[id]?.x ?? 0,
              y: activeCoords[id]?.y ?? 0
            };

            listStack.push({ indent: indentSpaces, id });
          }
        }
      }

      if (node) {
        parsedNodes.push(node);
      }
    });

    // Parent/children dizilerini doldur
    parsedNodes.forEach(node => {
      if (node.parentId) {
        const parent = parsedNodes.find(p => p.id === node.parentId);
        if (parent) {
          parent.children.push(node.id);
        }
      }
    });

    // Otomatik yerleşimi çalıştır (Eğer koordinatlar boşsa)
    const hasCoordinates = parsedNodes.some(n => n.id !== rootNodeId && (n.x !== 0 || n.y !== 0));
    if (!hasCoordinates) {
      calculateAutoLayout(parsedNodes, layoutMode);
    } else {
      setNodes(parsedNodes);
    }

  }, [content, noteName, layoutMode]);

  // ==========================================
  // TÜRKÇE YORUM (Kural 5):
  // Eğer düğümlerin koordinatları yoksa, zihin haritası yapısını otomatik yerleştiren fonksiyon.
  // ==========================================
  const calculateAutoLayout = (nodesList: MindmapNode[], mode: 'radial' | 'tree' | 'free') => {
    const root = nodesList.find(n => n.id === 'root-node');
    if (!root) return;

    root.x = 0;
    root.y = 0;

    if (mode === 'radial') {
      const arrangeRadial = (parentId: string, startAngle: number, endAngle: number, radius: number) => {
        const parent = nodesList.find(n => n.id === parentId);
        if (!parent) return;

        const childIds = parent.children;
        if (childIds.length === 0) return;

        const angleStep = (endAngle - startAngle) / childIds.length;
        childIds.forEach((childId, idx) => {
          const child = nodesList.find(n => n.id === childId);
          if (child) {
            const angle = startAngle + angleStep * idx + angleStep / 2;
            child.x = parent.x + radius * Math.cos(angle);
            child.y = parent.y + radius * Math.sin(angle);
            
            arrangeRadial(childId, angle - angleStep / 2, angle + angleStep / 2, radius * 0.95);
          }
        });
      };

      arrangeRadial('root-node', 0, 2 * Math.PI, 220);
    } else {
      const rootChildren = root.children;
      const leftChildren = rootChildren.slice(0, Math.ceil(rootChildren.length / 2));
      const rightChildren = rootChildren.slice(Math.ceil(rootChildren.length / 2));

      const arrangeTreeSide = (nodeId: string, depth: number, dir: number, verticalOffset: { val: number }) => {
        const node = nodesList.find(n => n.id === nodeId);
        if (!node) return;

        node.x = dir * depth * 220;
        node.y = verticalOffset.val;

        if (node.children.length === 0) {
          verticalOffset.val += 80;
          return;
        }

        const startY = verticalOffset.val;
        node.children.forEach(childId => {
          arrangeTreeSide(childId, depth + 1, dir, verticalOffset);
        });

        const endY = verticalOffset.val - 80;
        node.y = (startY + endY) / 2;
      };

      let leftOffset = { val: -180 };
      leftChildren.forEach(childId => {
        arrangeTreeSide(childId, 1, -1, leftOffset);
      });

      let rightOffset = { val: -180 };
      rightChildren.forEach(childId => {
        arrangeTreeSide(childId, 1, 1, rightOffset);
      });
    }

    setNodes([...nodesList]);
  };

  // ==========================================
  // TÜRKÇE YORUM (Kural 5):
  // Düzenlenen koordinatları ve yüzer öğeleri markdown belgesine geri yazan (Serializer) fonksiyon.
  // ==========================================
  const saveTreeToMarkdown = (updatedNodes: MindmapNode[], updatedCustoms?: CustomElement[]) => {
    const layoutRegex = /<!--\s*mindmap-layout:\s*({.*?})\s*-->/s;
    const cleanContent = content.replace(layoutRegex, '');
    const lines = cleanContent.split('\n');

    updatedNodes.forEach(node => {
      if (node.id === 'root-node') return;
      
      const lineIdx = node.lineIndex;
      if (lineIdx < 0 || lineIdx >= lines.length) return;

      let newLine = '';
      if (node.type === 'heading') {
        newLine = `${'#'.repeat(node.level)} ${node.text}`;
      } else if (node.type === 'task') {
        const indent = ' '.repeat(node.indent);
        newLine = `${indent}- [${node.checked ? 'x' : ' '}] ${node.text}`;
      } else if (node.type === 'listitem') {
        const indent = ' '.repeat(node.indent);
        newLine = `${indent}- ${node.text}`;
      }

      lines[lineIdx] = newLine;
    });

    // Koordinatları topla
    const coords: LayoutCoords = {};
    updatedNodes.forEach(n => {
      coords[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };
    });

    const finalCustoms = updatedCustoms || customs;

    // TÜRKÇE YORUM (Kural 5):
    // Zihin haritası yerleşimi ve özel öğeleri artık not dosyası yerine merkezi metadata.json'a kaydedilir.
    onSaveLayout(coords, finalCustoms);

    // Eğer markdown metninin kendisi (başlık veya görev durumu) değiştiyse, içeriği temizlenmiş şekilde kaydet
    const finalMarkdown = lines.join('\n');
    if (finalMarkdown !== cleanContent) {
      onChangeContent(finalMarkdown);
    } else if (content.match(layoutRegex)) {
      // Eğer dosyada eski şablon yorum satırı duruyorsa, onu temizlemek için yeni temiz içeriği yaz
      onChangeContent(cleanContent);
    }
  };

  // ==========================================
  // KANVAS HAREKETLERİ VE ETKİLEŞİM (Canvas Pan & Zoom Events)
  // ==========================================

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).tagName !== 'svg') return;
    
    isDraggingCanvasRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    
    setSelectedNodeId(null);
    setSelectedCustomId(null);
    setPreviewNodeId(null); // Önizlemeyi de kapat
    
    if (containerRef.current) {
      containerRef.current.style.cursor = 'grabbing';
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    // 1. Kanvas sürükleme
    if (isDraggingCanvasRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy
      });
    }
    // 2. Düğüm sürükleme
    else if (draggedNodeId) {
      const dx = (e.clientX - dragNodeStartMouseRef.current.x) / zoom;
      const dy = (e.clientY - dragNodeStartMouseRef.current.y) / zoom;
      
      setNodes(prev => prev.map(n => {
        if (n.id === draggedNodeId) {
          return {
            ...n,
            x: dragNodeStartPosRef.current.x + dx,
            y: dragNodeStartPosRef.current.y + dy
          };
        }
        return n;
      }));
    }
    // 3. Yüzer Özel Öğe Sürükleme
    else if (draggedCustomId) {
      const dx = (e.clientX - dragNodeStartMouseRef.current.x) / zoom;
      const dy = (e.clientY - dragNodeStartMouseRef.current.y) / zoom;
      
      setCustoms(prev => prev.map(c => {
        if (c.id === draggedCustomId) {
          return {
            ...c,
            x: dragNodeStartPosRef.current.x + dx,
            y: dragNodeStartPosRef.current.y + dy
          };
        }
        return c;
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    if (isDraggingCanvasRef.current) {
      isDraggingCanvasRef.current = false;
      if (containerRef.current) {
        containerRef.current.style.cursor = 'default';
      }
    }
    
    if (draggedNodeId) {
      setDraggedNodeId(null);
      saveTreeToMarkdown(nodes);
    }

    if (draggedCustomId) {
      setDraggedCustomId(null);
      saveTreeToMarkdown(nodes, customs);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.08;
    let newZoom = zoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(zoom * zoomFactor, 2.5);
    } else {
      newZoom = Math.max(zoom / zoomFactor, 0.25);
    }
    setZoom(newZoom);
  };

  // ==========================================
  // DÜĞÜM ETKİLEŞİMLERİ (Node Operations)
  // ==========================================

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    setSelectedCustomId(null);
    setDraggedNodeId(nodeId);

    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      dragNodeStartMouseRef.current = { x: e.clientX, y: e.clientY };
      dragNodeStartPosRef.current = { x: node.x, y: node.y };
    }
  };

  const handleNodeDoubleClick = (e: React.MouseEvent, node: MindmapNode) => {
    e.stopPropagation();
    setEditingNodeId(node.id);
    setEditingText(node.text);
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
    }, 50);
  };

  const handleSaveTextEdit = () => {
    if (!editingNodeId) return;

    const updated = nodes.map(n => {
      if (n.id === editingNodeId) {
        return { ...n, text: editingText };
      }
      return n;
    });

    setNodes(updated);
    setEditingNodeId(null);
    saveTreeToMarkdown(updated);
  };

  // Görev tamamlandı durumunu değiştir
  const handleToggleCheck = (e: React.MouseEvent, node: MindmapNode) => {
    e.stopPropagation();
    const updated = nodes.map(n => {
      if (n.id === node.id) {
        return { ...n, checked: !n.checked };
      }
      return n;
    });
    setNodes(updated);
    saveTreeToMarkdown(updated);
  };

  // ==========================================
  // TÜRKÇE YORUM (Kural 5):
  // Seçili başlığın (H1-H6) altında yer alan metin paragraflarını veya detay satırlarını ayrıştırıp önizleyen yardımcı fonksiyon.
  // Bir sonraki eşdeğer veya daha üst düzey başlığa kadar olan tüm satırları yakalar.
  // ==========================================
  const handleTogglePreview = (e: React.MouseEvent, node: MindmapNode) => {
    e.stopPropagation();
    
    if (previewNodeId === node.id) {
      setPreviewNodeId(null);
      setPreviewLines([]);
      return;
    }

    const layoutRegex = /<!--\s*mindmap-layout:\s*({.*?})\s*-->/s;
    const cleanContent = content.replace(layoutRegex, '');
    const lines = cleanContent.split('\n');

    const headingIdx = node.lineIndex;
    if (headingIdx === -1) return;

    const collected: string[] = [];

    // Başlığın hemen sonrasından itibaren taramaya başla
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.trim().match(/^(#{1,6})\s+(.*)$/);
      
      if (headingMatch) {
        const nextLevel = headingMatch[1].length;
        // Eğer bir sonraki başlık, mevcut başlığın seviyesinden küçükse veya eşitse taramayı durdur
        if (nextLevel <= node.level) {
          break;
        }
      }
      collected.push(line);
    }

    setPreviewNodeId(node.id);
    setPreviewLines(collected);
  };

  // ==========================================
  // ÖZEL ÖĞELER VE ŞEKİLLER (Custom Elements Events)
  // ==========================================

  const handleCustomMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedCustomId(id);
    setSelectedNodeId(null);
    setPreviewNodeId(null);
    setDraggedCustomId(id);

    const item = customs.find(c => c.id === id);
    if (item) {
      dragNodeStartMouseRef.current = { x: e.clientX, y: e.clientY };
      dragNodeStartPosRef.current = { x: item.x, y: item.y };
    }
  };

  const handleCustomDoubleClick = (e: React.MouseEvent, item: CustomElement) => {
    e.stopPropagation();
    setEditingCustomId(item.id);
    setEditingText(item.text);
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
    }, 50);
  };

  const handleSaveCustomEdit = () => {
    if (!editingCustomId) return;

    const updated = customs.map(c => {
      if (c.id === editingCustomId) {
        return { ...c, text: editingText };
      }
      return c;
    });

    setCustoms(updated);
    setEditingCustomId(null);
    saveTreeToMarkdown(nodes, updated);
  };

  const handleDeleteCustom = (id: string) => {
    const doDelete = () => {
      const updated = customs.filter(c => c.id !== id);
      setCustoms(updated);
      setSelectedCustomId(null);
      saveTreeToMarkdown(nodes, updated);
    };
    const message = 'Bu özel öğeyi tuvalden silmek istediğinize emin misiniz?';
    if (onRequestConfirm) {
      onRequestConfirm(message, doDelete);
    } else if (confirm(message)) {
      doDelete();
    }
  };

  // Yapışkan Not (Sticky) rengini değiştir
  const handleChangeCustomColor = (id: string, color: string) => {
    const updated = customs.map(c => {
      if (c.id === id) {
        return { ...c, color };
      }
      return c;
    });
    setCustoms(updated);
    saveTreeToMarkdown(nodes, updated);
  };

  // Kanvasa Yeni Özel Öğe Ekle
  const handleAddNewCustom = (type: 'text' | 'emoji' | 'sticky', initialText: string, customColor?: string) => {
    // Ekranda merkeze yakın bir konuma yerleştir
    const localX = Math.round(-pan.x / zoom + (containerRef.current?.clientWidth || 800) / (2 * zoom));
    const localY = Math.round(-pan.y / zoom + (containerRef.current?.clientHeight || 500) / (2 * zoom));

    const newElement: CustomElement = {
      id: `custom-${Date.now()}`,
      type,
      text: initialText,
      x: localX + (Math.random() * 40 - 20),
      y: localY + (Math.random() * 40 - 20),
      color: customColor
    };

    const updated = [...customs, newElement];
    setCustoms(updated);
    setIsAddMenuOpen(false);
    saveTreeToMarkdown(nodes, updated);
    setSelectedCustomId(newElement.id);
  };

  // ==========================================
  // YENİ DÜĞÜM EKLEME / SİLME (Add / Delete Nodes)
  // ==========================================

  // Alt Düğüm Ekleme (Child Node)
  const handleAddChild = (parentNodeId: string) => {
    const parent = nodes.find(n => n.id === parentNodeId);
    if (!parent) return;

    const layoutRegex = /<!--\s*mindmap-layout:\s*({.*?})\s*-->/s;
    const cleanContent = content.replace(layoutRegex, '');
    const lines = cleanContent.split('\n');

    let insertLineIdx = parent.lineIndex + 1;
    
    const getDeepestLineIdx = (nodeId: string): number => {
      const pNode = nodes.find(n => n.id === nodeId);
      if (!pNode) return -1;
      let maxIdx = pNode.lineIndex;
      pNode.children.forEach(cid => {
        const childMax = getDeepestLineIdx(cid);
        if (childMax > maxIdx) {
          maxIdx = childMax;
        }
      });
      return maxIdx;
    };

    if (parentNodeId !== 'root-node') {
      insertLineIdx = getDeepestLineIdx(parentNodeId) + 1;
    } else {
      insertLineIdx = lines.length;
    }

    let newLine = '';
    if (parent.type === 'root') {
      newLine = '## Yeni Başlık';
    } else if (parent.type === 'heading') {
      const childLevel = Math.min(parent.level + 1, 6);
      newLine = `${'#'.repeat(childLevel)} Yeni Alt Konu`;
    } else {
      const childIndent = parent.indent + 2;
      newLine = `${' '.repeat(childIndent)}- Yeni Madde`;
    }

    lines.splice(insertLineIdx, 0, newLine);

    const shiftNodes = nodes.map(n => {
      if (n.lineIndex >= insertLineIdx) {
        return { ...n, lineIndex: n.lineIndex + 1 };
      }
      return n;
    });

    const newId = `new-node-${Date.now()}`;
    const newCoords = {
      x: parent.x + (layoutMode === 'tree' ? 220 : 150 * Math.cos(Math.random() * 2 * Math.PI)),
      y: parent.y + (layoutMode === 'tree' ? 50 : 150 * Math.sin(Math.random() * 2 * Math.PI))
    };

    const coords: LayoutCoords = {};
    shiftNodes.forEach(n => {
      coords[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };
    });
    coords[newId] = newCoords;

    const metadata: MindmapMetadata = {
      coords,
      customs
    };

    const finalMarkdown = lines.join('\n') + `\n\n<!-- mindmap-layout: ${JSON.stringify(metadata)} -->`;
    onChangeContent(finalMarkdown);
    setSelectedNodeId(newId);
  };

  // Kardeş Düğüm Ekleme (Sibling Node)
  const handleAddSibling = (nodeId: string) => {
    if (nodeId === 'root-node') return;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const layoutRegex = /<!--\s*mindmap-layout:\s*({.*?})\s*-->/s;
    const cleanContent = content.replace(layoutRegex, '');
    const lines = cleanContent.split('\n');

    const getDeepestLineIdx = (nId: string): number => {
      const pNode = nodes.find(n => n.id === nId);
      if (!pNode) return -1;
      let maxIdx = pNode.lineIndex;
      pNode.children.forEach(cid => {
        const childMax = getDeepestLineIdx(cid);
        if (childMax > maxIdx) {
          maxIdx = childMax;
        }
      });
      return maxIdx;
    };

    const insertLineIdx = getDeepestLineIdx(nodeId) + 1;

    let newLine = '';
    if (node.type === 'heading') {
      newLine = `${'#'.repeat(node.level)} Yeni Başlık`;
    } else if (node.type === 'task') {
      newLine = `${' '.repeat(node.indent)}- [ ] Yeni Görev`;
    } else {
      newLine = `${' '.repeat(node.indent)}- Yeni Madde`;
    }

    lines.splice(insertLineIdx, 0, newLine);

    const shiftNodes = nodes.map(n => {
      if (n.lineIndex >= insertLineIdx) {
        return { ...n, lineIndex: n.lineIndex + 1 };
      }
      return n;
    });

    const newId = `new-node-${Date.now()}`;
    const newCoords = {
      x: node.x,
      y: node.y + 80
    };

    const coords: LayoutCoords = {};
    shiftNodes.forEach(n => {
      coords[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };
    });
    coords[newId] = newCoords;

    const metadata: MindmapMetadata = {
      coords,
      customs
    };

    const finalMarkdown = lines.join('\n') + `\n\n<!-- mindmap-layout: ${JSON.stringify(metadata)} -->`;
    onChangeContent(finalMarkdown);
    setSelectedNodeId(newId);
  };

  // Düğüm Silme (Delete Node)
  const handleDeleteNode = (nodeId: string) => {
    if (nodeId === 'root-node') return;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const doDelete = () => {
      const layoutRegex = /<!--\s*mindmap-layout:\s*({.*?})\s*-->/s;
      const cleanContent = content.replace(layoutRegex, '');
      const lines = cleanContent.split('\n');

      const lineIndexesToDelete: number[] = [];
      const collectLineIndexes = (nId: string) => {
        const pNode = nodes.find(n => n.id === nId);
        if (pNode && pNode.lineIndex !== -1) {
          lineIndexesToDelete.push(pNode.lineIndex);
          pNode.children.forEach(collectLineIndexes);
        }
      };
      collectLineIndexes(nodeId);

      lineIndexesToDelete.sort((a, b) => b - a);
      lineIndexesToDelete.forEach(idx => {
        lines.splice(idx, 1);
      });

      const coords: LayoutCoords = {};
      nodes.forEach(n => {
        if (!lineIndexesToDelete.includes(n.lineIndex) && n.id !== nodeId) {
          const lineShiftCount = lineIndexesToDelete.filter(idx => idx < n.lineIndex).length;
          n.lineIndex -= lineShiftCount;
          coords[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };
        }
      });

      const metadata: MindmapMetadata = {
        coords,
        customs
      };

      const finalMarkdown = lines.join('\n') + `\n\n<!-- mindmap-layout: ${JSON.stringify(metadata)} -->`;
      onChangeContent(finalMarkdown);
      setSelectedNodeId(null);
      setPreviewNodeId(null);
    };

    const message = 'Seçili düğümü ve altındaki tüm dalları silmek istediğinize emin misiniz?';
    if (onRequestConfirm) {
      onRequestConfirm(message, doDelete);
    } else if (confirm(message)) {
      doDelete();
    }
  };

  // ==========================================
  // TÜRKÇE YORUM (Kural 5):
  // Düğümleri birbirine bağlayan SVG Bezier eğrilerini çizen bağlantı yöneticisi.
  // parent ve child koordinatlarını alıp şık bir "S-Curve" (kübik bezier) çizer.
  // ==========================================
  const renderConnections = useMemo(() => {
    return nodes.map(node => {
      if (!node.parentId) return null;
      const parent = nodes.find(p => p.id === node.parentId);
      if (!parent) return null;

      const pX = parent.x;
      const pY = parent.y;
      const cX = node.x;
      const cY = node.y;

      const controlDist = Math.abs(cX - pX) * 0.5;
      let pathData = '';

      if (layoutMode === 'tree') {
        pathData = `M ${pX} ${pY} C ${pX + (cX > pX ? controlDist : -controlDist)} ${pY}, ${cX - (cX > pX ? controlDist : -controlDist)} ${cY}, ${cX} ${cY}`;
      } else {
        pathData = `M ${pX} ${pY} C ${(pX + cX) / 2} ${pY}, ${(pX + cX) / 2} ${cY}, ${cX} ${cY}`;
      }

      let strokeColor = 'rgba(99, 102, 241, 0.4)';
      if (node.level === 1) strokeColor = 'rgba(99, 102, 241, 0.6)';
      else if (node.level === 2) strokeColor = 'rgba(16, 185, 129, 0.5)';
      else if (node.level >= 3) strokeColor = 'rgba(245, 158, 11, 0.4)';

      return (
        <path
          key={`conn-${parent.id}-${node.id}`}
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={Math.max(4 - node.level * 0.8, 1.5)}
          className="mindmap-connection"
          style={{
            strokeDasharray: '6, 6',
            animation: 'mindmapFlow 1.8s linear infinite'
          }}
        />
      );
    });
  }, [nodes, layoutMode]);

  return (
    <div 
      ref={containerRef}
      className="mindmap-container"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#0b0f19',
        userSelect: 'none'
      }}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onWheel={handleWheel}
    >
      {/* 1. KILAVUZ ÇİZGİSİ VE AKICI ANİMASYON STİL TANIMI */}
      <style>{`
        @keyframes mindmapFlow {
          to {
            stroke-dashoffset: -20;
          }
        }
        .mindmap-node-card {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-radius: 8px;
          background: rgba(17, 24, 39, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
          color: #e5e7eb;
          cursor: grab;
          transition: border-color 0.2s, box-shadow 0.2s;
          max-width: 250px;
        }
        .mindmap-node-card:hover {
          border-color: rgba(99, 102, 241, 0.6);
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.25);
        }
        .mindmap-node-card.selected {
          border-color: #6366f1;
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.4);
        }
        .mindmap-node-card.root {
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.95), rgba(79, 70, 229, 0.95));
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #fff;
          font-weight: 700;
          font-size: 15px;
          padding: 12px 20px;
          border-radius: 12px;
        }
        .mindmap-node-card.heading {
          border-left: 4px solid #6366f1;
          font-weight: 600;
        }
        .mindmap-node-card.task {
          border-left: 4px solid #10b981;
        }
        .mindmap-node-card.listitem {
          border-left: 4px solid #f59e0b;
        }

        /* Özel yüzer şekillerin stilleri */
        .mindmap-custom-card {
          position: absolute;
          transform: translate(-50%, -50%);
          cursor: grab;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
        }
        .mindmap-custom-card.text {
          color: #e5e7eb;
          font-size: 13px;
          font-weight: 500;
          padding: 4px 8px;
          border: 1px dashed rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        .mindmap-custom-card.emoji {
          font-size: 28px;
          filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
        }
        .mindmap-custom-card.sticky {
          padding: 12px;
          width: 140px;
          min-height: 120px;
          box-shadow: 2px 4px 10px rgba(0,0,0,0.3);
          border-radius: 4px;
          font-size: 12.5px;
          line-height: 1.4;
          font-family: sans-serif;
          color: #1f2937;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          text-align: left;
        }
        .mindmap-custom-card.sticky textarea {
          border: none;
          background: transparent;
          width: 100%;
          height: 100%;
          resize: none;
          outline: none;
          font-family: inherit;
          font-size: inherit;
          color: inherit;
        }
      `}</style>

      {/* 2. ARKA PLAN GRID DESENİ */}
      <svg 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      >
        <defs>
          <pattern id="mindmap-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#mindmap-grid)" />
      </svg>

      {/* 3. BAĞLANTI EĞRİLERİ (SVG CONNECTIONS) */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {renderConnections}
        </g>
      </svg>

      {/* 4. ZİHİN HARİTASI DÜĞÜM KARTLARI VE PREVIEW TOOLTIP */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
        }}
      >
        {nodes.map(node => {
          const isSelected = selectedNodeId === node.id;
          const isEditing = editingNodeId === node.id;
          const isPreviewing = previewNodeId === node.id;

          return (
            <React.Fragment key={node.id}>
              {/* Düğüm Kartı */}
              <div
                className={`mindmap-node-card ${node.type} ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  pointerEvents: 'auto',
                  zIndex: isSelected ? 100 : 50
                }}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onDoubleClick={(e) => handleNodeDoubleClick(e, node)}
              >
                {/* Görev Kontrol Kutusu */}
                {node.type === 'task' && (
                  <button
                    onClick={(e) => handleToggleCheck(e, node)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: node.checked ? '#10b981' : 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {node.checked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                )}

                {/* Düğüm Metni */}
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={handleSaveTextEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveTextEdit();
                      if (e.key === 'Escape') setEditingNodeId(null);
                    }}
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid #6366f1',
                      borderRadius: '4px',
                      color: '#fff',
                      padding: '2px 6px',
                      outline: 'none',
                      fontSize: '12px',
                      width: '120px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span 
                    style={{ 
                      fontSize: node.type === 'root' ? '14px' : '12px',
                      textDecoration: node.checked ? 'line-through' : 'none',
                      opacity: node.checked ? 0.6 : 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {node.text}
                  </span>
                )}

                {/* Düğüm İşlem Paneli (Seçildiğinde Beliren Floating Menu) */}
                {isSelected && !isEditing && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-38px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      gap: '4px',
                      background: '#1f2937',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      padding: '4px',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
                      pointerEvents: 'auto',
                      zIndex: 1000
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {/* Alt Düğüm Ekle */}
                    <button
                      onClick={() => handleAddChild(node.id)}
                      title="Alt Dal Ekle"
                      style={{ background: 'rgba(99, 102, 241, 0.2)', border: 'none', borderRadius: '4px', color: '#a5b4fc', cursor: 'pointer', padding: '4px', display: 'flex' }}
                    >
                      <Plus size={12} />
                    </button>
                    {/* Kardeş Düğüm Ekle */}
                    {node.id !== 'root-node' && (
                      <button
                        onClick={() => handleAddSibling(node.id)}
                        title="Kardeş Dal Ekle"
                        style={{ background: 'rgba(255, 255, 255, 0.05)', border: 'none', borderRadius: '4px', color: '#9ca3af', cursor: 'pointer', padding: '4px', display: 'flex' }}
                      >
                        <ArrowDown size={12} />
                      </button>
                    )}
                    {/* İçeriği Gör (Önizleme Butonu) */}
                    {node.type === 'heading' && (
                      <button
                        onClick={(e) => handleTogglePreview(e, node)}
                        title="Dizin İçeriğini Önizle"
                        style={{
                          background: isPreviewing ? 'rgba(99, 102, 241, 0.4)' : 'rgba(255, 255, 255, 0.05)',
                          border: 'none',
                          borderRadius: '4px',
                          color: isPreviewing ? '#fff' : '#9ca3af',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex'
                        }}
                      >
                        <Eye size={12} />
                      </button>
                    )}
                    {/* Düğümü Sil */}
                    {node.id !== 'root-node' && (
                      <button
                        onClick={() => handleDeleteNode(node.id)}
                        title="Seçili Dalı Sil"
                        style={{ background: 'rgba(239, 68, 68, 0.2)', border: 'none', borderRadius: '4px', color: '#fca5a5', cursor: 'pointer', padding: '4px', display: 'flex' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* TÜRKÇE YORUM (Kural 5):
                  Başlık düğümünün altındaki düz metinleri yarı saydam, glassmorphic bir tooltip/popup ile zihin haritası üzerinde gösteren render motoru. */}
              {isPreviewing && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${node.x + 130}px`,
                    top: `${node.y - 10}px`,
                    width: '280px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    background: 'rgba(15, 23, 42, 0.92)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                    color: '#cbd5e1',
                    fontSize: '11.5px',
                    lineHeight: '1.5',
                    textAlign: 'left',
                    zIndex: 200,
                    pointerEvents: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace'
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', marginBottom: '8px', color: '#a5b4fc', fontWeight: 'bold' }}>
                    <span>📝 Alt Bölüm İçeriği</span>
                    <button 
                      onClick={() => { setPreviewNodeId(null); setPreviewLines([]); }}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}
                    >
                      ✕
                    </button>
                  </div>
                  {previewLines.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Bu başlığın altında düz metin/içerik bulunmuyor.</div>
                  ) : (
                    previewLines.join('\n')
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* 4.2 YÜZER ÖZEL ÖĞELER VE YAPİŞKAN NOTLAR (CUSTOM ELEMENTS RENDERER) */}
        {customs.map(item => {
          const isSelected = selectedCustomId === item.id;
          const isEditing = editingCustomId === item.id;

          if (item.type === 'sticky') {
            // YAPİŞKAN NOT (STICKY NOTE / SHAPE) ŞABLONU
            return (
              <div
                key={item.id}
                className={`mindmap-custom-card sticky ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  background: item.color || '#fef08a',
                  border: isSelected ? '2px solid #6366f1' : 'none',
                  zIndex: isSelected ? 110 : 60
                }}
                onMouseDown={(e) => handleCustomMouseDown(e, item.id)}
                onDoubleClick={(e) => handleCustomDoubleClick(e, item)}
              >
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={handleSaveCustomEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCustomEdit();
                      if (e.key === 'Escape') setEditingCustomId(null);
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.4)',
                      border: '1px solid rgba(0, 0, 0, 0.2)',
                      borderRadius: '4px',
                      color: '#000',
                      padding: '4px',
                      outline: 'none',
                      width: '100%',
                      fontWeight: 'bold'
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span style={{ fontWeight: '500', width: '100%', wordBreak: 'break-word' }}>{item.text}</span>
                )}

                {/* Yapışkan Not Seçenekleri Panel (Renk değiştirme & Silme) */}
                {isSelected && !isEditing && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-34px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: '#1f2937',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
                      pointerEvents: 'auto',
                      zIndex: 1000
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {/* Renk Değiştirme Butonları */}
                    {['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8'].map(c => (
                      <button
                        key={c}
                        onClick={() => handleChangeCustomColor(item.id, c)}
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: c,
                          border: item.color === c ? '1px solid #fff' : '1px solid rgba(0,0,0,0.2)',
                          cursor: 'pointer',
                          padding: 0
                        }}
                      />
                    ))}
                    <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
                    {/* Sil Butonu */}
                    <button
                      onClick={() => handleDeleteCustom(item.id)}
                      title="Sil"
                      style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0, display: 'flex' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          } else {
            // METİN NOTU VEYA EMOLAR ŞABLONU
            return (
              <div
                key={item.id}
                className={`mindmap-custom-card ${item.type} ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  border: isSelected ? '1px dashed #6366f1' : (item.type === 'text' ? '1px dashed rgba(255, 255, 255, 0.15)' : 'none'),
                  zIndex: isSelected ? 110 : 60
                }}
                onMouseDown={(e) => handleCustomMouseDown(e, item.id)}
                onDoubleClick={(e) => handleCustomDoubleClick(e, item)}
              >
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={handleSaveCustomEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCustomEdit();
                      if (e.key === 'Escape') setEditingCustomId(null);
                    }}
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid #6366f1',
                      borderRadius: '4px',
                      color: '#fff',
                      padding: '2px 6px',
                      outline: 'none',
                      fontSize: '12px',
                      width: '80px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span>{item.text}</span>
                )}

                {/* Yüzer Metin/İkon Silme Paneli */}
                {isSelected && !isEditing && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '-30px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#1f2937',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.4)',
                      pointerEvents: 'auto',
                      zIndex: 1000
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => handleDeleteCustom(item.id)}
                      title="Sil"
                      style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0, display: 'flex' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          }
        })}
      </div>

      {/* 5. SOL ÜST KONTROL PANELİ VE ÖĞE EKLEME MENÜSÜ */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          display: 'flex',
          gap: '8px',
          zIndex: 10
        }}
      >
        {/* Görünüm Modu Seçimi */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '4px',
            borderRadius: '6px'
          }}
        >
          <button
            onClick={() => { setLayoutMode('radial'); setSelectedNodeId(null); setSelectedCustomId(null); }}
            style={{
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 'bold',
              borderRadius: '4px',
              border: 'none',
              background: layoutMode === 'radial' ? '#6366f1' : 'transparent',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Dairesel
          </button>
          <button
            onClick={() => { setLayoutMode('tree'); setSelectedNodeId(null); setSelectedCustomId(null); }}
            style={{
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 'bold',
              borderRadius: '4px',
              border: 'none',
              background: layoutMode === 'tree' ? '#6366f1' : 'transparent',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            Ağaç Yapısı
          </button>
        </div>

        {/* TÜRKÇE YORUM (Kural 5):
            Kullanıcının tuvale serbest şekilde yüzer sticky note, metin ya da emoji/ikon eklemesini sağlayan panel dropdown yapısı. */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
            style={{
              padding: '8px 12px',
              fontSize: '11px',
              fontWeight: 'bold',
              borderRadius: '6px',
              border: 'none',
              background: 'rgba(99, 102, 241, 0.95)',
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 4px 10px rgba(99,102,241,0.3)'
            }}
          >
            <Plus size={14} />
            <span>Öğe Ekle</span>
          </button>

          {isAddMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '36px',
                left: 0,
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '6px',
                width: '150px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                zIndex: 200
              }}
            >
              <button
                onClick={() => handleAddNewCustom('sticky', 'Açıklama notu...', '#fef08a')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Palette size={12} style={{ color: '#fef08a' }} />
                <span>Yapışkan Not</span>
              </button>
              <button
                onClick={() => handleAddNewCustom('text', 'Serbest Metin')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <FileText size={12} style={{ color: '#3b82f6' }} />
                <span>Yazı Notu</span>
              </button>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
              {/* Emojiler */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', padding: '4px' }}>
                {['💡', '🚀', '📌', '⭐', '🎯', '📅', '🎯', '🔥'].map(emo => (
                  <button
                    key={emo}
                    onClick={() => handleAddNewCustom('emoji', emo)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      fontSize: '16px',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {emo}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 6. SAĞ ALT ZUM / NAVİGASYON PANELİ */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          display: 'flex',
          gap: '6px',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '4px',
          borderRadius: '6px',
          zIndex: 10
        }}
      >
        <button
          onClick={() => setZoom(z => Math.min(z + 0.1, 2.5))}
          title="Yakınlaştır"
          style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px' }}
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => setZoom(z => Math.max(z - 0.1, 0.25))}
          title="Uzaklaştır"
          style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px' }}
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={() => { setZoom(0.85); setPan({ x: 100, y: 150 }); }}
          title="Merkezle"
          style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px' }}
        >
          <Compass size={16} />
        </button>
      </div>
    </div>
  );
}
