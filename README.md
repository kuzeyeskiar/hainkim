# Hainkim? 🎬

Letterboxd'da seni takip etmeyenleri anında bul.

## Kurulum & Deploy

### 1. Repoyu fork'la veya clone'la
```bash
git clone https://github.com/kullaniciadin/hainkim.git
cd hainkim
```

### 2. Netlify'a bağla
1. [netlify.com](https://netlify.com) → "Add new site" → "Import an existing project"
2. GitHub reposunu seç
3. Build ayarları otomatik gelir (`netlify.toml` sayesinde)
4. **Deploy site** butonuna bas — bitti!

### 3. Lokal geliştirme (opsiyonel)
```bash
npm install
npm run dev
# → http://localhost:8888
```

## Proje Yapısı

```
hainkim/
├── public/
│   └── index.html          # Frontend
├── netlify/
│   └── functions/
│       └── letterboxd.js   # Serverless scraper
├── netlify.toml             # Netlify config
└── package.json
```

## Nasıl Çalışır?

- Frontend `/api/letterboxd?username=XXX` endpoint'ini çağırır
- Netlify Function, Letterboxd'un herkese açık sayfalarını scrape eder:
  - `letterboxd.com/{user}/following/` — kimin takip edildiği
  - `letterboxd.com/{user}/followers/` — kimin takip ettiği
- Sayfalama otomatik yönetilir (20 sayfaya kadar)
- Sonuçlar karşılaştırılıp 3 kategoride döner:
  - `notFollowingBack` — sen takip ediyorsun, onlar etmiyor (**hainler** 🗡️)
  - `mutual` — karşılıklı takip
  - `notFollowing` — seni takip ediyor, sen etmiyorsun

## Notlar

- Letterboxd'un resmi API'si yoktur; bu araç herkese açık profil sayfalarını okur
- Çok büyük takip listelerinde (500+) işlem birkaç saniye sürebilir
- Gizli profiller çalışmaz

---
made by [@kyuzelost](https://letterboxd.com/kyuzelost)
