# Çöpçünün Anahtarı GPU Kapısını Açmaz: Bir Seviyeyi 200 Kez Yükleyip Three.js VRAM Sızıntısını dispose() Denetimiyle Kapatmak

*"dispose() çağırmayı unutmayın" bir dilek değil, bir veri yapısı olmalı. Sahneyi menü→seviye→menü döngüsünde 200 kez yeniden yükleyip `renderer.info.memory` sayaçlarıyla sızıntıyı önce gözle görüyor, sonra referans sayan bir ResourceTracker ile kapatıyoruz — ve WebGL gerektirmeyen sahte bir renderer'la sıfır sızıntıyı vitest altında kanıtlıyoruz.*

*Tahmini okuma süresi: 16 dakika*

---

İki bina düşünün, duvar duvara komşu. Solda JavaScript binası: değişkenleriniz, nesneleriniz, sahne grafiğiniz burada oturur. Sağda GPU binası: dokular, geometriler, derlenmiş shader'lar orada, VRAM'de (GPU belleği) yaşar. Bir de çöpçü var — garbage collector (çöp toplayıcı). İşini iyi yapar, ama tek bir sorunu vardır: anahtarlığında yalnızca sol binanın anahtarı asılıdır. Sağ binaya adım atma yetkisi yoktur.

`scene.remove(root)` yazdığınızda ne olur? Sol binadaki isim tabelasını sökersiniz. Sahne artık o nesneyi tutmaz, JavaScript referansı kopar, çöpçü gelip solu süpürür. Heap tertemiz. Ama sağ bina? Oradaki kiracı hâlâ orada, hâlâ kira ödüyor, hâlâ VRAM işgal ediyor. Çöpçünün onu göremediği gibi, sizin heap profilcinizin (bellek profilcisi) de göremediği bir kiracı.

İşte bu yazının tek bir cümlelik derdi: **JavaScript'te bir kaynağa artık hiçbir referans kalmasa bile, o kaynak GPU'da öylece durmaya devam edebilir.** Ve bunu görmenin tek yolu doğru binaya bakmaktır.

Bu, yeni bir 3D serisinin ilk yazısı. İlk sırada durması da tesadüf değil. Serinin geri kalanında fizik dünyaları kuracağız, glTF modelleri yükleyeceğiz, arazi chunk'ları üreteceğiz — hepsi GPU'ya kaynak yükleyen projeler. Seviye boşaltmayı ilk projede öğrenmezsek, sonraki her proje aynı sızıntıyı miras alır. O yüzden omurgayı en baştan, denetlenebilir biçimde kuruyoruz.

Bir uyarı borçluyum. Bu konu, 2D serisindeki nesne havuzu (object pool) yazısına uzaktan benziyor — ama aynı şey değil, sakın karıştırmayın. Orada JavaScript heap'inde çöp biriktiriyorduk, çöpçüye fazla iş çıkarıyorduk, çözüm ona daha az iş vermekti. Burada JavaScript'te hiç çöp yok; referanslar temiz, heap düz. Sorun, çöpçünün yetkisinin bittiği yerde başlıyor. O yüzden bütün dikkatimizi 3D'ye özgü kısma — GPU tarafına ve paylaşılan dokuların referans sayımına — vereceğiz.

Yol haritası şu: önce naif `scene.remove` sürümünün sızıntısını `renderer.info.memory` ile gözle göreceğiz. Sonra o sayaçları bir ölçüm aletine (`MemoryProbe`) çevireceğiz. Ardından sahne grafiğini gezip her kaynağı elden çıkaran `disposeSubtree`'yi yazacağız. İki seviyenin paylaştığı dokular için referans sayan bir katman ekleyeceğiz. Mesh'lerin ötesindeki kaynaklara — render target, program, renderer'ın kendisine — bakacağız. Ve en sonda, WebGL bile gerektirmeyen sayan bir sahte renderer'la 200 döngü boyunca sızıntının sıfır olduğunu vitest altında kanıtlayacağız.

Sürüm notu: `three@0.185.1` (r185), klasik `WebGLRenderer`. Bu yazı WebGPU'ya girmez. Vite + TypeScript + vitest.

### Heap Profilcinin Göremediği Sızıntı

Bir oyun düşünün. Ana menüde "Başla" var, tıklıyorsunuz, seviye yükleniyor, oynuyorsunuz, Esc'ye basıp menüye dönüyorsunuz. Sonra tekrar. QA testçisi bunu bir öğleden sonra boyunca yapar; speedrun deneyen biri yüzlerce kez yapar. Masaüstünde belki hiç fark edilmez. Mobilde, kırktan sonra oyun takılmaya başlar; altmışta sekme çöker.

