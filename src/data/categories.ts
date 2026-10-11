// Starting categories. Illustrators can add more from their profile editor; those are saved in Firestore
// (categories collection) and offered to every illustrator after them.
export type Category = string;
export const CATEGORIES: Category[] = ['Ilustrasi', 'Character Design', 'Chibi', 'Emote & Stiker'];
export const MAX_CATEGORIES = 8; // per illustrator
export const rupiah = (n: number) => 'Rp' + new Intl.NumberFormat('id-ID').format(n);
