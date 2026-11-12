// Yeni projeye eklenen "Proje Başlangıç Kontrol Listesi" (ProjectsView) ve oturum özetinin bu satırları tek cümlede toplaması (sessionTracker) için ortak kaynak.
export const PROJECT_KICKOFF_CHECKLIST = `
## 📋 Proje Başlangıç Kontrol Listesi

### Kapsam
- [ ] Müşteri ne istedi, neden istedi (asıl iş problemi ne)
- [ ] Kapsam DIŞI olan ne — yazılı netleştirildi mi
- [ ] Kabul kriterleri ("bitti" ne demek, kim onaylayacak)

### Mimari ve Teknik Seçimler
- [ ] Stack seçimi + gerekçesi
- [ ] Entegrasyon noktaları (hangi sistemlerle konuşacak)
- [ ] Veri modeli / veri sahipliği (source of truth kim)
- [ ] Ortam stratejisi (dev/test/prod, CI/CD)

### Boşluk Analizi
- [ ] Müşterinin istemediği ama eksik gördüğüm noktalar listelendi
- [ ] Bu noktalar müşteriye risk olarak sunuldu (sessizce eklenmedi/atlanmadı)

### Efor ve Zaman
- [ ] İş kırılımı (WBS) yapıldı
- [ ] Belirsizlik payı olan kısımlar işaretlendi
- [ ] Müşteriden gelecek bağımlılıklar (onay/veri/erişim) ve olası gecikme etkisi

### Güvenlik
- [ ] Kimlik doğrulama/yetkilendirme modeli
- [ ] Hassas veri var mı, nerede saklanacak/şifrelenecek
- [ ] KVKK/GDPR uyumu gerekiyor mu

### Müşteriden İstenmesi Gerekenler
- [ ] Erişimler (SharePoint, Azure AD, API key/secret, VPN)
- [ ] Karar vericiler netleşti (teknik onay / iş onayı kim)
- [ ] Test verisi / örnek veri erişimi

### Tamamlayıcı Planlar
- [ ] Bakım/destek modeli (proje bitince kim sahiplenecek)
- [ ] Test stratejisi (kim test edecek, kritik senaryolar)
- [ ] İletişim planı (rapor sıklığı, kanal)
- [ ] Üçüncü parti bağımlılık/lisans riski
- [ ] Rollback/geri dönüş planı
- [ ] Dokümantasyon planı (teknik / kullanıcı kılavuzu / devir teslim)
`;
