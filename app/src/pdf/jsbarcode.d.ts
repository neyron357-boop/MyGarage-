declare module 'jsbarcode/bin/barcodes/CODE128/CODE128B' {
  export default class CODE128B {
    constructor(data: string, options: Record<string, unknown>);
    valid(): boolean;
    encode(): { text: string; data: string };
  }
}
