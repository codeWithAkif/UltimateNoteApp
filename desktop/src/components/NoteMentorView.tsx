import React, { useState, useEffect, useMemo } from 'react';
import { Compass, Plus, Trash2, Save, Sparkles, BookOpen, FileText, Eye, Check } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw';
}

interface NoteMentorViewProps {
  notes: NoteItem[];
  onSaveNote: (path: string, content: string) => Promise<any>;
  onSelectNote: (path: string) => void;
}

interface Methodology {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  description: string;
  philosophy: string;
  steps: string[];
  templateGenerator: (stepsValues: string[]) => string;
}

export default function NoteMentorView({
  notes,
  onSaveNote,
  onSelectNote
}: NoteMentorViewProps) {
  // Hazır 10 Metot Tanımı
  const builtInMethods: Methodology[] = useMemo(() => [
    {
      id: 'engineer',
      name: 'Mühendis (Sistem Tasarımı)',
      role: 'Sistem & Yazılım Geliştiriciler',
      icon: '⚙️',
      color: '#10b981',
      description: 'Mimari akışları ve teknik gereksinimleri Mermaid diyagramlarıyla görselleştirerek modelleme metodu.',
      philosophy: 'Mühendislik notları, sistemin "Neden" ve "Nasıl" çalıştığını belgelemelidir. Önce gereksinimler netleştirilir, ardından mimari ve veri akışları şematize edilir, en son aksiyon planı çıkarılır. Bu sayede kod yazılmadan önce tüm mantıksal tasarım doğrulanır.',
      steps: ['Sistem Gereksinimleri & Amaç', 'Mimari Bileşenler (Örn: Veritabanı, Web, API)', 'Veri Akışı Adımları (Mermaid şeması için)', 'Aksiyon / Yapılacak İşler Planı'],
      templateGenerator: (val) => `# ⚙️ Sistem Tasarım Raporu: [Başlık]

## 📌 1. Amaç ve Gereksinimler
${val[0] || 'Gereksinimler belirtilmedi.'}

## 🗺️ 2. Sistem Mimarisi (Mermaid Akış Şeması)
\`\`\`mermaid
graph TD
    A[Kullanıcı] --> B[Web Arayüzü]
    B --> C[API Sunucusu]
    C --> D[Veritabanı]
    
    %% Veri Akışı:
    %% ${val[2] || 'Akış belirtilmedi.'}
\`\`\`

## 🔌 3. Mimari Bileşenler
${val[1] || 'Bileşen detayları belirtilmedi.'}

## 📅 4. Yapılacak İşler (Aksiyon Planı)
- [ ] ${val[3] || 'Aksiyon maddesi eklenmedi.'}
`
    },
    {
      id: 'doctor',
      name: 'Doktor (SOAP Metodu)',
      role: 'Sağlık Çalışanları & Tıp',
      icon: '🩺',
      color: '#06b6d4',
      description: 'Dünya tıp literatüründe standart kabul edilen SOAP klinik vaka raporlama sistemi.',
      philosophy: 'SOAP metodu klinik kararları yapılandırır. S (Subjective) hastanın şikayetini, O (Objective) muayene bulgularını, A (Assessment) tanıları, P (Plan) ise tedavi programını gösterir. Hataları sıfırlar ve doktorlar arası bilgi aktarımını pürüzsüzleştirir.',
      steps: ['Subjective (Hastanın Şikayetleri & Hikayesi)', 'Objective (Fiziksel Muayene, Tansiyon, Lab Bulguları)', 'Assessment (Ön Tanı, Kesin Tanı ve Ayırıcı Tanı)', 'Plan (Tedavi, İlaç Reçetesi & Kontrol Takvimi)'],
      templateGenerator: (val) => `# 🩺 Klinik SOAP Raporu: [Başlık]

### 💬 S - Subjective (Öznel Hikaye)
> ${val[0] || 'Hasta şikayetleri girilmedi.'}

### 🔍 O - Objective (Nesnel Bulgular)
- **Fiziksel Muayene / Bulgular**: ${val[1] || 'Muayene verileri girilmedi.'}

### 🧠 A - Assessment (Değerlendirme & Tanı)
- **Tanılar**: ${val[2] || 'Tanı bilgileri belirtilmedi.'}

### 📋 P - Plan (Tedavi Planı & İzlem)
- **Önerilen İlaçlar ve Tedavi**: ${val[3] || 'Plan belirtilmedi.'}
`
    },
    {
      id: 'student',
      name: 'Öğrenci (Cornell Metodu)',
      role: 'Öğrenciler & Akademisyenler',
      icon: '🎓',
      color: '#3b82f6',
      description: 'Aktif öğrenme ve ders tekrarlarında en verimli Cornell 3-bölüm tekniği.',
      philosophy: 'Cornell metodu bilgiyi pasif okumaktan çıkarıp aktif sorgulamaya dönüştürür. Sağ kolona ders notları, sol kolona ise dersten sonra çıkarılan anahtar soru/kavramlar yazılır. En alta ise 3 cümlelik kendi cümlelerinizle özet yerleştirilir.',
      steps: ['Ders Esnası Alınan Notlar (Ana Bilgiler)', 'Dersten Sonra Çıkarılan Sorular & İpuçları (Sol Kolon)', 'Dersin 3 Cümlelik Özeti (Alt Kısım)'],
      templateGenerator: (val) => `# 🎓 Cornell Çalışma Notu: [Başlık]

| 💡 İpuçları & Soru İşaretleri (Sol Kolon) | ✍️ Ders Notları (Sağ Kolon) |
| :--- | :--- |
| ${val[1]?.split('\n').join('<br/>') || 'İpuçları belirtilmedi.'} | ${val[0]?.split('\n').join('<br/>') || 'Notlar belirtilmedi.'} |

---

### 📝 Zihinsel Özet (Summary)
> ${val[2] || 'Özet eklenmedi.'}
`
    },
    {
      id: 'lawyer',
      name: 'Avukat (IRAC Metodu)',
      role: 'Hukukçular & Danışmanlar',
      icon: '⚖️',
      color: '#f59e0b',
      description: 'Hukuki davaları ve sözleşme uyuşmazlıklarını analiz etme standardı.',
      philosophy: 'IRAC yöntemi, hukuki uyuşmazlıkları yapısal olarak çözmek için mükemmeldir. Olaydaki Uyuşmazlığı (Issue), uygulanacak Kanun Maddesini (Rule), kanunun olaya uygulanmasını (Application) ve son olarak da nihai kanıyı (Conclusion) ayırır.',
      steps: ['Issue (Uyuşmazlığın Konusu Nedir?)', 'Rule (Uygulanacak Kanun / Yargıtay Kararı Maddeleri)', 'Application (Kanunların Somut Olaya Uygulanması & Analiz)', 'Conclusion (Hukuki Sonuç / Karar Görüşü)'],
      templateGenerator: (val) => `# ⚖️ Hukuki Analiz Raporu (IRAC): [Başlık]

### ⚖️ I - Issue (Uyuşmazlık Konusu)
${val[0] || 'Uyuşmazlık girilmedi.'}

### 📖 R - Rule (İlgili Hukuki Kurallar & Mevzuat)
${val[1] || 'Mevzuat belirtilmedi.'}

### 🔍 A - Application (Somut Olay Analizi)
${val[2] || 'Analiz girilmedi.'}

### 🏁 C - Conclusion (Hukuki Sonuç)
> **Karar/Görüş**: ${val[3] || 'Sonuç belirtilmedi.'}
`
    },
    {
      id: 'designer',
      name: 'Tasarımcı (SCAMPER Metodu)',
      role: 'Sanatçılar, Ürün & Grafik Tasarımcılar',
      icon: '🎨',
      color: '#ec4899',
      description: 'SCAMPER sorularıyla mevcut tasarımları/ürünleri inovatif olarak geliştirme metodu.',
      philosophy: 'SCAMPER, yaratıcı düşünceyi tetikleyen 7 yönlendirici kelimeden oluşur: Yerine koy (S), Birleştir (C), Uyarla (A), Değiştir (M), Başka amaçla kullan (P), Yok et (E), Tersine çevir (R). Tıkanıklıkları açmada birebirdir.',
      steps: ['S - Neyi Başka Bir Şeyle Değiştirebiliriz? (Substitute)', 'C - Hangi Özellikleri Birleştirebiliriz? (Combine)', 'A - Başka Hangi Fikirleri Buraya Uyarlayabiliriz? (Adapt)', 'M - Boyutu veya Şekli Nasıl Modifiye Edebiliriz? (Modify)', 'E - Neleri Çıkarıp Eleme Yapabiliriz? (Eliminate)'],
      templateGenerator: (val) => `# 🎨 Yaratıcı SCAMPER Fikir Taslağı: [Başlık]

* **🔄 S - Substitute (Yerine Koyma)**: ${val[0] || 'Giriş yapılmadı.'}
* **🔗 C - Combine (Birleştirme)**: ${val[1] || 'Giriş yapılmadı.'}
* **💡 A - Adapt (Uyarlama)**: ${val[2] || 'Giriş yapılmadı.'}
* **📐 M - Modify (Modifiye Etme)**: ${val[3] || 'Giriş yapılmadı.'}
* **❌ E - Eliminate (Yok Etme / Elemek)**: ${val[4] || 'Giriş yapılmadı.'}
`
    },
    {
      id: 'entrepreneur',
      name: 'Girişimci (SWOT Analizi)',
      role: 'Girişimciler & İş Geliştiriciler',
      icon: '💼',
      color: '#8b5cf6',
      description: 'İş fikirlerini, projeleri hızlıca güçlü/zayıf yönleriyle masaya yatırma yöntemi.',
      philosophy: 'SWOT analizi, bir projenin veya girişimin stratejik konumunu anlamak için kullanılır. Güçlü ve zayıf içsel etkenler ile dışsal fırsat ve tehditleri ayırarak resmin tamamını görmenizi sağlar.',
      steps: ['S - Güçlü Yanlarımız Neler? (Strengths)', 'W - Zayıf Yanlarımız Neler? (Weaknesses)', 'O - Dışsal Fırsatlar Neler? (Opportunities)', 'T - Karşı Karşıya Olduğumuz Tehditler Neler? (Threats)'],
      templateGenerator: (val) => `# 💼 Proje SWOT Analizi: [Başlık]

| 🟢 GÜÇLÜ YANLAR (Strengths) | 🔴 ZAYIF YANLAR (Weaknesses) |
| :--- | :--- |
| ${val[0]?.split('\n').join('<br/>') || 'Belirtilmedi.'} | ${val[1]?.split('\n').join('<br/>') || 'Belirtilmedi.'} |

| 🔵 FIRSATLAR (Opportunities) | 🟡 TEHDİTLER (Threats) |
| :--- | :--- |
| ${val[2]?.split('\n').join('<br/>') || 'Belirtilmedi.'} | ${val[3]?.split('\n').join('<br/>') || 'Belirtilmedi.'} |
`
    },
    {
      id: 'writer',
      name: 'Yazar (5N1K Metodu)',
      role: 'Senaristler, Yazarlar & İçerik Üreticileri',
      icon: '✍️',
      color: '#a855f7',
      description: 'Hikaye, makale veya kurgu iskeletini 6 temel soruyla yapılandırma.',
      philosophy: 'Bir hikayenin veya haberin iskeleti 5N1K ile kurulur. Karakterin neyi, neden, nasıl yaptığını ve nerede/ne zaman gerçekleştiğini netleştirmek, yazar tıkanmalarını önler ve akıcı bir olay örgüsü sağlar.',
      steps: ['KİM? (Karakterler / Baş Kahramanlar)', 'NE? (Olay / Çatışma Nedir?)', 'NEREDE & NE ZAMAN? (Mekan ve Zaman Dilimi)', 'NASIL & NEDEN? (Olayların Gelişimi ve Sebebi)'],
      templateGenerator: (val) => `# ✍️ Kurgu & Olay Örgüsü (5N1K): [Başlık]

*   **👤 KİM (Karakterler / Aktörler)**:
    > ${val[0] || 'Karakterler girilmedi.'}
*   **🎯 NE (Ana Olay / Çatışma)**:
    > ${val[1] || 'Olay girilmedi.'}
*   **📍 NEREDE & NE ZAMAN (Sahne & Zaman)**:
    > ${val[2] || 'Mekan/Zaman girilmedi.'}
*   **🔥 NASIL & NEDEN (Motivasyon & Gelişme)**:
    > ${val[3] || 'Detaylar girilmedi.'}
`
    },
    {
      id: 'researcher',
      name: 'Araştırmacı (Zettelkasten)',
      role: 'Akademisyenler & Bilim İnsanları',
      icon: '🔍',
      color: '#14b8a6',
      description: 'Bilgiyi küçük atomik kartlar ve çapraz bağlantılarla kalıcı hafıza ağına dönüştürme.',
      philosophy: 'Zettelkasten felsefesi "ikinci beyin" mantığıdır. Her not tek bir ana fikre odaklanır (atomik). Notlar kendi aralarında çapraz referans linkleriyle ([[Not]]) bağlanır, böylece zamanla kendiliğinden oluşan bir bilgi ağı ortaya çıkar.',
      steps: ['Çekirdek Düşünce (Atomik Bilgi)', 'Kaynak / Literatür Referansı', 'İlişkili Olabilecek Diğer Konular / Notlar'],
      templateGenerator: (val) => `# 🔍 Atomik Bilgi (Zettelkasten): [Başlık]

### 💡 Çekirdek Fikir
${val[0] || 'Çekirdek fikir girilmedi.'}

### 🔗 İlişkili Bağlantılar
- [[Dizin]]
- [[${val[2] || 'İlişkili Notlar'}]]

---
### 📚 Kaynakça / Referans
- ${val[1] || 'Referans girilmedi.'}
`
    },
    {
      id: 'improvement',
      name: 'Kişisel Gelişim (Değerlendirme)',
      role: 'Bireysel Gelişim & Günlükçüler',
      icon: '🧠',
      color: '#f43f5e',
      description: 'Zihinsel odak, şükran günlüğü ve günlük hedeflerin değerlendirilmesi.',
      philosophy: 'Kişisel gelişim notları, farkındalık kazanmanın anahtarıdır. Güne şükran duyulan şeylerle başlamak stresi azaltırken, gün sonu yapılan zihinsel değerlendirme ve hedef analizi sürekli ilerlemeyi teşvik eder.',
      steps: ['Bugün Şükran Duyduğum 3 Şey', 'Günün En Büyük Başarısı / Kazanımı', 'Yarın Daha İyi Yapabileceğim Şeyler'],
      templateGenerator: (val) => `# 🧠 Günlük Zihinsel Değerlendirme: [Başlık]

### 🙏 1. Şükran Günlüğü
1. ${val[0]?.split('\n').join('\n1. ') || 'Şükran maddesi eklenmedi.'}

### 🏆 2. Günün Kazanımı
> ${val[1] || 'Kazanım girilmedi.'}

### 📈 3. Yarın İçin İyileştirmeler
- ${val[2] || 'Gelişim alanı girilmedi.'}
`
    },
    {
      id: 'okr',
      name: 'Proje Yöneticisi (OKR Metodu)',
      role: 'Proje Sorumluları & Yöneticiler',
      icon: '🎯',
      color: '#f97316',
      description: 'Hedefler (Objectives) ve ölçülebilir Temel Sonuçlar (Key Results) belirleme.',
      philosophy: 'OKR metodolojisi stratejik odak sağlar. Hedefler (Objectives) vizyonu ve nereye gitmek istediğimizi söyler. Temel Sonuçlar (Key Results) ise oraya varıp varmadığımızı ölçeceğimiz net, sayısal göstergelerdir.',
      steps: ['Ana Hedef (Nereye Gitmek İstiyoruz? - Objective)', 'Ölçülebilir Temel Sonuç 1 (Key Result 1)', 'Ölçülebilir Temel Sonuç 2 (Key Result 2)', 'Gerekli Başlıca İnisiyatifler / Görevler'],
      templateGenerator: (val) => `# 🎯 Stratejik OKR Raporu: [Başlık]

## 🎯 Hedef (Objective)
> **"${val[0] || 'Ana hedef belirtilmedi.'}"**

## 📈 Temel Sonuçlar (Key Results)
1. **KR 1:** ${val[1] || 'Temel sonuç 1 belirtilmedi.'} [Durum: Beklemede]
2. **KR 2:** ${val[2] || 'Temel sonuç 2 belirtilmedi.'} [Durum: Beklemede]

## 🛠️ İnisiyatifler / Aksiyonlar
- [ ] ${val[3] || 'İnisiyatif eklenmedi.'}
`
    }
  ], []);

  // Özel Metotlar Eyaleti (localStorage/Preferences üzerinden okunur)
  const [customMethods, setCustomMethods] = useState<Methodology[]>([]);

  // Özel uyarı popupları için durum (Kural 5)
  const [alertText, setAlertText] = useState<string | null>(null);
  
  // Aktif Seçili Metot
  const [selectedMethodId, setSelectedMethodId] = useState<string>('engineer');
  
  // Yönlendirici form değerleri
  const [formValues, setFormValues] = useState<string[]>([]);
  const [newNoteTitle, setNewNoteTitle] = useState<string>('');

  // Yeni metot ekleme form eyaleti
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customSteps, setCustomSteps] = useState<string[]>(['Step 1']);

  // Özel metotları diskten yükleme
  useEffect(() => {
    const loadCustom = async () => {
      try {
        const { value } = await Preferences.get({ key: 'custom_note_methodologies' });
        if (value) {
          const parsed = JSON.parse(value);
          // JSON string'den dönen fonksiyonlar templateGenerator içermeyeceği için eşleştir
          const mapped = parsed.map((item: any) => ({
            ...item,
            templateGenerator: (val: string[]) => {
              let text = `# ${item.icon} ${item.name}: [Başlık]\n\n`;
              item.steps.forEach((step: string, idx: number) => {
                text += `### 📌 ${step}\n${val[idx] || 'Giriş yapılmadı.'}\n\n`;
              });
              return text;
            }
          }));
          setCustomMethods(mapped);
        }
      } catch (e) {
        console.error(e);
      }
    };
    loadCustom();
  }, []);

  // Tüm metodolojileri birleştir
  const allMethodologies = useMemo(() => {
    return [...builtInMethods, ...customMethods];
  }, [builtInMethods, customMethods]);

  // Seçili metodoloji
  const activeMethod = useMemo(() => {
    return allMethodologies.find(m => m.id === selectedMethodId) || builtInMethods[0];
  }, [selectedMethodId, allMethodologies, builtInMethods]);

  // Metot değiştiğinde form alanlarını temizle
  useEffect(() => {
    setFormValues(new Array(activeMethod.steps.length).fill(''));
    // Varsayılan isim oluştur
    const cleanName = activeMethod.name.split(' (')[0];
    setNewNoteTitle(`${cleanName}_Notu`);
  }, [selectedMethodId, activeMethod]);

  // Form girdisi değiştikçe
  const handleInputChange = (idx: number, value: string) => {
    setFormValues(prev => {
      const copy = [...prev];
      copy[idx] = value;
      return copy;
    });
  };

  // Dinamik Canlı Markdown Önizlemesi (Kural 5)
  const livePreview = useMemo(() => {
    const generated = activeMethod.templateGenerator(formValues);
    return generated.replace('[Başlık]', newNoteTitle || 'Adsız');
  }, [activeMethod, formValues, newNoteTitle]);

  // Kaydetme Fonksiyonu
  const handleSaveNote = async () => {
    if (!newNoteTitle.trim()) {
      setAlertText('Lütfen sentezlenecek nota bir başlık verin!');
      return;
    }
    
    const cleanName = newNoteTitle.trim().replace(/[^a-zA-Z0-9_ğüşöçİĞÜŞÖÇ\s-]/g, '');
    const finalPath = `Sentez/${cleanName}.md`;

    try {
      await onSaveNote(finalPath, livePreview);
      onSelectNote(finalPath);
    } catch (e) {
      console.error(e);
      setAlertText('Not kaydedilirken bir sorun oluştu!');
    }
  };

  // Yeni Özel Adım Ekle
  const addStepField = () => {
    setCustomSteps(prev => [...prev, `Step ${prev.length + 1}`]);
  };

  // Özel Adım Çıkar
  const removeStepField = (idx: number) => {
    setCustomSteps(prev => prev.filter((_, i) => i !== idx));
  };

  // Özel metodu kaydetme
  const handleSaveCustomMethod = async () => {
    if (!customName.trim()) {
      setAlertText('Lütfen metot adını girin!');
      return;
    }
    const cleanSteps = customSteps.map(s => s.trim()).filter(s => s.length > 0);
    if (cleanSteps.length === 0) {
      setAlertText('Lütfen en az bir yönlendirici adım/soru ekleyin!');
      return;
    }

    const newMethod: Methodology = {
      id: `custom_${Date.now()}`,
      name: `${customName.trim()} (Özel)`,
      role: customRole.trim() || 'Bireysel Rol',
      icon: '💡',
      color: '#f43f5e',
      description: customDescription.trim() || 'Kişisel olarak tasarlanmış not alma şablonu.',
      philosophy: 'Kullanıcı tarafından oluşturulan özel not alma metodolojisi.',
      steps: cleanSteps,
      templateGenerator: (val) => {
        let text = `# 💡 ${customName.trim()}: [Başlık]\n\n`;
        cleanSteps.forEach((step, idx) => {
          text += `### 📌 ${step}\n${val[idx] || 'Giriş yapılmadı.'}\n\n`;
        });
        return text;
      }
    };

    const updatedList = [...customMethods, newMethod];
    setCustomMethods(updatedList);
    setSelectedMethodId(newMethod.id);
    setIsAddingCustom(false);

    // Reset Form
    setCustomName('');
    setCustomRole('');
    setCustomDescription('');
    setCustomSteps(['Step 1']);

    // Preferences Kayıt
    try {
      // Preferences içinde fonksiyonları saklayamayız, bu yüzden sadece verileri serialize et
      const serializable = updatedList.map(({ id, name, role, icon, color, description, philosophy, steps }) => ({
        id, name, role, icon, color, description, philosophy, steps
      }));
      await Preferences.set({
        key: 'custom_note_methodologies',
        value: JSON.stringify(serializable)
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Özel metodu silme
  const handleDeleteCustomMethod = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedList = customMethods.filter(m => m.id !== id);
    setCustomMethods(updatedList);
    setSelectedMethodId('engineer');

    try {
      const serializable = updatedList.map(({ id, name, role, icon, color, description, philosophy, steps }) => ({
        id, name, role, icon, color, description, philosophy, steps
      }));
      await Preferences.set({
        key: 'custom_note_methodologies',
        value: JSON.stringify(serializable)
      });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="mentor-view-container" style={{ display: 'flex', height: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box', overflow: 'hidden' }}>
      
      {/* 🧭 Left Sidebar - Methodology List */}
      <div className="mentor-sidebar" style={{
        width: '280px',
        borderRight: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}>
        {/* Title */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Compass style={{ color: '#ff6b35' }} size={18} />
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)' }}>Not Akademisi</h2>
        </div>

        {/* Scrollable List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }} className="custom-scroll">
          
          {/* Header */}
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '6px 8px', fontWeight: 'bold', letterSpacing: '1px' }}>HAZIR METOTLAR</div>
          {builtInMethods.map(method => (
            <div
              key={method.id}
              onClick={() => { setSelectedMethodId(method.id); setIsAddingCustom(false); }}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: selectedMethodId === method.id && !isAddingCustom ? 'var(--bg-tertiary)' : 'transparent',
                border: selectedMethodId === method.id && !isAddingCustom ? `1px solid ${method.color}44` : '1px solid transparent',
                cursor: 'pointer',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'all 0.2s'
              }}
              className="method-item"
            >
              <span style={{ fontSize: '20px' }}>{method.icon}</span>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '12.5px', color: selectedMethodId === method.id && !isAddingCustom ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{method.name.split(' (')[0]}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{method.role}</div>
              </div>
            </div>
          ))}

          {/* Custom Methods Section */}
          {customMethods.length > 0 && (
            <>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '16px 8px 6px 8px', fontWeight: 'bold', letterSpacing: '1px' }}>ÖZEL METOTLARINIZ</div>
              {customMethods.map(method => (
                <div
                  key={method.id}
                  onClick={() => { setSelectedMethodId(method.id); setIsAddingCustom(false); }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: selectedMethodId === method.id && !isAddingCustom ? 'var(--bg-tertiary)' : 'transparent',
                    border: selectedMethodId === method.id && !isAddingCustom ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid transparent',
                    cursor: 'pointer',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    transition: 'all 0.2s'
                  }}
                  className="method-item"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                    <span style={{ fontSize: '20px' }}>💡</span>
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', fontWeight: 'bold', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{method.name.split(' (')[0]}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{method.role}</div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteCustomMethod(method.id, e)}
                    style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px' }}
                    title="Sil"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </>
          )}

        </div>

        {/* Add New Custom Method Button */}
        <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setIsAddingCustom(true)}
            style={{
              width: '100%',
              background: 'var(--bg-primary)',
              border: '1px dashed var(--border-color)',
              borderRadius: '8px',
              color: '#ff6b35',
              padding: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Plus size={14} /> Yeni Metot Tanımla 💡
          </button>
        </div>
      </div>

      {/* 📝 Main Panel - Form & Philosophy & Live Preview */}
      <div className="mentor-main-panel" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {isAddingCustom ? (
          /* ➕ CREATE CUSTOM METHODOLOGY PANEL */
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }} className="custom-scroll">
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>🛠️ Yeni Özel Metot Tanımla</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Kendi çalışma stilinize ve mesleğinize uygun, adım adım doldurulabilen not şablonları tasarlayın.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '600px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#ff6b35', fontWeight: 'bold' }}>METOT ADI</label>
                <input
                  type="text"
                  placeholder="Orn: Haftalık_Rapor, Bug_Analizi"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#ff6b35', fontWeight: 'bold' }}>MESLEK / ROL GRUBU</label>
                <input
                  type="text"
                  placeholder="Orn: Yöneticiler, Tasarım Ekibi"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#ff6b35', fontWeight: 'bold' }}>KISA AÇIKLAMA</label>
                <input
                  type="text"
                  placeholder="Bu metot ne için kullanılır?"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '11px', color: '#ff6b35', fontWeight: 'bold' }}>SİZDEN İSTENECEK ADIMLAR / SORULAR</label>
                {customSteps.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder={`Adım ${idx + 1} Başlığı`}
                      value={step}
                      onChange={(e) => {
                        const copy = [...customSteps];
                        copy[idx] = e.target.value;
                        setCustomSteps(copy);
                      }}
                      style={{ flex: 1, padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12.5px', outline: 'none' }}
                    />
                    <button
                      onClick={() => removeStepField(idx)}
                      style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#ef4444', padding: '6px 12px', cursor: 'pointer', fontSize: '11px' }}
                    >
                      Kaldır
                    </button>
                  </div>
                ))}
                
                <button
                  onClick={addStepField}
                  style={{ width: 'fit-content', background: 'var(--bg-tertiary)', border: '1px dashed var(--border-color)', color: 'var(--text-secondary)', padding: '6px 12px', fontSize: '11.5px', cursor: 'pointer', marginTop: '4px' }}
                >
                  ➕ Yeni Soru / Adım Ekle
                </button>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button
                  onClick={handleSaveCustomMethod}
                  style={{ background: '#ff6b35', border: 'none', borderRadius: '6px', color: '#fff', padding: '10px 24px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Save size={14} /> Metodu Şablon Kaydet
                </button>
                <button
                  onClick={() => setIsAddingCustom(false)}
                  style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#cbd5e1', padding: '10px 24px', fontSize: '13px', cursor: 'pointer' }}
                >
                  İptal
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* 📋 CHOSEN METHODOLOGY WORKSPACE */
          <>
            {/* Form Area (Left half) */}
            <div className="mentor-form-area custom-scroll" style={{
              width: '50%',
              padding: '24px',
              borderRight: '1px solid var(--border-color)',
              overflowY: 'auto',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}>
              
              {/* Header card with Philosophy */}
              <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '16px',
                borderLeft: `4px solid ${activeMethod.color || '#ff6b35'}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '24px' }}>{activeMethod.icon}</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)', fontWeight: 'bold' }}>{activeMethod.name}</h3>
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{activeMethod.role}</span>
                  </div>
                </div>
                <p style={{ margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>{activeMethod.description}</p>
                <div style={{ background: 'var(--bg-tertiary)', padding: '10px 12px', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', borderLeft: '2px solid var(--border-color)' }}>
                  📖 **Felsefe:** {activeMethod.philosophy}
                </div>
              </div>

              {/* Title input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '10.5px', color: '#ff6b35', fontWeight: 'bold', letterSpacing: '0.5px' }}>SENTEZ NOTU BAŞLIĞI</label>
                <input
                  type="text"
                  placeholder="Orn: Toplanti_Notu"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Step-by-Step Inputs Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {activeMethod.steps.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: '#ff6b35', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Sparkles size={11} style={{ color: activeMethod.color }} /> {step.toUpperCase()}
                    </label>
                    <textarea
                      placeholder={`${step} hakkında notlarınızı buraya yazın...`}
                      value={formValues[idx] || ''}
                      onChange={(e) => handleInputChange(idx, e.target.value)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        fontSize: '12.5px',
                        lineHeight: '1.45',
                        minHeight: '80px',
                        resize: 'vertical',
                        outline: 'none'
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Save Button */}
              <button
                onClick={handleSaveNote}
                style={{
                  background: 'linear-gradient(90deg, #ea580c 0%, #f97316 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  padding: '12px',
                  fontSize: '13px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 16px rgba(234, 88, 12, 0.3)',
                  marginTop: '12px'
                }}
              >
                <Check size={16} /> Notu Sentezle ve Git 🚀
              </button>

            </div>

            {/* Live Markdown Preview Area (Right half) */}
            <div className="mentor-preview-area" style={{
              width: '50%',
              padding: '24px',
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '16px' }}>
                <Eye size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'bold' }}>DİNAMİK MARKDOWN ÖNİZLEME</span>
              </div>

              {/* Code Pre container */}
              <div style={{
                flex: 1,
                background: 'var(--bg-tertiary)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                padding: '16px',
                overflowY: 'auto',
                fontSize: '12.5px',
                lineHeight: '1.6',
                color: 'var(--text-primary)'
              }} className="custom-scroll">
                <PreviewRenderer markdown={livePreview} />
              </div>

            </div>
          </>
        )}

      </div>

      {/* Custom Alert Overlay Modal */}
      {alertText && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100vw', height: '100vh',
          background: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999,
          userSelect: 'none'
        }}>
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '24px',
            width: '320px',
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
              {alertText}
            </p>
            <button
              onClick={() => setAlertText(null)}
              style={{
                background: 'linear-gradient(90deg, #ea580c 0%, #f97316 100%)',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                padding: '8px 24px',
                fontSize: '12.5px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.2);
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 90, 0, 0.2);
          border-radius: 3px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 90, 0, 0.4);
        }
        .method-item:hover {
          background: rgba(255,255,255,0.02) !important;
        }
      `}} />

    </div>
  );
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Markdown metnini canlı olarak analiz edip HTML formatında zengin arayüze dönüştürür.
function PreviewRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  const renderedElements: React.ReactNode[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Kod bloğu tespiti (Mermaid vb.)
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        const codeContent = codeBlockLines.join('\n');
        renderedElements.push(
          <pre key={`code-${idx}`} style={{
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '12px',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#34d399',
            overflowX: 'auto',
            margin: '10px 0'
          }}>
            {codeContent}
          </pre>
        );
        codeBlockLines = [];
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Başlıklar
    if (line.startsWith('# ')) {
      renderedElements.push(<h1 key={idx} style={{ fontSize: '18px', color: '#fff', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', margin: '18px 0 10px 0', fontWeight: 'bold' }}>{parseInline(line.substring(2))}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      renderedElements.push(<h2 key={idx} style={{ fontSize: '14.5px', color: '#ffd7ba', margin: '14px 0 8px 0', borderLeft: '3px solid #ff6b35', paddingLeft: '8px', fontWeight: 'bold' }}>{parseInline(line.substring(3))}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      renderedElements.push(<h3 key={idx} style={{ fontSize: '13px', color: '#fff', margin: '12px 0 6px 0', fontWeight: 'bold' }}>{parseInline(line.substring(4))}</h3>);
      continue;
    }

    // Alıntılar (Quotes)
    if (line.startsWith('> ')) {
      renderedElements.push(
        <blockquote key={idx} style={{
          borderLeft: '3px solid #ea580c',
          padding: '4px 12px',
          background: 'rgba(234, 88, 12, 0.05)',
          margin: '10px 0',
          color: '#94a3b8',
          fontSize: '12px',
          fontStyle: 'italic',
          borderRadius: '0 6px 6px 0'
        }}>
          {parseInline(line.substring(2))}
        </blockquote>
      );
      continue;
    }

    // Checkbox listesi
    if (line.trim().startsWith('- [ ] ') || line.trim().startsWith('- [] ')) {
      renderedElements.push(
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0', fontSize: '12.5px' }}>
          <input type="checkbox" disabled style={{ accentColor: '#ff6b35' }} />
          <span style={{ color: '#cbd5e1' }}>{parseInline(line.substring(6))}</span>
        </div>
      );
      continue;
    }

    // Normal Liste
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      renderedElements.push(
        <div key={idx} style={{ display: 'flex', gap: '6px', margin: '6px 0 6px 12px', fontSize: '12.5px', color: '#cbd5e1' }}>
          <span style={{ color: '#ff6b35' }}>•</span>
          <span>{parseInline(line.substring(2))}</span>
        </div>
      );
      continue;
    }

    // Yatay Çizgi
    if (line.trim() === '---') {
      renderedElements.push(<hr key={idx} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0' }} />);
      continue;
    }

    // Tablo satırları
    if (line.trim().startsWith('|') && line.includes('---')) {
      continue; // Çizgi satırını atla
    }
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
      renderedElements.push(
        <div key={idx} style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          padding: '6px 8px',
          fontSize: '11.5px',
          background: idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
          color: '#cbd5e1'
        }}>
          {cells.map((cell, cidx) => (
            <div key={cidx} style={{ flex: 1, paddingRight: '8px', wordBreak: 'break-word' }}>
              {parseInline(cell)}
            </div>
          ))}
        </div>
      );
      continue;
    }

    // Boş satır
    if (line.trim() === '') {
      renderedElements.push(<div key={idx} style={{ height: '8px' }} />);
      continue;
    }

    // Normal paragraf
    renderedElements.push(
      <p key={idx} style={{ fontSize: '12.5px', color: '#cbd5e1', lineHeight: '1.6', margin: '4px 0' }}>
        {parseInline(line)}
      </p>
    );
  }

  return <div>{renderedElements}</div>;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Kalın metinleri (**), satır içi kodları (\`) ve Wiki-Link'leri ([[]]) ayıklayıp HTML nesnelerine dönüştürür.
function parseInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[\[.*?\]\])/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} style={{ color: '#fff', fontWeight: 'bold' }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx} style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 5px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#f43f5e' }}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('[[') && part.endsWith(']]')) {
      return <span key={idx} style={{ color: '#ff6b35', textDecoration: 'underline', fontWeight: 'bold' }}>{part.slice(2, -2)}</span>;
    }
    return part;
  });
}