Naif seviye yöneticisini yazalım — çoğu tutorial'ın durduğu yer:

```ts
// src/naive-scene-manager.ts — kasıtlı naif sürüm, karşılaştırma için projede duruyor
import * as THREE from "three";
import type { Level } from "./level-factory";

export class NaiveSceneManager {
  readonly scene = new THREE.Scene();

  load(level: Level): void {
    this.scene.add(level.root);
  }

  unload(level: Level): void {
    this.scene.remove(level.root); // sol binadaki tabelayı sök — hepsi bu
  }
}
```

`load` seviyeyi sahneye ekliyor, `unload` çıkarıyor. JavaScript açısından kusursuz: `unload`'dan sonra `level.root`'a hiçbir yerden ulaşılamıyor, çöpçü onu ilk fırsatta toplar. DevTools'ta Memory sekmesini açıp bu döngüyü 200 kez koşarsanız, JS Heap grafiği testere dişi çizer ama trend olarak yataydır — biriken JavaScript nesnesi yok. Heap profilciniz size "her şey yolunda" der.

Şimdi doğru binaya bakalım. Three.js'in renderer'ı, GPU'ya ne yüklediğini `renderer.info.memory` altında sayar. Gerçek API, uydurma değil:

```ts
// three.js API alıntısı — projede ayrı bir dosya değil, renderer.info alanlarının okunuşu
renderer.info.memory.geometries; // GPU'da duran geometri sayısı
renderer.info.memory.textures;   // GPU'da duran doku sayısı
renderer.info.programs?.length;  // derlenmiş shader program sayısı
```

Aynı 200 döngüyü koşup her döngü sonunda bu sayaçları okuyunca hikâye tersine döner. `geometries` her döngüde artar. `textures` artar. `programs` artar. Sekiz mesh'lik minik bir seviyede bile, iki yüzüncü döngüde `geometries` sayacı 1600'ü gösterir — çünkü `scene.remove` GPU'ya tek kelime etmedi. Sol bina her seferinde temizlendi; sağ bina tıka basa doldu.

Neden? Çünkü Three.js'te bir `BufferGeometry`, bir `Texture` ya da bir `Material`, GPU'daki karşılığını serbest bırakmak için sizden açık bir emir bekler. O emir `dispose()`'tur. `dispose()` çağrılana kadar renderer o kaynağı iç önbelleğinde tutar — çünkü onu bir sonraki karede yine çizmeniz gayet olası. Renderer geleceği bilmez; siz "bu bitti" demedikçe silmez. `scene.remove` ise renderer'a hiçbir şey söylemez, sadece grafik ağacından bir dalı koparır.

İki sayacın yan yana durması bu yazının bütün teşhisi: JavaScript heap düz, GPU belleği tırmanışta. Çöpçü elinden geleni yapıyor — ama yetkisi o kapıda bitiyor.

### GPU'yu renderer.info.memory ile Tartmak

"Tırmanıyor" bir izlenim; izlenimle iş yapmayız. Sayacı ölçüm aletine çevirelim. İki şey istiyorum: bir baseline (başlangıç değeri) tutsun, ve her an bana o baseline'dan ne kadar saptığımızı — drift'i — söylesin. Bir de sonu CSV olarak döksün ki grafiği kendi gözünüzle çizin.

Önce renderer'dan okuyacağı verinin şeklini sabitleyelim. Kritik nokta şu: bu şekli hem gerçek `WebGLRenderer` hem de birazdan yazacağımız sahte renderer sağlayacak. Aynı prob ikisini de okuyabilsin diye:

```ts
// src/memory-probe.ts
export interface RendererInfoLike {
  info: {
    memory: { geometries: number; textures: number };
    programs: { length: number } | null;
    render: { calls: number };
  };
}

export interface MemorySample {
  cycle: number;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
}
```

