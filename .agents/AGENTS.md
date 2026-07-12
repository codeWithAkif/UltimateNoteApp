# Project Rules

Bu proje üzerinde çalışırken aşağıdaki kurallara ve adımlara her zaman uymalısın:

## 1. Çalışma Prensipleri
- Herhangi bir kod değişikliği yapmadan önce mantıksal planını listele ve onay bekle.
- Onay aldığında plan kapsamındaki gerekli tüm dosyaları tek seferde güncelleyebilir veya oluşturabilir.
- Kod yazarken işlevsel (functional) ve minimum kod prensibine uy; gereksiz yorum satırları ekleme.
- Hata durumunda ardışık otomatik düzeltme döngüsüne girme; hatayı raporlayıp talimat bekle.
- Her kod değişikliği yaptıktan sonra ilgili derleme ve yayınlama komutlarını çalıştırarak değişiklikleri doğrula ve uygula.

## 2. Telefon (Android) Yayınlama Adımları
Uygulamayı Android telefona aktarırken veya test ederken sırasıyla aşağıdaki komutları kullanmalısın:
1. Web derlemesini yap: `npm run build`
2. Native projeyi senkronize et: `npx cap sync android`
3. Bağlı cihaza yüklemek için Android Studio'yu aç (`npx cap open android`) ve oradaki Run (Yeşil Oynat `▶`) butonunu kullan.

## 3. Masaüstü (Electron) Güncelleme Adımları
Masaüstündeki kısayolda en son kod değişikliklerini görmek için sadece web derlemesini yapmalısın:
1. Web derlemesini yap: `npm run build`
*(Kısayol yereldeki `dist` klasörünü çalıştırdığından, derleme sonrasında uygulamayı kapatıp açmanız yeterlidir).*


