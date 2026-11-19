# Ultimate NoteFactory — geliştirme kuralları

Bu dosya, uygulamanın "Geliştir" bölümünden (ve elle) çalışan Claude Code için kurallardır. Herkese açık bir depoda durur: **buraya asla anahtar, şifre, jeton ya da kişisel veri yazma.**

## Yapı
- `desktop/` — uygulamanın tamamı. `desktop/src` React + TypeScript arayüzü; `desktop/electron` Electron ana süreci (CommonJS, `.cjs`); `desktop/android` Capacitor (telefon).
- `desktop/src/App.tsx` çok büyük (≈11.800 satır). Değişiklikleri küçük ve yerinde yap; dosyayı baştan yazma, taşıma ya da toplu yeniden düzenleme yapma.
- Servisler `desktop/src/services/`, ekranlar `desktop/src/components/`. Yeni özellik için önce benzer mevcut dosyaya bak ve onun desenini izle.
- Aynı kod hem masaüstünde (Electron) hem telefonda (Capacitor) çalışır. Electron'a özgü API'ler `window.electron` üzerindedir ve telefonda YOKTUR; kullanmadan önce varlığını denetle (`isElectron`, `window.electron?.…`).

## Zorunlu kurallar
1. **Sürüm, commit, etiket, push YAPMA.** `package.json` sürümüne dokunma; commit/birleştirme/yayın işini uygulama yapar.
2. **Kapsam:** yalnızca istenen işi yap. Kapsam dışı "iyileştirme", yeniden adlandırma, biçim düzeltme yapma.
3. **Bağımlılık ekleme/kurma yok** (`npm install` vb.). Gerçekten gerekiyorsa yapma, son yanıtta "Elle yapılacaklar"a yaz.
4. **Gizli bilgi yok:** anahtar, parola, jeton, kasa yolu gibi kişisel şeyleri koda, yorumlara ya da test verisine yazma. Kullanıcı verisi (notlar kasası) bu depoda durmaz.
5. `.github/` altındaki iş akışlarına, `electron-builder` ayarlarına ve `android/` altına, açıkça istenmedikçe dokunma.
6. Şifreler/oturum bilgileri yalnızca işletim sisteminin korumalı deposunda (`safeStorage`) tutulur; düz dosyaya ya da `localStorage`'a yazma.

## Kod biçimi
- Arayüz metinleri **Türkçe**.
- Yorumlar **Türkçe** ve *neden* gerektiğini açıklar (ne yaptığını değil). Mevcut dosyalardaki yorum diline uy.
- Dosyaların mevcut satır sonlarını koru (`App.tsx` gibi bazı dosyalar CRLF). Tek satırlık değişiklik yüzünden tüm dosyanın farkı değişmemeli.
- Kullanıcıya gösterilen hata mesajları açık ve eyleme yönelik olsun ("ne oldu, ne yapmalı").
- Veri kaybı riski olan işlemler (silme, üzerine yazma) önce onay ister; geri alınamaz işlemi kendiliğinden yapma.

## Doğrulama
- Bitirmeden önce `desktop` klasöründe: `npx tsc --noEmit` — hatasız olmalı. (Çalışma kopyasında `node_modules` ana klasörden bağlıdır; kurma.)
- Mantık içeren değişiklikte, mümkünse davranışı gerçekten çalıştırarak denemeden "çalışıyor" deme; denemediysen son yanıtta açıkça yaz.

## Son yanıt
Kısa ve Türkçe: yapılanlar, değişen dosyalar (neden), doğrulama sonucu, yapılmayanlar/sorular.