`WebGLRenderer.info` tam olarak bu şekle uyar — `info.memory.geometries`, `info.memory.textures`, `info.programs` (bir dizi, `.length`'i var), `info.render.calls`. Prob renderer'ın türünü umursamaz; sadece sayaçları okur:

```ts
// src/memory-probe.ts (aynı dosyanın devamı)
export class MemoryProbe {
  private baseline: MemorySample | null = null;
  private ring: MemorySample[] = [];

  constructor(private readonly capacity = 256) {}

  sample(renderer: RendererInfoLike, cycle: number): MemorySample {
    const info = renderer.info;
    const s: MemorySample = {
      cycle,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      calls: info.render.calls,
    };
    this.baseline ??= s; // ilk örnek baseline olur
    this.ring.push(s);
    if (this.ring.length > this.capacity) this.ring.shift();
    return s;
  }

  drift(): Omit<MemorySample, "cycle"> {
    const last = this.ring.at(-1);
    const base = this.baseline;
    if (!last || !base)
      return { geometries: 0, textures: 0, programs: 0, calls: 0 };
    return {
      geometries: last.geometries - base.geometries,
      textures: last.textures - base.textures,
      programs: last.programs - base.programs,
      calls: last.calls - base.calls,
    };
  }

  toCSV(): string {
    const header = "cycle,geometries,textures,programs,calls";
    const rows = this.ring.map(
      (s) =>
        `${s.cycle},${s.geometries},${s.textures},${s.programs},${s.calls}`,
    );
    return [header, ...rows].join("\n");
  }
}
```

Ring-buffer (halka tampon) neden? Çünkü 200 değil, 20.000 döngü koşsanız bile bellekte son 256 örneği tutsun, prob'un kendisi sızıntı kaynağı olmasın. `drift()` işin kalbi: son örnek eksi baseline. Sızıntı yoksa dört alan da sıfır döner. Sızıntı varsa, hangi kaynağın sızdığını tek tek söyler — geometri mi, doku mu, program mı.

Tarayıcıda gerçek renderer'la kullanımı şöyle görünür. Bu kod `npm run dev` ile Vite altında çalışır, `file://` ile açılınca boş ekran verir:

```ts
// src/main.ts (runCorrect gövdesi — kısaltıldı: sm = new SceneManager(),
// camera/light kurulumu ve DOM bağlama atlandı)
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.info.autoReset = false; // render.calls'ı biz sıfırlayacağız; memory zaten kalıcı

const probe = new MemoryProbe();
probe.sample(renderer, 0); // baseline: boş sahne

for (let cycle = 1; cycle <= 200; cycle++) {
  const level = buildLevel(sm.cache, cycle);
  sm.load(level);
  renderer.render(sm.scene, camera); // GPU'ya yükle
  sm.unload(level);
  const s = probe.sample(renderer, cycle);
  console.log(cycle, s.geometries, s.textures, s.programs);
}
```

Küçük ama önemli bir ayrıntı: `renderer.info.autoReset = false`. Varsayılan olarak `info.render.calls` her karede sıfırlanır (o bir kare-içi sayaçtır). `info.memory` ise sıfırlanmaz — o canlı GPU yerleşimini gösterir, tam da bizim istediğimiz şey. `autoReset`'i kapatınca kontrol tümüyle sizde olur.

Naif `NaiveSceneManager` ile bu döngüyü koşarsanız konsol her satırda daha büyük bir `geometries` basar. Doğru yöneticiyle — birazdan yazacağız — sayı ilk satırdan sonra sabitlenir. İşte o sabit çizgi, bu yazının hedefi.

### Bir ResourceTracker: Sahne Grafiğini Gezmek

Teşhis bitti. Tedavi tek bir cümle: sahneden çıkardığınız her kaynak için `dispose()` çağırın. Sorun, "her kaynağın" göründüğünden fazla olması.

Bir mesh'i düşünün. Elle `mesh.geometry.dispose()` ve `mesh.material.dispose()` demek akla ilk geleni. Ama bir materyalin altında bir sürü doku asılı olabilir: renk dokusu (`map`), normal haritası (`normalMap`), pürüzlülük (`roughnessMap`), metaliklik (`metalnessMap`), ortam örtme (`aoMap`), saydamlık (`alphaMap`), ortam yansıması (`envMap`). Materyalin `dispose()`'u bu dokuları sizin için elden çıkarmaz — Three.js kasıtlı olarak dokunmaz, çünkü o dokular pekâlâ başka materyaller tarafından da paylaşılıyor olabilir. Her birini ayrı ayrı bulup dispose etmek sizin işiniz.

O yüzden "unutmayın" çalışmaz. İnsan unutur, hele yedi ayrı doku alanını. Bunu bir gezinti algoritmasına — sahne grafiğini kökten yaprağa dolaşıp her kaynağı bulan bir fonksiyona — çevireceğiz. Three.js'in `traverse` metodu tam bunun için var:

```ts
// src/dispose.ts
import * as THREE from "three";
import type { TextureCache } from "./texture-cache";

export const TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "envMap",
] as const;

export function disposeMaterial(
  material: THREE.Material,
  cache?: TextureCache,
): void {
  for (const slot of TEXTURE_SLOTS) {
    const tex = (material as unknown as Record<string, unknown>)[slot];
    if (tex instanceof THREE.Texture) {
      if (cache?.isShared(tex)) continue; // paylaşılan doku cache'in işi — ona dokunma
      tex.dispose();
    }
  }
  material.dispose();
}

export function disposeSubtree(
  root: THREE.Object3D,
  cache?: TextureCache,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();

    const material = mesh.material;
    if (!material) return;
    if (Array.isArray(material)) {
      for (const m of material) disposeMaterial(m, cache);
    } else {
      disposeMaterial(material, cache);
    }
  });
}
```

`traverse` kökten başlar, her çocuğu, çocuğun çocuğunu tek tek gezer — sizin elle ağaç dolaşmanıza gerek kalmaz. Her düğümde geometriyi elden çıkarırız (bir `Group` ya da `Light` düğümünde `geometry` tanımsızdır, `if` onu atlar). Sonra materyale bakarız. Materyal bir dizi de olabilir (Three.js çok-materyalli mesh'lere izin verir) — o yüzden hem tekil hem dizi hâlini ele alıyoruz.

`disposeMaterial`'ın kalbi o yedi elemanlı `TEXTURE_SLOTS` döngüsü. Her alanı tek tek yoklar, orada gerçekten bir doku varsa dispose eder, en sonda materyalin kendisini kapatır. `cache?.isShared(tex)` kontrolünü şimdilik görmezden gelin; bir sonraki bölümde paylaşılan dokuları koruyan kapı o. Cache olmadan çağırırsanız (`disposeSubtree(root)`) her doku "sahipli" sayılır ve doğrudan dispose edilir.

Bu fonksiyon, "dispose etmeyi unutmayın" cümlesini bir veri yapısına çevirmenin ilk yarısı. Artık unutacak bir şey yok: hangi mesh olursa olsun, hangi materyal olursa olsun, gezinti bütün alanlara uğrar. İnsan hafızası değil, `traverse` garantiliyor.

### Paylaşılan Doku'yu Referansla Saymak

Şimdi işin 3D'ye asıl özgü, asıl kurnaz kısmı. İki seviye aynı doku atlasını paylaşırsa ne olur?

Çok gerçekçi bir senaryo. Bir "yükleme ekranı" atlas'ı, ortak bir UI sprite sayfası, bir çevre yansıma haritası — bunlar seviyeden seviyeye taşınır, her seferinde yeniden yüklenmez. İki seviye aynı anda yüklüyken (birinden diğerine geçiş yaparken kısa bir an ikisi de sahnede olabilir) o atlas'ı tek bir `Texture` nesnesi olarak paylaşırlar. Peki A seviyesini boşaltırken atlas'ı dispose edersem? B seviyesi hâlâ onu kullanıyor — GPU'da olmayan bir dokuya referans veren bir materyal kalır, ekranda siyah ya da bozuk yüzeyler. Ya hiç dispose etmezsem? O zaman geri döndük başa: sızıntı.

Doğru cevap ne yeni ne de 3D'ye özgü, ama burada tam yerine oturuyor: reference counting (referans sayma). Dokuyu bir anahtara bağlarsınız. Her `acquire` (edin) sayacı bir artırır, her `release` (bırak) bir azaltır. Sayaç sıfıra inince — yani son sahip de çıkınca — o zaman ve yalnızca o zaman gerçek `dispose()` çağrılır.

```ts
// src/texture-cache.ts
import * as THREE from "three";

interface Entry {
  texture: THREE.Texture;
  refs: number;
}

export class TextureCache {
  private byKey = new Map<string, Entry>();
  private keyOf = new WeakMap<THREE.Texture, string>();

  acquire(key: string, create: () => THREE.Texture): THREE.Texture {
    let entry = this.byKey.get(key);
    if (!entry) {
      const texture = create(); // üretici YALNIZCA ilk edinmede koşar
      entry = { texture, refs: 0 };
      this.byKey.set(key, entry);
      this.keyOf.set(texture, key);
    }
    entry.refs++;
    return entry.texture;
  }

  release(key: string): void {
    const entry = this.byKey.get(key);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      entry.texture.dispose(); // GERÇEK dispose — yalnızca son sahip çıkınca
      this.byKey.delete(key);
    }
  }

  isShared(texture: THREE.Texture): boolean {
    const key = this.keyOf.get(texture);
    return key !== undefined && this.byKey.has(key);
  }

  refs(key: string): number {
    return this.byKey.get(key)?.refs ?? 0;
  }

  get size(): number {
    return this.byKey.size;
  }
}
```

Bütün numara `acquire` ve `release`'in simetrisinde. `acquire(key, create)` çağrısı, anahtar daha önce görülmediyse `create`'i koşup dokuyu üretir; görülmüşse hazır olanı verir ve sayacı artırır. Önemli olan `create`'in geç değerlendirilmesi (lazy): atlas ikinci seviyeye geldiğinde yeniden üretilmez, ilk üretimin sayacı bir artar, o kadar.

`release` tam tersini yapar. Sayaç bire inerse hiçbir şey silinmez; hâlâ birinin elinde. Sıfıra inince gerçek `dispose()` devreye girer. `isShared` ise az önce `disposeSubtree`'de gördüğümüz kapı: bir doku bu cache tarafından yönetiliyorsa, sahne gezgini ona dokunmaz — çünkü onun kaderi refcount'a bağlı, tek bir seviyenin kaprisine değil.

Bir atlas'ın 2→1→0 yolunu izleyen deney şöyle çıkar. A ve B seviyeleri yükleniyor, ikisi de atlas'ı ediniyor: refcount 2. A boşalıyor: refcount 1, atlas hâlâ GPU'da (B'nin ihtiyacı var). B boşalıyor: refcount 0, işte şimdi gerçek dispose. Atlas tam olarak bir kez üretildi, tam bir kez silindi, arada iki seviyeye hizmet etti. Bu yolu birazdan test bölümünde bir dispose olay dinleyicisiyle harfi harfine kanıtlayacağız.

Şimdi bu iki parçayı — gezgin ve refcount — tek bir sahne yöneticisinde birleştirelim:

```ts
// src/scene-manager.ts
import * as THREE from "three";
import { disposeSubtree } from "./dispose";
import { TextureCache } from "./texture-cache";
import type { Level } from "./level-factory";

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly cache = new TextureCache();
  private loaded: Level[] = [];

  load(level: Level): void {
    this.scene.add(level.root);
    this.loaded.push(level);
  }

  unload(level: Level): void {
    this.scene.remove(level.root);
    disposeSubtree(level.root, this.cache); // sahipli geometri + doku + materyal
    for (const key of level.shared) this.cache.release(key); // paylaşılan: refcount
    for (const extra of level.extras) extra.dispose(); // grafik DIŞI kaynaklar
    this.loaded = this.loaded.filter((l) => l !== level);
  }

  get loadedCount(): number {
    return this.loaded.length;
  }
}
```

`unload`'a bakın: bir satırda sahipli her şeyi gezip dispose ediyor, bir satırda paylaşılan dokuların sayacını düşürüyor, bir satırda da grafik dışı kaynakları kapatıyor — birazdan tam da onlara geleceğiz. "Unutmayın" cümlesi artık üç satırlık bir sözleşme. Naif sürümde `unload`, `scene.remove`'dan ibaretti; buradaki fark, o iki eksik satır ve bir gezgin.

### Mesh'lerin Ötesi: Render Target, Program ve Renderer'ın Kendisi

`disposeSubtree` sahne grafiğini gezer. Peki ya grafikte hiç olmayan kaynaklar?

Burada çoğu denetim tökezler. Bir render target (render hedefi) düşünün — bir aynanın, bir portalın ya da bir su yüzeyinin yansımasını çizdiğiniz kapalı bir tampon. O `WebGLRenderTarget` sahne ağacında bir düğüm değildir; bir kenarda durur, siz `renderer.setRenderTarget(rt)` deyip ona çizer, sonucunu bir materyalin `map`'ine bağlarsınız. `traverse` ona asla uğramaz. Dolayısıyla `disposeSubtree` onu bulamaz. Bulamadığı için de dispose edemez. Ve `WebGLRenderTarget` bir doku (hatta derinlik tamponuyla birlikte birden fazla) taşıdığından, her seviye değişiminde bir tane daha sızar.

Aynı hikâye şunlar için de geçerli:

- **`WebGLRenderTarget`** — yansıma/portal/post-process tamponları. `rt.dispose()` ile elle kapatılır.
- **`PMREMGenerator`** — bir HDR ortam haritasından önceden filtrelenmiş yansıma üretir; ürettiği hedef de, generator'ın kendisi de (`pmrem.dispose()`) ayrı ayrı kapatılmalıdır.
- **`renderer.renderLists.dispose()`** — renderer'ın kareden kareye taşıdığı çizim listesi önbelleği. Sahneyi tümden değiştirdiğinizde bunu temizlemek, bayat referansların takılıp kalmasını önler.
- Ve en dıştaki halka: uygulamayı kapatıyorsanız **`renderer.dispose()`** — WebGL context'inin kendisini bırakır.

Bunlar sahne grafiğine bağlı olmadığından, sahibini bir yere yazmak zorundasınız. Ben her seviyeye "grafik dışı kaynaklar" için basit bir `extras` listesi taşıtıyorum; `SceneManager.unload` o listedeki her şeyin `dispose`'unu çağırıyor. Bir seviyeyi kurarken:

```ts
// src/level-factory.ts (ilgili kısım)
export interface Level {
  root: THREE.Object3D;
  shared: string[]; // cache anahtarları (paylaşılan dokular)
  extras: { dispose(): void }[]; // render target, PMREM — sahne grafiği DIŞI
}

// ...buildLevel içinde:
const reflection = new THREE.WebGLRenderTarget(256, 256);
return { root, shared: [ATLAS_KEY], extras: [reflection] };
```

Bu bölümün kanıtı tarayıcıda en net görünür: `renderer.info.programs.length` sayacını izleyin. Render target'ları ve materyalleri dispose etmeden 200 döngü koşarsanız, program sayacının nasıl kat kat şiştiğini kendi gözünüzle görürsünüz — çünkü her yeni materyal (dispose edilmediği için) shader program önbelleğinde bir yer tutmaya devam eder. Doğru `unload` ile o sayaç ilk seviyeden sonra sabitlenir. Grafik dışı kaynakları sahiplenmenin bedeli üç satır; sahiplenmemenin bedeli, kırkıncı seviyede çöken bir sekme.

### Kanıt: Vitest Altında 200 Döngü, Sayan Bir Sahte Renderer

Şimdi bu yazının en sevdiğim kısmı. Bütün bu iddiaları — "sızıntı bitti, her `acquire` bir `release` ile eşleşiyor, sayaçlar baseline'a birebir dönüyor" — nasıl otomatik test ederiz? Gerçek `WebGLRenderer` bir WebGL context ister, o da bir `<canvas>` ve bir GPU ister; vitest node altında koşar, orada ne canvas ne GPU var.

İyi haber: buna ihtiyacımız yok. `renderer.info.memory`'nin ölçtüğü GPU yerleşimi, aslında Three.js'in kaynaklardan gelen bir olayı dinlemesiyle güncellenir. Bir `BufferGeometry`, bir `Texture` ya da bir `Material`, `dispose()` çağrıldığında `"dispose"` adında bir olay yayınlar — bu gerçek Three.js davranışıdır, uydurma değil. Gerçek renderer bu olayı dinleyip sayacını düşürür. Biz de aynı olayı dinleyen, WebGL gerektirmeyen sayan bir sahte renderer yazabiliriz:

```ts
// src/dispose-spy.ts
import * as THREE from "three";
import { TEXTURE_SLOTS } from "./dispose";

export class DisposeSpy {
  private geom = 0;
  private tex = 0;
  private prog = 0;

  private seenGeom = new WeakSet<THREE.BufferGeometry>();
  private seenTex = new WeakSet<THREE.Texture>();
  private seenMat = new WeakSet<THREE.Material>();
  private programRefs = new Map<string, number>();

  // renderer.info ile BİREBİR aynı şekil → MemoryProbe ikisini de okuyabilir
  get info() {
    return {
      memory: { geometries: this.geom, textures: this.tex },
      programs: { length: this.prog },
      render: { calls: 0 },
    };
  }

  renderScene(scene: THREE.Object3D): void {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) this.trackGeometry(mesh.geometry);
      const material = mesh.material;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      for (const m of materials) this.trackMaterial(m);
    });
  }

  private trackGeometry(geometry: THREE.BufferGeometry): void {
    if (this.seenGeom.has(geometry)) return;
    this.seenGeom.add(geometry);
    this.geom++;
    const onDispose = () => {
      this.geom--;
      geometry.removeEventListener("dispose", onDispose);
    };
    geometry.addEventListener("dispose", onDispose);
  }

  private trackTexture(texture: THREE.Texture): void {
    if (this.seenTex.has(texture)) return;
    this.seenTex.add(texture);
    this.tex++;
    const onDispose = () => {
      this.tex--;
      texture.removeEventListener("dispose", onDispose);
    };
    texture.addEventListener("dispose", onDispose);
  }

  private trackMaterial(material: THREE.Material): void {
    if (this.seenMat.has(material)) return;
    this.seenMat.add(material);

    for (const slot of TEXTURE_SLOTS) {
      const tex = (material as unknown as Record<string, unknown>)[slot];
      if (tex instanceof THREE.Texture) this.trackTexture(tex);
    }

    // Program: imzaya göre dedup — WebGLPrograms gibi
    const sig = programSignature(material);
    const refs = this.programRefs.get(sig) ?? 0;
    this.programRefs.set(sig, refs + 1);
    if (refs === 0) this.prog++;

    const onDispose = () => {
      const n = (this.programRefs.get(sig) ?? 1) - 1;
      if (n <= 0) {
        this.programRefs.delete(sig);
        this.prog--;
      } else {
        this.programRefs.set(sig, n);
      }
      material.removeEventListener("dispose", onDispose);
    };
    material.addEventListener("dispose", onDispose);
  }
}

function programSignature(material: THREE.Material): string {
  const slots = TEXTURE_SLOTS.filter(
    (s) => (material as unknown as Record<string, unknown>)[s],
  );
  return `${material.type}|${slots.join(",")}`;
}
```

`renderScene` gerçek renderer'ın yaptığını taklit eder: sahneyi gezip her kaynağı "ilk görüşte" kaydeder ve o kaynağın `dispose` olayına abone olur. Kaynak dispose edilince olay tetiklenir, sayaç düşer, dinleyici kendini siler (tıpkı gerçek Three.js'in yaptığı gibi). `info` getter'ı `renderer.info` ile aynı şekilde döndüğü için, `MemoryProbe` sahte renderer'ı gerçeğinden ayırt edemez.

