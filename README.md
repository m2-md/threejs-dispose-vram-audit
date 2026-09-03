# dispose() VRAM Denetimi — Three.js Seviye Boşaltma

"Çöpçünün Anahtarı GPU Kapısını Açmaz" makalesinin çalışan kodu. Bir seviyeyi
menü→seviye→menü döngüsünde 200 kez yeniden yükleyip `renderer.info.memory`
sayaçlarıyla VRAM sızıntısını önce gözle görür, sonra referans sayan bir
ResourceTracker ile kapatır — ve WebGL gerektirmeyen sayan bir sahte renderer'la
sıfır sızıntıyı vitest altında kanıtlar.

Three.js 3D serisinin **ilk** projesi; sonraki projeler (fizik, glTF, terrain)
bu `SceneManager` + `TextureCache` + `disposeSubtree` omurgasını miras alır.

Sürüm: `three@0.185.1` (r185), klasik `WebGLRenderer`. Bu proje WebGPU'ya girmez.

## Ne içerir

- **`src/naive-scene-manager.ts`** — sadece `scene.add` / `scene.remove`. Sızıntı deseni:
  JS referansını koparır ama GPU'ya tek kelime etmez.
- **`src/memory-probe.ts`** — `renderer.info` sayaçlarını ölçüm aletine çevirir:
  baseline tutar, `drift()` döndürür, `toCSV()` üretir (ring-buffer, prob'un kendisi
  sızmaz). `RendererInfoLike` şekli sayesinde hem gerçek renderer'ı hem sahte
  renderer'ı okur.
- **`src/dispose.ts`** — `disposeSubtree` sahne grafiğini `traverse` ile gezer ve her
  materyalin YEDİ doku alanını (`map`, `normalMap`, `roughnessMap`, `metalnessMap`,
  `aoMap`, `alphaMap`, `envMap`) + geometriyi + materyali elden çıkarır.
- **`src/texture-cache.ts`** — paylaşılan dokular için referans sayma. `acquire` artırır,
  `release` azaltır, yalnızca sıfırda gerçek `dispose()` çağrılır (atlas 2→1→0 yolu).
- **`src/scene-manager.ts`** — gezgin + refcount + grafik dışı `extras` (render target,
  PMREM) tek bir `unload` sözleşmesinde.
- **`src/dispose-spy.ts`** — WebGL gerektirmeyen sayan sahte renderer. Three.js'in gerçek
  `"dispose"` olayını dinler; `info` getter'ı `renderer.info` ile birebir aynı şekilde
  döner, böylece `MemoryProbe` sahte renderer'ı gerçeğinden ayırt edemez.
- **`src/level-factory.ts`** — deterministik (`mulberry32`) seviye üreticisi; 8 mesh, her
  biri kendi geometrisi + sahipli dokuları, hepsi paylaşılan atlas'ı ediniyor.
- **`src/main.ts` + `index.html`** — gerçek `WebGLRenderer` ile tarayıcı demosu
  (dark cinematic + neon glow arayüz).
- **`src/view/diorama.ts`** — sunum katmanı: denetlenen 8 mesh'lik seviyeyi sinematik
  bir diorama gibi çizen AYRI `WebGLRenderer` (ACESFilmic tone mapping, `RoomEnvironment`
  + PMREM IBL, gölgeli zemin, fog, `UnrealBloomPass`). Kendi context'i olduğu için
  ölçüm sayaçlarına **dokunmaz** → naif `geometries` drift'i 1600 kalır.
- **`src/view/chart.ts`** — geometries drift'inin neon alan/çizgi grafiği (leak = tırmanan
  rose çizgi + glow + "tepe 1600" rozeti; fixed = düz emerald çizgi).

## Kurulum

```bash
npm install
```

## Test

```bash
npm test
```

