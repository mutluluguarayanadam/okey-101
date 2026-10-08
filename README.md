# 101 Okey (online, botlu)

4 kişilik, gerçek zamanlı 101 Okey. Boş koltuklara bot oturur; oyundan düşen oyuncunun yerine bot oynar, oyuncu geri gelince koltuğunu geri alır.

## Bilgisayarında çalıştırma
```
npm install
npm start
```
Tarayıcıda http://localhost:3000 aç.

## Render'a ücretsiz yükleme
1. Bu klasörü GitHub'da yeni bir depoya yükle (node_modules hariç).
2. render.com'a GitHub hesabınla gir → **New → Web Service** → depoyu seç.
3. Ayarlar:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
4. **Deploy** de. Birkaç dakika sonra `https://<isim>.onrender.com` adresi hazır olur.

Not: Ücretsiz sunucu 15 dakika kimse bağlanmazsa uyur; ilk girişte açılması ~1 dakika sürebilir. Sunucu yeniden başlarsa süren oyunlar silinir.

## Oynanış
- **Seri diz / Çift diz:** Okey, yüzü açıkken kendi sayısıyla değerlendirilir; sağ tık / uzun basma ile ters çevirirsen okey (joker) olarak kullanılır. Açmadan önce barajı geçen en iyi dizilimi, açtıktan sonra bitirmek için en çok taşı yere indiren dizilimi kurar. Gruplar ıstakaya her zaman aralarında boşlukla yerleşir.
- **Telefon (yatay):** Istaka ekranın tamamını kaplar. Taş çekme yeri sol altta (soldakinin attığı taş ve yığın), taş atma yeri sağ altta. Istakanın üstündeki ince çubukta ☰ menü (sohbet, ayarlar, tam ekran, puanlar, çıkış), gösterge, sıra bilgisi ve sadece o an kullanılabilen düğmeler var; süre ince bir çizgiyle gösterilir.
- Taşlar çekilirken, atılırken ve yere inerken animasyonla hareket eder; ıstakada taşlar kayarak yer değiştirir.
- **Taş çekme:** Yığından ya da sol alttaki taştan, dokunarak ya da ıstakada istediğin yuvaya sürükleyerek çekersin. Sıra sendeyken yığında "Çek", soldaki taşta "Al" yazar.
- Yığında 6, 3 ve 1 taş kalınca uyarı verilir. Son 10 saniyede süre halkası kırmızıya döner.
- Okey, işlek taş ya da kullanılmamış alınan okey atılırken onay istenir (Ayarlar'dan kapatılabilir).
- Ayarlar (⚙️): ses, titreşim, otomatik dizme, riskli atış onayı, renk körlüğü desteği. Nasıl oynanır (❔) giriş ekranında ve ayarlarda.
- Bilgisayarda kısayollar: Boşluk çek, A soldakini al, S seri diz, C çift diz, Delete at, Enter elini aç, Esc seçimi kaldır.
- Istaka iki sıra, 15'er yuvadır. Perlerin arasına bir boşluk bırakınca per otomatik algılanır, puanı ıstakanın üstünde görünür (yeşil çizgi: geçerli per, mavi çizgi: çift).
- **Seri diz / Çift diz** elindeki en iyi dizilimi otomatik kurar.
- Taşı sürükleyip yuvalar arasında taşıyabilirsin (telefonda da çalışır). Taşa dokunup boş bir yuvaya dokunmak da olur.
- Atmak: taşı sağ alt köşeye sürükle, ya da taşa iki kez dokun, ya da seçip köşeye dokun.
- İşlemek: açtıktan sonra taşı seç; işlenebileceği perler parlar. "+" (başa/sona ekle) ya da "Al" (okeyi al) üzerine dokun ya da taşı oraya sürükle. Uygulama kendi kendine işlemez.
- **İşle** düğmesi (isteyene): işlenebilen normal taşları tek dokunuşla işler; okeyi kullanmaz ve okey almaz.
- **Elini aç / Perleri indir** önce bir önizleme açar; indirmek istemediğin grubun işaretini kaldırabilirsin.
- Yeni çektiğin taş, ıstakada uyduğu grubun yanına konur.
- Süren dolarsa senin adına sadece taş çekilir ve güvenli bir taş atılır; el açılmaz, işlenmez.
- Kırmızı çerçeveli taşlar işlek taştır (atarsan 101 ceza).
- Telefonda yatay kullanım ve tam ekran (⛶) önerilir.

## Kurallar
- 106 taş. Göstergenin bir üstü okeydir (gösterge 13 ise okey 1). Sahte okey, okeyin yerine geçer.
- Başlayan oyuncu 22, diğerleri 21 taş alır. Oyun saat yönünün tersine döner, soldakinin attığını alabilirsin.
- Seriler 1-13 arasıdır: **12-13-1 ve 13-1-2 geçersizdir**. Aynı sayı perleri 3 ya da 4 farklı renktir.
- Açarken ya da yere indirirken bir seri **en fazla 5 taş** olabilir: 1234567 tek per açılamaz, 1234 + 567 ya da 123 + 4567 diye bölünür.
- Açmak için en az 101 puanlık seri ya da en az 5 çift gerekir. Okey, yerine geçtiği taşın değerini alır ve dizildiği yerde kalır.
- Soldan taş alan, elini açmamışsa o taşla açmak zorundadır. Açamazsa ya da açmak istemezse taşı geri koyar ve 101 ceza yazılır.
- Seri açan yeni seri indirebilir. Masada çift açan varsa çift alanına çift de indirebilir. Çift açan yeni seri açamaz, sadece çift indirir ve işler.
- Masadaki bir pere **bir turda en fazla 2 taş** işlenebilir; toplamda sınır yoktur (seri işlenerek 13'e kadar uzayabilir). O tur sınırı dolmuş bir pere uyan taşı atmak işlek sayılmaz.
- Elini açan, yerdeki okeyin yerine geçen taşı koyup okeyi alabilir: seriden, 4'lü gruptan ya da çiftten (çiftte okeyin eşiyle aynı taş konur). 3'lü gruptaki ve iki okeyli çiftteki okey belirsiz olduğu için alınamaz. Okeyi almak kimseye ceza yazdırmaz; ama alınan okey aynı tur kullanılmazsa alana 101 ceza yazılır.
- Okey atmak ya da işlek taş atmak 101 cezadır (bitiş taşı hariç). Yerdeki bir okeyi alabilecek taş da işlek sayılır.
- Okey göstergenin bir üstüdür; ekranda ayrıca gösterilmez. Okey elde kendi yüzüyle durur; oyuncu istediği taşı sağ tık (telefonda uzun basma) ile ters çevirebilir. Masada (perlerde, atılanlarda) okey ters çevrilmiş, numarasız görünür.
- Eli bitiren -101, açmayan 202 alır. Açan, elinde kalan taşların toplamını yazar; çift açanın puanı ikiye katlanır. Elde kalan her okey için +101 eklenir.
- Okey atarak, çiftten ya da elden (açtığı turda) bitirmek puanları her biri için ikiye katlar.
- Dört oyuncu da çift açarsa el iptal edilir ve yeniden dağıtılır.
- Belirlenen el sayısı sonunda en düşük puan kazanır.

## Giriş
Adının yanındaki yuvarlağa dokunup avatarını seçebilirsin (tarayıcında saklanır).

Açılışta açık masalar listelenir; birine dokunup oturabilir ya da yeni oda kurabilirsin. Oyundaki masalarda botun oturduğu koltuğa geçebilirsin. Oda ayarlarından masayı listeden gizleyebilirsin.

## Oda ayarları (oda sahibi, oyun başlamadan)
- **Tekli / Eşli:** Eşli oyunda karşılıklı oturanlar eştir (koltuğa tıklayarak yer değiştirebilirsiniz). Puanlar takım olarak toplanır; bitirenin eşinin el cezası silinir (o el 0 yazar, cezaları hariç). En düşük takım toplamı kazanır.
- **Katlamalı:** Rakipten sonra açan, rakibin en yüksek açışından en az 1 fazla açmalıdır (çiftte 1 çift fazla). Eşin açışı barajı yükseltmez.
- **Açtığı turda işleme yok:** Elini açan, işleme yapmak için bir tur bekler.
- **El sayısı** ve **hamle süresi** (30-90 sn).

## Diğer
- 💬 düğmesiyle hazır mesajlar ya da serbest yazı gönderilebilir; mesaj, gönderenin üstünde balon olarak görünür.
- 🏆 düğmesi el el puan çetelesini ve oyun akışını gösterir.

## Ayarlar (server.js)
- `TURN_MS`: oyuncu hamle süresi (varsayılan 45 sn; dolarsa hamle otomatik yapılır)
- `BOT_MS`: bot hamle hızı
