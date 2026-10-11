export type Category = 'Ilustrasi' | 'Character Design' | 'Chibi' | 'Emote & Stiker';
export const CATEGORIES: Category[] = ['Ilustrasi', 'Character Design', 'Chibi', 'Emote & Stiker'];
export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);