15 test — hepsi deterministik, **WebGL/GPU GEREKTİRMEZ** (Node'da koşar):

- **Naif sızıntı:** 200 döngü `NaiveSceneManager` → `drift().geometries > 0` ve
  `.textures > 0` (sayaç tırmanır, düşmez).
- **Sıfır sızıntı:** 200 döngü `SceneManager` → `drift()` dört alanda da `0`,
  `cache.size === 0`, `loadedCount === 0`.
- **Refcount 2→1→0:** atlas yalnızca SON sahip çıkınca dispose edilir (ne erken, ne geç).
- **Gezinti:** `disposeSubtree` `map` + `normalMap` + `aoMap` + geometri + materyali
  tek çağrıda dispose eder; paylaşılan dokuya dokunmaz.
- **Grafik dışı:** sahne ağacında OLMAYAN `WebGLRenderTarget` yine de kapatılır.
- **Prob / spy:** `drift` baseline sapmasını ölçer, `toCSV` doğru satır sayısı üretir;
  spy'ın program sayımı imzaya göre dedup eder.

Beklenen çıktı:

```
 ✓ test/dispose-spy.test.ts    (4 tests)
 ✓ test/dispose.test.ts        (3 tests)
 ✓ test/memory-probe.test.ts   (3 tests)
 ✓ test/texture-cache.test.ts  (1 test)
 ✓ test/extras.test.ts         (2 tests)
 ✓ test/scene-manager.test.ts  (2 tests)

 Test Files  6 passed (6)
      Tests  15 passed (15)
```

Ölçülen deterministik sayılar (WebGL'siz, `DisposeSpy` ile):

| Senaryo (200 döngü, meshCount=8) | geometries | textures | programs |
|---|---|---|---|
| Naif (`scene.remove`) | **1600** (200×8) | 5601 | 8 |
| Doğru (`dispose` + refcount) — drift | **0** | **0** | **0** |

Naif sürümde `geometries` 200. döngüde tam **1600**'ü gösterir. Doğru sürümde her sayaç
baseline'a döner (`cache.size === 0`).

## Demo (tarayıcı)

```bash
npm run dev
```

`http://localhost:5173/` → sinematik diorama + cam kontrol paneli:

- **Naif 200× yükle** (rose/danger buton) — `renderer.info.memory` sayaçları tırmanır;
  neon grafik geometries drift'ini 0→**1600** yükselen rose bir çizgiyle çizer (glow +
  dolgu + "tepe 1600" rozeti), stat sayaçları `+1600 / +5602 / +8` (kırmızı) gösterir.
- **Doğru 200× yükle** (emerald/success buton) — grafik düz emerald sıfır çizgisi; üç
  sayaç da `0`.

Mimari — **iki ayrı WebGL context**:

1. **Ölçüm renderer'ı** (`main.ts`) — makaledeki gerçek `WebGLRenderer`. Sahnesi
   baseline'da boştur; naif 200 döngü sonunda `geometries` mutlak = drift = **1600**
   (makale iddiası). Görünmez ama gerçek context (sayaç kaynağı).
2. **Diorama renderer'ı** (`view/diorama.ts`) — salt sunum, ayrı context; ölçüm
   sayaçlarına dokunmaz. Denetlenen 8 mesh'i neon ışıkla, gölgeli zeminde gösterir.

> Demo bir dev sunucusu ister. `index.html`'i `file://` ile açmak boş ekran verir
> (Vite bare module specifier'ları çözer). Her zaman `npm run dev` kullanın.

Tarayıcıda gerçek `WebGLRenderer.info.memory` ile doğrulandı (headless Chrome, SwiftShader):
naif → `geometries +1600 / textures +5602 / programs +8`; doğru → hepsi `0`.

## Build

```bash
npm run build   # tsc && vite build → dist/
```

## Neden WebGL gerektirmeden test edilebilir?

`renderer.info.memory`'nin ölçtüğü GPU yerleşimi, Three.js'in kaynaklardan gelen bir
`"dispose"` olayını dinlemesiyle güncellenir. `BufferGeometry`, `Texture` ve `Material`,
`dispose()` çağrıldığında `"dispose"` olayı yayınlar — bu gerçek Three.js davranışıdır.
`DisposeSpy` aynı olayı dinleyip sayar; canvas'a, GPU'ya ve tarayıcıya dokunmaz. Böylece
200 döngü kanıtı milisaniyeler içinde, deterministik olarak Node'da koşar.

## Lisans

MIT