Bir dürüstlük notu, çünkü size aksini söyleyen bir test bir şey saklıyordur: program sayımını imzaya göre yapıyorum. Aynı doku alanlarını kullanan sekiz materyal aynı programı paylaşır — bu, gerçek `WebGLPrograms`'ın davranışının sadık bir modeli, ama tam kopyası değil. Gerçek Three.js programı çok daha ince ayrıntılarla (gölge, sis, kemik sayısı...) imzalar. Kanıtlamak istediğim değişmez ise ikisinde de aynı: her materyal dispose edilirse programı serbest kalır. Sayının kesin değeri değil, sıfıra dönmesi önemli.

Şimdi asıl test. 200 döngü, önce naif sürümle (sızmalı), sonra doğru sürümle (sızmamalı):

```ts
// test/scene-manager.test.ts
import { describe, it, expect } from "vitest";
import { SceneManager } from "../src/scene-manager";
import { NaiveSceneManager } from "../src/naive-scene-manager";
import { TextureCache } from "../src/texture-cache";
import { buildLevel } from "../src/level-factory";
import { DisposeSpy } from "../src/dispose-spy";
import { MemoryProbe } from "../src/memory-probe";

describe("dispose denetimi — 200 döngü", () => {
  it("naif scene.remove sızdırır: sayaç tırmanır, düşmez", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    const naive = new NaiveSceneManager();
    const cache = new TextureCache(); // naif sürüm bunu asla release etmez
    probe.sample(spy, 0);

    for (let cycle = 1; cycle <= 200; cycle++) {
      const level = buildLevel(cache, cycle);
      naive.load(level);
      spy.renderScene(naive.scene); // GPU'ya yükle
      naive.unload(level); // yalnızca scene.remove
      probe.sample(spy, cycle);
    }

    const drift = probe.drift();
    expect(drift.geometries).toBeGreaterThan(0); // sızıntı KANITI
    expect(drift.textures).toBeGreaterThan(0);
  });

  it("doğru unload sızdırmaz: 200 döngü sonunda sayaçlar baseline'a döner", () => {
    const spy = new DisposeSpy();
    const probe = new MemoryProbe();
    const sm = new SceneManager();
    probe.sample(spy, 0); // baseline: boş sahne

    for (let cycle = 1; cycle <= 200; cycle++) {
      const level = buildLevel(sm.cache, cycle);
      sm.load(level);
      spy.renderScene(sm.scene);
      sm.unload(level); // dispose + refcount release
      probe.sample(spy, cycle);
    }

    expect(probe.drift()).toEqual({
      geometries: 0,
      textures: 0,
      programs: 0,
      calls: 0,
    });
    expect(sm.cache.size).toBe(0); // paylaşılan doku da temizlendi
    expect(sm.loadedCount).toBe(0);
  });
});
```

