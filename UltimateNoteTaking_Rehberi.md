# 🚀 UltimateNoteTaking — Kullanım Kılavuzu & Sistem Felsefesi

**UltimateNoteTaking** dünyasına hoş geldiniz! Bu rehber, uygulamanızın kalbinde yatan mantığı kavramanız ve tüm sisteminizi en yüksek verimle yönetmeniz için hazırlanmıştır.

Uygulamanın en büyük gücü, **verilerinizin 100% taşınabilir ve tamamen size ait olmasıdır**. Tüm notlarınız ve görevleriniz, bilgisayarınızda düz metin (plain-text) `.md` (Markdown) dosyalarında saklanır. Herhangi bir "bulut kilidi" (vendor lock-in) yoktur.

---

## 🧠 1. Ana Sistem Felsefesi: GTD & Flat Files

Sistem, David Allen'ın ünlü **GTD (Getting Things Done - İşleri Yoluna Koymak)** metodolojisini temel alır:
1. **Yakala (Capture):** Aklınıza gelen her şeyi hızla kaydedin.
2. **Netleştir & Ayıkla (Clarify & Triage):** Gelen kutusundaki ham fikirleri inceleyin, klasörleyin veya göreve dönüştürün.
3. **Organize Et (Organize):** Takvime yerleştirin, öncelik sırasına koyun.

---

## ⚡ 2. Hızlı Not Fabrikası (Note Factory Engine)

Uygulamanın en üstünde yer alan **Hızlı Not Fabrikası**, aklınızdakileri hiçbir menüyle uğraşmadan tek satırda yazıp sisteme yerleştirmenizi sağlar.

Yazım alanında kullanabileceğiniz **Akıllı Etiket Yapısı (Syntax)** şöyledir:

| Etiket Kalıbı | Açıklama | Örnek Kullanım |
| :--- | :--- | :--- |
| **`@klasör`** | Notu belirli bir klasörün gelen kutusuna yönlendirir. | `Borusan sunumunu hazırla @Borusan` |
| **`!not`** | Metni doğrudan o klasörün içindeki özel bir nota ekler. | `Toplantı kararlarını yaz !Toplantılar` |
| **`#etiket`** | Nota etiketler ekleyerek kategorize eder. | `#planlama #yazılım` |
| **`#todo`** | Girdiğinizi otomatik olarak bir **Görev (Task)** kartına dönüştürür. | `Fatura ödemesini yap #todo` |
| **`[p:öncelik]`** | Göreve öncelik seviyesi atar (critical, high, medium, low). | `Raporu teslim et [p:critical]` |
| **`[due:tarih]`** | Göreve bitiş tarihi (YYYY-MM-DD) ekler. | `Ödevi gönder [due:2026-05-24]` |
| **`[time:saat]`** | Göreve takvim için saat aralığı ekler. | `Haftalık toplantı [time:14:00-15:00]` |

> [!TIP]
> **Hızlı Ekle Araç Çubuğu (Toolbar):** 
> Klavyeden ezbere yazmak yerine, yazı kutusunun hemen üzerindeki **`@ Klasör`**, **`! Not`**, **`# Etiket`**, **`⚡ Öncelik`**, **`📅 Bitiş Tarihi`** ve **`⏰ Saat Dilimi`** butonlarına tıklayarak tüm bu formatları imlecinizin bulunduğu yere anında, pratik açılır pencerelerden seçerek ekleyebilirsiniz!

---

## 📥 3. Gelen Kutusu & Ayıklama (GTD Triage)

Gelen kutusu (Inbox), işlenmemiş ham fikirlerin toplandığı havuzdur. 

### Akıllı Alt Görev (Subtask) Blok Yönetimi:
* Gelen kutusunda alt görevler (örn: `Alışveriş Listesi` altındaki `Süt` ve `Elma`) ayrı ayrı bağımsız kartlar olarak görünmez. Ana görevinizin altında şık bir liste halinde gruplanır.
* **Kalıcı Silme:** Ana görevi sildiğinizde veya başka bir klasöre taşıdığınızda, tüm alt görevleri de onunla birlikte taşınır/silinir. Böylece arka planda dosya içinde asla "hortlayan/geri gelen" yetim görevler kalmaz!

---

## 📅 4. İnteraktif Takvim & Görev Yönetimi

Takvim görünümü, planlarınızı saat saat organize etmenizi sağlar:
* **Sürükle - Bırak (Drag & Drop):** Takvimdeki görev kartlarını dilediğiniz saate sürükleyerek zamanını değiştirebilirsiniz.
* **Aşağı Kaydırarak Süre Değiştirme (Resize):** Görev kartlarının en altındaki ince çizgiden tutarak aşağı/yukarı sürüklediğinizde, görevin süresini (örn: 1 saatten 2 saate) takvim üzerinde anında güncelleyebilirsiniz.
* **Akıllı Puanlama (Priority Score):** Görevlerinizin öncelik seviyesi ve bitiş tarihlerine göre otomatik olarak bir **Öncelik Puanı** hesaplanır. Böylece o gün ilk yapmanız gereken en kritik işler listenin en üstünde ışıldar!

---

## 🔮 5. Yakında Gelecek İnteraktif Genişleme Araçları (Yol Haritası)

Notlarınızın içine yazacağınız akıllı tetikleyicilerle çalışacak olan yeni nesil yol haritamız:

1. **⏱️ `timer 25`:** Yazdığınız anda not içinde 25 dakikalık canlı bir geri sayım aracı başlar.
2. **🔢 `counter şınav`:** Yanında `[-] 0 [+]` butonları olan, spor veya tekrar takibi yapabileceğiniz interaktif sayaçlar ekler (son değer nota kaydedilir).
3. **🎙️ `record`:** Düz metin içinden tek tuşla ses kaydı başlatıp ses dosyasını notunuza gömer.
4. **🎨 `çiz`:** Not içinde mini bir çizim tuvali açar ve çizdiğiniz görseli otomatik olarak nota kaydeder.
5. **💸 `1200 dolar`:** Anlık kurlarla yanına otomatik olarak TL değerini yazar.
6. **📊 Para Hesaplayıcı:** Not içinde geçen `+120`, `-50` sayılarını algılayıp altlarında toplam bakiye gösterir.
7. **🔔 #HedefProje Takipçisi:** Yarım bıraktığınız önemli projeler için "Yarım bıraktığın işler seni takip eder!" sloganıyla sizi uyaran erteleme karşıtı bildirim sistemi.
