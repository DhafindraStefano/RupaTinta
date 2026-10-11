// Illustrator logins. There is no server, so these are checked in the browser and anyone can read them in the page
// source: fine for this class prototype, never for real accounts.
export interface Account { email: string; password: string; artist: string } // `artist` = slug in src/data/artists.ts

export const accounts: Account[] = [
  { email: 'nara@rupatinta.id', password: 'nara2026', artist: 'nara-illustration' },
  { email: 'rakai@rupatinta.id', password: 'rakai2026', artist: 'rakai-studio' },
  { email: 'kirana@rupatinta.id', password: 'kirana2026', artist: 'kirana-draws' },
  { email: 'bima@rupatinta.id', password: 'bima2026', artist: 'bima-pixel' },
];