İkinci testin son üç `expect`'i bu yazının bütün tezidir. İki yüz döngü boyunca yüzlerce geometri, doku ve program doğdu ve öldü; sonunda `drift` dört alanda da tam sıfır. Cache boş — hiçbir paylaşılan doku askıda kalmadı. Yüklü seviye kalmadı. Sızıntı yok, üstelik ne bir tarayıcı ne bir GPU açtık; test milisaniyeler içinde deterministik olarak koşuyor.

Paylaşılan atlas'ın 2→1→0 yolunu da harfi harfine kanıtlayalım:

```ts
// test/texture-cache.test.ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SceneManager } from "../src/scene-manager";
import { buildLevel } from "../src/level-factory";

describe("paylaşılan doku refcount", () => {
  it("atlas yalnızca SON sahip çıkınca dispose edilir (2→1→0)", () => {
    const sm = new SceneManager();
    const a = buildLevel(sm.cache, 1);
    const b = buildLevel(sm.cache, 2);

    sm.load(a);
    sm.load(b);
    expect(sm.cache.refs("shared-atlas")).toBe(2);

    // atlas'ın gerçek dispose'unu dinle
    const firstMesh = a.root.children[0] as THREE.Mesh;
    const atlas = (firstMesh.material as THREE.MeshStandardMaterial).map!;
    let disposed = false;
    atlas.addEventListener("dispose", () => {
      disposed = true;
    });

    sm.unload(a);
    expect(sm.cache.refs("shared-atlas")).toBe(1);
    expect(disposed).toBe(false); // B hâlâ kullanıyor — silinmedi

    sm.unload(b);
    expect(sm.cache.refs("shared-atlas")).toBe(0);
    expect(disposed).toBe(true); // son sahip çıktı → GERÇEK dispose
  });
});
```

