import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Inbox, Folder, FileText, CheckSquare, Clock, Trash2, 
  ArrowRight, FilePlus2, Calendar, Edit3, Check, X, AlertCircle,
  SlidersHorizontal, ChevronRight, ListCollapse
} from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
}

interface InboxItem {
  id: string;
  raw: string;
  content: string;
  timestamp: string;
  isTodo: boolean;
  isCompleted: boolean;
  tags: string[];
  subtasks?: string[];
}

interface InboxViewProps {
  notes: NoteItem[];
  folders: string[];
  tags: string[];
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
  onCreateNote: (name: string, folder: string | null) => Promise<void>;
  loadAllData: () => Promise<void>;
  setActiveTab: (tab: string) => void;
  setActiveNotePath: (path: string | null) => void;
  // BUG DÜZELTMESİ: native window.confirm() yerine App.tsx'teki paylaşılan uygulama-içi
  // onay modalını kullanır (confirm() gerçek bir pencere blur/focus olayı tetiklemediği
  // için odağa dayalı temizleme mekanizmaları silme onayı sırasında hiç çalışmıyordu).
  onRequestConfirm?: (message: string, onConfirm: () => void) => void;
}

export default function InboxView({
  notes,
  folders,
  tags,
  readNoteContent,
  onSaveNote,
  onCreateNote,
  loadAllData,
  setActiveTab,
  setActiveNotePath,
  onRequestConfirm
}: InboxViewProps) {
  // Inbox Files list
  const inboxNotes = notes.filter(n => n.type === 'note' && (n.path === 'inbox.md' || n.path.endsWith('/inbox.md')));
  const [selectedInboxPath, setSelectedInboxPath] = useState<string>('inbox.md');
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filters State
  const [filterType, setFilterType] = useState<'all' | 'notes' | 'todos'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Bulk Selection State
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  // Triage Action Dialogs
  const [editingItem, setEditingItem] = useState<InboxItem | null>(null);
  const [editingText, setEditingText] = useState('');

  const [movingItem, setMovingItem] = useState<InboxItem | null>(null);
  const [targetFolder, setTargetFolder] = useState<string>('');
  const [targetNote, setTargetNote] = useState<string>('');

  const [convertingItem, setConvertingItem] = useState<InboxItem | null>(null);
  const [newNoteName, setNewNoteName] = useState('');
  const [newNoteFolder, setNewNoteFolder] = useState<string>('');

  const [snoozingItem, setSnoozingItem] = useState<InboxItem | null>(null);
  const [snoozeDate, setSnoozeDate] = useState('');

  // Fetch items from the selected inbox markdown file
  const fetchInboxItems = async () => {
    setIsLoading(true);
    try {
      let content = '';
      try {
        content = await readNoteContent(selectedInboxPath);
      } catch (err) {
        // If file doesn't exist, create default header
        const defaultHeader = `# Gelen Kutusu (${selectedInboxPath.replace('/inbox.md', '').replace('inbox.md', 'Root')})\n\n`;
        await onSaveNote(selectedInboxPath, defaultHeader);
        content = defaultHeader;
      }
      
      const parsed = parseInboxContent(content);
      setInboxItems(parsed);
      setSelectedItemIds([]); // reset selection
    } catch (error) {
      console.error('Error fetching inbox items:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInboxItems();
  }, [selectedInboxPath, notes]); // Reload when notes or selected path changes

  // Parser: splits markdown content into triage cards
  const parseInboxContent = (content: string): InboxItem[] => {
    if (!content) return [];
    const lines = content.split('\n');
    const items: InboxItem[] = [];
    
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // 1. Check checklist tasks
      const checklistMatch = line.match(/^(\s*)([*\-]\s+\[([ xX])\])\s+(.*)$/);
      if (checklistMatch) {
        const leadingWhitespace = checklistMatch[1];
        const indent = leadingWhitespace.length;
        
        if (indent > 0) {
          // Skip indented subtasks, they are grouped under their parent task card
          i++;
          continue;
        }

        const isChecked = checklistMatch[3].toLowerCase() === 'x';
        const rest = checklistMatch[4];
        
        // Try parsing timestamp: [YYYY-MM-DD HH:mm]
        const timeMatch = rest.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/);
        const timestamp = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : '';
        
        // Extract tags
        const tagRegex = /#([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)/g;
        const itemTags: string[] = [];
        let tagMatch;
        while ((tagMatch = tagRegex.exec(rest)) !== null) {
          if (tagMatch[1].toLowerCase() !== 'todo') {
            itemTags.push(tagMatch[1].toLowerCase());
          }
        }
        
        // Clean display text
        let cleanText = rest
          .replace(/\[p:(?:critical|acil|high|yüksek|medium|orta|low|düşük)\]/gi, '')
          .replace(/\[due:\d{4}-\d{2}-\d{2}\]/gi, '')
          .replace(/\[time:\d{2}:\d{2}-\d{2}:\d{2}\]/gi, '')
          .replace(/\[repeat:(?:daily|günlük|weekly|haftalık|monthly|aylık)\]/gi, '')
          .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '') // strip capture timestamp
          .replace(tagRegex, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Scan subsequent lines for indented subtasks and group them
        let blockLines = [line];
        let subtasksList: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          if (/^\s+/.test(nextLine)) {
            blockLines.push(nextLine);
            
            // Check if this indented line is a checklist subtask
            const subtaskMatch = nextLine.match(/^\s*[*\-]\s+\[([ xX])\]\s+(.*)$/);
            if (subtaskMatch) {
              const subTaskText = subtaskMatch[2].trim();
              if (subTaskText) {
                subtasksList.push(subTaskText);
              }
            }
            j++;
          } else {
            break;
          }
        }
        
        const rawBlock = blockLines.join('\n');
        
        items.push({
          id: `todo-${i}-${Math.random().toString(36).substring(2, 7)}`,
          raw: rawBlock,
          content: cleanText || rest,
          timestamp,
          isTodo: true,
          isCompleted: isChecked,
          tags: itemTags,
          subtasks: subtasksList.length > 0 ? subtasksList : undefined
        });
        
        i = j;
        continue;
      }
      
      // 2. Check paragraph header: ### [timestamp]
      if (trimmedLine.startsWith('### ')) {
        const headerRest = trimmedLine.replace('### ', '').trim();
        const timeMatch = headerRest.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/);
        const timestamp = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : '';
        
        // Gather subsequent lines until next item
        let blockLines = [line];
        let bodyLines: string[] = [];
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          const nextTrimmed = nextLine.trim();
          
          const isNextTodo = /^\s*[*\-]\s+\[([ xX])\]/.test(nextLine);
          const isNextHeader = nextTrimmed.startsWith('### ');
          
          if (isNextTodo || isNextHeader) {
             break;
          }
          
          blockLines.push(nextLine);
          bodyLines.push(nextLine);
          j++;
        }
        
        const rawBlock = blockLines.join('\n');
        const bodyText = bodyLines.join('\n').trim();
        
        // Extract tags
        const tagRegex = /#([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)/g;
        const itemTags: string[] = [];
        let tagMatch;
        while ((tagMatch = tagRegex.exec(bodyText)) !== null) {
          itemTags.push(tagMatch[1].toLowerCase());
        }
        
        let cleanText = bodyText
          .replace(tagRegex, '')
          .replace(/\s+/g, ' ')
          .trim();
          
        if (!cleanText && headerRest) {
          cleanText = headerRest.replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]/g, '').trim();
        }
        
        items.push({
          id: `note-${i}-${Math.random().toString(36).substring(2, 7)}`,
          raw: rawBlock,
          content: cleanText || '(Boş metin)',
          timestamp,
          isTodo: false,
          isCompleted: false,
          tags: itemTags
        });
        
        i = j;
        continue;
      }
      
      i++;
    }
    
    return items;
  };

  // Actions implementation

  // 1. Complete task in markdown file
  const handleToggleComplete = async (item: InboxItem) => {
    try {
      const fileContent = await readNoteContent(selectedInboxPath);
      const match = item.raw.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
      if (!match) return;
      const nextState = !item.isCompleted;
      const newRaw = `${match[1]}${nextState ? 'x' : ' '}${match[3]}`;
      
      const updatedContent = fileContent.replace(item.raw, newRaw);
      await onSaveNote(selectedInboxPath, updatedContent);
      await loadAllData();
      await fetchInboxItems();
    } catch (err) {
      console.error('Error toggling inbox todo complete:', err);
    }
  };

  // 2. Delete / Archive item from file
  const handleDeleteItem = async (item: InboxItem) => {
    try {
      const fileContent = await readNoteContent(selectedInboxPath);
      // Remove raw block and extra newlines
      const updatedContent = fileContent.replace(item.raw, '').replace(/\n{3,}/g, '\n\n').trim();
      await onSaveNote(selectedInboxPath, updatedContent);
      await loadAllData();
      await fetchInboxItems();
    } catch (err) {
      console.error('Error deleting inbox item:', err);
    }
  };

  // 3. Move Item to another folder / note
  const handleMoveItem = async (item: InboxItem, folder: string | null, notePath: string | null) => {
    try {
      let destinationPath = '';
      if (notePath) {
        destinationPath = notePath;
      } else if (folder) {
        destinationPath = `${folder}/inbox.md`;
      } else {
        destinationPath = 'inbox.md';
      }

      // Read destination note content
      let destContent = '';
      try {
        destContent = await readNoteContent(destinationPath);
      } catch (e) {
        // If file doesn't exist, start new
        const noteTitle = destinationPath.split('/').pop()?.replace('.md', '') || 'Gelen Kutusu';
        destContent = `# ${noteTitle}\n\n`;
      }

      const appendText = `\n\n${item.raw.trim()}`;
      await onSaveNote(destinationPath, destContent.trim() + appendText);

      // Remove from current inbox
      const fileContent = await readNoteContent(selectedInboxPath);
      const updatedContent = fileContent.replace(item.raw, '').replace(/\n{3,}/g, '\n\n').trim();
      await onSaveNote(selectedInboxPath, updatedContent);

      setMovingItem(null);
      await loadAllData();
      await fetchInboxItems();
    } catch (err) {
      console.error('Error moving inbox item:', err);
    }
  };

  // 4. Convert Item to Dedicated Note
  const handleConvertToNote = async (item: InboxItem, name: string, folder: string | null) => {
    if (!name.trim()) return;
    try {
      const cleanName = name.trim();
      await onCreateNote(cleanName, folder);
      
      const filename = `${cleanName.replace(/\s+/g, '_')}.md`;
      const notePath = folder ? `${folder}/${filename}` : filename;

      let bodyText = item.content;
      if (item.tags.length > 0) {
        bodyText += `\n\n${item.tags.map(t => `#${t}`).join(' ')}`;
      }

      await onSaveNote(notePath, `# ${cleanName}\n\nOluşturulma Tarihi: ${new Date().toLocaleString('tr-TR')}\n\n${bodyText}`);

      // Remove from current inbox
      const fileContent = await readNoteContent(selectedInboxPath);
      const updatedContent = fileContent.replace(item.raw, '').replace(/\n{3,}/g, '\n\n').trim();
      await onSaveNote(selectedInboxPath, updatedContent);

      setConvertingItem(null);
      await loadAllData();
      await fetchInboxItems();

      // Open the newly created note directly
      setActiveNotePath(notePath);
      setActiveTab('notes');
    } catch (err) {
      console.error('Error converting inbox item to note:', err);
    }
  };

  // 5. Snooze / Schedule Bit Tarihi ekleme
  const handleSnoozeItem = async (item: InboxItem, date: string) => {
    if (!date) return;
    try {
      const fileContent = await readNoteContent(selectedInboxPath);
      
      let newRaw = '';
      if (item.isTodo) {
        if (item.raw.includes('[due:')) {
          newRaw = item.raw.replace(/\[due:\d{4}-\d{2}-\d{2}\]/, `[due:${date}]`);
        } else {
          newRaw = `${item.raw.trim()} [due:${date}]`;
        }
      } else {
        if (item.raw.includes('[due:')) {
          newRaw = item.raw.replace(/\[due:\d{4}-\d{2}-\d{2}\]/, `[due:${date}]`);
        } else {
          newRaw = `${item.raw.trim()}\n[due:${date}]`;
        }
      }

      const updatedContent = fileContent.replace(item.raw, newRaw);
      await onSaveNote(selectedInboxPath, updatedContent);
      
      setSnoozingItem(null);
      await loadAllData();
      await fetchInboxItems();
    } catch (err) {
      console.error('Error snoozing inbox item:', err);
    }
  };

  // 6. Save Inline Quick Edit
  const handleSaveQuickEdit = async () => {
    if (!editingItem || !editingText.trim()) return;
    try {
      const fileContent = await readNoteContent(selectedInboxPath);
      let newRaw = '';

      if (editingItem.isTodo) {
        const match = editingItem.raw.match(/^(\s*[*\-]\s+\[[ xX]\]\s+\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s+)(.*)$/);
        if (match) {
          newRaw = `${match[1]}${editingText} ${editingItem.tags.map(t => `#${t}`).join(' ')}`;
        } else {
          const matchNoTime = editingItem.raw.match(/^(\s*[*\-]\s+\[[ xX]\]\s+)(.*)$/);
          if (matchNoTime) {
            newRaw = `${matchNoTime[1]}${editingText} ${editingItem.tags.map(t => `#${t}`).join(' ')}`;
          } else {
            newRaw = `- [ ] ${editingText} ${editingItem.tags.map(t => `#${t}`).join(' ')}`;
          }
        }
      } else {
        const lines = editingItem.raw.split('\n');
        if (lines.length > 0 && lines[0].trim().startsWith('### ')) {
          newRaw = `${lines[0]}\n${editingText}\n${editingItem.tags.map(t => `#${t}`).join(' ')}`;
        } else {
          newRaw = `### [${new Date().toISOString().substring(0, 16).replace('T', ' ')}]\n${editingText}\n${editingItem.tags.map(t => `#${t}`).join(' ')}`;
        }
      }

      const updatedContent = fileContent.replace(editingItem.raw, newRaw);
      await onSaveNote(selectedInboxPath, updatedContent);
      setEditingItem(null);
      await loadAllData();
      await fetchInboxItems();
    } catch (err) {
      console.error('Error saving inline quick edit:', err);
    }
  };

  // 7. Bulk Actions
  const handleBulkDelete = async () => {
    if (selectedItemIds.length === 0) return;
    const message = `${selectedItemIds.length} öğeyi kalıcı olarak silmek istediğinize emin misiniz?`;
    const doDelete = async () => {
      try {
        let fileContent = await readNoteContent(selectedInboxPath);
        for (const itemId of selectedItemIds) {
          const item = inboxItems.find(i => i.id === itemId);
          if (item) {
            fileContent = fileContent.replace(item.raw, '');
          }
        }

        fileContent = fileContent.replace(/\n{3,}/g, '\n\n').trim();
        await onSaveNote(selectedInboxPath, fileContent);
        await loadAllData();
        await fetchInboxItems();
      } catch (err) {
        console.error('Error during bulk delete:', err);
      }
    };
    if (onRequestConfirm) {
      onRequestConfirm(message, doDelete);
    } else if (confirm(message)) {
      await doDelete();
    }
  };

  const handleBulkMove = async (folder: string | null) => {
    if (selectedItemIds.length === 0) return;
    const destPath = folder ? `${folder}/inbox.md` : 'inbox.md';
    try {
      let destContent = '';
      try {
        destContent = await readNoteContent(destPath);
      } catch (e) {
        destContent = `# Gelen Kutusu\n\n`;
      }

      let sourceContent = await readNoteContent(selectedInboxPath);
      const itemsToMove: string[] = [];

      for (const itemId of selectedItemIds) {
        const item = inboxItems.find(i => i.id === itemId);
        if (item) {
          itemsToMove.push(item.raw.trim());
          sourceContent = sourceContent.replace(item.raw, '');
        }
      }

      // Write destination
      const appendText = '\n\n' + itemsToMove.join('\n\n');
      await onSaveNote(destPath, destContent.trim() + appendText);

      // Write source
      sourceContent = sourceContent.replace(/\n{3,}/g, '\n\n').trim();
      await onSaveNote(selectedInboxPath, sourceContent);

      await loadAllData();
      await fetchInboxItems();
    } catch (err) {
      console.error('Error during bulk move:', err);
    }
  };

  // Open Actions Dialog triggers
  const startMove = (item: InboxItem) => {
    setMovingItem(item);
    setTargetFolder('');
    setTargetNote('');
  };

  const startConvertToNote = (item: InboxItem) => {
    setConvertingItem(item);
    // clean text for note name suggestions
    const cleanSuggestion = item.content.slice(0, 30).replace(/[^a-zA-Z0-9_ ğüşıöçĞÜŞİÖÇ-]/g, '').trim();
    setNewNoteName(cleanSuggestion);
    setNewNoteFolder('');
  };

  const startSnooze = (item: InboxItem) => {
    setSnoozingItem(item);
    const today = new Date().toISOString().substring(0, 10);
    setSnoozeDate(today);
  };

  const startInlineEdit = (item: InboxItem) => {
    setEditingItem(item);
    setEditingText(item.content);
  };

  // Filters calculation
  const filteredItems = inboxItems.filter(item => {
    const matchesSearch = item.content.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (!matchesSearch) return false;
    if (filterType === 'notes') return !item.isTodo;
    if (filterType === 'todos') return item.isTodo;
    return true;
  });

  const notesInTargetFolder = targetFolder 
    ? notes.filter(n => n.type === 'note' && n.path.startsWith(targetFolder + '/'))
    : notes.filter(n => n.type === 'note' && !n.path.includes('/'));

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedItemIds.length === filteredItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(filteredItems.map(item => item.id));
    }
  };

  return (
    <div className="inbox-triage-container animate-fade" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px 32px' }}>
      
      {/* Triage Header */}
      <div className="triage-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)' }}>
            <Inbox size={22} className="text-accent" style={{ color: 'var(--accent-color)' }} />
            Gelen Kutusu (GTD Triage)
          </h1>
          <p className="subtitle" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>İşlenmemiş ham fikirleri, notları ve görevleri ayıklayın, yerlerine yerleştirin.</p>
        </div>

        {/* Selected Inbox Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)' }}>İncele:</span>
          <select 
            value={selectedInboxPath}
            onChange={(e) => setSelectedInboxPath(e.target.value)}
            className="triage-select"
            style={{
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="inbox.md">Ana Gelen Kutusu (Root)</option>
            {inboxNotes.filter(n => n.path !== 'inbox.md').map(n => {
              const folderName = n.path.split('/')[0];
              return (
                <option key={n.path} value={n.path}>{folderName} Gelen Kutusu</option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="triage-filter-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
        
        {/* Left: Type filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            onClick={() => setFilterType('all')}
            className={`filter-tab ${filterType === 'all' ? 'active' : ''}`}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              background: filterType === 'all' ? 'var(--accent-color)' : 'transparent',
              color: filterType === 'all' ? '#fff' : 'var(--text-secondary)',
              border: 'none'
            }}
          >
            Hepsi ({inboxItems.length})
          </button>
          <button 
            onClick={() => setFilterType('notes')}
            className={`filter-tab ${filterType === 'notes' ? 'active' : ''}`}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              background: filterType === 'notes' ? 'var(--accent-color)' : 'transparent',
              color: filterType === 'notes' ? '#fff' : 'var(--text-secondary)',
              border: 'none'
            }}
          >
            📝 Notlar ({inboxItems.filter(i => !i.isTodo).length})
          </button>
          <button 
            onClick={() => setFilterType('todos')}
            className={`filter-tab ${filterType === 'todos' ? 'active' : ''}`}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '600',
              background: filterType === 'todos' ? 'var(--accent-color)' : 'transparent',
              color: filterType === 'todos' ? '#fff' : 'var(--text-secondary)',
              border: 'none'
            }}
          >
            ✅ Görevler ({inboxItems.filter(i => i.isTodo).length})
          </button>
        </div>

        {/* Right: Search Input */}
        <div style={{ position: 'relative', width: '220px' }}>
          <input 
            type="text"
            placeholder="Öğelerde veya etiketlerde ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              color: 'var(--text-primary)'
            }}
          />
        </div>
      </div>

      {/* Bulk Actions Panel (Only visible when items are selected) */}
      <AnimatePresence>
        {selectedItemIds.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bulk-actions-panel"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '8px',
              padding: '10px 16px',
              marginBottom: '16px'
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent-color)' }}>
              {selectedItemIds.length} öğe seçildi
            </span>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Bulk Move Selector */}
              <select 
                className="triage-select"
                onChange={(e) => {
                  if (e.target.value !== '') {
                    handleBulkMove(e.target.value === 'root' ? null : e.target.value);
                    e.target.value = '';
                  }
                }}
                style={{
                  background: 'rgba(20,20,25,0.8)',
                  color: 'var(--text-primary)',
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                <option value="">Seçilenleri Klasöre Taşı...</option>
                <option value="root">[Kök Dizin (Root)]</option>
                {folders.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>

              <button 
                onClick={handleBulkDelete}
                className="btn-triage-bulk-delete"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600'
                }}
              >
                <Trash2 size={13} />
                Seçilenleri Sil
              </button>

              <button 
                onClick={() => setSelectedItemIds([])}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                Seçimi İptal Et
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Grid View */}
      <div className="triage-content-scroller" style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid var(--accent-color)', borderRadius: '50%', width: '24px', height: '24px', animation: 'spin 1s linear infinite', marginBottom: '12px' }}></div>
            <span>Gelen Kutusu analiz ediliyor...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '250px', background: 'rgba(30,30,40,0.1)', borderRadius: '12px', border: '1px dashed var(--border-color)', padding: '24px', color: 'var(--text-muted)' }}>
            <Inbox size={36} style={{ marginBottom: '12px', opacity: 0.4 }} />
            <h3 style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Gelen Kutunuz Tertemiz!</h3>
            <p style={{ fontSize: '12.5px', textAlign: 'center', maxWidth: '300px' }}>
              {searchQuery ? 'Arama kriterlerinize uygun öğe bulunamadı.' : 'Burada işlenecek ham düşünce kalmadı. Hızlı Giriş sayfasından yeni fikirler ekleyebilirsiniz.'}
            </p>
            {!searchQuery && (
              <button 
                onClick={() => setActiveTab('notfactory')}
                style={{
                  marginTop: '16px',
                  padding: '8px 16px',
                  background: 'var(--accent-color)',
                  color: '#fff',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '700',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Fikir Dök (Hızlı Giriş)
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Table Selection Header */}
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px 10px 12px', borderBottom: '1px solid var(--border-color)', marginBottom: '12px' }}>
              <input 
                type="checkbox"
                checked={selectedItemIds.length === filteredItems.length && filteredItems.length > 0}
                onChange={toggleSelectAll}
                style={{ cursor: 'pointer', marginRight: '12px' }}
              />
              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tümünü Seç</span>
            </div>

            {/* Grid list */}
            <div className="triage-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {filteredItems.map((item) => (
                <div 
                  key={item.id} 
                  className={`triage-card ${item.isCompleted ? 'completed' : ''}`}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    position: 'relative',
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                  }}
                >
                  
                  {/* Top row: Checkbox select & Type indicator & Date */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input 
                        type="checkbox"
                        checked={selectedItemIds.includes(item.id)}
                        onChange={() => toggleSelectItem(item.id)}
                        style={{ cursor: 'pointer' }}
                      />
                      
                      {/* Badge Icon */}
                      {item.isTodo ? (
                        <button 
                          onClick={() => handleToggleComplete(item)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: item.isCompleted ? 'var(--success-color)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex'
                          }}
                        >
                          <CheckSquare size={15} style={{ color: item.isCompleted ? 'var(--success-color)' : 'var(--text-muted)' }} />
                        </button>
                      ) : (
                        <FileText size={15} style={{ color: 'var(--accent-color)' }} />
                      )}

                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>
                        {item.isTodo ? 'Görev' : 'Düz Not'}
                      </span>
                    </div>

                    {/* Timestamp */}
                    {item.timestamp && (
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={11} />
                        {item.timestamp}
                      </span>
                    )}
                  </div>

                  {/* Body Content */}
                  <div style={{ flex: 1, marginBottom: '14px' }}>
                    {editingItem?.id === item.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea 
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="triage-textarea-edit"
                          style={{
                            width: '100%',
                            minHeight: '60px',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--accent-color)',
                            borderRadius: '6px',
                            padding: '8px',
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                            outline: 'none',
                            resize: 'none'
                          }}
                        />
                        <div style={{ display: 'flex', gap: '6px', alignSelf: 'flex-end' }}>
                          <button 
                            onClick={() => setEditingItem(null)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '4px'
                            }}
                          >
                            <X size={15} />
                          </button>
                          <button 
                            onClick={handleSaveQuickEdit}
                            style={{
                              background: 'var(--success-color)',
                              border: 'none',
                              color: '#fff',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            <Check size={15} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p 
                        onDoubleClick={() => startInlineEdit(item)}
                        style={{ 
                          fontSize: '13px', 
                          color: 'var(--text-primary)', 
                          lineHeight: '1.5',
                          textDecoration: item.isCompleted ? 'line-through' : 'none',
                          opacity: item.isCompleted ? 0.5 : 1,
                          cursor: 'pointer'
                        }}
                        title="Çift tıklayarak hızlı düzenleyin"
                      >
                        {item.content}
                      </p>
                    )}

                    {/* Render Subtasks list under parent content */}
                    {item.subtasks && item.subtasks.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.04)' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px', display: 'block' }}>Alt Görevler:</span>
                        {item.subtasks.map((sub, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--accent-color)', fontSize: '10px' }}>▪</span>
                            <span>{sub}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Render Tags */}
                    {item.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '8px' }}>
                        {item.tags.map(t => (
                          <span 
                            key={t}
                            style={{
                              fontSize: '9.5px',
                              background: 'rgba(16, 185, 129, 0.1)',
                              color: 'var(--success-color)',
                              border: '1px solid rgba(16, 185, 129, 0.15)',
                              padding: '1px 5px',
                              borderRadius: '4px'
                            }}
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', marginTop: '10px' }}>
                    
                    {/* Left: Quick Actions */}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      
                      {/* Move to Folder */}
                      <button 
                        onClick={() => startMove(item)}
                        className="btn-triage-icon"
                        title="Klasöre veya Nota Taşı"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <Folder size={13} />
                      </button>

                      {/* Convert to Note */}
                      <button 
                        onClick={() => startConvertToNote(item)}
                        className="btn-triage-icon"
                        title="Müstakil Nota Dönüştür"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <FilePlus2 size={13} />
                      </button>

                      {/* Snooze / Schedule Bit Tarihi */}
                      <button 
                        onClick={() => startSnooze(item)}
                        className="btn-triage-icon"
                        title="Bitiş Tarihi Planla (Snooze)"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <Calendar size={13} />
                      </button>

                      {/* Quick Edit inline */}
                      <button 
                        onClick={() => startInlineEdit(item)}
                        className="btn-triage-icon"
                        title="Hızlı Düzenle"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <Edit3 size={13} />
                      </button>
                    </div>

                    {/* Right: Delete */}
                    <button 
                      onClick={() => handleDeleteItem(item)}
                      className="btn-triage-icon-delete"
                      title="Gelen Kutusundan Sil"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px solid rgba(239, 68, 68, 0.1)',
                        cursor: 'pointer',
                        color: '#f87171'
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* GTD Action Modals */}
      
      {/* 1. MOVE MODAL */}
      {movingItem && (
        <div className="modal-overlay animate-fade" style={{ zIndex: 1100 }}>
          <div className="modal-content animate-pop" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>Klasöre / Nota Yerleştir</h3>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Hedef Klasör:</label>
                <select 
                  value={targetFolder} 
                  onChange={(e) => {
                    setTargetFolder(e.target.value);
                    setTargetNote(''); // Reset selected note when folder changes
                  }}
                  className="modal-input"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', width: '100%' }}
                >
                  <option value="">[Kök Dizin (Root)]</option>
                  {folders.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Hedef Not (İsteğe Bağlı):</label>
                <select 
                  value={targetNote} 
                  onChange={(e) => setTargetNote(e.target.value)}
                  className="modal-input"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', width: '100%' }}
                >
                  <option value="">[Oluşturulmasın - Klasörün Gelen Kutusu (inbox.md) dosyasına eklensin]</option>
                  {notesInTargetFolder.map(n => (
                    <option key={n.path} value={n.path}>{n.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ background: 'rgba(99, 102, 241, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.1)' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>Öğe Metni:</span>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>{movingItem.content}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setMovingItem(null)}>İptal</button>
              <button 
                className="btn-modal-confirm" 
                onClick={() => handleMoveItem(movingItem, targetFolder || null, targetNote || null)}
              >
                Taşı ve Yerleştir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CONVERT TO NOTE MODAL */}
      {convertingItem && (
        <div className="modal-overlay animate-fade" style={{ zIndex: 1100 }}>
          <div className="modal-content animate-pop" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>Müstakil Nota Dönüştür</h3>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Oluşturulacak Klasör:</label>
                <select 
                  value={newNoteFolder} 
                  onChange={(e) => setNewNoteFolder(e.target.value)}
                  className="modal-input"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', width: '100%' }}
                >
                  <option value="">[Kök Dizin (Root)]</option>
                  {folders.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Yeni Not Başlığı:</label>
                <input 
                  type="text"
                  value={newNoteName}
                  onChange={(e) => setNewNoteName(e.target.value)}
                  className="modal-input"
                  placeholder="Not adı yazın..."
                  autoFocus
                />
              </div>

              <div style={{ background: 'rgba(99, 102, 241, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.1)' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>İçerik Aktarımı:</span>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>{convertingItem.content}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setConvertingItem(null)}>İptal</button>
              <button 
                className="btn-modal-confirm" 
                disabled={!newNoteName.trim()}
                onClick={() => handleConvertToNote(convertingItem, newNoteName, newNoteFolder || null)}
              >
                Not Oluştur ve Taşı
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. SNOOZE / BITIS TARIHI MODAL */}
      {snoozingItem && (
        <div className="modal-overlay animate-fade" style={{ zIndex: 1100 }}>
          <div className="modal-content animate-pop" style={{ maxWidth: '360px' }}>
            <div className="modal-header">
              <h3>Bitiş Tarihi Planla (Snooze)</h3>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '6px', textTransform: 'uppercase' }}>Bitiş/Teslim Tarihi:</label>
                <input 
                  type="date"
                  value={snoozeDate}
                  onChange={(e) => setSnoozeDate(e.target.value)}
                  className="modal-input"
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px',
                    width: '100%',
                    colorScheme: 'dark'
                  }}
                />
              </div>

              <div style={{ background: 'rgba(99, 102, 241, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(99, 102, 241, 0.1)' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' }}>Öğe:</span>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>{snoozingItem.content}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-modal-cancel" onClick={() => setSnoozingItem(null)}>İptal</button>
              <button 
                className="btn-modal-confirm" 
                disabled={!snoozeDate}
                onClick={() => handleSnoozeItem(snoozingItem, snoozeDate)}
              >
                Planla ve Kaydet
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
