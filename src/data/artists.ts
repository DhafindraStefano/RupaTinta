export type Category = 'Ilustrasi' | 'Character Design' | 'Chibi' | 'Emote & Stiker';
export type QueueStatus = 'Selesai' | 'Dikerjakan' | 'Menunggu';
export type Art = 'a1'|'a2'|'a3'|'a4'|'a5'|'a6'|'a7'|'a8'; // CSS placeholder art classes from the prototype

export interface Artist {
  slug: string; name: string; city: string;
  categories: Category[]; mainLabel: string;    // shown after the price, e.g. "Chibi"
  priceFrom: number;                            // IDR
  slots: { period: string; total: number; filled: number };
  queue: { client: string; type: string; status: QueueStatus }[]; // masked names
  avatar: Art; cover: [Art, Art, Art]; gallery: Art[];
  bio: string;
}

export const CATEGORIES: Category[] = ['Ilustrasi', 'Character Design', 'Chibi', 'Emote & Stiker'];

export const artists: Artist[] = [
  { slug:'nara-illustration', name:'Nara Illustration', city:'Bandung', categories:['Chibi','Character Design'], mainLabel:'Chibi', priceFrom:150000,
    slots:{period:'Oktober', total:6, filled:4},
    queue:[{client:'ra***n',type:'Chibi',status:'Selesai'},{client:'di***a',type:'Full body',status:'Dikerjakan'},{client:'ka***i',type:'Headshot',status:'Menunggu'},{client:'fa***y',type:'Chibi',status:'Menunggu'}],
    avatar:'a1', cover:['a5','a1','a3'], gallery:['a5','a1','a3','a7','a2','a4'],
    bio:'Spesialis chibi dan karakter imut untuk VTuber, OC, dan hadiah.' },
  { slug:'rakai-studio', name:'Rakai Studio', city:'Yogyakarta', categories:['Character Design','Ilustrasi'], mainLabel:'Character', priceFrom:450000,
    slots:{period:'Oktober', total:7, filled:2},
    queue:[{client:'an***a',type:'Character sheet',status:'Dikerjakan'},{client:'bu***i',type:'Full body',status:'Menunggu'}],
    avatar:'a2', cover:['a2','a8','a4'], gallery:['a2','a8','a4','a6','a3','a5'],
    bio:'Desain karakter lengkap dengan turnaround untuk game dan webtoon.' },
  { slug:'kirana-draws', name:'Kirana Draws', city:'Jakarta', categories:['Ilustrasi'], mainLabel:'Ilustrasi', priceFrom:300000,
    slots:{period:'Oktober', total:5, filled:5},
    queue:[{client:'me***a',type:'Ilustrasi scene',status:'Dikerjakan'},{client:'yo***o',type:'Cover buku',status:'Menunggu'},{client:'sa***s',type:'Poster',status:'Menunggu'}],
    avatar:'a3', cover:['a7','a6','a5'], gallery:['a7','a6','a5','a1','a8','a3'],
    bio:'Ilustrasi penuh warna untuk cover, poster, dan merchandise.' },
  { slug:'bima-pixel', name:'Bima Pixel', city:'Surabaya', categories:['Emote & Stiker','Chibi'], mainLabel:'Emote', priceFrom:100000,
    slots:{period:'Oktober', total:6, filled:2},
    queue:[{client:'ri***o',type:'Emote set',status:'Selesai'},{client:'ge***n',type:'Stiker',status:'Dikerjakan'}],
    avatar:'a4', cover:['a3','a4','a7'], gallery:['a3','a4','a7','a2','a5','a1'],
    bio:'Emote Twitch/Discord dan stiker WhatsApp dengan gaya bold.' },
];

export const remaining = (a: Artist) => a.slots.total - a.slots.filled;
export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);

// Slot badge: 0 → Penuh, 1–2 → few, ≥3 → open
export const slotBadge = (a: Artist) => {
  const n = remaining(a);
  if (n <= 0) return { label: 'Penuh', cls: 'st-full' };
  return { label: `${n} slot`, cls: n <= 2 ? 'st-few' : 'st-open' };
};
