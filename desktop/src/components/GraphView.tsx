import React, { useEffect, useRef, useState } from 'react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
  createdAt: number;
  updatedAt: number;
}

interface GraphViewProps {
  notes: NoteItem[];
  scannedContents: Record<string, string>;
  onOpenNotePath: (path: string) => void;
  folderCustomizations?: Record<string, { icon?: string; color?: string }>;
}

interface Node {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  folder: string;
  color: string;
  size: number;
}

interface Edge {
  source: string;
  target: string;
}

export default function GraphView({ 
  notes, 
  scannedContents, 
  onOpenNotePath,
  folderCustomizations = {} 
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);

  // Floating settings UI states
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [activeAccordion, setActiveAccordion] = useState<'filters' | 'groups' | 'show' | 'forces' | null>('filters');

  // Interactive configurations
  const [searchQuery, setSearchQuery] = useState('');
  const [showLabels, setShowLabels] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);

  // Simulation physics parameters states
  const [repulsion, setRepulsion] = useState(350);
  const [attraction, setAttraction] = useState(0.04);
  const [gravity, setGravity] = useState(0.006);
  const [linkLength, setLinkLength] = useState(100);
  const kDamping = 0.85;

  // Sync physics states with references for loop thread safety
  const repulsionRef = useRef(350);
  const attractionRef = useRef(0.04);
  const gravityRef = useRef(0.006);
  const linkLengthRef = useRef(100);

  repulsionRef.current = repulsion;
  attractionRef.current = attraction;
  gravityRef.current = gravity;
  linkLengthRef.current = linkLength;

  // Graph data references
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  // Camera Zoom & Pan states
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  panRef.current = pan;

  // Interaction tracking
  const dragNodeIdRef = useRef<string | null>(null);
  const dragStartMouseRef = useRef({ x: 0, y: 0 });
  const dragStartPanRef = useRef({ x: 0, y: 0 });

  // Touch tracking for mobile
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);

  // Generate color palette based on folder name or user custom colors
  const getFolderColor = (folder: string) => {
    if (folder && folderCustomizations[folder]?.color) {
      return folderCustomizations[folder].color;
    }
    // Default Obsidian node color (off-white / slate-400)
    return '#94a3b8';
  };

  // Build nodes and edges from wiki links [[NoteName]]
  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // 1. Create nodes
    notes.forEach((note, idx) => {
      const parts = note.path.split('/');
      const folderName = parts.length > 1 ? parts[0] : '';
      
      // Keep existing positions if re-indexing
      const oldNode = nodesRef.current.find(n => n.path === note.path);
      const angle = (idx / notes.length) * Math.PI * 2;
      const radius = 120 + Math.random() * 60;

      newNodes.push({
        id: note.path,
        name: note.name,
        path: note.path,
        x: oldNode ? oldNode.x : radius * Math.cos(angle),
        y: oldNode ? oldNode.y : radius * Math.sin(angle),
        vx: oldNode ? oldNode.vx : 0,
        vy: oldNode ? oldNode.vy : 0,
        folder: folderName,
        color: getFolderColor(folderName),
        size: note.type === 'excalidraw' ? 7 : 5
      });
    });

    // 2. Parse wiki links in each note content
    notes.forEach((note) => {
      const content = scannedContents[note.path] || '';
      // Regex matches: [[Note Name]] or [[Folder/Note Name]] or [[Note Name|Display Label]]
      const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let match;
      
      while ((match = linkRegex.exec(content)) !== null) {
        const linkTarget = match[1].trim().toLowerCase();
        
        // Resolve link target name to a note
        const targetNote = notes.find((n) => {
          const nameLower = n.name.toLowerCase();
          const pathLower = n.path.toLowerCase().replace('.md', '').replace('.excalidraw', '');
          return nameLower === linkTarget || pathLower === linkTarget || pathLower.endsWith('/' + linkTarget);
        });

        if (targetNote && targetNote.path !== note.path) {
          // Prevent duplicates
          const alreadyLinked = newEdges.some(
            (e) => (e.source === note.path && e.target === targetNote.path) ||
                   (e.source === targetNote.path && e.target === note.path)
          );
          if (!alreadyLinked) {
            newEdges.push({
              source: note.path,
              target: targetNote.path
            });
          }
        }
      }
    });

    nodesRef.current = newNodes;
    edgesRef.current = newEdges;
  }, [notes, scannedContents, folderCustomizations]);

  // Main canvas drawing and physics loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      canvas.width = rect?.width || 800;
      canvas.height = rect?.height || 500;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Physics update step
    const updatePhysics = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      // 1. Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);

          if (dist < 350) {
            // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            // Düğümler çok yakınken (örn. başlangıçtaki dairesel dizilimde onlarca not üst üste biner)
            // itme kuvveti 1/mesafe² ile patlayıp düğümleri fırlatıyor ve sonsuz salınıma yol açıyordu.
            // Mesafeyi bir tabana (min ~15px) sabitleyerek bu patlamayı önlüyoruz.
            const clampedDistSq = Math.max(distSq, 225);
            const force = repulsionRef.current / clampedDistSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            n1.vx += fx;
            n1.vy += fy;
            n2.vx -= fx;
            n2.vy -= fy;
          }
        }
      }

      // 2. Attraction along edges
      edges.forEach((edge) => {
        const n1 = nodes.find(n => n.id === edge.source);
        const n2 = nodes.find(n => n.id === edge.target);
        if (!n1 || !n2) return;

        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const force = (dist - linkLengthRef.current) * attractionRef.current;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        n1.vx += fx;
        n1.vy += fy;
        n2.vx -= fx;
        n2.vy -= fy;
      });

      // 3. Gravity pulling to center and position updates
      nodes.forEach((node) => {
        // If dragged, keep at mouse position
        if (node.id === dragNodeIdRef.current) {
          node.vx = 0;
          node.vy = 0;
          return;
        }

        // Center gravity
        node.vx += -node.x * gravityRef.current;
        node.vy += -node.y * gravityRef.current;

        // Apply velocities with damping
        node.vx *= kDamping;
        node.vy *= kDamping;

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Herhangi bir kaynaktan (itme, çekim vb.) gelen ani büyük kuvvet birikimini sınırlayarak
        // düğümlerin ekranda fırlayıp geri gelmesini (kararsız salınım) önleyen hız tavanı.
        const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        const maxSpeed = 30;
        if (speed > maxSpeed) {
          node.vx = (node.vx / speed) * maxSpeed;
          node.vy = (node.vy / speed) * maxSpeed;
        }

        node.x += node.vx;
        node.y += node.vy;
      });
    };

    // Draw frame
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Apply pan offset and zoom scale
      ctx.translate(canvas.width / 2 + panRef.current.x, canvas.height / 2 + panRef.current.y);
      ctx.scale(zoomRef.current, zoomRef.current);

      const nodes = nodesRef.current;
      const edges = edgesRef.current;

      const hasSearch = searchQuery.trim() !== '';
      const query = searchQuery.toLowerCase().trim();

      // Filter function to check if node matches query
      const isNodeMatch = (n: Node) => {
        if (!hasSearch) return true;
        return n.name.toLowerCase().includes(query) || n.folder.toLowerCase().includes(query);
      };

      // Helper function to check if node is an orphan
      const isNodeOrphan = (nId: string) => {
        return !edges.some(e => e.source === nId || e.target === nId);
      };

      // Get list of nodes we actually want to draw
      const activeNodes = nodes.filter(n => {
        if (!showOrphans && isNodeOrphan(n.id)) return false;
        return true;
      });

      // 1. Draw edges/links
      if (showLinks) {
        ctx.lineWidth = 1;
        edges.forEach((edge) => {
          const sourceNode = activeNodes.find(n => n.id === edge.source);
          const targetNode = activeNodes.find(n => n.id === edge.target);
          if (!sourceNode || !targetNode) return;

          // Search highlighting for edges
          const sourceMatch = isNodeMatch(sourceNode);
          const targetMatch = isNodeMatch(targetNode);

          let edgeOpacity = 0.08;
          if (hasSearch) {
            if (sourceMatch && targetMatch) {
              edgeOpacity = 0.25;
            } else if (sourceMatch || targetMatch) {
              edgeOpacity = 0.02;
            } else {
              return; // Do not draw edge if neither matches
            }
          }

          // Highlight connected edge if hovered
          const isHighlighted = hoveredNode && (hoveredNode.id === edge.source || hoveredNode.id === edge.target);

          ctx.strokeStyle = isHighlighted ? 'var(--accent-color)' : `rgba(255, 255, 255, ${edgeOpacity})`;
          ctx.beginPath();
          ctx.moveTo(sourceNode.x, sourceNode.y);
          ctx.lineTo(targetNode.x, targetNode.y);
          ctx.stroke();
        });
      }

      // 2. Draw nodes/dots
      activeNodes.forEach((node) => {
        const isHovered = hoveredNode && hoveredNode.id === node.id;
        const isNeighbor = hoveredNode && edges.some(e => 
          (e.source === hoveredNode.id && e.target === node.id) ||
          (e.target === hoveredNode.id && e.source === node.id)
        );

        // Search highlight checking
        const isMatch = isNodeMatch(node);
        let nodeOpacity = 1.0;
        if (hasSearch && !isMatch) {
          nodeOpacity = 0.15;
        }

        ctx.save();
        ctx.globalAlpha = nodeOpacity;

        ctx.beginPath();
        
        // Node size modifier on hover/search (divided by zoom to make nodes smaller when zoomed in)
        let radius = node.size;
        if (zoomRef.current > 1) {
          // As zoom increases, scale down the drawn radius to make nodes smaller on screen
          radius = node.size / Math.pow(zoomRef.current, 1.2);
        } else if (zoomRef.current < 1) {
          // When zooming out, don't let nodes get too small on screen (maintain a minimum visible size)
          radius = Math.max(2, node.size / zoomRef.current);
        }

        if (isHovered) radius += 3 / zoomRef.current;
        else if (hasSearch && isMatch) radius += 1.5 / zoomRef.current;

        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        
        ctx.fillStyle = node.color;
        
        // Node Glow effect
        if (isHovered) {
          ctx.shadowBlur = 18;
          ctx.shadowColor = node.color;
        } else if (isNeighbor) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = 'rgba(255,255,255,0.4)';
        } else if (hasSearch && isMatch) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = node.color;
        } else {
          ctx.shadowBlur = 0;
        }

        ctx.fill();
        ctx.shadowBlur = 0; // reset shadow

        // Render target ring on search matching items
        if (hasSearch && isMatch) {
          ctx.strokeStyle = node.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        // 3. Draw text label
        const renderText = showLabels && (activeNodes.length < 60 || isHovered || isNeighbor || (hasSearch && isMatch));
        if (renderText) {
          ctx.font = isHovered ? 'bold 11px sans-serif' : '10px sans-serif';
          ctx.fillStyle = isHovered ? '#fff' : (isNeighbor ? 'var(--text-primary)' : 'var(--text-muted)');
          ctx.textAlign = 'center';
          ctx.fillText(node.name, node.x, node.y + radius + 14);
        }

        ctx.restore();
      });

      ctx.restore();
    };

    // Render loop
    const loop = () => {
      updatePhysics();
      draw();
      animationId = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [hoveredNode, showLabels, showLinks, showOrphans, searchQuery]);

  // Screen to world coordinates helper
  const screenToWorld = (screenX: number, screenY: number, canvas: HTMLCanvasElement) => {
    const x = (screenX - canvas.width / 2 - panRef.current.x) / zoomRef.current;
    const y = (screenY - canvas.height / 2 - panRef.current.y) / zoomRef.current;
    return { x, y };
  };

  // Mouse move handler (Hover detection, Drag node or Pan view)
  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPos = screenToWorld(mouseX, mouseY, canvas);

    // Handle node drag update
    if (dragNodeIdRef.current) {
      const dragNode = nodesRef.current.find(n => n.id === dragNodeIdRef.current);
      if (dragNode) {
        dragNode.x = worldPos.x;
        dragNode.y = worldPos.y;
      }
      return;
    }

    // Handle view panning
    if (e.buttons === 1 && !dragNodeIdRef.current) {
      const dx = e.clientX - dragStartMouseRef.current.x;
      const dy = e.clientY - dragStartMouseRef.current.y;
      setPan({
        x: dragStartPanRef.current.x + dx,
        y: dragStartPanRef.current.y + dy
      });
      return;
    }

    // Hover check
    let foundHover: Node | null = null;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const node = nodesRef.current[i];
      const dx = worldPos.x - node.x;
      const dy = worldPos.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < node.size + 6) {
        foundHover = node;
        break;
      }
    }
    setHoveredNode(foundHover);
  };

  // Mouse down handler (Start drag node or Pan view)
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPos = screenToWorld(mouseX, mouseY, canvas);

    // Check if clicked a node
    let clickedNode: Node | null = null;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const node = nodesRef.current[i];
      const dx = worldPos.x - node.x;
      const dy = worldPos.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < node.size + 6) {
        clickedNode = node;
        break;
      }
    }

    if (clickedNode) {
      dragNodeIdRef.current = clickedNode.id;
      dragStartMouseRef.current = { x: e.clientX, y: e.clientY };
    } else {
      // Start view panning
      dragStartMouseRef.current = { x: e.clientX, y: e.clientY };
      dragStartPanRef.current = { ...panRef.current };
    }
  };

  // Mouse up handler (End drag and open note if click was static)
  const handleMouseUp = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragNodeIdRef.current) {
      const node = nodesRef.current.find(n => n.id === dragNodeIdRef.current);
      if (node) {
        // Calculate screen-space movement distance
        const dx = e.clientX - dragStartMouseRef.current.x;
        const dy = e.clientY - dragStartMouseRef.current.y;
        const clickDist = Math.sqrt(dx * dx + dy * dy);

        // Click threshold: if mouse moved less than 6 pixels on screen, open the note!
        if (clickDist < 6) {
          onOpenNotePath(node.path);
        }
      }
    }

    dragNodeIdRef.current = null;
  };

  // Touch start handler for mobile screens
  const handleTouchStart = (e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const mouseX = touch.clientX - rect.left;
      const mouseY = touch.clientY - rect.top;

      const worldPos = screenToWorld(mouseX, mouseY, canvas);

      // Check if clicked a node (with a larger touch target size (14px) for fingers)
      let clickedNode: Node | null = null;
      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const node = nodesRef.current[i];
        const dx = worldPos.x - node.x;
        const dy = worldPos.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < node.size + 14) {
          clickedNode = node;
          break;
        }
      }

      if (clickedNode) {
        dragNodeIdRef.current = clickedNode.id;
        dragStartMouseRef.current = { x: touch.clientX, y: touch.clientY };
      } else {
        // Start view panning
        dragStartMouseRef.current = { x: touch.clientX, y: touch.clientY };
        dragStartPanRef.current = { ...panRef.current };
      }
    } else if (e.touches.length === 2) {
      // Start multi-touch pinch to zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartZoomRef.current = zoomRef.current;
    }
  };

  // Touch move handler for mobile screens (drag node, pan viewport, or pinch zoom)
  const handleTouchMove = (e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.touches.length === 1 && dragStartMouseRef.current) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      const mouseX = touch.clientX - rect.left;
      const mouseY = touch.clientY - rect.top;

      const worldPos = screenToWorld(mouseX, mouseY, canvas);

      // Handle node drag update
      if (dragNodeIdRef.current) {
        const dragNode = nodesRef.current.find(n => n.id === dragNodeIdRef.current);
        if (dragNode) {
          dragNode.x = worldPos.x;
          dragNode.y = worldPos.y;
        }
        return;
      }

      // Handle viewport panning
      const dx = touch.clientX - dragStartMouseRef.current.x;
      const dy = touch.clientY - dragStartMouseRef.current.y;
      setPan({
        x: dragStartPanRef.current.x + dx,
        y: dragStartPanRef.current.y + dy
      });
    } else if (e.touches.length === 2 && touchStartDistRef.current) {
      // Handle multi-touch pinch zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const zoomFactor = dist / touchStartDistRef.current;
      const newZoom = Math.min(Math.max(touchStartZoomRef.current * zoomFactor, 0.15), 5);
      setZoom(newZoom);
    }
  };

  // Touch end handler for mobile screens
  const handleTouchEnd = (e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragNodeIdRef.current && dragStartMouseRef.current) {
      if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        const dx = touch.clientX - dragStartMouseRef.current.x;
        const dy = touch.clientY - dragStartMouseRef.current.y;
        const clickDist = Math.sqrt(dx * dx + dy * dy);

        // Click threshold on mobile (fingers are less precise, so 12px)
        if (clickDist < 12) {
          const node = nodesRef.current.find(n => n.id === dragNodeIdRef.current);
          if (node) {
            onOpenNotePath(node.path);
          }
        }
      }
    }

    dragNodeIdRef.current = null;
    touchStartDistRef.current = null;
  };

  // Zoom wheel handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.min(Math.max(zoomRef.current * zoomFactor, 0.15), 5);
    setZoom(newZoom);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', height: '100%', background: '#0b0f19' }}>
      
      {/* Controls HUD overlay */}
      <div 
        style={{ 
          position: 'absolute', 
          top: '12px', 
          left: '12px', 
          zIndex: 10, 
          display: 'flex', 
          gap: '6px', 
          background: 'rgba(15, 23, 42, 0.8)', 
          backdropFilter: 'blur(8px)', 
          border: '1px solid rgba(255,255,255,0.08)', 
          borderRadius: '8px', 
          padding: '6px' 
        }}
      >
        <button 
          onClick={() => setZoom(z => Math.min(z * 1.2, 5))}
          style={{ width: '28px', height: '28px', background: 'transparent', border: 'none', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Yakınlaştır"
        >
          ＋
        </button>
        <button 
          onClick={() => setZoom(z => Math.max(z * 0.8, 0.15))}
          style={{ width: '28px', height: '28px', background: 'transparent', border: 'none', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Uzaklaştır"
        >
          －
        </button>
        <button 
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          style={{ width: '28px', height: '28px', background: 'transparent', border: 'none', color: '#fff', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="Sıfırla"
        >
          🏠
        </button>
      </div>

      {/* Obsidian-Style Floating Settings Pane */}
      {isPanelOpen ? (
        <div 
          className="graph-settings-panel animate-fade"
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '280px',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '8px',
            color: '#e2e8f0',
            fontFamily: 'sans-serif',
            fontSize: '12px',
            zIndex: 100,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(100% - 24px)'
          }}
        >
          {/* Header */}
          <div 
            style={{ 
              padding: '12px 14px', 
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              fontWeight: 600
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>⚙️</span>
              <span>Grafik Ayarları</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button 
                onClick={() => {
                  setSearchQuery('');
                  setShowLabels(true);
                  setShowLinks(true);
                  setShowOrphans(true);
                  setRepulsion(350);
                  setAttraction(0.04);
                  setGravity(0.006);
                  setLinkLength(100);
                }}
                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '13px', padding: 0 }}
                title="Ayarları Sıfırla"
              >
                🔄
              </button>
              <button 
                onClick={() => setIsPanelOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '14px', padding: 0 }}
                title="Kapat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Accordion List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            
            {/* 1. Filtreler */}
            <div>
              <div 
                onClick={() => setActiveAccordion(activeAccordion === 'filters' ? null : 'filters')}
                style={{ 
                  padding: '10px 14px', 
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  fontWeight: 500,
                  background: activeAccordion === 'filters' ? 'rgba(255,255,255,0.02)' : 'transparent'
                }}
              >
                <span>Filtreler</span>
                <span>{activeAccordion === 'filters' ? '▼' : '▶'}</span>
              </div>
              {activeAccordion === 'filters' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Not Ara</label>
                    <input
                      type="text"
                      placeholder="Not adını yazın..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '11px',
                        outline: 'none'
                      }}
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '11.5px' }}>
                    <input
                      type="checkbox"
                      checked={showLabels}
                      onChange={(e) => setShowLabels(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>Not isimlerini göster</span>
                  </label>
                </div>
              )}
            </div>

            {/* 2. Gruplar (Klasör Renkleri) */}
            <div>
              <div 
                onClick={() => setActiveAccordion(activeAccordion === 'groups' ? null : 'groups')}
                style={{ 
                  padding: '10px 14px', 
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  fontWeight: 500,
                  background: activeAccordion === 'groups' ? 'rgba(255,255,255,0.02)' : 'transparent'
                }}
              >
                <span>Gruplar (Klasörler)</span>
                <span>{activeAccordion === 'groups' ? '▼' : '▶'}</span>
              </div>
              {activeAccordion === 'groups' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>
                    Sol menüde klasörlere atadığınız özel renkler grafiğe yansır:
                  </div>
                  {(() => {
                    const folderNames = Array.from(new Set(notes.map(n => {
                      const parts = n.path.split('/');
                      return parts.length > 1 ? parts[0] : '';
                    }).filter(Boolean)));

                    if (folderNames.length === 0) {
                      return <div style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>Aktif klasör bulunamadı.</div>;
                    }

                    return folderNames.map(f => {
                      const hasCustom = folderCustomizations[f]?.color;
                      return (
                        <div key={f} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                          <span style={{ fontSize: '11px' }}>📁 {f}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span 
                              style={{ 
                                width: '10px', 
                                height: '10px', 
                                borderRadius: '50%', 
                                background: hasCustom || '#94a3b8',
                                display: 'inline-block',
                                boxShadow: hasCustom ? `0 0 8px ${hasCustom}` : 'none'
                              }} 
                            />
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                              {hasCustom ? 'Özel Renk' : 'Varsayılan'}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            {/* 3. Göster */}
            <div>
              <div 
                onClick={() => setActiveAccordion(activeAccordion === 'show' ? null : 'show')}
                style={{ 
                  padding: '10px 14px', 
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  fontWeight: 500,
                  background: activeAccordion === 'show' ? 'rgba(255,255,255,0.02)' : 'transparent'
                }}
              >
                <span>Göster</span>
                <span>{activeAccordion === 'show' ? '▼' : '▶'}</span>
              </div>
              {activeAccordion === 'show' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showLinks}
                      onChange={(e) => setShowLinks(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>Bağlantı çizgilerini göster</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showOrphans}
                      onChange={(e) => setShowOrphans(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <span>Bağlantısız notları göster</span>
                  </label>
                </div>
              )}
            </div>

            {/* 4. Güçler */}
            <div>
              <div 
                onClick={() => setActiveAccordion(activeAccordion === 'forces' ? null : 'forces')}
                style={{ 
                  padding: '10px 14px', 
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  fontWeight: 500,
                  background: activeAccordion === 'forces' ? 'rgba(255,255,255,0.02)' : 'transparent'
                }}
              >
                <span>Güçler (Fizik Motoru)</span>
                <span>{activeAccordion === 'forces' ? '▼' : '▶'}</span>
              </div>
              {activeAccordion === 'forces' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px', color: 'rgba(255,255,255,0.4)' }}>
                      <span>İtme Gücü (Repulsion)</span>
                      <span>{repulsion}</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="10"
                      value={repulsion}
                      onChange={(e) => setRepulsion(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                    />
                  </div>
                  
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px', color: 'rgba(255,255,255,0.4)' }}>
                      <span>Çekim Gücü (Attraction)</span>
                      <span>{attraction.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.005"
                      max="0.2"
                      step="0.005"
                      value={attraction}
                      onChange={(e) => setAttraction(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px', color: 'rgba(255,255,255,0.4)' }}>
                      <span>Merkez Çekimi (Gravity)</span>
                      <span>{gravity.toFixed(3)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.001"
                      max="0.05"
                      step="0.001"
                      value={gravity}
                      onChange={(e) => setGravity(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '2px', color: 'rgba(255,255,255,0.4)' }}>
                      <span>Bağlantı Mesafesi</span>
                      <span>{linkLength}px</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="300"
                      step="5"
                      value={linkLength}
                      onChange={(e) => setLinkLength(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent-color)', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsPanelOpen(true)}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: '#fff',
            fontSize: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
            transition: 'all 0.2s'
          }}
          title="Ayarları Aç"
        >
          ⚙️
        </button>
      )}

      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ width: '100%', height: '100%', display: 'block', cursor: hoveredNode ? 'pointer' : (dragNodeIdRef.current ? 'grabbing' : 'grab') }}
      />
    </div>
  );
}