`disposed` bayrağının yalnızca ikinci `unload`'dan sonra `true` olması, bütün refcount fikrinin çekirdeği. A boşalınca atlas silinmedi — B'nin ekranında kalıcı bir kara delik açmadan. B de boşalınca, işte o zaman silindi. Ne erken, ne geç.

Son olarak gezginin gerçekten yedi alanı da gezdiğini ve grafik dışı render target'ın dispose edildiğini de birer testle çiviliyoruz — bunların ikisi de projenin test klasöründe. `disposeSubtree`'nin `map`, `normalMap`, `aoMap`'i tek çağrıda bulup dispose ettiğini, ve `SceneManager.unload`'ın sahne ağacında hiç olmayan `WebGLRenderTarget`'ı yine de kapattığını doğrularlar.

### Özetle:

1. `scene.remove(root)` yalnızca JavaScript referansını koparır; GPU'daki geometri, doku ve program'ı serbest bırakmaz. Çöp toplayıcının GPU belleğine yetkisi yok — o kapıyı yalnızca `dispose()` açar.
2. Sızıntı JS heap profilcisinde görünmez (heap düz kalır), ama `renderer.info.memory.geometries` / `.textures` / `programs.length` sayaçlarında net tırmanış olarak görünür. Doğru binaya bakın.
3. `MemoryProbe` bu sayaçları bir ölçüm aletine çevirir: baseline tutar, drift döndürür, CSV üretir. `RendererInfoLike` şekli sayesinde hem gerçek renderer'ı hem sahte renderer'ı okur.
4. `disposeSubtree` sahne grafiğini `traverse` ile gezer ve her materyalin YEDİ doku alanını (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `alphaMap`, `envMap`) + geometriyi + materyali elden çıkarır. "Unutmayın" bir gezinti algoritmasına dönüşür.
5. Paylaşılan dokular refcount ister: `acquire` sayacı artırır, `release` azaltır, yalnızca sıfırda gerçek `dispose()` çağrılır. Atlas'ın 2→1→0 yolu, erken silmeyi (kara delik) de geç silmeyi (sızıntı) de önler.
6. Bazı kaynaklar sahne grafiğinde hiç yoktur: `WebGLRenderTarget`, `PMREMGenerator`, `renderer.renderLists`, ve renderer'ın kendisi. `traverse` onlara uğramaz; sahiplerini elle bir listede tutup dispose etmelisiniz.
7. Kanıt WebGL gerektirmez: `dispose()` gerçek bir `"dispose"` olayı yayınladığı için, o olayı dinleyen sayan bir `DisposeSpy` ile 200 döngüyü vitest altında deterministik koşarsınız. Doğru sürümde drift dört alanda da tam sıfır.

