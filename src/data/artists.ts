export type Category = 'Ilustrasi' | 'Character Design' | 'Chibi' | 'Emote & Stiker';
export type Art = 'a1'|'a2'|'a3'|'a4'|'a5'|'a6'|'a7'|'a8'; // CSS placeholder art classes from the prototype

export interface Artist {
  slug: string; name: string; city: string;
  categories: Category[]; mainLabel: string;    // shown after the price, e.g. "Chibi"
  priceFrom: number;                            // IDR
  whatsapp: string;                             // 62… format for wa.me links (placeholder numbers until artists send theirs)
  services: string[];                            // options in the booking form
  avatar: Art; cover: [Art, Art, Art]; gallery: Art[];
  bio: string;
}

export const CATEGORIES: Category[] = ['Ilustrasi', 'Character Design', 'Chibi', 'Emote & Stiker'];

export const artists: Artist[] = [
  { slug:'nara-illustration', name:'Nara Illustration', city:'Bandung', categories:['Chibi','Character Design'], mainLabel:'Chibi', priceFrom:150000, whatsapp:'6281200000001',
    services:['Chibi','Headshot','Full body'],
    avatar:'a1', cover:['a5','a1','a3'], gallery:['a5','a1','a3','a7','a2','a4'],
    bio:'Spesialis chibi dan karakter imut untuk VTuber, OC, dan hadiah.' },
  { slug:'rakai-studio', name:'Rakai Studio', city:'Yogyakarta', categories:['Character Design','Ilustrasi'], mainLabel:'Character', priceFrom:450000, whatsapp:'6281200000002',
    services:['Character sheet','Full body','Turnaround'],
    avatar:'a2', cover:['a2','a8','a4'], gallery:['a2','a8','a4','a6','a3','a5'],
    bio:'Desain karakter lengkap dengan turnaround untuk game dan webtoon.' },
  { slug:'kirana-draws', name:'Kirana Draws', city:'Jakarta', categories:['Ilustrasi'], mainLabel:'Ilustrasi', priceFrom:300000, whatsapp:'6281200000003',
    services:['Ilustrasi scene','Cover buku','Poster'],
    avatar:'a3', cover:['a7','a6','a5'], gallery:['a7','a6','a5','a1','a8','a3'],
    bio:'Ilustrasi penuh warna untuk cover, poster, dan merchandise.' },
  { slug:'bima-pixel', name:'Bima Pixel', city:'Surabaya', categories:['Emote & Stiker','Chibi'], mainLabel:'Emote', priceFrom:100000, whatsapp:'6281200000004',
    services:['Emote set','Stiker','Chibi'],
    avatar:'a4', cover:['a3','a4','a7'], gallery:['a3','a4','a7','a2','a5','a1'],
    bio:'Emote Twitch/Discord dan stiker WhatsApp dengan gaya bold.' },
];

export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);

export const getArtist = (slug: string) => artists.find((a) => a.slug === slug);
