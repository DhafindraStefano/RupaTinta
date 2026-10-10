// Accepts 0812…, 62812…, +62 812-… and returns 62812… (or null if it doesn't look like an Indonesian mobile number).
export function normalizeWhatsapp(input: string) {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^628\d{7,12}$/.test(d) ? d : null;
}