Kodun tamamı — sahne yöneticisi, gezgin, refcount'lu doku cache'i, `MemoryProbe`, sayan sahte renderer, tarayıcı demosu ve testler — GitHub'da. README'deki komutlarla `npm test` deyip 200 döngü kanıtını yeşile boyayabilir, `npm run dev` deyip gerçek `renderer.info.memory` sayaçlarının naif sürümde tırmanışını, doğru sürümde düz çizgisini kendi tarayıcınızda görebilirsiniz.

Bu yazıyı yazarken fark ettiğim şey şu oldu. 2D serisinde çöp toplayıcı bizim tarafımızdaydı; tek yapmamız gereken ona daha az iş vermekti, gerisini o hallederdi. 3D'ye geçince ilk öğrendiğim ders, o yardımın bittiği sınır oldu. GPU ayrı bir ülke ve çöpçünün orada pasaportu yok. İtiraf edeyim, kendi jam projelerimde bazen tembellik edip bu defteri tutmayı ertelerim — iki kez menüye dönen küçük bir demoda tarayıcı zaten sekmeyi kapatınca her şeyi temizler, kimse fark etmez. Ama seri büyüdükçe, seviyeler ağırlaştıkça, "unutmayın" cümlesinin bir dilek olmaktan çıkıp bir `unload` metoduna, bir gezgine, bir refcount'a dönüşmesi gerekiyor. Çünkü artık unutmak elimizde değil — kod unutmuyor. Mesele de tam olarak bu. ⚙️🧠
